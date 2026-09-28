import { config } from '../src/config.js';
import { evaluateTransaction, FRAUD_CODES, rollingDayStart, type FraudContext, type FraudInput } from '../src/services/fraud.js';

const now = new Date('2026-09-20T10:00:00Z');

const baseInput = (over: Partial<FraudInput> = {}): FraudInput => ({
  transactionId: 'txn-1',
  nonce: 'nonce-1',
  amount: 50000, // INR 500
  createdAt: new Date(now.getTime() - 60_000).toISOString(),
  expiresAt: new Date(now.getTime() + 9 * 86_400_000).toISOString(),
  merchantId: 'm-1',
  payerId: 'p-1',
  deviceId: 'd-1',
  mode: 'OFFLINE',
  submittingMerchantId: 'm-1',
  ...over,
});

const cleanCtx = (over: Partial<FraudContext> = {}): FraudContext => ({
  now,
  nonceSeen: false,
  transactionIdSeen: false,
  merchantKnown: true,
  payerDeviceRegistered: true,
  payerDailyOfflineTotal: 0,
  payerRecentTxnCount: 0,
  ...over,
});

const codes = (v: { flags: Array<{ code: string }> }) => v.flags.map((f) => f.code);

describe('fraud engine', () => {
  it('accepts a clean offline transaction', () => {
    const v = evaluateTransaction(baseInput(), cleanCtx(), config.fraud);
    expect(v).toEqual({ decision: 'ACCEPT', flags: [], suspicious: false });
  });

  it('hard-rejects non-positive amounts', () => {
    expect(evaluateTransaction(baseInput({ amount: 0 }), cleanCtx(), config.fraud).decision).toBe('REJECT');
    expect(codes(evaluateTransaction(baseInput({ amount: -1 }), cleanCtx(), config.fraud))).toContain(FRAUD_CODES.NON_POSITIVE_AMOUNT);
  });

  it('hard-rejects duplicate nonce and replayed transaction id', () => {
    expect(codes(evaluateTransaction(baseInput(), cleanCtx({ nonceSeen: true }), config.fraud))).toContain(FRAUD_CODES.DUPLICATE_NONCE);
    const v = evaluateTransaction(baseInput(), cleanCtx({ transactionIdSeen: true }), config.fraud);
    expect(codes(v)).toContain(FRAUD_CODES.REPLAYED_TRANSACTION_ID);
    expect(v.decision).toBe('REJECT');
  });

  it('hard-rejects expired authorisations', () => {
    const v = evaluateTransaction(baseInput({ expiresAt: new Date(now.getTime() - 1000).toISOString() }), cleanCtx(), config.fraud);
    expect(codes(v)).toContain(FRAUD_CODES.EXPIRED_AUTHORIZATION);
    expect(v.decision).toBe('REJECT');
  });

  it('hard-rejects stale offline authorisations older than 10 days', () => {
    const created = new Date(now.getTime() - 11 * 86_400_000);
    const v = evaluateTransaction(
      baseInput({ createdAt: created.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString() }),
      cleanCtx(),
      config.fraud,
    );
    expect(codes(v)).toContain(FRAUD_CODES.STALE_OFFLINE_AUTHORIZATION);
    expect(v.decision).toBe('REJECT');
  });

  it('does not apply the staleness rule to online payments', () => {
    const created = new Date(now.getTime() - 11 * 86_400_000);
    const v = evaluateTransaction(baseInput({ mode: 'ONLINE', createdAt: created.toISOString() }), cleanCtx(), config.fraud);
    expect(codes(v)).not.toContain(FRAUD_CODES.STALE_OFFLINE_AUTHORIZATION);
  });

  it('flags a validity window longer than allowed as tampered expiry', () => {
    const v = evaluateTransaction(baseInput({ expiresAt: new Date(now.getTime() + 40 * 86_400_000).toISOString() }), cleanCtx(), config.fraud);
    expect(codes(v)).toContain(FRAUD_CODES.TAMPERED_EXPIRY);
  });

  it('hard-rejects future-dated authorisations', () => {
    const v = evaluateTransaction(baseInput({ createdAt: new Date(now.getTime() + 3_600_000).toISOString() }), cleanCtx(), config.fraud);
    expect(codes(v)).toContain(FRAUD_CODES.FUTURE_DATED);
  });

  it('enforces the per-transaction offline limit (INR 2000)', () => {
    expect(evaluateTransaction(baseInput({ amount: 2000_00 }), cleanCtx(), config.fraud).decision).not.toBe('REJECT');
    const v = evaluateTransaction(baseInput({ amount: 2000_01 }), cleanCtx(), config.fraud);
    expect(codes(v)).toContain(FRAUD_CODES.EXCEEDS_SINGLE_TXN_LIMIT);
    expect(v.decision).toBe('REJECT');
  });

  it('enforces the rolling daily offline limit (INR 5000)', () => {
    const ok = evaluateTransaction(baseInput({ amount: 1000_00 }), cleanCtx({ payerDailyOfflineTotal: 4000_00 }), config.fraud);
    expect(codes(ok)).not.toContain(FRAUD_CODES.EXCEEDS_DAILY_LIMIT);
    const over = evaluateTransaction(baseInput({ amount: 1000_01 }), cleanCtx({ payerDailyOfflineTotal: 4000_00 }), config.fraud);
    expect(codes(over)).toContain(FRAUD_CODES.EXCEEDS_DAILY_LIMIT);
    expect(over.decision).toBe('REJECT');
  });

  it('does not apply offline limits to online payments', () => {
    const v = evaluateTransaction(baseInput({ mode: 'ONLINE', amount: 2500_00 }), cleanCtx({ payerDailyOfflineTotal: 4900_00 }), config.fraud);
    expect(codes(v)).not.toContain(FRAUD_CODES.EXCEEDS_SINGLE_TXN_LIMIT);
    expect(codes(v)).not.toContain(FRAUD_CODES.EXCEEDS_DAILY_LIMIT);
  });

  it('hard-rejects an authorisation submitted by a different merchant', () => {
    const v = evaluateTransaction(baseInput({ submittingMerchantId: 'm-2' }), cleanCtx(), config.fraud);
    expect(codes(v)).toContain(FRAUD_CODES.MERCHANT_MISMATCH);
    expect(v.decision).toBe('REJECT');
  });

  it('soft-flags unknown merchant and device mismatch as suspicious but does not reject', () => {
    const v = evaluateTransaction(baseInput(), cleanCtx({ merchantKnown: false, payerDeviceRegistered: false }), config.fraud);
    expect(codes(v)).toEqual(expect.arrayContaining([FRAUD_CODES.UNKNOWN_MERCHANT, FRAUD_CODES.DEVICE_MISMATCH]));
    expect(v.decision).toBe('REVIEW');
    expect(v.suspicious).toBe(true);
    expect(v.flags.every((f) => f.severity === 'SOFT')).toBe(true);
  });

  it('routes amounts above the review threshold (INR 1500) to review', () => {
    const v = evaluateTransaction(baseInput({ amount: 1500_01 }), cleanCtx(), config.fraud);
    expect(codes(v)).toContain(FRAUD_CODES.ABOVE_REVIEW_THRESHOLD);
    expect(v.decision).toBe('REVIEW');
    expect(v.suspicious).toBe(false);
  });

  it('flags high velocity', () => {
    const v = evaluateTransaction(baseInput(), cleanCtx({ payerRecentTxnCount: config.fraud.velocityMaxTxns }), config.fraud);
    expect(codes(v)).toContain(FRAUD_CODES.HIGH_VELOCITY);
    expect(v.decision).toBe('REVIEW');
  });

  it('a HARD flag always wins over review/soft flags', () => {
    const v = evaluateTransaction(baseInput({ amount: 1800_00 }), cleanCtx({ nonceSeen: true, merchantKnown: false }), config.fraud);
    expect(v.decision).toBe('REJECT');
  });

  it('honours verification failures from the credential layer', () => {
    const v = evaluateTransaction(baseInput(), cleanCtx({ verificationFailures: [{ code: 'INVALID_SIGNATURE', message: 'bad sig' }] }), config.fraud);
    expect(v.decision).toBe('REJECT');
    expect(v.flags[0]).toEqual({ code: 'INVALID_SIGNATURE', severity: 'HARD', message: 'bad sig' });
  });

  it('is configurable through FraudConfig', () => {
    const strict = { ...config.fraud, maxSingleOfflinePaise: 100_00 };
    expect(evaluateTransaction(baseInput({ amount: 150_00 }), cleanCtx(), strict).decision).toBe('REJECT');
  });

  it('rollingDayStart is 24h before', () => {
    expect(rollingDayStart(now).toISOString()).toBe('2026-09-19T10:00:00.000Z');
  });
});
