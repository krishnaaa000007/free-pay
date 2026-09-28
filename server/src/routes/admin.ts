import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { many, one, withUser } from '../db.js';
import { asyncHandler, authMiddleware, requireRole, validate } from '../middleware.js';
import { densityLevel } from '../services/crowd.js';
import { trustScore, type NgoFacts } from '../services/ngoTrust.js';

/**
 * Ops dashboard API. Everything is read through the ADMIN RLS context, which sees all
 * rows but still cannot UPDATE financial fields (trigger-enforced) or DELETE anything.
 */
export const adminRouter = Router();
adminRouter.use(authMiddleware, requireRole('ADMIN'));

const asAdmin = <T>(userId: string, fn: (c: pg.PoolClient) => Promise<T>) => withUser({ userId, role: 'ADMIN' }, fn);

/* ------------------------------------------------------------------ */
/* Overview: metric cards with 7-day sparklines                          */
/* ------------------------------------------------------------------ */
adminRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const data = await asAdmin(req.user!.userId, async (c) => {
      const totals = await one<Record<string, number>>(
        c,
        `SELECT
          (SELECT COUNT(*) FROM users WHERE role = 'PILGRIM')::int AS pilgrims,
          (SELECT COUNT(*) FROM users WHERE role = 'VENDOR')::int AS vendors,
          (SELECT COUNT(*) FROM merchants)::int AS merchants,
          (SELECT COUNT(DISTINCT merchant_id) FROM transactions WHERE created_at > now() - interval '24 hours')::int AS active_vendors_24h,
          (SELECT COUNT(*) FROM transactions)::int AS txns_total,
          (SELECT COUNT(*) FROM transactions WHERE created_at >= date_trunc('day', now()))::int AS txns_today,
          (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE status <> 'FAILED')::bigint AS gmv_total,
          (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE status <> 'FAILED' AND created_at >= date_trunc('day', now()))::bigint AS gmv_today,
          (SELECT COUNT(*) FROM transactions WHERE mode = 'OFFLINE')::int AS offline_txns,
          (SELECT COUNT(*) FROM transactions WHERE status = 'SYNCED')::int AS synced,
          (SELECT COUNT(*) FROM transactions WHERE status = 'SETTLED')::int AS settled,
          (SELECT COUNT(*) FROM transactions WHERE status = 'FAILED')::int AS failed,
          (SELECT COUNT(*) FROM transactions WHERE fraud_decision = 'REVIEW' AND status = 'SYNCED')::int AS pending_review,
          (SELECT COUNT(*) FROM transactions WHERE suspicious)::int AS suspicious,
          (SELECT COUNT(*) FROM rejected_transactions)::int AS rejected,
          (SELECT COALESCE(SUM(pending_count),0) FROM vendor_sync_state)::int AS pending_sync_count,
          (SELECT COALESCE(SUM(pending_amount),0) FROM vendor_sync_state)::bigint AS pending_sync_amount,
          (SELECT COUNT(*) FROM vendor_sync_state WHERE pending_count > 0)::int AS vendors_with_pending,
          (SELECT COALESCE(SUM(amount),0) FROM settlements WHERE status = 'COMPLETED')::bigint AS settled_amount,
          (SELECT COUNT(*) FROM settlements WHERE status IN ('PENDING','PROCESSING'))::int AS settlements_open,
          (SELECT COALESCE(SUM(amount),0) FROM settlements WHERE status IN ('PENDING','PROCESSING'))::bigint AS settlements_open_amount,
          (SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (synced_at - created_at)) / 60.0)::numeric, 1), 0) FROM transactions WHERE mode = 'OFFLINE' AND synced_at IS NOT NULL AND created_at > now() - interval '7 days')::float AS avg_sync_latency_min,
          (SELECT COUNT(*) FROM lost_persons WHERE status = 'OPEN')::int AS lost_open,
          (SELECT COUNT(*) FROM ngos)::int AS ngos,
          (SELECT COALESCE(ROUND(AVG(trust_score)::numeric, 1), 0) FROM ngos)::float AS avg_ngo_trust,
          (SELECT COUNT(*) FROM ngo_credits WHERE redeemed_at IS NULL AND expires_at > now())::int AS ngo_credits_open`,
      );
      const emergency = await one<{ active: number; resolved_24h: number; total: number; avg_ack_minutes: number | null }>(c, 'SELECT * FROM app_emergency_stats()');
      const crowd = await many<{ density: number }>(
        c,
        `SELECT COALESCE(r.density, 0)::float AS density FROM crowd_zones z
         LEFT JOIN LATERAL (SELECT density FROM crowd_readings WHERE zone_id = z.id ORDER BY recorded_at DESC LIMIT 1) r ON true`,
      );
      const daily = await many<{ day: string; txns: number; gmv: number; offline: number; new_users: number; settled: number; review: number }>(
        c,
        `WITH days AS (SELECT generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') AS day)
         SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                COUNT(t.id)::int AS txns,
                COALESCE(SUM(t.amount) FILTER (WHERE t.status <> 'FAILED'), 0)::bigint AS gmv,
                COUNT(t.id) FILTER (WHERE t.mode = 'OFFLINE')::int AS offline,
                (SELECT COUNT(*) FROM users u WHERE date_trunc('day', u.created_at) = d.day)::int AS new_users,
                COUNT(t.id) FILTER (WHERE t.status = 'SETTLED')::int AS settled,
                COUNT(t.id) FILTER (WHERE t.fraud_decision = 'REVIEW')::int AS review
         FROM days d LEFT JOIN transactions t ON date_trunc('day', t.created_at) = d.day
         GROUP BY d.day ORDER BY d.day`,
      );
      return { totals: totals!, emergency: emergency!, crowd, daily };
    });

    const t = data.totals;
    const spark = (key: keyof (typeof data.daily)[number]) => data.daily.map((d) => Number(d[key]));
    const offlineShare = t.txns_total ? Math.round((t.offline_txns / t.txns_total) * 1000) / 10 : 0;
    const criticalZones = data.crowd.filter((z) => densityLevel(z.density) === 'CRITICAL').length;

    res.json({
      generated_at: new Date().toISOString(),
      metrics: [
        { key: 'gmv_today', label: 'GMV today', value: t.gmv_today, format: 'inr', spark: spark('gmv'), hint: `${t.txns_today} payments` },
        { key: 'gmv_total', label: 'Total processed', value: t.gmv_total, format: 'inr', spark: spark('gmv'), hint: `${t.txns_total} lifetime payments` },
        { key: 'txns_today', label: 'Payments today', value: t.txns_today, format: 'int', spark: spark('txns') },
        { key: 'offline_share', label: 'Offline share', value: offlineShare, format: 'pct', spark: spark('offline'), hint: `${t.offline_txns} offline payments` },
        { key: 'pending_sync', label: 'Awaiting sync', value: t.pending_sync_count, format: 'int', hint: `${paise(t.pending_sync_amount)} across ${t.vendors_with_pending} stalls`, tone: t.pending_sync_count > 20 ? 'warn' : 'neutral' },
        { key: 'sync_latency', label: 'Avg sync latency', value: t.avg_sync_latency_min, format: 'min', hint: 'offline -> server, 7 days' },
        { key: 'pilgrims', label: 'Pilgrims', value: t.pilgrims, format: 'int', spark: spark('new_users') },
        { key: 'vendors', label: 'Vendors', value: t.vendors, format: 'int', hint: `${t.active_vendors_24h} active in 24h` },
        { key: 'synced', label: 'Synced', value: t.synced, format: 'int', hint: 'awaiting settlement' },
        { key: 'settled', label: 'Settled', value: t.settled, format: 'int', spark: spark('settled'), hint: paise(t.settled_amount) },
        { key: 'settlements_open', label: 'Open settlements', value: t.settlements_open, format: 'int', hint: paise(t.settlements_open_amount) },
        { key: 'pending_review', label: 'Needs review', value: t.pending_review, format: 'int', spark: spark('review'), tone: t.pending_review > 0 ? 'warn' : 'neutral' },
        { key: 'rejected', label: 'Rejected by fraud engine', value: t.rejected, format: 'int', hint: `${t.suspicious} marked suspicious`, tone: 'danger' },
        { key: 'emergencies', label: 'Live emergencies', value: data.emergency.active, format: 'int', hint: `${data.emergency.resolved_24h} resolved in 24h`, tone: data.emergency.active > 0 ? 'danger' : 'good' },
        { key: 'lost_open', label: 'Lost-person reports open', value: t.lost_open, format: 'int' },
        { key: 'crowd_critical', label: 'Critical crowd zones', value: criticalZones, format: 'int', hint: `${data.crowd.length} zones monitored`, tone: criticalZones > 0 ? 'danger' : 'good' },
        { key: 'ngos', label: 'Partner NGOs', value: t.ngos, format: 'int', hint: `avg trust ${t.avg_ngo_trust}` },
        { key: 'ngo_credits_open', label: 'NGO credits in circulation', value: t.ngo_credits_open, format: 'int' },
      ],
      daily: data.daily,
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Analytics (charts)                                                    */
/* ------------------------------------------------------------------ */
adminRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const data = await asAdmin(req.user!.userId, async (c) => {
      const hourly = await many<{ hour: number; txns: number; gmv: number; offline: number; online: number }>(
        c,
        `WITH h AS (SELECT generate_series(0, 23) AS hour)
         SELECT h.hour, COUNT(t.id)::int AS txns, COALESCE(SUM(t.amount) FILTER (WHERE t.status <> 'FAILED'),0)::bigint AS gmv,
                COUNT(t.id) FILTER (WHERE t.mode = 'OFFLINE')::int AS offline, COUNT(t.id) FILTER (WHERE t.mode <> 'OFFLINE')::int AS online
         FROM h LEFT JOIN transactions t ON EXTRACT(HOUR FROM t.created_at) = h.hour AND t.created_at > now() - interval '7 days'
         GROUP BY h.hour ORDER BY h.hour`,
      );
      const modes = await many<{ mode: string; txns: number; gmv: number }>(
        c,
        `SELECT mode::text, COUNT(*)::int AS txns, COALESCE(SUM(amount),0)::bigint AS gmv FROM transactions WHERE status <> 'FAILED' GROUP BY mode ORDER BY gmv DESC`,
      );
      const topVendors = await many<{ id: string; name: string; category: string; txns: number; gmv: number; offline_pct: number }>(
        c,
        `SELECT m.id, m.name, m.category, COUNT(t.id)::int AS txns, COALESCE(SUM(t.amount),0)::bigint AS gmv,
                ROUND(100.0 * COUNT(t.id) FILTER (WHERE t.mode = 'OFFLINE') / GREATEST(1, COUNT(t.id)), 0)::float AS offline_pct
         FROM merchants m LEFT JOIN transactions t ON t.merchant_id = m.id AND t.status <> 'FAILED'
         GROUP BY m.id ORDER BY gmv DESC LIMIT 8`,
      );
      const statusByDay = await many<{ day: string; synced: number; settled: number; failed: number; review: number }>(
        c,
        `WITH days AS (SELECT generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') AS day)
         SELECT to_char(d.day, 'Dy DD') AS day,
                COUNT(t.id) FILTER (WHERE t.status = 'SYNCED')::int AS synced,
                COUNT(t.id) FILTER (WHERE t.status = 'SETTLED')::int AS settled,
                COUNT(t.id) FILTER (WHERE t.status = 'FAILED')::int AS failed,
                COUNT(t.id) FILTER (WHERE t.fraud_decision = 'REVIEW')::int AS review
         FROM days d LEFT JOIN transactions t ON date_trunc('day', t.created_at) = d.day GROUP BY d.day ORDER BY d.day`,
      );
      const settlementProgress = await many<{ id: string; name: string; settled: number; synced: number; processing: number }>(
        c,
        `SELECT * FROM (SELECT m.id, m.name,
                COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'SETTLED'),0)::bigint AS settled,
                COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'SYNCED' AND t.settlement_id IS NULL),0)::bigint AS synced,
                COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'SYNCED' AND t.settlement_id IS NOT NULL),0)::bigint AS processing
         FROM merchants m LEFT JOIN transactions t ON t.merchant_id = m.id GROUP BY m.id) s ORDER BY settled + synced + processing DESC`,
      );
      const categories = await many<{ category: string; gmv: number; txns: number }>(
        c,
        `SELECT m.category, COALESCE(SUM(t.amount),0)::bigint AS gmv, COUNT(t.id)::int AS txns FROM merchants m
         LEFT JOIN transactions t ON t.merchant_id = m.id AND t.status <> 'FAILED' GROUP BY m.category ORDER BY gmv DESC`,
      );
      const fraudFlags = await many<{ flag: string; count: number }>(
        c,
        `SELECT flag, COUNT(*)::int AS count FROM (
           SELECT unnest(fraud_flags) AS flag FROM transactions
           UNION ALL SELECT unnest(reasons) FROM rejected_transactions
         ) f GROUP BY flag ORDER BY count DESC LIMIT 10`,
      );
      const syncLatency = await many<{ bucket: string; count: number }>(
        c,
        `SELECT bucket, COUNT(*)::int AS count FROM (
           SELECT CASE
             WHEN EXTRACT(EPOCH FROM (synced_at - created_at)) < 60 THEN '< 1 min'
             WHEN EXTRACT(EPOCH FROM (synced_at - created_at)) < 900 THEN '1-15 min'
             WHEN EXTRACT(EPOCH FROM (synced_at - created_at)) < 3600 THEN '15-60 min'
             WHEN EXTRACT(EPOCH FROM (synced_at - created_at)) < 21600 THEN '1-6 h'
             ELSE '> 6 h' END AS bucket
           FROM transactions WHERE mode = 'OFFLINE' AND synced_at IS NOT NULL) b
         GROUP BY bucket ORDER BY MIN(CASE bucket WHEN '< 1 min' THEN 1 WHEN '1-15 min' THEN 2 WHEN '15-60 min' THEN 3 WHEN '1-6 h' THEN 4 ELSE 5 END)`,
      );
      return { hourly, modes, topVendors, statusByDay, settlementProgress, categories, fraudFlags, syncLatency };
    });
    res.json(data);
  }),
);

