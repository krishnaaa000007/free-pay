import { Router } from 'express';
import { z } from 'zod';
import { many, one, withUser } from '../db.js';
import { asyncHandler, authMiddleware, notFound, requireRole, validate } from '../middleware.js';
import { signMerchantQR, verifyMerchantQR } from '../services/credentials.js';
import type { MerchantQR } from '../services/types.js';

/** Merchant directory + platform-signed stall QR codes. */
export const merchantsRouter = Router();
merchantsRouter.use(authMiddleware);

merchantsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const q = String(req.query.q ?? '').trim();
    const rows = await withUser({ userId: me.userId, role: me.role }, (c) =>
      many(
        c,
        `SELECT m.id, m.code, m.name, m.category, m.is_verified, z.name AS zone_name, z.code AS zone_code
         FROM merchants m LEFT JOIN crowd_zones z ON z.id = m.zone_id
         WHERE ($1 = '' OR m.name ILIKE '%' || $1 || '%' OR m.code ILIKE '%' || $1 || '%')
         ORDER BY m.is_verified DESC, m.name LIMIT 100`,
        [q],
      ),
    );
    res.json({ merchants: rows });
  }),
);

merchantsRouter.get(
  '/me/qr',
  requireRole('VENDOR'),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const data = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const m = await one<{ id: string; name: string; category: string; zone_code: string | null }>(
        c,
        `SELECT m.id, m.name, m.category, z.code AS zone_code FROM merchants m LEFT JOIN crowd_zones z ON z.id = m.zone_id
         WHERE m.owner_id = $1 LIMIT 1`,
        [me.userId],
      );
      if (!m) throw notFound('No merchant profile');
      const device = await one<{ public_key: string }>(c, 'SELECT public_key FROM devices WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 1', [me.userId]);
      return signMerchantQR({ merchant_id: m.id, name: m.name, category: m.category, ...(m.zone_code ? { zone: m.zone_code } : {}), ...(device ? { pk: device.public_key } : {}) });
    });
    res.json({ qr: data, payload: JSON.stringify(data) });
  }),
);

merchantsRouter.post(
  '/verify-qr',
  validate(z.object({ qr: z.any() })),
  asyncHandler(async (req, res) => {
    const qr = (req.body as { qr: MerchantQR }).qr;
    const ok = verifyMerchantQR(qr);
    res.json({ ok });
  }),
);

merchantsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const row = await withUser({ userId: me.userId, role: me.role }, (c) =>
      one(
        c,
        `SELECT m.id, m.code, m.name, m.category, m.is_verified, m.created_at, z.name AS zone_name, z.code AS zone_code
         FROM merchants m LEFT JOIN crowd_zones z ON z.id = m.zone_id WHERE m.id = $1`,
        [req.params.id],
      ),
    );
    if (!row) throw notFound('Merchant not found');
    res.json({ merchant: row });
  }),
);
