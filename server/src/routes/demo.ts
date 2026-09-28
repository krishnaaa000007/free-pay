import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { one, withSystem, withUser } from '../db.js';
import { ApiError, asyncHandler, authMiddleware, signToken, validate } from '../middleware.js';
import { audit } from '../services/audit.js';
import { issueWalletCertificate } from '../services/credentials.js';
import { isValidBase64Key } from '../services/crypto.js';

/**
 * Pitch-demo support (DEV ONLY, gated by DEMO_MODE / NODE_ENV).
 *
 * A single phone cannot be both the pilgrim and the vendor with normal accounts. This
 * route lets an authenticated app provision a throw-away demo session: it registers two
 * fresh device keys generated on the phone (one for the demo pilgrim "Meera Iyer", one for
 * the demo vendor "Shankar Chai & Snacks"), issues a wallet certificate for the pilgrim key
 * and returns a short-lived vendor token so the phone can sync as the vendor.
 *
 * Everything downstream (signature checks, fraud engine, RLS) is the real thing.
 */
export const demoRouter = Router();

const DEMO_PILGRIM_ID = '11111111-1111-4111-8111-000000000002';
const DEMO_VENDOR_ID = '22222222-2222-4222-8222-000000000001';
const DEMO_MERCHANT_ID = '33333333-3333-4333-8333-000000000001';

demoRouter.use((_req, _res, next) => {
  if (!config.demoMode) return next(new ApiError(404, 'NOT_FOUND', 'Demo mode is disabled'));
  next();
});
demoRouter.use(authMiddleware);

const sessionSchema = z.object({
  device_id: z.string().min(8).max(120),
  pilgrim_public_key: z.string().refine(isValidBase64Key, 'invalid key'),
  vendor_public_key: z.string().refine(isValidBase64Key, 'invalid key'),
});

demoRouter.post(
  '/session',
  validate(sessionSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof sessionSchema>;
    const pilgrimDeviceId = `${b.device_id}-demo-pilgrim`;
    const vendorDeviceId = `${b.device_id}-demo-vendor`;

    // Device registration happens in the SYSTEM context because the caller may be
    // signed in as either role; the demo identities are fixed seed accounts.
    const { pilgrim, vendor, merchant } = await withSystem(async (c) => {
      const p = await one<{ id: string; name: string }>(c, 'SELECT id, name FROM users WHERE id = $1', [DEMO_PILGRIM_ID]);
      const v = await one<{ id: string; name: string }>(c, 'SELECT id, name FROM users WHERE id = $1', [DEMO_VENDOR_ID]);
      const m = await one<{ id: string; name: string; code: string }>(c, 'SELECT id, name, code FROM merchants WHERE id = $1', [DEMO_MERCHANT_ID]);
      if (!p || !v || !m) throw new ApiError(500, 'DEMO_SEED_MISSING', 'Demo seed accounts are missing; run migrations');
      for (const [userId, deviceId, key] of [
        [p.id, pilgrimDeviceId, b.pilgrim_public_key],
        [v.id, vendorDeviceId, b.vendor_public_key],
      ] as const) {
        await c.query(
          `INSERT INTO devices (user_id, device_id, public_key, platform, model) VALUES ($1, $2, $3, 'demo', 'pitch-demo')
           ON CONFLICT (device_id) DO UPDATE SET public_key = EXCLUDED.public_key, user_id = EXCLUDED.user_id, last_seen_at = now(), revoked_at = NULL`,
          [userId, deviceId, key],
        );
      }
      await audit(c, { actorId: req.user!.userId, actorRole: req.user!.role, action: 'DEMO_SESSION', entity: 'devices', entityId: b.device_id });
      return { pilgrim: p, vendor: v, merchant: m };
    });

    const credential = issueWalletCertificate({
      userId: pilgrim.id,
      name: pilgrim.name,
      deviceId: pilgrimDeviceId,
      devicePublicKey: b.pilgrim_public_key,
      perTxnLimitPaise: config.fraud.maxSingleOfflinePaise,
      dailyLimitPaise: config.fraud.maxDailyOfflinePaise,
      ttlMs: config.fraud.maxOfflineAgeMs,
    });
    await withUser({ userId: pilgrim.id, role: 'PILGRIM' }, (c) =>
      c.query(
        `INSERT INTO wallet_certificates (user_id, device_id, kid, issued_at, expires_at, per_txn_limit, daily_limit, cert_json, sig)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [pilgrim.id, pilgrimDeviceId, credential.cert.kid, credential.cert.issued_at, credential.cert.expires_at, credential.cert.limits.per_txn, credential.cert.limits.daily, credential.cert, credential.sig],
      ),
    );

    res.json({
      pilgrim: { user_id: pilgrim.id, name: pilgrim.name, device_id: pilgrimDeviceId, credential },
      vendor: { user_id: vendor.id, name: vendor.name, device_id: vendorDeviceId, token: signToken({ sub: vendor.id, role: 'VENDOR', name: vendor.name }), merchant },
      limits: { per_txn: config.fraud.maxSingleOfflinePaise, daily: config.fraud.maxDailyOfflinePaise, review_threshold: config.fraud.reviewThresholdPaise },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Demo relay (DEV ONLY)                                                */
/* ------------------------------------------------------------------ */
/**
 * Stands in for the camera when a demo runs across two browser windows / two monitors
 * on one desktop, where no camera can see the other screen. One window publishes the
 * exact QR string it is displaying; the other polls and handles it as if it had scanned
 * it. Nothing about verification changes — the same signed payload travels, and every
 * signature, expiry, limit and fraud check runs unaltered.
 *
 * Deliberately tiny: last message wins, held in memory only, cleared on restart.
 */
type RelayKind = 'MERCHANT' | 'QR' | 'RECEIPT';
interface RelayItem {
  seq: number;
  kind: RelayKind;
  payload: string;
  at: string;
}
const RELAY_TTL_MS = 5 * 60_000;
let relaySeq = 0;
let relayItems: RelayItem[] = [];

const relayBody = z.object({
  kind: z.enum(['MERCHANT', 'QR', 'RECEIPT']),
  payload: z.string().min(8).max(8000),
});

demoRouter.post(
  '/relay',
  validate(relayBody),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof relayBody>;
    const item: RelayItem = { seq: ++relaySeq, kind: b.kind, payload: b.payload, at: new Date().toISOString() };
    const cutoff = Date.now() - RELAY_TTL_MS;
    relayItems = [...relayItems.filter((i) => Date.parse(i.at) > cutoff), item].slice(-20);
    res.json({ seq: item.seq });
  }),
);

demoRouter.get(
  '/relay',
  validate(z.object({ since: z.coerce.number().int().min(0).default(0), kinds: z.string().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { since: number; kinds?: string };
    const wanted = q.kinds ? new Set(q.kinds.split(',')) : null;
    const cutoff = Date.now() - RELAY_TTL_MS;
    const items = relayItems.filter((i) => i.seq > q.since && Date.parse(i.at) > cutoff && (!wanted || wanted.has(i.kind)));
    res.json({ seq: relaySeq, items });
  }),
);