adminRouter.get(
  '/analytics/trends',
  validate(z.object({ days: z.coerce.number().int().min(7).max(60).default(14) }), 'query'),
  asyncHandler(async (req, res) => {
    const days = (req.query as unknown as { days: number }).days;
    const rows = await asAdmin(req.user!.userId, (c) =>
      many(
        c,
        `WITH days AS (SELECT generate_series(date_trunc('day', now()) - ($1::int - 1) * interval '1 day', date_trunc('day', now()), interval '1 day') AS day)
         SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                COUNT(t.id)::int AS txns,
                COALESCE(SUM(t.amount) FILTER (WHERE t.status <> 'FAILED'),0)::bigint AS gmv,
                ROUND(100.0 * COUNT(t.id) FILTER (WHERE t.mode = 'OFFLINE') / GREATEST(1, COUNT(t.id)), 1)::float AS offline_share,
                COUNT(DISTINCT t.payer_id)::int AS active_pilgrims,
                COUNT(DISTINCT t.merchant_id)::int AS active_vendors,
                COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (t.synced_at - t.created_at)) / 60.0) FILTER (WHERE t.mode = 'OFFLINE')::numeric, 1), 0)::float AS sync_latency_min,
                (SELECT COUNT(*) FROM users u WHERE date_trunc('day', u.created_at) = d.day)::int AS new_users
         FROM days d LEFT JOIN transactions t ON date_trunc('day', t.created_at) = d.day
         GROUP BY d.day ORDER BY d.day`,
        [days],
      ),
    );
    res.json({ days, series: rows });
  }),
);

