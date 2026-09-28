import { Router } from 'express';
import { z } from 'zod';
import { many, one, withUser } from '../db.js';
import { asyncHandler, authMiddleware, notFound, requireRole, validate } from '../middleware.js';
import { audit } from '../services/audit.js';
import { getMerchantForUser, getSettlementSummary, requestSettlement, type SettlementRow } from '../services/settlement/index.js';

export const settlementRouter = Router();
settlementRouter.use(authMiddleware);

settlementRouter.get(
  '/summary',
  requireRole('VENDOR'),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const summary = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const merchant = await getMerchantForUser(c, me.userId);
      return getSettlementSummary(c, merchant.id);
    });
    res.json(summary);
  }),
);

settlementRouter.post(
  '/request',
  requireRole('VENDOR'),
  validate(z.object({ note: z.string().max(200).optional() })),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const out = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const merchant = await getMerchantForUser(c, me.userId);
      const result = await requestSettlement(c, { merchantId: merchant.id, userId: me.userId });
      await audit(c, {
        actorId: me.userId,
        actorRole: me.role,
        action: 'SETTLEMENT_REQUESTED',
        entity: 'settlements',
        entityId: result.settlement.id,
        meta: { amount: result.settlement.amount, txn_count: result.settlement.txn_count, status: result.settlement.status },
      });
      return result;
    });
    res.status(201).json(out);
  }),
);

settlementRouter.get(
  '/',
  requireRole('VENDOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const rows = await withUser({ userId: me.userId, role: me.role }, (c) =>
      many<SettlementRow>(
        c,
        `SELECT s.*, m.name AS merchant_name, m.code AS merchant_code FROM settlements s JOIN merchants m ON m.id = s.merchant_id
         ORDER BY s.requested_at DESC LIMIT 100`,
      ),
    );
    res.json({ settlements: rows });
  }),
);

settlementRouter.get(
  '/:id',
  requireRole('VENDOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const data = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const s = await one<SettlementRow>(c, 'SELECT s.*, m.name AS merchant_name FROM settlements s JOIN merchants m ON m.id = s.merchant_id WHERE s.id = $1', [req.params.id]);
      if (!s) return null;
      const items = await many(c, 'SELECT id, amount, mode, status, created_at, settled_at FROM transactions WHERE settlement_id = $1 ORDER BY created_at', [s.id]);
      return { settlement: s, items };
    });
    if (!data) throw notFound('Settlement not found');
    res.json(data);
  }),
);
