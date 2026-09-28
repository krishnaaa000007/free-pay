import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { many, one, withUser } from '../db.js';
import { asyncHandler, authMiddleware, notFound, requireRole, validate } from '../middleware.js';
import { audit } from '../services/audit.js';

/**
 * Emergency SOS + lost-person reporting.
 * Location sharing is time-boxed: RLS hides an emergency from responders once
 * `expires_at` passes (EMERGENCY_SHARE_TTL_MIN, default 60 minutes).
 */
export const emergencyRouter = Router();

/** Contacts are public so the app can show them even before login. */
emergencyRouter.get('/contacts', (_req, res) => {
  res.json({ contacts: config.emergency.contacts, share_ttl_min: Math.round(config.emergency.shareTtlMs / 60_000) });
});

emergencyRouter.use(authMiddleware);

const sosSchema = z.object({
  kind: z.enum(['MEDICAL', 'SECURITY', 'FIRE', 'LOST_CHILD', 'OTHER']).default('OTHER'),
  note: z.string().max(300).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy_m: z.number().min(0).optional(),
  zone_id: z.string().uuid().optional(),
});

emergencyRouter.post(
  '/sos',
  requireRole('PILGRIM', 'VENDOR'),
  validate(sosSchema),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const b = req.body as z.infer<typeof sosSchema>;
    const row = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const expiresAt = new Date(Date.now() + config.emergency.shareTtlMs).toISOString();
      const e = await one<{ id: string; expires_at: string; created_at: string }>(
        c,
        `INSERT INTO emergencies (user_id, kind, note, lat, lng, accuracy_m, zone_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at, expires_at, status, kind`,
        [me.userId, b.kind, b.note ?? null, b.lat ?? null, b.lng ?? null, b.accuracy_m ?? null, b.zone_id ?? null, expiresAt],
      );
      if (b.lat !== undefined && b.lng !== undefined) {
        await c.query('INSERT INTO emergency_locations (emergency_id, lat, lng) VALUES ($1, $2, $3)', [e!.id, b.lat, b.lng]);
      }
      await audit(c, { actorId: me.userId, actorRole: me.role, action: 'SOS_RAISED', entity: 'emergencies', entityId: e!.id, meta: { kind: b.kind } });
      return e!;
    });
    res.status(201).json({ emergency: row, contacts: config.emergency.contacts, share_ttl_min: Math.round(config.emergency.shareTtlMs / 60_000) });
  }),
);

/** Location trail updates while the SOS is active. */
emergencyRouter.patch(
  '/:id/location',
  requireRole('PILGRIM', 'VENDOR'),
  validate(z.object({ lat: z.number(), lng: z.number(), accuracy_m: z.number().optional() })),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const b = req.body as { lat: number; lng: number; accuracy_m?: number };
    const ok = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const e = await one<{ id: string; status: string }>(c, `SELECT id, status FROM emergencies WHERE id = $1 AND status IN ('ACTIVE','ACKNOWLEDGED') AND expires_at > now()`, [req.params.id]);
      if (!e) return false;
      await c.query('UPDATE emergencies SET lat = $2, lng = $3, accuracy_m = $4 WHERE id = $1', [e.id, b.lat, b.lng, b.accuracy_m ?? null]);
      await c.query('INSERT INTO emergency_locations (emergency_id, lat, lng) VALUES ($1, $2, $3)', [e.id, b.lat, b.lng]);
      return true;
    });
    if (!ok) throw notFound('No active emergency with this id');
    res.json({ ok: true });
  }),
);

emergencyRouter.post(
  '/:id/resolve',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const ok = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const r = await c.query(`UPDATE emergencies SET status = 'RESOLVED', resolved_at = now() WHERE id = $1 AND status <> 'RESOLVED' RETURNING id`, [req.params.id]);
      if (r.rowCount) await audit(c, { actorId: me.userId, actorRole: me.role, action: 'EMERGENCY_RESOLVED', entity: 'emergencies', entityId: req.params.id });
      return !!r.rowCount;
    });
    if (!ok) throw notFound('Emergency not found');
    res.json({ ok: true });
  }),
);

