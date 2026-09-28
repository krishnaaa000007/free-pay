import { authorizationExpiry, credentialHealth, evaluateOfflineLimits, rollingDayStart } from '@/domain/limits';
import { formatINR, groupIndian, parseAmountInput } from '@/domain/money';
import { DAY, LIMITS } from './helpers';

describe('offline limits (client side)', () => {
  it('accepts a payment within both limits', () => {
    const r = evaluateOfflineLimits({ amount: 500_00, dailyOfflineTotal: 1000_00 }, LIMITS);
    expect(r.ok).toBe(true);
    expect(r.remainingToday).toBe(3500_00);
  });

  it('rejects above the per-payment limit (INR 2000)', () => {
    expect(evaluateOfflineLimits({ amount: 2000_00, dailyOfflineTotal: 0 }, LIMITS).ok).toBe(true);
    const r = evaluateOfflineLimits({ amount: 2000_01, dailyOfflineTotal: 0 }, LIMITS);
    expect(r.ok).toBe(false);
    expect(r.failures).toContain('EXCEEDS_SINGLE_TXN_LIMIT');
  });

  it('rejects when the rolling day limit (INR 5000) would be exceeded', () => {
    const r = evaluateOfflineLimits({ amount: 1500_00, dailyOfflineTotal: 4000_00 }, LIMITS);
    expect(r.failures).toContain('EXCEEDS_DAILY_LIMIT');
    expect(r.remainingToday).toBe(1000_00);
  });

  it('honours tighter certificate limits but never looser ones', () => {
    const tight = evaluateOfflineLimits({ amount: 600_00, dailyOfflineTotal: 0, certLimits: { per_txn: 500_00, daily: 1000_00 } }, LIMITS);
    expect(tight.failures).toContain('EXCEEDS_CERT_TXN_LIMIT');
    const loose = evaluateOfflineLimits({ amount: 3000_00, dailyOfflineTotal: 0, certLimits: { per_txn: 9999_00, daily: 99999_00 } }, LIMITS);
    expect(loose.failures).toContain('EXCEEDS_SINGLE_TXN_LIMIT');
  });

  it('rejects non-positive and fractional-paise amounts', () => {
    expect(evaluateOfflineLimits({ amount: 0, dailyOfflineTotal: 0 }, LIMITS).failures).toContain('NON_POSITIVE_AMOUNT');
    expect(evaluateOfflineLimits({ amount: 10.5, dailyOfflineTotal: 0 }, LIMITS).failures).toContain('NON_POSITIVE_AMOUNT');
  });

  it('computes the rolling window and authorisation expiry', () => {
    const now = new Date('2026-09-20T10:00:00Z');
    expect(rollingDayStart(now).toISOString()).toBe('2026-09-19T10:00:00.000Z');
    const certExpiry = new Date(now.getTime() + 3 * DAY).toISOString();
    expect(authorizationExpiry(now, certExpiry, LIMITS).toISOString()).toBe(certExpiry);
    const later = new Date(now.getTime() + 30 * DAY).toISOString();
    expect(authorizationExpiry(now, later, LIMITS).getTime()).toBe(now.getTime() + 10 * DAY);
  });

  it('reports credential health', () => {
    const now = new Date('2026-09-20T10:00:00Z');
    expect(credentialHealth(new Date(now.getTime() + 5 * DAY).toISOString(), now)).toMatchObject({ state: 'FRESH', daysLeft: 5 });
    expect(credentialHealth(new Date(now.getTime() + 6 * 3_600_000).toISOString(), now)).toMatchObject({ state: 'EXPIRING', hoursLeft: 6 });
    expect(credentialHealth(new Date(now.getTime() - 1).toISOString(), now).state).toBe('EXPIRED');
  });
});

describe('money formatting', () => {
  it('groups in the Indian style', () => {
    expect(groupIndian('1234567')).toBe('12,34,567');
    expect(groupIndian('100')).toBe('100');
    expect(groupIndian('1000')).toBe('1,000');
  });

  it('formats paise', () => {
    expect(formatINR(12000)).toBe('₹120');
    expect(formatINR(12050)).toBe('₹120.50');
    expect(formatINR(123456789)).toBe('₹12,34,567.89');
    expect(formatINR(-500)).toBe('-₹5');
    expect(formatINR(48250000, { compact: true })).toBe('₹4.83 L');
    expect(formatINR(1_50_00_000_00, { compact: true })).toBe('₹1.5 Cr');
  });

  it('parses keypad input', () => {
    expect(parseAmountInput('120')).toBe(12000);
    expect(parseAmountInput('120.5')).toBe(12050);
    expect(parseAmountInput('0.05')).toBe(5);
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('1.234')).toBeNull();
  });
});
