import type { LedgerTransaction, TxnStatus } from '../domain/types';
import { openSqlite } from './sqliteDriver';

/**
 * Local ledger. Vendors store every accepted offline payment here (direction IN) until it
 * is synced; pilgrims store their outgoing payments (direction OUT) for history and for
 * the on-device daily-limit check. Backed by expo-sqlite on native and by an in-memory
 * store on web / in Jest, behind one interface.
 */
export interface LedgerStats {
  todayCount: number;
  todayAmount: number;
  todayOfflineCount: number;
  pendingCount: number;
  pendingAmount: number;
  syncedCount: number;
  syncedAmount: number;
  settledCount: number;
  settledAmount: number;
  failedCount: number;
  totalCount: number;
  totalAmount: number;
}

export interface SyncLogEntry {
  id: number;
  at: string;
  items: number;
  accepted: number;
  review: number;
  rejected: number;
  duplicates: number;
  error: string | null;
}

export interface ListOptions {
  direction?: 'IN' | 'OUT';
  status?: TxnStatus | TxnStatus[];
  limit?: number;
  offset?: number;
}

export interface Ledger {
  insert(txn: LedgerTransaction): Promise<void>;
  get(id: string): Promise<LedgerTransaction | null>;
  list(opts?: ListOptions): Promise<LedgerTransaction[]>;
  pending(): Promise<LedgerTransaction[]>;
  applySyncResult(id: string, r: { status: TxnStatus; synced_at?: string | null; flags?: string[]; error?: string | null }): Promise<void>;
  updateStatus(id: string, status: TxnStatus, extra?: { settled_at?: string | null; synced_at?: string | null }): Promise<void>;
  recordAttempt(id: string, error: string | null): Promise<void>;
  hasNonce(nonce: string): Promise<boolean>;
  rememberNonce(nonce: string): Promise<void>;
  offlineTotalSince(direction: 'IN' | 'OUT', sinceIso: string): Promise<number>;
  stats(direction: 'IN' | 'OUT'): Promise<LedgerStats>;
  addSyncLog(e: Omit<SyncLogEntry, 'id'>): Promise<void>;
  syncLogs(limit?: number): Promise<SyncLogEntry[]>;
  clear(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  nonce TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  merchant_name TEXT NOT NULL,
  payer_id TEXT,
  payer_name TEXT,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  accepted_at TEXT,
  synced_at TEXT,
  settled_at TEXT,
  memo TEXT,
  payload_json TEXT,
  receipt_json TEXT,
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  fraud_flags TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_txn_created ON transactions(created_at DESC);
CREATE TABLE IF NOT EXISTS seen_nonces (nonce TEXT PRIMARY KEY, seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, items INTEGER, accepted INTEGER, review INTEGER,
  rejected INTEGER, duplicates INTEGER, error TEXT
);
`;

type Row = Omit<LedgerTransaction, 'fraud_flags'> & { fraud_flags: string };
const fromRow = (r: Row): LedgerTransaction => ({ ...r, fraud_flags: safeJson(r.fraud_flags) });
const safeJson = (s: string): string[] => {
  try {
    return JSON.parse(s) as string[];
  } catch {
    return [];
  }
};
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

/* ------------------------------------------------------------------ */
/* SQLite implementation                                                */
/* ------------------------------------------------------------------ */
async function createSqliteLedger(name: string): Promise<Ledger> {
  const db = await openSqlite(`${name}.db`);
  if (!db) return createMemoryLedger(`${name}.ledger`);
  await db.execAsync(SCHEMA);

  const statsFor = async (direction: 'IN' | 'OUT'): Promise<LedgerStats> => {
    const today = startOfToday();
    const r = await db.getFirstAsync<Record<string, number>>(
      `SELECT
        COALESCE(SUM(CASE WHEN created_at >= ? AND status <> 'FAILED' THEN 1 ELSE 0 END),0) AS todayCount,
        COALESCE(SUM(CASE WHEN created_at >= ? AND status <> 'FAILED' THEN amount ELSE 0 END),0) AS todayAmount,
        COALESCE(SUM(CASE WHEN created_at >= ? AND mode = 'OFFLINE' THEN 1 ELSE 0 END),0) AS todayOfflineCount,
        COALESCE(SUM(CASE WHEN status = 'PENDING_SYNC' THEN 1 ELSE 0 END),0) AS pendingCount,
        COALESCE(SUM(CASE WHEN status = 'PENDING_SYNC' THEN amount ELSE 0 END),0) AS pendingAmount,
        COALESCE(SUM(CASE WHEN status = 'SYNCED' THEN 1 ELSE 0 END),0) AS syncedCount,
        COALESCE(SUM(CASE WHEN status = 'SYNCED' THEN amount ELSE 0 END),0) AS syncedAmount,
        COALESCE(SUM(CASE WHEN status = 'SETTLED' THEN 1 ELSE 0 END),0) AS settledCount,
        COALESCE(SUM(CASE WHEN status = 'SETTLED' THEN amount ELSE 0 END),0) AS settledAmount,
        COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END),0) AS failedCount,
        COUNT(*) AS totalCount,
        COALESCE(SUM(CASE WHEN status <> 'FAILED' THEN amount ELSE 0 END),0) AS totalAmount
      FROM transactions WHERE direction = ?`,
      [today, today, today, direction],
    );
    return (r ?? {}) as unknown as LedgerStats;
  };

  return {
    async insert(t) {
      await db.runAsync(
        `INSERT OR REPLACE INTO transactions (id, nonce, direction, amount, currency, mode, status, merchant_id, merchant_name, payer_id, payer_name,
          device_id, created_at, expires_at, accepted_at, synced_at, settled_at, memo, payload_json, receipt_json, sync_attempts, last_error, fraud_flags)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [t.id, t.nonce, t.direction, t.amount, t.currency, t.mode, t.status, t.merchant_id, t.merchant_name, t.payer_id, t.payer_name, t.device_id, t.created_at, t.expires_at, t.accepted_at, t.synced_at, t.settled_at, t.memo, t.payload_json, t.receipt_json, t.sync_attempts, t.last_error, JSON.stringify(t.fraud_flags ?? [])],
      );
    },
    async get(id) {
      const r = await db.getFirstAsync<Row>('SELECT * FROM transactions WHERE id = ?', [id]);
      return r ? fromRow(r) : null;
    },
    async list(opts = {}) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (opts.direction) {
        where.push('direction = ?');
        params.push(opts.direction);
      }
      if (opts.status) {
        const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
        where.push(`status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses);
      }
      const rows = await db.getAllAsync<Row>(
        `SELECT * FROM transactions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, opts.limit ?? 100, opts.offset ?? 0],
      );
      return rows.map(fromRow);
    },
    async pending() {
      const rows = await db.getAllAsync<Row>(`SELECT * FROM transactions WHERE direction = 'IN' AND status = 'PENDING_SYNC' ORDER BY created_at ASC LIMIT 200`);
      return rows.map(fromRow);
    },
    async applySyncResult(id, r) {
      await db.runAsync(
        `UPDATE transactions SET status = ?, synced_at = COALESCE(?, synced_at), fraud_flags = ?, last_error = ?, sync_attempts = sync_attempts + 1 WHERE id = ?`,
        [r.status, r.synced_at ?? null, JSON.stringify(r.flags ?? []), r.error ?? null, id],
      );
    },
    async updateStatus(id, status, extra = {}) {
      await db.runAsync(`UPDATE transactions SET status = ?, settled_at = COALESCE(?, settled_at), synced_at = COALESCE(?, synced_at) WHERE id = ?`, [
        status,
        extra.settled_at ?? null,
        extra.synced_at ?? null,
        id,
      ]);
    },
    async recordAttempt(id, error) {
      await db.runAsync('UPDATE transactions SET sync_attempts = sync_attempts + 1, last_error = ? WHERE id = ?', [error, id]);
    },
    async hasNonce(nonce) {
      const r = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM seen_nonces WHERE nonce = ?', [nonce]);
      const t = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM transactions WHERE nonce = ?', [nonce]);
      return (r?.c ?? 0) > 0 || (t?.c ?? 0) > 0;
    },
    async rememberNonce(nonce) {
      await db.runAsync('INSERT OR IGNORE INTO seen_nonces (nonce, seen_at) VALUES (?, ?)', [nonce, new Date().toISOString()]);
    },
    async offlineTotalSince(direction, sinceIso) {
      const r = await db.getFirstAsync<{ s: number }>(
        `SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE direction = ? AND mode = 'OFFLINE' AND status <> 'FAILED' AND created_at >= ?`,
        [direction, sinceIso],
      );
      return r?.s ?? 0;
    },
    stats: statsFor,
    async addSyncLog(e) {
      await db.runAsync('INSERT INTO sync_log (at, items, accepted, review, rejected, duplicates, error) VALUES (?,?,?,?,?,?,?)', [
        e.at,
        e.items,
        e.accepted,
        e.review,
        e.rejected,
        e.duplicates,
        e.error,
      ]);
    },
    async syncLogs(limit = 20) {
      return db.getAllAsync<SyncLogEntry>('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?', [limit]);
    },
    async clear() {
      await db.execAsync('DELETE FROM transactions; DELETE FROM seen_nonces; DELETE FROM sync_log;');
    },
  };
}