/* ------------------------------------------------------------------ */
/* Ops tabs                                                              */
/* ------------------------------------------------------------------ */
const pageQuery = z.object({ q: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
type PageQuery = z.infer<typeof pageQuery>;

adminRouter.get(
  '/users',
  validate(pageQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as PageQuery;
    const rows = await asAdmin(req.user!.userId, (c) =>
      many(
        c,
        `SELECT u.id, u.name, u.phone, u.role, u.language, u.avatar_seed, u.is_active, u.created_at, u.last_login_at,
                (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL)::int AS devices,
                (SELECT COUNT(*) FROM transactions t WHERE t.payer_id = u.id)::int AS payments,
                (SELECT COALESCE(SUM(amount),0) FROM transactions t WHERE t.payer_id = u.id AND t.status <> 'FAILED')::bigint AS spent
         FROM users u
         WHERE ($1::text IS NULL OR u.name ILIKE '%' || $1 || '%' OR u.phone LIKE '%' || $1 || '%')
         ORDER BY u.created_at DESC LIMIT $2 OFFSET $3`,
        [q.q ?? null, q.limit, q.offset],
      ),
    );
    res.json({ users: rows });
  }),
);

adminRouter.get(
  '/vendors',
  asyncHandler(async (req, res) => {
    const rows = await asAdmin(req.user!.userId, (c) =>
      many(
        c,
        `SELECT m.id, m.code, m.name, m.category, m.is_verified, m.settlement_account, m.created_at,
                u.name AS owner_name, u.phone AS owner_phone, z.name AS zone_name,
                COUNT(t.id)::int AS txns,
                COALESCE(SUM(t.amount) FILTER (WHERE t.status <> 'FAILED'),0)::bigint AS gmv,
                COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'SYNCED'),0)::bigint AS unsettled,
                COUNT(t.id) FILTER (WHERE t.created_at > now() - interval '24 hours')::int AS txns_24h,
                vs.pending_count, vs.pending_amount, vs.last_sync_at, vs.last_seen_at, vs.network, vs.battery_pct
         FROM merchants m JOIN users u ON u.id = m.owner_id LEFT JOIN crowd_zones z ON z.id = m.zone_id
         LEFT JOIN transactions t ON t.merchant_id = m.id
         LEFT JOIN vendor_sync_state vs ON vs.merchant_id = m.id
         GROUP BY m.id, u.name, u.phone, z.name, vs.pending_count, vs.pending_amount, vs.last_sync_at, vs.last_seen_at, vs.network, vs.battery_pct
         ORDER BY gmv DESC`,
      ),
    );
    res.json({ vendors: rows });
  }),
);

const txnQuery = pageQuery.extend({
  status: z.enum(['PENDING_SYNC', 'SYNCED', 'SETTLED', 'FAILED']).optional(),
  mode: z.enum(['OFFLINE', 'ONLINE', 'NGO_CREDIT']).optional(),
  review: z.coerce.boolean().optional(),
});

adminRouter.get(
  '/transactions',
  validate(txnQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof txnQuery>;
    const rows = await asAdmin(req.user!.userId, (c) =>
      many(
        c,
        `SELECT t.id, t.amount, t.mode, t.status, t.created_at, t.synced_at, t.settled_at, t.fraud_decision, t.fraud_flags, t.suspicious, t.memo,
                m.name AS merchant_name, m.code AS merchant_code, p.name AS payer_name, t.payer_id, t.merchant_id, t.settlement_id
         FROM transactions t JOIN merchants m ON m.id = t.merchant_id LEFT JOIN users p ON p.id = t.payer_id
         WHERE ($1::txn_status IS NULL OR t.status = $1)
           AND ($2::txn_mode IS NULL OR t.mode = $2)
           AND ($3::boolean IS NULL OR ($3 = true AND (t.fraud_decision = 'REVIEW' OR t.suspicious)))
           AND ($4::text IS NULL OR m.name ILIKE '%' || $4 || '%' OR p.name ILIKE '%' || $4 || '%' OR t.id::text LIKE $4 || '%')
         ORDER BY t.created_at DESC LIMIT $5 OFFSET $6`,
        [q.status ?? null, q.mode ?? null, q.review ?? null, q.q ?? null, q.limit, q.offset],
      ),
    );
    res.json({ transactions: rows });
  }),
);

