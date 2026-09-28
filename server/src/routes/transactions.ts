import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { many, one, withUser } from '../db.js';
import { asyncHandler, authMiddleware, badRequest, notFound, requireRole, validate } from '../middleware.js';
import { audit } from '../services/audit.js';
import { verifyPaymentQR } from '../services/credentials.js';
import { reconcile, type LedgerEntry } from '../services/reconciliation.js';
import { getMerchantForUser } from '../services/settlement/index.js';
import { createOnlinePayment, ingestSyncBatch, upsertVendorSyncState, verifyOnlineReceiptForMerchant } from '../services/transactions.js';
import type { SignedPaymentQR, SignedReceipt, SyncItem, TransactionRow } from '../services/types.js';

export const transactionsRouter = Router();
transactionsRouter.use(authMiddleware);

const listQuery = z.object({
  status: z.enum(['PENDING_SYNC', 'SYNCED', 'SETTLED', 'FAILED']).optional(),
  mode: z.enum(['OFFLINE', 'ONLINE', 'NGO_CREDIT']).optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** RLS does the tenant filtering: pilgrims see their payments, vendors their stall's. */
transactionsRouter.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const rows = await withUser({ userId: me.userId, role: me.role }, (c) =>
      many(
        c,
        `SELECT t.id, t.nonce, t.payer_id, t.merchant_id, m.name AS merchant_name, m.category AS merchant_category,
                p.name AS payer_name, t.amount, t.currency, t.mode, t.status, t.created_at, t.expires_at, t.accepted_at,
                t.synced_at, t.settled_at, t.fraud_decision, t.fraud_flags, t.suspicious, t.memo, t.settlement_id
         FROM transactions t
         JOIN merchants m ON m.id = t.merchant_id
         LEFT JOIN public_profiles p ON p.id = t.payer_id
         WHERE ($1::txn_status IS NULL OR t.status = $1)
           AND ($2::txn_mode IS NULL OR t.mode = $2)
           AND ($3::timestamptz IS NULL OR t.created_at >= $3)
         ORDER BY t.created_at DESC LIMIT $4 OFFSET $5`,
        [q.status ?? null, q.mode ?? null, q.since ?? null, q.limit, q.offset],
      ),
    );
    res.json({ transactions: rows, limit: q.limit, offset: q.offset });
  }),
);

/* ------------------------------------------------------------------ */
/* Vendor: sync offline transactions                                    */
/* ------------------------------------------------------------------ */
const syncSchema = z.object({
  device_id: z.string().min(8).max(120),
  items: z.array(z.object({ payload: z.any(), receipt: z.any(), accepted_at: z.string(), vendor_device_id: z.string() })).max(200),
  pending_after_sync: z.object({ count: z.number().int().min(0), amount: z.number().int().min(0) }).optional(),
  client: z.object({ app_version: z.string().optional(), battery_pct: z.number().int().min(0).max(100).optional(), network: z.string().optional() }).optional(),
});

transactionsRouter.post(
  '/sync',
  requireRole('VENDOR'),
  validate(syncSchema),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const body = req.body as z.infer<typeof syncSchema>;
    const out = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const merchant = await getMerchantForUser(c, me.userId);
      if (body.items.length === 0) {
        await upsertVendorSyncState(c, {
          merchantId: merchant.id,
          userId: me.userId,
          deviceId: body.device_id,
          pendingCount: body.pending_after_sync?.count ?? 0,
          pendingAmount: body.pending_after_sync?.amount ?? 0,
          clientInfo: { appVersion: body.client?.app_version, batteryPct: body.client?.battery_pct, network: body.client?.network },
        });
        return { batchId: null, results: [], counters: { accepted: 0, review: 0, rejected: 0, duplicates: 0 }, syncedAt: new Date().toISOString() };
      }
      return ingestSyncBatch(c, {
        user: me,
        merchantId: merchant.id,
        deviceId: body.device_id,
        items: body.items as SyncItem[],
        pendingAfterSync: body.pending_after_sync,
        clientInfo: { appVersion: body.client?.app_version, batteryPct: body.client?.battery_pct, network: body.client?.network },
      });
    });
    res.json({ batch_id: out.batchId, synced_at: out.syncedAt, summary: out.counters, results: out.results });
  }),
);