/* ------------------------------------------------------------------ */
/* In-memory implementation (web + tests)                               */
/* ------------------------------------------------------------------ */
export function createMemoryLedger(persistKey?: string): Ledger {
  const txns = new Map<string, LedgerTransaction>();
  const nonces = new Set<string>();
  const logs: SyncLogEntry[] = [];
  let logId = 1;

  // On web there is no SQLite, so the ledger is kept in memory. When a storage key is
  // given we mirror it into localStorage as well, so a browser refresh does not wipe a
  // vendor's pending queue mid-demo. Every access is guarded: private windows and
  // blocked site-data simply fall back to memory-only.
  const store = (() => {
    try {
      return persistKey && typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  })();
  const save = () => {
    if (!store) return;
    try {
      store.setItem(persistKey!, JSON.stringify({ txns: [...txns.values()], nonces: [...nonces], logs, logId }));
    } catch {
      /* quota or blocked storage: stay memory-only */
    }
  };
  if (store) {
    try {
      const raw = store.getItem(persistKey!);
      if (raw) {
        const snap = JSON.parse(raw) as { txns?: LedgerTransaction[]; nonces?: string[]; logs?: SyncLogEntry[]; logId?: number };
        for (const t of snap.txns ?? []) txns.set(t.id, t);
        for (const n of snap.nonces ?? []) nonces.add(n);
        logs.push(...(snap.logs ?? []));
        logId = snap.logId ?? logs.length + 1;
      }
    } catch {
      /* corrupt snapshot: start clean */
    }
  }
  const all = () => [...txns.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return {
    async insert(t) {
      txns.set(t.id, { ...t, fraud_flags: [...(t.fraud_flags ?? [])] });
      save();
    },
    async get(id) {
      return txns.get(id) ?? null;
    },
    async list(opts = {}) {
      const statuses = opts.status ? (Array.isArray(opts.status) ? opts.status : [opts.status]) : null;
      return all()
        .filter((t) => (!opts.direction || t.direction === opts.direction) && (!statuses || statuses.includes(t.status)))
        .slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100));
    },
    async pending() {
      return all()
        .filter((t) => t.direction === 'IN' && t.status === 'PENDING_SYNC')
        .reverse();
    },
    async applySyncResult(id, r) {
      const t = txns.get(id);
      if (!t) return;
      txns.set(id, { ...t, status: r.status, synced_at: r.synced_at ?? t.synced_at, fraud_flags: r.flags ?? [], last_error: r.error ?? null, sync_attempts: t.sync_attempts + 1 });
      save();
    },
    async updateStatus(id, status, extra = {}) {
      const t = txns.get(id);
      if (!t) return;
      txns.set(id, { ...t, status, settled_at: extra.settled_at ?? t.settled_at, synced_at: extra.synced_at ?? t.synced_at });
      save();
    },
    async recordAttempt(id, error) {
      const t = txns.get(id);
      if (t) txns.set(id, { ...t, sync_attempts: t.sync_attempts + 1, last_error: error });
      save();
    },
    async hasNonce(nonce) {
      return nonces.has(nonce) || [...txns.values()].some((t) => t.nonce === nonce);
    },
    async rememberNonce(nonce) {
      nonces.add(nonce);
      save();
    },
    async offlineTotalSince(direction, sinceIso) {
      return [...txns.values()]
        .filter((t) => t.direction === direction && t.mode === 'OFFLINE' && t.status !== 'FAILED' && t.created_at >= sinceIso)
        .reduce((a, t) => a + t.amount, 0);
    },
    async stats(direction) {
      const today = startOfToday();
      const rows = [...txns.values()].filter((t) => t.direction === direction);
      const sum = (f: (t: LedgerTransaction) => boolean) => rows.filter(f).reduce((a, t) => a + t.amount, 0);
      const count = (f: (t: LedgerTransaction) => boolean) => rows.filter(f).length;
      return {
        todayCount: count((t) => t.created_at >= today && t.status !== 'FAILED'),
        todayAmount: sum((t) => t.created_at >= today && t.status !== 'FAILED'),
        todayOfflineCount: count((t) => t.created_at >= today && t.mode === 'OFFLINE'),
        pendingCount: count((t) => t.status === 'PENDING_SYNC'),
        pendingAmount: sum((t) => t.status === 'PENDING_SYNC'),
        syncedCount: count((t) => t.status === 'SYNCED'),
        syncedAmount: sum((t) => t.status === 'SYNCED'),
        settledCount: count((t) => t.status === 'SETTLED'),
        settledAmount: sum((t) => t.status === 'SETTLED'),
        failedCount: count((t) => t.status === 'FAILED'),
        totalCount: rows.length,
        totalAmount: sum((t) => t.status !== 'FAILED'),
      };
    },
    async addSyncLog(e) {
      logs.unshift({ id: logId++, ...e });
      save();
    },
    async syncLogs(limit = 20) {
      return logs.slice(0, limit);
    },
    async clear() {
      txns.clear();
      nonces.clear();
      logs.length = 0;
      save();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Factory                                                              */
/* ------------------------------------------------------------------ */
const instances = new Map<string, Promise<Ledger>>();

/** One ledger per signed-in user so demo accounts on the same phone never mix. */
export function openLedger(userId: string): Promise<Ledger> {
  const key = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  let p = instances.get(key);
  if (!p) {
    p = createSqliteLedger(`freepay-${key}`);
    instances.set(key, p);
  }
  return p;
}
