import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { config } from '../config.js';
import { many, one } from '../db.js';
import { ApiError, notFound } from '../middleware.js';
import { audit } from './audit.js';
import { verifyPaymentQR, type VerificationFailure } from './credentials.js';
import { randomNonce } from './crypto.js';
import { evaluateTransaction, FRAUD_CODES, rollingDayStart } from './fraud.js';
import { issuePlatformReceipt, verifyReceipt } from './receipt.js';
import type { AuthUser, SignedReceipt, SyncItem, SyncResult, TransactionRow } from './types.js';

/**
 * Transaction ingestion. Everything here runs inside a `withUser()` transaction so RLS
 * applies; cross-tenant facts come from the SECURITY DEFINER helper functions.
 */

export interface SyncBatchInput {
  user: AuthUser;
  merchantId: string;
  deviceId: string;
  items: SyncItem[];
  pendingAfterSync?: { count: number; amount: number };
  clientInfo?: { appVersion?: string; batteryPct?: number; network?: string };
}

export async function ingestSyncBatch(client: pg.PoolClient, input: SyncBatchInput) {
  const now = new Date();
  const batchId = randomUUID();
  await client.query(
    `INSERT INTO sync_batches (id, merchant_id, vendor_user_id, device_id, item_count) VALUES ($1, $2, $3, $4, $5)`,
    [batchId, input.merchantId, input.user.userId, input.deviceId, input.items.length],
  );

  // Vendor devices we trust to have signed receipts.
  const vendorDeviceKeys = new Set(
    (await many<{ public_key: string }>(client, 'SELECT public_key FROM devices WHERE user_id = $1 AND revoked_at IS NULL', [
      input.user.userId,
    ])).map((r) => r.public_key),
  );

  const results: SyncResult[] = [];
  const counters = { accepted: 0, review: 0, rejected: 0, duplicates: 0 };
  // Daily totals must include earlier items of this same batch.
  const inBatchDaily = new Map<string, Array<{ at: number; amount: number }>>();

  for (const item of input.items) {
    const qr = item.payload;
    const auth = qr?.auth;
    if (!auth?.transaction_id) {
      results.push({ transaction_id: 'unknown', status: 'FAILED', decision: 'REJECT', flags: ['MALFORMED_PAYLOAD'] });
      counters.rejected++;
      continue;
    }

    // Idempotent re-sync: the vendor already synced this exact transaction.
    const existing = await one<TransactionRow>(client, 'SELECT * FROM transactions WHERE id = $1', [auth.transaction_id]);
    if (existing && existing.nonce === auth.nonce && existing.amount === auth.amount && existing.merchant_id === auth.merchant_id) {
      results.push({
        transaction_id: existing.id,
        status: existing.status,
        decision: 'DUPLICATE',
        flags: existing.fraud_flags,
        synced_at: existing.synced_at ?? undefined,
        message: 'Already synced',
      });
      counters.duplicates++;
      continue;
    }

    const verification = verifyPaymentQR(qr, { now, maxOfflineAgeMs: config.fraud.maxOfflineAgeMs });
    const failures: VerificationFailure[] = [...verification.failures];

    // Receipt must be signed by one of this vendor's registered devices.
    const receiptCheck = verifyReceipt(item.receipt, { now });
    if (!receiptCheck.ok) {
      failures.push({ code: 'INVALID_RECEIPT', message: `Vendor receipt failed verification (${receiptCheck.reason})` });
    } else if (!vendorDeviceKeys.has(item.receipt.signer_pk)) {
      failures.push({ code: FRAUD_CODES.VENDOR_DEVICE_UNREGISTERED, message: 'Receipt signed by a device not registered to this vendor' });
    } else if (item.receipt.receipt.transaction_id !== auth.transaction_id || item.receipt.receipt.amount !== auth.amount) {
      failures.push({ code: 'RECEIPT_MISMATCH', message: 'Receipt does not match the authorisation' });
    }

    const createdAt = new Date(auth.created_at);
    const windowStart = rollingDayStart(Number.isNaN(createdAt.getTime()) ? now : createdAt);
    const [nonceSeen, txnSeen, merchantKnown, deviceOk, dailyTotal, recentCount] = await Promise.all([
      scalar<boolean>(client, 'SELECT app_nonce_exists($1) AS v', [auth.nonce]),
      scalar<boolean>(client, 'SELECT app_txn_exists($1) AS v', [auth.transaction_id]),
      scalar<boolean>(client, 'SELECT app_merchant_exists($1) AS v', [auth.merchant_id]),
      scalar<boolean>(client, 'SELECT app_device_belongs_to($1, $2) AS v', [auth.device_id, auth.payer_id]),
      scalar<number>(client, 'SELECT app_payer_offline_total($1, $2, $3) AS v', [auth.payer_id, windowStart.toISOString(), auth.created_at]),
      scalar<number>(client, 'SELECT app_payer_txn_count($1, $2) AS v', [
        auth.payer_id,
        new Date(now.getTime() - config.fraud.velocityWindowMs).toISOString(),
      ]),
    ]);

    const batchEarlier = (inBatchDaily.get(auth.payer_id) ?? [])
      .filter((x) => x.at >= windowStart.getTime() && x.at < createdAt.getTime())
      .reduce((a, x) => a + x.amount, 0);

    const verdict = evaluateTransaction(
      {
        transactionId: auth.transaction_id,
        nonce: auth.nonce,
        amount: auth.amount,
        createdAt: auth.created_at,
        expiresAt: auth.expires_at,
        merchantId: auth.merchant_id,
        payerId: auth.payer_id,
        deviceId: auth.device_id,
        mode: 'OFFLINE',
        submittingMerchantId: input.merchantId,
      },
      {
        now,
        nonceSeen: !!nonceSeen,
        transactionIdSeen: !!txnSeen,
        merchantKnown: !!merchantKnown,
        payerDeviceRegistered: !!deviceOk,
        payerDailyOfflineTotal: (dailyTotal ?? 0) + batchEarlier,
        payerRecentTxnCount: recentCount ?? 0,
        verificationFailures: failures,
      },
      config.fraud,
    );
    const flagCodes = verdict.flags.map((f) => f.code);

    if (verdict.decision === 'REJECT') {
      await client.query(
        `INSERT INTO rejected_transactions (transaction_id, nonce, merchant_id, payer_id, amount, reasons, payload, sync_batch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [auth.transaction_id, auth.nonce, input.merchantId, isUuid(auth.payer_id) ? auth.payer_id : null, auth.amount, flagCodes, qr, batchId],
      );
      results.push({
        transaction_id: auth.transaction_id,
        status: 'FAILED',
        decision: 'REJECT',
        flags: flagCodes,
        message: verdict.flags.find((f) => f.severity === 'HARD')?.message,
      });
      counters.rejected++;
      continue;
    }

    const syncedAt = now.toISOString();
    await client.query(
      `INSERT INTO transactions (id, nonce, payer_id, merchant_id, vendor_device_id, payer_device_id, amount, currency, mode, status,
         created_at, expires_at, accepted_at, synced_at, fraud_decision, fraud_flags, suspicious, memo, payload, receipt, sync_batch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'INR', 'OFFLINE', 'SYNCED', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        auth.transaction_id,
        auth.nonce,
        auth.payer_id,
        auth.merchant_id,
        input.deviceId,
        auth.device_id,
        auth.amount,
        auth.created_at,
        auth.expires_at,
        item.accepted_at ?? syncedAt,
        syncedAt,
        verdict.decision,
        flagCodes,
        verdict.suspicious,
        auth.memo ?? null,
        qr,
        item.receipt,
        batchId,
      ],
    );
    inBatchDaily.set(auth.payer_id, [...(inBatchDaily.get(auth.payer_id) ?? []), { at: createdAt.getTime(), amount: auth.amount }]);
    results.push({ transaction_id: auth.transaction_id, status: 'SYNCED', decision: verdict.decision, flags: flagCodes, synced_at: syncedAt });
    if (verdict.decision === 'REVIEW') counters.review++;
    else counters.accepted++;
  }

  await client.query(
    'UPDATE sync_batches SET accepted = $2, review = $3, rejected = $4, duplicates = $5 WHERE id = $1',
    [batchId, counters.accepted, counters.review, counters.rejected, counters.duplicates],
  );
  await upsertVendorSyncState(client, {
    merchantId: input.merchantId,
    userId: input.user.userId,
    deviceId: input.deviceId,
    pendingCount: input.pendingAfterSync?.count ?? 0,
    pendingAmount: input.pendingAfterSync?.amount ?? 0,
    lastSyncAt: now.toISOString(),
    clientInfo: input.clientInfo,
  });
  await audit(client, {
    actorId: input.user.userId,
    actorRole: input.user.role,
    action: 'SYNC_BATCH',
    entity: 'sync_batches',
    entityId: batchId,
    meta: { items: input.items.length, ...counters },
  });

  return { batchId, results, counters, syncedAt: now.toISOString() };
}

export async function upsertVendorSyncState(
  client: pg.PoolClient,
  p: {
    merchantId: string;
    userId: string;
    deviceId: string;
    pendingCount: number;
    pendingAmount: number;
    lastSyncAt?: string | null;
    clientInfo?: { appVersion?: string; batteryPct?: number; network?: string };
  },
) {
  await client.query(
    `INSERT INTO vendor_sync_state (merchant_id, vendor_user_id, device_id, pending_count, pending_amount, last_sync_at, last_seen_at, app_version, battery_pct, network)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9)
     ON CONFLICT (merchant_id) DO UPDATE SET
       device_id = EXCLUDED.device_id, pending_count = EXCLUDED.pending_count, pending_amount = EXCLUDED.pending_amount,
       last_sync_at = COALESCE(EXCLUDED.last_sync_at, vendor_sync_state.last_sync_at), last_seen_at = now(),
       app_version = COALESCE(EXCLUDED.app_version, vendor_sync_state.app_version),
       battery_pct = COALESCE(EXCLUDED.battery_pct, vendor_sync_state.battery_pct),
       network = COALESCE(EXCLUDED.network, vendor_sync_state.network)`,
    [p.merchantId, p.userId, p.deviceId, p.pendingCount, p.pendingAmount, p.lastSyncAt ?? null, p.clientInfo?.appVersion ?? null, p.clientInfo?.batteryPct ?? null, p.clientInfo?.network ?? null],
  );
}

/* ------------------------------------------------------------------ */
/* Online payments                                                      */
/* ------------------------------------------------------------------ */
export async function createOnlinePayment(
  client: pg.PoolClient,
  p: { user: AuthUser; merchantId: string; amount: number; deviceId: string; memo?: string },
): Promise<{ transaction: TransactionRow; receipt: SignedReceipt }> {
  const merchant = await one<{ id: string; name: string }>(client, 'SELECT id, name FROM merchants WHERE id = $1', [p.merchantId]);
  if (!merchant) throw notFound('Merchant not found');

  const now = new Date();
  const id = randomUUID();
  const nonce = randomNonce(16);
  const expiresAt = new Date(now.getTime() + config.onlineReceiptTtlMs).toISOString();
  const deviceOk = await scalar<boolean>(client, 'SELECT app_device_belongs_to($1, $2) AS v', [p.deviceId, p.user.userId]);
  const recentCount = await scalar<number>(client, 'SELECT app_payer_txn_count($1, $2) AS v', [
    p.user.userId,
    new Date(now.getTime() - config.fraud.velocityWindowMs).toISOString(),
  ]);

  const verdict = evaluateTransaction(
    {
      transactionId: id,
      nonce,
      amount: p.amount,
      createdAt: now.toISOString(),
      expiresAt,
      merchantId: p.merchantId,
      payerId: p.user.userId,
      deviceId: p.deviceId,
      mode: 'ONLINE',
    },
    {
      now,
      nonceSeen: false,
      transactionIdSeen: false,
      merchantKnown: true,
      payerDeviceRegistered: !!deviceOk,
      payerDailyOfflineTotal: 0,
      payerRecentTxnCount: recentCount ?? 0,
    },
    config.fraud,
  );
  if (verdict.decision === 'REJECT') {
    throw new ApiError(422, 'PAYMENT_REJECTED', verdict.flags[0]?.message ?? 'Payment rejected', { flags: verdict.flags });
  }

  const receipt = issuePlatformReceipt({
    transactionId: id,
    nonce,
    amount: p.amount,
    merchantId: merchant.id,
    merchantName: merchant.name,
    payerId: p.user.userId,
    mode: 'ONLINE',
    status: 'SYNCED',
    createdAt: now.toISOString(),
    expiresAt,
    syncedAt: now.toISOString(),
    now,
  });

  await client.query(
    `INSERT INTO transactions (id, nonce, payer_id, merchant_id, payer_device_id, amount, currency, mode, status, created_at, expires_at,
        accepted_at, synced_at, fraud_decision, fraud_flags, suspicious, memo, receipt)
     VALUES ($1, $2, $3, $4, $5, $6, 'INR', 'ONLINE', 'SYNCED', $7, $8, $7, $7, $9, $10, $11, $12, $13)`,
    [id, nonce, p.user.userId, merchant.id, p.deviceId, p.amount, now.toISOString(), expiresAt, verdict.decision, verdict.flags.map((f) => f.code), verdict.suspicious, p.memo ?? null, receipt],
  );
  const transaction = (await one<TransactionRow>(client, 'SELECT * FROM transactions WHERE id = $1', [id]))!;
  return { transaction, receipt };
}

/** Vendor-side verification of an online receipt shown by a pilgrim. */
export async function verifyOnlineReceiptForMerchant(client: pg.PoolClient, signed: SignedReceipt, merchantId: string) {
  const check = verifyReceipt(signed, { now: new Date() });
  if (!check.ok) return { ok: false as const, reason: check.reason, expired: check.expired ?? false };
  const row = await one<TransactionRow>(client, 'SELECT * FROM transactions WHERE id = $1', [signed.receipt.transaction_id]);
  if (!row) return { ok: false as const, reason: 'UNKNOWN_TRANSACTION' };
  if (row.merchant_id !== merchantId) return { ok: false as const, reason: 'MERCHANT_MISMATCH' };
  if (row.amount !== signed.receipt.amount || row.nonce !== signed.receipt.nonce) return { ok: false as const, reason: 'RECEIPT_MISMATCH' };
  return { ok: true as const, transaction: row };
}

async function scalar<T>(client: pg.PoolClient, sql: string, params: unknown[]): Promise<T | null> {
  const r = await client.query(sql, params);
  return (r.rows[0]?.v as T) ?? null;
}

function isUuid(s: string | undefined): boolean {
  return !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
