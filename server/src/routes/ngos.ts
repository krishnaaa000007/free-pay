import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { many, one, withUser } from '../db.js';
import { ApiError, asyncHandler, authMiddleware, notFound, requireRole, validate } from '../middleware.js';
import { audit } from '../services/audit.js';
import { issueNgoCredit, verifyNgoCredit } from '../services/ngoQr.js';
import { getMerchantForUser } from '../services/settlement/index.js';
import { trustScore, type NgoFacts } from '../services/ngoTrust.js';
import type { SignedNgoCredit } from '../services/types.js';

export const ngosRouter = Router();
ngosRouter.use(authMiddleware);

interface NgoRow extends NgoFacts {
  id: string;
  name: string;
  registration_no: string;
  category: string;
  trust_score: number;
  description: string | null;
  created_at: string;
}

const withTrust = (n: NgoRow) => ({ ...n, trust: trustScore(n) });

ngosRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const rows = await withUser({ userId: me.userId, role: me.role }, (c) => many<NgoRow>(c, 'SELECT * FROM ngos ORDER BY trust_score DESC, name'));
    res.json({ ngos: rows.map(withTrust) });
  }),
);

ngosRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const data = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const n = await one<NgoRow>(c, 'SELECT * FROM ngos WHERE id = $1', [req.params.id]);
      if (!n) return null;
      const credits = me.role === 'ADMIN'
        ? await many(c, 'SELECT id, amount, purpose, issued_at, expires_at, redeemed_at, redeemed_merchant_id FROM ngo_credits WHERE ngo_id = $1 ORDER BY issued_at DESC LIMIT 50', [n.id])
        : [];
      return { ngo: withTrust(n), credits };
    });
    if (!data) throw notFound('NGO not found');
    res.json(data);
  }),
);

/** Admin (acting for a verified NGO) issues signed QR credits. */
ngosRouter.post(
  '/:id/credits',
  requireRole('ADMIN'),
  validate(z.object({ amount: z.number().int().positive().max(5_000_00), purpose: z.string().min(2).max(80), beneficiary_hint: z.string().max(80).optional(), count: z.number().int().min(1).max(50).default(1), ttl_hours: z.number().int().min(1).max(24 * 30).default(72) })),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const b = req.body as { amount: number; purpose: string; beneficiary_hint?: string; count: number; ttl_hours: number };
    const out = await withUser({ userId: me.userId, role: 'ADMIN' }, async (c) => {
      const ngo = await one<NgoRow>(c, 'SELECT * FROM ngos WHERE id = $1', [req.params.id]);
      if (!ngo) throw notFound('NGO not found');
      if (!ngo.verified) throw new ApiError(403, 'NGO_NOT_VERIFIED', 'Only verified NGOs may issue credits');
      const credits: SignedNgoCredit[] = [];
      for (let i = 0; i < b.count; i++) {
        const signed = issueNgoCredit({ ngoId: ngo.id, ngoName: ngo.name, amount: b.amount, purpose: b.purpose, beneficiaryHint: b.beneficiary_hint, ttlMs: b.ttl_hours * 3_600_000 });
        await c.query(
          `INSERT INTO ngo_credits (id, ngo_id, nonce, amount, purpose, beneficiary_hint, issued_by, issued_at, expires_at, credit_json, sig)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [signed.credit.credit_id, ngo.id, signed.credit.nonce, b.amount, b.purpose, b.beneficiary_hint ?? null, me.userId, signed.credit.issued_at, signed.credit.expires_at, signed, signed.sig],
        );
        credits.push(signed);
      }
      await c.query('UPDATE ngos SET credits_issued = credits_issued + $2, disbursed_total = disbursed_total + $3 WHERE id = $1', [ngo.id, b.count, b.amount * b.count]);
      await audit(c, { actorId: me.userId, actorRole: 'ADMIN', action: 'NGO_CREDIT_ISSUED', entity: 'ngos', entityId: ngo.id, meta: { count: b.count, amount: b.amount, purpose: b.purpose } });
      return credits;
    });
    res.status(201).json({ credits: out, payloads: out.map((c) => JSON.stringify(c)) });
  }),
);

/** Vendor redeems a credit shown by a beneficiary. Verified offline first; redeemed atomically here. */
ngosRouter.post(
  '/credits/redeem',
  requireRole('VENDOR'),
  validate(z.object({ credit: z.any(), device_id: z.string().min(8) })),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const { credit, device_id } = req.body as { credit: SignedNgoCredit; device_id: string };
    const check = verifyNgoCredit(credit);
    if (!check.ok) throw new ApiError(422, check.reason ?? 'INVALID_CREDIT', 'Credit failed verification');

    const out = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const merchant = await getMerchantForUser(c, me.userId);
      const txnId = randomUUID();
      const redeemed = (await c.query('SELECT (app_redeem_ngo_credit($1, $2, $3)).*', [credit.credit.credit_id, merchant.id, txnId])).rows[0] as { id: string | null; amount: number } | undefined;
      if (!redeemed?.id) throw new ApiError(409, 'CREDIT_ALREADY_REDEEMED', 'This credit was already redeemed or has expired');
      const now = new Date().toISOString();
      await c.query(
        `INSERT INTO transactions (id, nonce, payer_id, merchant_id, vendor_device_id, amount, currency, mode, status, created_at, expires_at, accepted_at, synced_at, fraud_decision, memo, ngo_credit_id, payload)
         VALUES ($1, $2, NULL, $3, $4, $5, 'INR', 'NGO_CREDIT', 'SYNCED', $6, $7, $6, $6, 'ACCEPT', $8, $9, $10)`,
        [txnId, credit.credit.nonce, merchant.id, device_id, credit.credit.amount, now, credit.credit.expires_at, `${credit.credit.ngo_name}: ${credit.credit.purpose}`, credit.credit.credit_id, credit],
      );
      await audit(c, { actorId: me.userId, actorRole: me.role, action: 'NGO_CREDIT_REDEEMED', entity: 'ngo_credits', entityId: credit.credit.credit_id, meta: { amount: credit.credit.amount } });
      return { transaction_id: txnId, amount: credit.credit.amount, ngo_name: credit.credit.ngo_name, purpose: credit.credit.purpose };
    });
    res.status(201).json(out);
  }),
);
