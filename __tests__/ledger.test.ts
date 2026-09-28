import { verifyPaymentQR, verifyReceipt } from '@/domain/credential';
import { evaluateOfflineLimits, rollingDayStart } from '@/domain/limits';
import type { LedgerTransaction } from '@/domain/types';
import { createMemoryLedger } from '@/services/ledger';
import { encodeQr } from '@/services/qr';
import { toReconcileEntries } from '@/domain/reconcile';
import { DAY, LIMITS, makePilgrim, makePlatform, makeQr, makeReceipt, makeVendor, MERCHANT } from './helpers';

const row = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: over.id ?? 'id',
  nonce: over.nonce ?? 'nonce-' + (over.id ?? 'id'),
  direction: 'IN',
  amount: 10000,
  currency: 'INR',
  mode: 'OFFLINE',
  status: 'PENDING_SYNC',
  merchant_id: MERCHANT.id,
  merchant_name: MERCHANT.name,
  payer_id: 'p',
  payer_name: 'Arjun',
  device_id: 'dev',
  created_at: new Date().toISOString(),
  expires_at: null,
  accepted_at: null,
  synced_at: null,
  settled_at: null,
  memo: null,
  payload_json: null,
  receipt_json: null,
  sync_attempts: 0,
  last_error: null,
  fraud_flags: [],
  ...over,
});

describe('local ledger', () => {
  it('stores, lists and aggregates', async () => {
    const l = createMemoryLedger();
    await l.insert(row({ id: 'a', amount: 5000 }));
    await l.insert(row({ id: 'b', amount: 7000, status: 'SYNCED' }));
    await l.insert(row({ id: 'c', amount: 9000, status: 'SETTLED', direction: 'OUT' }));
    const s = await l.stats('IN');
    expect(s).toMatchObject({ pendingCount: 1, pendingAmount: 5000, syncedCount: 1, totalCount: 2, totalAmount: 12000 });
    expect((await l.pending()).map((t) => t.id)).toEqual(['a']);
    expect((await l.list({ direction: 'OUT' })).map((t) => t.id)).toEqual(['c']);
  });

  it('applies sync results and status updates', async () => {
    const l = createMemoryLedger();
    await l.insert(row({ id: 'a' }));
    await l.applySyncResult('a', { status: 'SYNCED', synced_at: '2026-09-20T10:00:00.000Z', flags: ['ABOVE_REVIEW_THRESHOLD'] });
    expect(await l.get('a')).toMatchObject({ status: 'SYNCED', synced_at: '2026-09-20T10:00:00.000Z', fraud_flags: ['ABOVE_REVIEW_THRESHOLD'], sync_attempts: 1 });
    await l.updateStatus('a', 'SETTLED', { settled_at: '2026-09-22T00:00:00.000Z' });
    expect((await l.get('a'))?.status).toBe('SETTLED');
    expect((await l.stats('IN')).settledCount).toBe(1);
  });

  it('remembers nonces for local replay protection', async () => {
    const l = createMemoryLedger();
    expect(await l.hasNonce('n1')).toBe(false);
    await l.rememberNonce('n1');
    expect(await l.hasNonce('n1')).toBe(true);
    await l.insert(row({ id: 'z', nonce: 'n2' }));
    expect(await l.hasNonce('n2')).toBe(true);
  });

  it('sums offline spend in the rolling window for the daily limit', async () => {
    const l = createMemoryLedger();
    const now = new Date();
    await l.insert(row({ id: 'old', direction: 'OUT', amount: 4000_00, created_at: new Date(now.getTime() - 2 * DAY).toISOString() }));
    await l.insert(row({ id: 'recent', direction: 'OUT', amount: 3000_00, created_at: new Date(now.getTime() - 3_600_000).toISOString() }));
    await l.insert(row({ id: 'online', direction: 'OUT', amount: 3000_00, mode: 'ONLINE' }));
    const total = await l.offlineTotalSince('OUT', rollingDayStart(now).toISOString());
    expect(total).toBe(3000_00);
    expect(evaluateOfflineLimits({ amount: 1500_00, dailyOfflineTotal: total }, LIMITS).ok).toBe(true);
    expect(evaluateOfflineLimits({ amount: 2001_00, dailyOfflineTotal: total }, LIMITS).failures).toContain('EXCEEDS_DAILY_LIMIT');
  });

  it('keeps a sync log', async () => {
    const l = createMemoryLedger();
    await l.addSyncLog({ at: 'now', items: 3, accepted: 2, review: 1, rejected: 0, duplicates: 0, error: null });
    expect(await l.syncLogs()).toHaveLength(1);
    await l.clear();
    expect(await l.syncLogs()).toHaveLength(0);
  });
});

describe('end-to-end offline payment on two devices (pure domain)', () => {
  it('pilgrim signs -> vendor verifies + receipts + stores -> queue is sync-ready', async () => {
    const platform = makePlatform();
    const pilgrim = makePilgrim(platform);
    const vendorKey = makeVendor();
    const vendorLedger = createMemoryLedger();

    const qr = makeQr(pilgrim, 15000, { memo: 'Thali' });
    const check = verifyPaymentQR(qr, { platformPublicKey: platform.publicKey, expectedMerchantId: MERCHANT.id });
    expect(check.ok).toBe(true);
    expect(await vendorLedger.hasNonce(qr.auth.nonce)).toBe(false);

    const receipt = makeReceipt(qr, vendorKey);
    expect(verifyReceipt(receipt, platform.publicKey).ok).toBe(true);
    expect(receipt.receipt).toMatchObject({ amount: 15000, merchant_id: MERCHANT.id, status: 'PENDING_SYNC', synced_at: null, nonce: qr.auth.nonce, transaction_id: qr.auth.transaction_id });

    await vendorLedger.insert(row({ id: qr.auth.transaction_id, nonce: qr.auth.nonce, amount: 15000, payload_json: encodeQr(qr), receipt_json: encodeQr(receipt), created_at: qr.auth.created_at }));
    await vendorLedger.rememberNonce(qr.auth.nonce);

    // second scan of the same code is refused locally
    expect(await vendorLedger.hasNonce(qr.auth.nonce)).toBe(true);

    const pending = await vendorLedger.pending();
    expect(pending).toHaveLength(1);
    const entries = toReconcileEntries(pending);
    expect(entries[0]).toEqual({ transaction_id: qr.auth.transaction_id, nonce: qr.auth.nonce, amount: 15000, status: 'PENDING_SYNC', created_at: qr.auth.created_at });
  });
});