adminRouter.get(
  '/pending-sync',
  asyncHandler(async (req, res) => {
    const data = await asAdmin(req.user!.userId, async (c) => {
      const vendors = await many(
        c,
        `SELECT vs.*, m.name AS merchant_name, m.code AS merchant_code, u.name AS owner_name, z.name AS zone_name,
                EXTRACT(EPOCH FROM (now() - vs.last_seen_at))::int AS seconds_since_seen,
                EXTRACT(EPOCH FROM (now() - COALESCE(vs.last_sync_at, vs.last_seen_at)))::int AS seconds_since_sync
         FROM vendor_sync_state vs JOIN merchants m ON m.id = vs.merchant_id JOIN users u ON u.id = vs.vendor_user_id
         LEFT JOIN crowd_zones z ON z.id = m.zone_id
         ORDER BY vs.pending_amount DESC, vs.last_seen_at DESC`,
      );
      const batches = await many(
        c,
        `SELECT b.*, m.name AS merchant_name FROM sync_batches b JOIN merchants m ON m.id = b.merchant_id ORDER BY b.received_at DESC LIMIT 25`,
      );
      const rejected = await many(
        c,
        `SELECT r.*, m.name AS merchant_name, p.name AS payer_name FROM rejected_transactions r
         LEFT JOIN merchants m ON m.id = r.merchant_id LEFT JOIN users p ON p.id = r.payer_id ORDER BY r.rejected_at DESC LIMIT 25`,
      );
      return { vendors, batches, rejected };
    });
    res.json(data);
  }),
);