/** Vendor heartbeat without payloads (keeps the ops dashboard's pending-sync view fresh). */
transactionsRouter.post(
  '/heartbeat',
  requireRole('VENDOR'),
  validate(z.object({ device_id: z.string().min(8), pending_count: z.number().int().min(0), pending_amount: z.number().int().min(0), client: syncSchema.shape.client })),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const b = req.body as { device_id: string; pending_count: number; pending_amount: number; client?: { app_version?: string; battery_pct?: number; network?: string } };
    await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const merchant = await getMerchantForUser(c, me.userId);
      await upsertVendorSyncState(c, {
        merchantId: merchant.id,
        userId: me.userId,
        deviceId: b.device_id,
        pendingCount: b.pending_count,
        pendingAmount: b.pending_amount,
        clientInfo: { appVersion: b.client?.app_version, batteryPct: b.client?.battery_pct, network: b.client?.network },
      });
    });
    res.json({ ok: true, server_time: new Date().toISOString() });
  }),
);

/* Vendor: reconcile local ledger against the server. */
transactionsRouter.post(
  '/reconcile',
  requireRole('VENDOR'),
  validate(z.object({ entries: z.array(z.object({ transaction_id: z.string(), nonce: z.string(), amount: z.number().int(), status: z.enum(['PENDING_SYNC', 'SYNCED', 'SETTLED', 'FAILED']), created_at: z.string() })).max(2000) })),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const { entries } = req.body as { entries: LedgerEntry[] };
    const report = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const merchant = await getMerchantForUser(c, me.userId);
      const since = entries.length ? entries.reduce((m, e) => (e.created_at < m ? e.created_at : m), entries[0].created_at) : new Date(0).toISOString();
      const server = await many<LedgerEntry>(
        c,
        `SELECT id AS transaction_id, nonce, amount, status, created_at FROM transactions
         WHERE merchant_id = $1 AND created_at >= $2::timestamptz - interval '1 day' AND mode = 'OFFLINE'`,
        [merchant.id, since],
      );
      return reconcile(entries, server);
    });
    res.json(report);
  }),
);

/* ------------------------------------------------------------------ */
/* Pilgrim: online payment                                               */
/* ------------------------------------------------------------------ */
transactionsRouter.post(
  '/online',
  requireRole('PILGRIM'),
  validate(z.object({ merchant_id: z.string().uuid(), amount: z.number().int().positive().max(50_000_00), device_id: z.string().min(8), memo: z.string().max(120).optional() })),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const b = req.body as { merchant_id: string; amount: number; device_id: string; memo?: string };
    const out = await withUser({ userId: me.userId, role: me.role }, (c) =>
      createOnlinePayment(c, { user: me, merchantId: b.merchant_id, amount: b.amount, deviceId: b.device_id, memo: b.memo }),
    );
    res.status(201).json({ transaction: out.transaction, receipt: out.receipt, receipt_payload: JSON.stringify(out.receipt) });
  }),
);

/* Anyone authenticated may dry-run verify a payment QR (used by the demo + vendor UI when online). */
transactionsRouter.post(
  '/verify-qr',
  validate(z.object({ qr: z.any() })),
  asyncHandler(async (req, res) => {
    const qr = (req.body as { qr: SignedPaymentQR }).qr;
    const result = verifyPaymentQR(qr, { maxOfflineAgeMs: config.fraud.maxOfflineAgeMs });
    const nonceSeen = qr?.auth?.nonce
      ? await withUser({ userId: req.user!.userId, role: req.user!.role }, async (c) => (await c.query('SELECT app_nonce_exists($1) AS v', [qr.auth.nonce])).rows[0]?.v as boolean)
      : false;
    res.json({ ok: result.ok && !nonceSeen, failures: [...result.failures, ...(nonceSeen ? [{ code: 'DUPLICATE_NONCE', message: 'This payment code was already used' }] : [])] });
  }),
);