emergencyRouter.post(
  '/:id/acknowledge',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const ok = await withUser({ userId: me.userId, role: 'ADMIN' }, async (c) => {
      const r = await c.query(`UPDATE emergencies SET status = 'ACKNOWLEDGED', acknowledged_at = now(), acknowledged_by = $2 WHERE id = $1 AND status = 'ACTIVE' RETURNING id`, [req.params.id, me.userId]);
      if (r.rowCount) await audit(c, { actorId: me.userId, actorRole: 'ADMIN', action: 'EMERGENCY_ACKNOWLEDGED', entity: 'emergencies', entityId: req.params.id });
      return !!r.rowCount;
    });
    if (!ok) throw notFound('No active emergency with this id');
    res.json({ ok: true });
  }),
);

/** My own emergencies (pilgrim) or all live ones (responder). RLS applies the window. */
emergencyRouter.get(
  '/active',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const rows = await withUser({ userId: me.userId, role: me.role }, (c) =>
      many(
        c,
        `SELECT e.*, p.name AS reporter_name, z.name AS zone_name,
                GREATEST(0, EXTRACT(EPOCH FROM (e.expires_at - now())))::int AS seconds_remaining
         FROM emergencies e LEFT JOIN public_profiles p ON p.id = e.user_id LEFT JOIN crowd_zones z ON z.id = e.zone_id
         WHERE e.status IN ('ACTIVE','ACKNOWLEDGED') AND e.expires_at > now()
         ORDER BY e.created_at DESC`,
      ),
    );
    res.json({ emergencies: rows });
  }),
);

emergencyRouter.get(
  '/:id/trail',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const rows = await withUser({ userId: me.userId, role: me.role }, (c) =>
      many(c, 'SELECT lat, lng, recorded_at FROM emergency_locations WHERE emergency_id = $1 ORDER BY recorded_at', [req.params.id]),
    );
    res.json({ trail: rows });
  }),
);

/* ------------------------------------------------------------------ */
/* Lost persons                                                          */
/* ------------------------------------------------------------------ */
const lostSchema = z.object({
  name: z.string().min(1).max(80),
  age: z.number().int().min(0).max(120).optional(),
  gender: z.enum(['M', 'F', 'O']).optional(),
  description: z.string().max(400).optional(),
  last_seen_zone_id: z.string().uuid().optional(),
  last_seen_at: z.string().datetime().optional(),
  contact_phone: z.string().regex(/^\d{10}$/),
});

emergencyRouter.post(
  '/lost-person',
  requireRole('PILGRIM', 'VENDOR'),
  validate(lostSchema),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const b = req.body as z.infer<typeof lostSchema>;
    const row = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const r = await one(
        c,
        `INSERT INTO lost_persons (reported_by, name, age, gender, description, last_seen_zone_id, last_seen_at, contact_phone)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8) RETURNING *`,
        [me.userId, b.name, b.age ?? null, b.gender ?? null, b.description ?? null, b.last_seen_zone_id ?? null, b.last_seen_at ?? null, b.contact_phone],
      );
      await audit(c, { actorId: me.userId, actorRole: me.role, action: 'LOST_PERSON_REPORTED', entity: 'lost_persons', entityId: (r as { id: string }).id });
      return r;
    });
    res.status(201).json({ report: row });
  }),
);

emergencyRouter.get(
  '/lost-person',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const rows = await withUser({ userId: me.userId, role: me.role }, (c) =>
      many(
        c,
        `SELECT l.*, z.name AS last_seen_zone_name, p.name AS reporter_name
         FROM lost_persons l LEFT JOIN crowd_zones z ON z.id = l.last_seen_zone_id LEFT JOIN public_profiles p ON p.id = l.reported_by
         WHERE ($1::text IS NULL OR l.status::text = $1) ORDER BY l.created_at DESC LIMIT 100`,
        [status],
      ),
    );
    res.json({ reports: rows });
  }),
);

emergencyRouter.post(
  '/lost-person/:id/found',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const ok = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const r = await c.query(`UPDATE lost_persons SET status = 'FOUND', found_at = now() WHERE id = $1 AND status = 'OPEN' RETURNING id`, [req.params.id]);
      return !!r.rowCount;
    });
    if (!ok) throw notFound('Report not found or already closed');
    res.json({ ok: true });
  }),
);