adminRouter.get(
  '/settlements',
  asyncHandler(async (req, res) => {
    const rows = await asAdmin(req.user!.userId, (c) =>
      many(
        c,
        `SELECT s.*, m.name AS merchant_name, m.code AS merchant_code, m.settlement_account FROM settlements s JOIN merchants m ON m.id = s.merchant_id
         ORDER BY s.requested_at DESC LIMIT 100`,
      ),
    );
    res.json({ settlements: rows });
  }),
);

adminRouter.get(
  '/crowd',
  asyncHandler(async (req, res) => {
    const rows = await asAdmin(req.user!.userId, (c) =>
      many<{ density: number } & Record<string, unknown>>(
        c,
        `SELECT z.id, z.code, z.name, z.kind, z.capacity, z.map_x, z.map_y, z.lat, z.lng,
                COALESCE(r.density, 0)::float AS density, COALESCE(r.head_count, 0) AS head_count, r.recorded_at,
                (SELECT json_agg(json_build_object('t', h.recorded_at, 'd', h.density::float) ORDER BY h.recorded_at)
                   FROM (SELECT recorded_at, density FROM crowd_readings WHERE zone_id = z.id AND recorded_at > now() - interval '24 hours' ORDER BY recorded_at) h) AS history,
                (SELECT COUNT(*) FROM merchants mm WHERE mm.zone_id = z.id)::int AS stalls
         FROM crowd_zones z LEFT JOIN LATERAL (SELECT density, head_count, recorded_at FROM crowd_readings WHERE zone_id = z.id ORDER BY recorded_at DESC LIMIT 1) r ON true
         ORDER BY density DESC`,
      ),
    );
    res.json({ zones: rows.map((z) => ({ ...z, level: densityLevel(z.density) })) });
  }),
);

