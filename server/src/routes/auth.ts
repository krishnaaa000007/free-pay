import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { one, withSystem, withUser } from '../db.js';
import { ApiError, asyncHandler, authMiddleware, badRequest, notFound, requireRole, signToken, unauthorized, validate } from '../middleware.js';
import { authLimiter } from '../rateLimit.js';
import { audit } from '../services/audit.js';
import { issueWalletCertificate } from '../services/credentials.js';
import { isValidBase64Key } from '../services/crypto.js';
import { getPlatformKeys } from '../services/platformKeys.js';
import type { Role } from '../services/types.js';

export const authRouter = Router();

interface UserRow {
  id: string;
  phone: string;
  email: string | null;
  name: string;
  role: Role;
  password_hash: string;
  language: string;
  avatar_seed: number;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

const publicUser = (u: UserRow) => ({
  id: u.id,
  phone: u.phone,
  email: u.email,
  name: u.name,
  role: u.role,
  language: u.language,
  avatar_seed: u.avatar_seed,
  created_at: u.created_at,
});

const phoneSchema = z.string().regex(/^\d{10}$/, 'Phone must be 10 digits');
const passwordSchema = z.string().min(6).max(72);

/* ------------------------------------------------------------------ */
/* Registration / login                                                 */
/* ------------------------------------------------------------------ */
const registerSchema = z.object({
  name: z.string().min(2).max(80),
  phone: phoneSchema,
  password: passwordSchema,
  role: z.enum(['PILGRIM', 'VENDOR']),
  language: z.string().min(2).max(5).default('en'),
  stall: z
    .object({
      name: z.string().min(2).max(80),
      category: z.string().min(2).max(30).default('GENERAL'),
      zone_id: z.string().uuid().optional(),
    })
    .optional(),
});

authRouter.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>;
    if (body.role === 'VENDOR' && !body.stall) throw badRequest('Vendors must provide stall details');
    const hash = await bcrypt.hash(body.password, 10);

    const result = await withSystem(async (client) => {
      const exists = await one(client, 'SELECT 1 FROM users WHERE phone = $1', [body.phone]);
      if (exists) throw new ApiError(409, 'PHONE_TAKEN', 'An account with this phone already exists');
      const user = (await one<UserRow>(
        client,
        `INSERT INTO users (phone, name, role, password_hash, language, last_login_at)
         VALUES ($1, $2, $3, $4, $5, now()) RETURNING *`,
        [body.phone, body.name, body.role, hash, body.language],
      ))!;
      let merchant: { id: string; code: string; name: string; category: string } | null = null;
      if (body.role === 'VENDOR' && body.stall) {
        const code = body.stall.name.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase().padEnd(3, 'X') + '-' + String(Math.floor(100 + Math.random() * 900));
        merchant = await one(
          client,
          `INSERT INTO merchants (owner_id, code, name, category, zone_id) VALUES ($1, $2, $3, $4, $5)
           RETURNING id, code, name, category`,
          [user.id, code, body.stall.name, body.stall.category.toUpperCase(), body.stall.zone_id ?? null],
        );
      }
      await audit(client, { actorId: user.id, actorRole: user.role, action: 'USER_REGISTERED', entity: 'users', entityId: user.id, meta: { role: user.role } });
      return { user, merchant };
    });

    const token = signToken({ sub: result.user.id, role: result.user.role, name: result.user.name });
    res.status(201).json({ token, user: publicUser(result.user), merchant: result.merchant });
  }),
);

const loginSchema = z.object({ phone: phoneSchema, password: z.string().min(1) });

authRouter.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { phone, password } = req.body as z.infer<typeof loginSchema>;
    const user = await withSystem(async (client) => {
      const u = await one<UserRow>(client, 'SELECT * FROM users WHERE phone = $1 AND is_active', [phone]);
      if (!u || !(await bcrypt.compare(password, u.password_hash))) return null;
      await client.query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
      return u;
    });
    if (!user) throw unauthorized('Incorrect phone number or password');
    const merchant = await withUser({ userId: user.id, role: user.role }, (c) =>
      one(c, 'SELECT id, code, name, category, zone_id, is_verified FROM merchants WHERE owner_id = $1 LIMIT 1', [user.id]),
    );
    res.json({ token: signToken({ sub: user.id, role: user.role, name: user.name }), user: publicUser(user), merchant });
  }),
);

const adminLoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post(
  '/admin/login',
  authLimiter,
  validate(adminLoginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof adminLoginSchema>;
    const admin = await withSystem(async (client) => {
      const a = await one<{ id: string; email: string; name: string; password_hash: string }>(
        client,
        'SELECT * FROM admin_users WHERE lower(email) = lower($1)',
        [email],
      );
      if (!a || !(await bcrypt.compare(password, a.password_hash))) return null;
      await client.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [a.id]);
      await audit(client, { actorId: a.id, actorRole: 'ADMIN', action: 'ADMIN_LOGIN', entity: 'admin_users', entityId: a.id, meta: { ip: req.ip } });
      return a;
    });
    if (!admin) throw unauthorized('Incorrect email or password');
    res.json({
      token: signToken({ sub: admin.id, role: 'ADMIN', name: admin.name }),
      user: { id: admin.id, email: admin.email, name: admin.name, role: 'ADMIN' },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Password recovery (mock OTP for the POC)                             */
/* ------------------------------------------------------------------ */
const DEMO_OTP = '123456';

authRouter.post(
  '/forgot-password',
  authLimiter,
  validate(z.object({ phone: phoneSchema })),
  asyncHandler(async (req, res) => {
    const { phone } = req.body as { phone: string };
    const exists = await withSystem((c) => one(c, 'SELECT 1 FROM users WHERE phone = $1', [phone]));
    // Always respond success so the endpoint cannot be used to enumerate accounts.
    res.json({
      ok: true,
      message: 'If this number is registered, an OTP has been sent by SMS.',
      ...(config.isProd ? {} : { demo_otp: exists ? DEMO_OTP : undefined }),
    });
  }),
);

authRouter.post(
  '/reset-password',
  authLimiter,
  validate(z.object({ phone: phoneSchema, otp: z.string().length(6), password: passwordSchema })),
  asyncHandler(async (req, res) => {
    const { phone, otp, password } = req.body as { phone: string; otp: string; password: string };
    if (config.isProd || otp !== DEMO_OTP) throw new ApiError(400, 'INVALID_OTP', 'Invalid or expired OTP');
    const hash = await bcrypt.hash(password, 10);
    const updated = await withSystem((c) => c.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE phone = $1', [phone, hash]));
    if (updated.rowCount === 0) throw notFound('Account not found');
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------------ */
/* Authenticated                                                        */
/* ------------------------------------------------------------------ */
authRouter.get('/platform-key', (_req, res) => {
  const k = getPlatformKeys();
  res.json({ kid: k.kid, public_key: k.publicKey, ephemeral: k.ephemeral });
});

authRouter.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    if (me.role === 'ADMIN') {
      const admin = await withUser({ userId: me.userId, role: 'ADMIN' }, (c) =>
        one(c, 'SELECT id, email, name, created_at, last_login_at FROM admin_users WHERE id = $1', [me.userId]),
      );
      if (!admin) throw notFound('Admin not found');
      res.json({ user: { ...admin, role: 'ADMIN' } });
      return;
    }
    const data = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const user = await one<UserRow>(c, 'SELECT * FROM users WHERE id = $1', [me.userId]);
      if (!user) throw notFound('User not found');
      const merchant = await one(c, 'SELECT id, code, name, category, zone_id, is_verified, settlement_account FROM merchants WHERE owner_id = $1 LIMIT 1', [me.userId]);
      const devices = await c.query('SELECT device_id, platform, model, registered_at, last_seen_at FROM devices WHERE user_id = $1 AND revoked_at IS NULL', [me.userId]);
      return { user: publicUser(user), merchant, devices: devices.rows };
    });
    res.json(data);
  }),
);

authRouter.patch(
  '/profile',
  authMiddleware,
  requireRole('PILGRIM', 'VENDOR'),
  validate(z.object({ name: z.string().min(2).max(80).optional(), language: z.string().min(2).max(5).optional() })),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const { name, language } = req.body as { name?: string; language?: string };
    const user = await withUser({ userId: me.userId, role: me.role }, (c) =>
      one<UserRow>(
        c,
        `UPDATE users SET name = COALESCE($2, name), language = COALESCE($3, language), updated_at = now() WHERE id = $1 RETURNING *`,
        [me.userId, name ?? null, language ?? null],
      ),
    );
    if (!user) throw notFound('User not found');
    res.json({ user: publicUser(user) });
  }),
);