/* Vendor: verify an ONLINE receipt shown by a pilgrim (15-minute validity). */
transactionsRouter.post(
  '/verify-receipt',
  requireRole('VENDOR'),
  validate(z.object({ receipt: z.any() })),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const signed = (req.body as { receipt: SignedReceipt }).receipt;
    const out = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const merchant = await getMerchantForUser(c, me.userId);
      return verifyOnlineReceiptForMerchant(c, signed, merchant.id);
    });
    res.json(out);
  }),
);

/* ------------------------------------------------------------------ */
/* Detail + admin annotation                                            */
/* ------------------------------------------------------------------ */
transactionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    if (!z.string().uuid().safeParse(req.params.id).success) throw badRequest('Invalid transaction id');
    const data = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const t = await one<TransactionRow & { merchant_name: string; payer_name: string | null }>(
        c,
        `SELECT t.*, m.name AS merchant_name, m.code AS merchant_code, p.name AS payer_name
         FROM transactions t JOIN merchants m ON m.id = t.merchant_id LEFT JOIN public_profiles p ON p.id = t.payer_id
         WHERE t.id = $1`,
        [req.params.id],
      );
      if (!t) return null;
      const annotations = await many(c, 'SELECT a.*, au.name AS admin_name FROM transaction_annotations a LEFT JOIN admin_users au ON au.id = a.admin_id WHERE a.transaction_id = $1 ORDER BY a.created_at', [t.id]);
      const settlement = t.settlement_id ? await one(c, 'SELECT id, status, provider_ref, requested_at, processed_at FROM settlements WHERE id = $1', [t.settlement_id]) : null;
      // Never leak the raw signed payload to pilgrims; vendors/admins get it for audit.
      if (me.role === 'PILGRIM') {
        const { payload: _p, ...rest } = t as TransactionRow & { payload?: unknown };
        return { transaction: rest, annotations, settlement };
      }
      return { transaction: t, annotations, settlement };
    });
    if (!data) throw notFound('Transaction not found');
    res.json(data);
  }),
);

/** Admins may annotate or flag, never edit. Amounts are immutable at the database level. */
transactionsRouter.post(
  '/:id/annotate',
  requireRole('ADMIN'),
  validate(z.object({ kind: z.enum(['NOTE', 'FLAG', 'UNFLAG', 'REVIEW_APPROVED', 'REVIEW_REJECTED']), note: z.string().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const { kind, note } = req.body as { kind: string; note?: string };
    const row = await withUser({ userId: me.userId, role: 'ADMIN' }, async (c) => {
      const t = await one<TransactionRow>(c, 'SELECT * FROM transactions WHERE id = $1', [req.params.id]);
      if (!t) throw notFound('Transaction not found');
      const a = await one(c, 'INSERT INTO transaction_annotations (transaction_id, admin_id, kind, note) VALUES ($1, $2, $3, $4) RETURNING *', [t.id, me.userId, kind, note ?? null]);
      if (kind === 'FLAG') await c.query('UPDATE transactions SET suspicious = true WHERE id = $1', [t.id]);
      if (kind === 'UNFLAG' || kind === 'REVIEW_APPROVED') await c.query('UPDATE transactions SET suspicious = false WHERE id = $1', [t.id]);
      if (kind === 'REVIEW_REJECTED') await c.query(`UPDATE transactions SET status = 'FAILED' WHERE id = $1 AND status = 'SYNCED'`, [t.id]);
      await audit(c, { actorId: me.userId, actorRole: 'ADMIN', action: `TXN_${kind}`, entity: 'transactions', entityId: t.id, meta: { note } });
      return a;
    });
    res.status(201).json({ annotation: row });
  }),
);
