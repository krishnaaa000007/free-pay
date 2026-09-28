import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Migration runner. Applies numbered SQL files from /migrations exactly once each,
 * tracked in `schema_migrations`. Runs as the database OWNER/admin (never as the
 * app role), because it creates roles, policies and SECURITY DEFINER functions.
 *
 *   npm run migrate           apply pending migrations
 *   npm run migrate:reset     DROP SCHEMA public CASCADE and re-apply (dev only)
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

function substitute(sql: string): string {
  return sql
    .replaceAll('${APP_DB_PASSWORD}', config.db.password.replaceAll("'", "''"))
    .replaceAll('${DB_NAME}', config.db.name);
}

async function main() {
  const reset = process.argv.includes('--reset');
  if (reset && config.isProd) {
    throw new Error('Refusing to --reset in production');
  }

  let host = config.db.host;
  let port = config.db.port;
  let tunnel: import('./tunnel.js').Tunnel | null = null;
  if (config.ssh.enabled) {
    const { startTunnel } = await import('./tunnel.js');
    tunnel = await startTunnel();
    host = tunnel.host;
    port = tunnel.port;
  }

  const client = new pg.Client(
    config.db.adminUrl && !config.ssh.enabled
      ? { connectionString: config.db.adminUrl, ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined }
      : {
          host,
          port,
          database: config.db.name,
          user: config.db.adminUser,
          password: config.db.adminPassword,
          ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
        },
  );
  await client.connect();
  logger.info('migrate: connected', { host, port, database: config.db.name, user: config.db.adminUser });

  try {
    if (reset) {
      logger.warn('migrate: RESETTING schema public');
      await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
      await client.query('GRANT ALL ON SCHEMA public TO public;');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now(),
        checksum    text
      )`);

    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        logger.debug('migrate: skip', { file });
        continue;
      }
      const sql = substitute(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      const started = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          file,
          simpleChecksum(sql),
        ]);
        await client.query('COMMIT');
        count++;
        logger.info('migrate: applied', { file, ms: Date.now() - started });
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error('migrate: FAILED', { file, error: (err as Error).message });
        throw err;
      }
    }
    logger.info('migrate: done', { applied: count, total: files.length });
  } finally {
    await client.end();
    if (tunnel) await tunnel.close();
  }
}

function simpleChecksum(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

main().catch((err) => {
  logger.error('migrate: aborted', { error: (err as Error).message });
  process.exit(1);
});
