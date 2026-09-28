import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { many, one } from '../../db.js';
import { ApiError, notFound } from '../../middleware.js';
import { MockSandboxSettlementProvider } from './provider.js';
import type { SettlementProvider } from './types.js';

export * from './types.js';
export { MockSandboxSettlementProvider } from './provider.js';

let provider: SettlementProvider = new MockSandboxSettlementProvider();
export function setSettlementProvider(p: SettlementProvider) {
  provider = p;
}

export interface SettlementSummary {
  merchant: { id: string; name: string; code: string; settlement_account: string | null };
  available: { amount: number; count: number; oldest_at: string | null };
  processing: { amount: number; count: number };
  settled: { amount: number; count: number; last_at: string | null };
  today: { amount: number; count: number; offline_count: number };
  recent: SettlementRow[];
}

export interface SettlementRow {
  id: string;
  merchant_id: string;
  amount: number;
  txn_count: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  provider: string;
  provider_ref: string | null;
  requested_at: string;
  processed_at: string | null;
  failure_reason: string | null;
  merchant_name?: string;
}

export async function getMerchantForUser(client: pg.PoolClient, userId: string) {
  const m = await one<{ id: string; name: string; code: string; settlement_account: string | null }>(
    client,
    'SELECT id, name, code, settlement_account FROM merchants WHERE owner_id = $1 ORDER BY created_at LIMIT 1',
    [userId],
  );
  if (!m) throw notFound('No merchant profile for this vendor');
  return m;
}

export async function getSettlementSummary(client: pg.PoolClient, merchantId: string): Promise<SettlementSummary> {
  const merchant = await one<SettlementSummary['merchant']>(
    client,
    'SELECT id, name, code, settlement_account FROM merchants WHERE id = $1',
    [merchantId],
  );
  if (!merchant) throw notFound('Merchant not found');

  const agg = await one<{
    avail_amount: number; avail_count: number; oldest: string | null;
    proc_amount: number; proc_count: number;
    settled_amount: number; settled_count: number; last_settled: string | null;
    today_amount: number; today_count: number; today_offline: number;
  }>(
    client,
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE status = 'SYNCED' AND settlement_id IS NULL), 0)::bigint AS avail_amount,
       COUNT(*) FILTER (WHERE status = 'SYNCED' AND settlement_id IS NULL)::int AS avail_count,
       MIN(created_at) FILTER (WHERE status = 'SYNCED' AND settlement_id IS NULL) AS oldest,
       COALESCE(SUM(amount) FILTER (WHERE status = 'SYNCED' AND settlement_id IS NOT NULL), 0)::bigint AS proc_amount,
       COUNT(*) FILTER (WHERE status = 'SYNCED' AND settlement_id IS NOT NULL)::int AS proc_count,
       COALESCE(SUM(amount) FILTER (WHERE status = 'SETTLED'), 0)::bigint AS settled_amount,
       COUNT(*) FILTER (WHERE status = 'SETTLED')::int AS settled_count,
       MAX(settled_at) AS last_settled,
       COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('day', now()) AND status <> 'FAILED'), 0)::bigint AS today_amount,
       COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()) AND status <> 'FAILED')::int AS today_count,
       COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()) AND mode = 'OFFLINE')::int AS today_offline
     FROM transactions WHERE merchant_id = $1`,
    [merchantId],
  );
  const recent = await many<SettlementRow>(
    client,
    'SELECT * FROM settlements WHERE merchant_id = $1 ORDER BY requested_at DESC LIMIT 10',
    [merchantId],
  );
  return {
    merchant,
    available: { amount: agg?.avail_amount ?? 0, count: agg?.avail_count ?? 0, oldest_at: agg?.oldest ?? null },
    processing: { amount: agg?.proc_amount ?? 0, count: agg?.proc_count ?? 0 },
    settled: { amount: agg?.settled_amount ?? 0, count: agg?.settled_count ?? 0, last_at: agg?.last_settled ?? null },
    today: { amount: agg?.today_amount ?? 0, count: agg?.today_count ?? 0, offline_count: agg?.today_offline ?? 0 },
    recent,
  };
}

/**
 * Settle every SYNCED, not-yet-settled transaction of the merchant in one batch.
 * Runs inside the caller's withUser transaction, so RLS scopes it to the vendor's stall.
 */
export async function requestSettlement(client: pg.PoolClient, params: { merchantId: string; userId: string }) {
  const merchant = await one<{ id: string; name: string; settlement_account: string | null }>(
    client,
    'SELECT id, name, settlement_account FROM merchants WHERE id = $1',
    [params.merchantId],
  );
  if (!merchant) throw notFound('Merchant not found');

  const txns = await many<{ id: string; amount: number }>(
    client,
    `SELECT id, amount FROM transactions
     WHERE merchant_id = $1 AND status = 'SYNCED' AND settlement_id IS NULL
     FOR UPDATE SKIP LOCKED`,
    [params.merchantId],
  );
  if (txns.length === 0) throw new ApiError(409, 'NOTHING_TO_SETTLE', 'No synced transactions are waiting for settlement');

  const amount = txns.reduce((a, t) => a + t.amount, 0);
  const settlementId = randomUUID();

  await client.query(
    `INSERT INTO settlements (id, merchant_id, requested_by, amount, txn_count, status, provider)
     VALUES ($1, $2, $3, $4, $5, 'PROCESSING', $6)`,
    [settlementId, params.merchantId, params.userId, amount, txns.length, provider.name],
  );
  await client.query('UPDATE transactions SET settlement_id = $1 WHERE id = ANY($2::uuid[])', [
    settlementId,
    txns.map((t) => t.id),
  ]);

  const result = await provider.initiatePayout({
    settlementId,
    merchantId: merchant.id,
    merchantName: merchant.name,
    destinationMasked: merchant.settlement_account,
    amount,
    txnCount: txns.length,
    currency: 'INR',
    idempotencyKey: settlementId,
  });

  if (result.status === 'COMPLETED') {
    await client.query(
      `UPDATE settlements SET status = 'COMPLETED', provider_ref = $2, processed_at = $3 WHERE id = $1`,
      [settlementId, result.providerRef, result.processedAt],
    );
    await client.query(`UPDATE transactions SET status = 'SETTLED', settled_at = $2 WHERE settlement_id = $1`, [
      settlementId,
      result.processedAt,
    ]);
  } else if (result.status === 'PROCESSING') {
    await client.query(`UPDATE settlements SET status = 'PROCESSING', provider_ref = $2 WHERE id = $1`, [
      settlementId,
      result.providerRef,
    ]);
  } else {
    await client.query(
      `UPDATE settlements SET status = 'FAILED', provider_ref = $2, processed_at = $3, failure_reason = $4 WHERE id = $1`,
      [settlementId, result.providerRef, result.processedAt, result.failureReason ?? 'UNKNOWN'],
    );
    // release the transactions so they can be retried in a later batch
    await client.query('UPDATE transactions SET settlement_id = NULL WHERE settlement_id = $1', [settlementId]);
  }

  const row = await one<SettlementRow>(client, 'SELECT * FROM settlements WHERE id = $1', [settlementId]);
  return { settlement: row!, provider: result };
}