/* Device binding: a device registers its Ed25519 public key once. */
const deviceSchema = z.object({
  device_id: z.string().min(8).max(120),
  public_key: z.string().refine((k) => isValidBase64Key(k), 'public_key must be a base64 Ed25519 key'),
  platform: z.string().max(20).optional(),
  model: z.string().max(80).optional(),
});

authRouter.post(
  '/device',
  authMiddleware,
  requireRole('PILGRIM', 'VENDOR'),
  validate(deviceSchema),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const body = req.body as z.infer<typeof deviceSchema>;
    const data = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const existing = await one<{ user_id: string; public_key: string }>(c, 'SELECT user_id, public_key FROM devices WHERE device_id = $1', [body.device_id]);
      if (existing && existing.user_id !== me.userId) {
        throw new ApiError(409, 'DEVICE_BOUND_ELSEWHERE', 'This device is bound to another account');
      }
      const device = await one(
        c,
        `INSERT INTO devices (user_id, device_id, public_key, platform, model)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (device_id) DO UPDATE SET public_key = EXCLUDED.public_key, platform = EXCLUDED.platform,
           model = EXCLUDED.model, last_seen_at = now(), revoked_at = NULL
         RETURNING device_id, public_key, platform, model, registered_at, last_seen_at`,
        [me.userId, body.device_id, body.public_key, body.platform ?? null, body.model ?? null],
      );
      await audit(c, { actorId: me.userId, actorRole: me.role, action: existing ? 'DEVICE_KEY_ROTATED' : 'DEVICE_REGISTERED', entity: 'devices', entityId: body.device_id });
      const credential = me.role === 'PILGRIM' ? await issueCredentialFor(c, me.userId, body.device_id, body.public_key) : null;
      return { device, credential };
    });
    res.json(data);
  }),
);

/* Issue / refresh the offline wallet certificate for a registered device. */
authRouter.post(
  '/credential',
  authMiddleware,
  requireRole('PILGRIM'),
  validate(z.object({ device_id: z.string().min(8).max(120) })),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const { device_id } = req.body as { device_id: string };
    const credential = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const device = await one<{ public_key: string }>(c, 'SELECT public_key FROM devices WHERE device_id = $1 AND user_id = $2 AND revoked_at IS NULL', [device_id, me.userId]);
      if (!device) throw notFound('Device not registered; call /auth/device first');
      return issueCredentialFor(c, me.userId, device_id, device.public_key);
    });
    res.json({ credential });
  }),
);

async function issueCredentialFor(client: Parameters<typeof one>[0], userId: string, deviceId: string, publicKey: string) {
  const user = await one<{ name: string }>(client, 'SELECT name FROM users WHERE id = $1', [userId]);
  const signed = issueWalletCertificate({
    userId,
    name: user?.name ?? 'Pilgrim',
    deviceId,
    devicePublicKey: publicKey,
    perTxnLimitPaise: config.fraud.maxSingleOfflinePaise,
    dailyLimitPaise: config.fraud.maxDailyOfflinePaise,
    ttlMs: config.fraud.maxOfflineAgeMs,
  });
  await client.query(
    `INSERT INTO wallet_certificates (user_id, device_id, kid, issued_at, expires_at, per_txn_limit, daily_limit, cert_json, sig)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [userId, deviceId, signed.cert.kid, signed.cert.issued_at, signed.cert.expires_at, signed.cert.limits.per_txn, signed.cert.limits.daily, signed.cert, signed.sig],
  );
  await audit(client, { actorId: userId, actorRole: 'PILGRIM', action: 'CREDENTIAL_ISSUED', entity: 'wallet_certificates', meta: { device_id: deviceId, expires_at: signed.cert.expires_at } });
  return signed;
}
