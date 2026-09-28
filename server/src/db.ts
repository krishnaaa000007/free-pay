import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';
import type { Tunnel } from './tunnel.js';
import type { Role } from './services/types.js';

const { Pool, types } = pg;

// BIGINT (paise) -> number, NUMERIC -> number. Amounts never exceed 2^53 paise here.
types.setTypeParser(20, (v) => Number.parseInt(v, 10));
types.setTypeParser(1700, (v) => Number.parseFloat(v));
// Keep timestamps as ISO strings so API responses are stable.
types.setTypeParser(1184, (v) => new Date(v).toISOString());
types.setTypeParser(1114, (v) => new Date(v + 'Z').toISOString());

/**
 * Database access layer.
 *
 * SECURITY MODEL
 * --------------
 * The API connects as `freepay_app`, a NON-SUPERUSER role without BYPASSRLS. Every
 * query runs inside `withUser()`, which opens a transaction and sets two transaction-
 * local GUCs: `app.user_id` and `app.role`. Row-level-security policies in the
 * database read those settings, so a pilgrim can only ever see their own rows even if
 * a bug in application code forgets a WHERE clause.
 *
 * `withSystem()` is the single unauthenticated context; it exists only so the auth
 * service can look up a user by phone number and insert new registrations. Its
 * policies are deliberately minimal.
 */
export type DbRole = Role | 'SYSTEM';

export interface DbUser {
  userId: string | null;
  role: DbRole;
}

let pool: pg.Pool | null = null;
let tunnel: Tunnel | null = null;
let initPromise: Promise<pg.Pool> | null = null;

function buildPoolConfig(host: string, port: number): pg.PoolConfig {
  if (config.db.url && !config.ssh.enabled) {
    return { connectionString: config.db.url, ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined, max: config.db.poolMax };
  }
  return {
    host,
    port,
    database: config.db.name,
    user: config.db.user,
    password: config.db.password,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
    max: config.db.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
}

export async function getPool(): Promise<pg.Pool> {
  if (pool) return pool;
  if (!initPromise) {
    initPromise = (async () => {
      let host = config.db.host;
      let port = config.db.port;
      if (config.ssh.enabled) {
        // Imported on demand so ssh2 never reaches a build that will not use it. It
        // carries a bundled pagent.exe and CommonJS __dirname lookups, which break a
        // serverless bundle; the tunnel itself is only ever a local-development aid.
        const { startTunnel } = await import('./tunnel.js');
        tunnel = await startTunnel();
        host = tunnel.host;
        port = tunnel.port;
      }
      const p = new Pool(buildPoolConfig(host, port));
      p.on('error', (err) => logger.error('pg pool error', { error: err.message }));
      pool = p;
      return p;
    })();
  }
  return initPromise;
}

/** Run `fn` inside a transaction with the RLS identity of `user` applied. */
export async function withUser<T>(user: DbUser, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const p = await getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    // set_config(..., true) scopes the setting to this transaction only.
    await client.query('SELECT set_config($1, $2, true), set_config($3, $4, true)', [
      'app.user_id',
      user.userId ?? '',
      'app.role',
      user.role,
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Unauthenticated context used ONLY by the auth service. */
export function withSystem<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withUser({ userId: null, role: 'SYSTEM' }, fn);
}

export async function checkDb(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    const p = await getPool();
    await p.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
  }
}

export async function closeDb() {
  if (pool) await pool.end();
  pool = null;
  initPromise = null;
  if (tunnel) await tunnel.close();
  tunnel = null;
}

/** Small helper to read the single row of a query or null. */
export async function one<T>(client: pg.PoolClient, text: string, params: unknown[] = []): Promise<T | null> {
  const r = await client.query(text, params);
  return (r.rows[0] as T) ?? null;
}

export async function many<T>(client: pg.PoolClient, text: string, params: unknown[] = []): Promise<T[]> {
  const r = await client.query(text, params);
  return r.rows as T[];
}