adminRouter.get(
  '/emergencies',
  asyncHandler(async (req, res) => {
    const data = await asAdmin(req.user!.userId, async (c) => {
      const live = await many(
        c,
        `SELECT e.*, p.name AS reporter_name, p.phone AS reporter_phone, z.name AS zone_name,
                GREATEST(0, EXTRACT(EPOCH FROM (e.expires_at - now())))::int AS seconds_remaining
         FROM emergencies e LEFT JOIN users p ON p.id = e.user_id LEFT JOIN crowd_zones z ON z.id = e.zone_id
         WHERE e.expires_at > now() ORDER BY e.status = 'ACTIVE' DESC, e.created_at DESC`,
      );
      const stats = await one(c, 'SELECT * FROM app_emergency_stats()');
      const lost = await many(
        c,
        `SELECT l.*, z.name AS last_seen_zone_name, p.name AS reporter_name FROM lost_persons l
         LEFT JOIN crowd_zones z ON z.id = l.last_seen_zone_id LEFT JOIN users p ON p.id = l.reported_by ORDER BY l.status = 'OPEN' DESC, l.created_at DESC LIMIT 50`,
      );
      return { live, stats, lost };
    });
    res.json(data);
  }),
);

adminRouter.get(
  '/audit',
  validate(pageQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as PageQuery;
    const rows = await asAdmin(req.user!.userId, (c) =>
      many(
        c,
        `SELECT a.*, COALESCE(u.name, au.name) AS actor_name FROM audit_log a
         LEFT JOIN users u ON u.id::text = a.actor_id LEFT JOIN admin_users au ON au.id::text = a.actor_id
         WHERE ($1::text IS NULL OR a.action ILIKE '%' || $1 || '%' OR a.entity ILIKE '%' || $1 || '%')
         ORDER BY a.created_at DESC LIMIT $2 OFFSET $3`,
        [q.q ?? null, q.limit, q.offset],
      ),
    );
    res.json({ audit: rows });
  }),
);

adminRouter.get(
  '/ngos',
  asyncHandler(async (req, res) => {
    const rows = await asAdmin(req.user!.userId, (c) => many<NgoFacts & { id: string; name: string }>(c, 'SELECT * FROM ngos ORDER BY trust_score DESC'));
    res.json({ ngos: rows.map((n) => ({ ...n, trust: trustScore(n) })) });
  }),
);

function paise(p: number) {
  const rupees = p / 100;
  if (rupees >= 1_00_00_000) return `INR ${(rupees / 1_00_00_000).toFixed(2)} Cr`;
  if (rupees >= 1_00_000) return `INR ${(rupees / 1_00_000).toFixed(2)} L`;
  return `INR ${rupees.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
