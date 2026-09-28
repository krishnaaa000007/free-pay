import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { many, withUser } from '../db.js';
import { asyncHandler, authMiddleware, badRequest, notFound, requireRole, validate } from '../middleware.js';
import { computeTrend, densityLevel, suggestRoute, type ZoneEdge, type ZoneNode } from '../services/crowd.js';

export const crowdRouter = Router();
crowdRouter.use(authMiddleware);

async function loadZones(c: pg.PoolClient): Promise<ZoneNode[]> {
  const rows = await many<ZoneNode & { history: Array<{ density: number; recorded_at: string }> | null }>(
    c,
    `SELECT z.id, z.code, z.name, z.kind, z.lat, z.lng, z.radius_m, z.capacity, z.map_x, z.map_y,
            COALESCE(r.density, 0)::float AS density, COALESCE(r.head_count, 0) AS head_count, r.recorded_at,
            (SELECT json_agg(json_build_object('density', h.density, 'recorded_at', h.recorded_at) ORDER BY h.recorded_at)
               FROM (SELECT density::float, recorded_at FROM crowd_readings WHERE zone_id = z.id ORDER BY recorded_at DESC LIMIT 4) h) AS history
     FROM crowd_zones z
     LEFT JOIN LATERAL (
       SELECT density::float, head_count, recorded_at FROM crowd_readings WHERE zone_id = z.id ORDER BY recorded_at DESC LIMIT 1
     ) r ON true
     ORDER BY z.code`,
  );
  return rows.map(({ history, ...z }) => ({ ...z, trend: computeTrend(history ?? []) }));
}

async function loadEdges(c: pg.PoolClient): Promise<ZoneEdge[]> {
  return many<ZoneEdge>(c, 'SELECT from_zone, to_zone, distance_m FROM crowd_zone_edges');
}

crowdRouter.get(
  '/zones',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const data = await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const zones = await loadZones(c);
      const edges = await loadEdges(c);
      return { zones, edges };
    });
    const zones = data.zones.map((z) => ({ ...z, level: densityLevel(z.density) }));
    const summary = {
      total: zones.length,
      critical: zones.filter((z) => z.level === 'CRITICAL').length,
      high: zones.filter((z) => z.level === 'HIGH').length,
      people_estimate: zones.reduce((a, z) => a + z.head_count, 0),
      updated_at: zones.reduce<string | null>((m, z) => (z.recorded_at && (!m || z.recorded_at > m) ? z.recorded_at : m), null),
    };
    res.json({ zones, edges: data.edges, summary });
  }),
);

crowdRouter.get(
  '/zones/:id/history',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const rows = await withUser({ userId: me.userId, role: me.role }, (c) =>
      many(
        c,
        `SELECT density::float AS density, head_count, recorded_at FROM crowd_readings
         WHERE zone_id = $1 AND recorded_at > now() - interval '24 hours' ORDER BY recorded_at`,
        [req.params.id],
      ),
    );
    res.json({ history: rows });
  }),
);

/** Crowd-sourced density report from any app user or ops staff. */
crowdRouter.post(
  '/readings',
  validate(z.object({ zone_id: z.string().uuid(), head_count: z.number().int().min(0).optional(), density: z.number().min(0).max(2).optional(), source: z.string().max(20).default('PILGRIM') })),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const b = req.body as { zone_id: string; head_count?: number; density?: number; source: string };
    if (b.head_count === undefined && b.density === undefined) throw badRequest('Provide head_count or density');
    await withUser({ userId: me.userId, role: me.role }, async (c) => {
      const zone = (await c.query('SELECT capacity FROM crowd_zones WHERE id = $1', [b.zone_id])).rows[0] as { capacity: number } | undefined;
      if (!zone) throw notFound('Zone not found');
      const density = b.density ?? (b.head_count ?? 0) / zone.capacity;
      const headCount = b.head_count ?? Math.round(density * zone.capacity);
      await c.query('INSERT INTO crowd_readings (zone_id, head_count, density, source, reported_by) VALUES ($1, $2, $3, $4, $5)', [
        b.zone_id,
        headCount,
        Math.min(2, density),
        me.role === 'ADMIN' ? 'ADMIN' : b.source,
        me.userId,
      ]);
    });
    res.status(201).json({ ok: true });
  }),
);

/** Least-crowded route between two zones. */
crowdRouter.get(
  '/route',
  validate(z.object({ from: z.string().uuid(), to: z.string().uuid(), avoid_critical: z.coerce.boolean().default(true) }), 'query'),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const q = req.query as unknown as { from: string; to: string; avoid_critical: boolean };
    const data = await withUser({ userId: me.userId, role: me.role }, async (c) => ({ zones: await loadZones(c), edges: await loadEdges(c) }));
    const route = suggestRoute(data.zones, data.edges, q.from, q.to, { avoidCritical: q.avoid_critical });
    if (!route) throw notFound('No route between these zones');
    res.json({
      ...route,
      path: route.path.map((z) => ({ ...z, level: densityLevel(z.density) })),
      avoided: route.avoided.map((z) => ({ id: z.id, name: z.name, density: z.density })),
    });
  }),
);

/** Ops: push a simulated surge to a zone (drives the live demo). */
crowdRouter.post(
  '/simulate',
  requireRole('ADMIN'),
  validate(z.object({ zone_id: z.string().uuid(), density: z.number().min(0).max(1.5) })),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const b = req.body as { zone_id: string; density: number };
    await withUser({ userId: me.userId, role: 'ADMIN' }, async (c) => {
      const zone = (await c.query('SELECT capacity FROM crowd_zones WHERE id = $1', [b.zone_id])).rows[0] as { capacity: number } | undefined;
      if (!zone) throw notFound('Zone not found');
      await c.query(`INSERT INTO crowd_readings (zone_id, head_count, density, source, reported_by) VALUES ($1, $2, $3, 'ADMIN', $4)`, [
        b.zone_id,
        Math.round(b.density * zone.capacity),
        b.density,
        me.userId,
      ]);
    });
    res.json({ ok: true });
  }),
);
