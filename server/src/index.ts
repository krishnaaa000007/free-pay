import { createApp } from './app.js';
import { config } from './config.js';
import { checkDb, closeDb } from './db.js';
import { logger } from './logger.js';
import { getPlatformKeys } from './services/platformKeys.js';

/**
 * Process bootstrap: start HTTP, probe the database once (non-fatal, so the API can
 * boot before Postgres and report readiness truthfully), wire graceful shutdown.
 */
async function main() {
  const keys = getPlatformKeys();
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info('freepay api listening', {
      port: config.port,
      env: config.env,
      platformKid: keys.kid,
      platformPublicKey: keys.publicKey,
      ephemeralKey: keys.ephemeral,
      corsOrigins: config.corsOrigins,
      limits: {
        maxSingleOfflineInr: config.fraud.maxSingleOfflinePaise / 100,
        maxDailyOfflineInr: config.fraud.maxDailyOfflinePaise / 100,
        maxOfflineAgeDays: config.fraud.maxOfflineAgeMs / 86_400_000,
      },
    });
  });

  const db = await checkDb();
  if (db.ok) logger.info('database reachable', { latencyMs: db.latencyMs });
  else logger.warn('database NOT reachable yet; /health/ready will report down', { error: db.error, hint: 'npm run db:up && npm run db:migrate' });

  const shutdown = (signal: string) => {
    logger.info('shutting down', { signal });
    server.close(() => {
      closeDb()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('fatal during bootstrap', { error: (err as Error).message });
  process.exit(1);
});
