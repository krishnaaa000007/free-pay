import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { checkDb } from './db.js';
import { requestLogger } from './logger.js';
import { errorHandler, notFound } from './middleware.js';
import { apiLimiter } from './rateLimit.js';
import { adminRouter } from './routes/admin.js';
import { aiRouter } from './routes/ai.js';
import { authRouter } from './routes/auth.js';
import { crowdRouter } from './routes/crowd.js';
import { demoRouter } from './routes/demo.js';
import { emergencyRouter } from './routes/emergency.js';
import { merchantsRouter } from './routes/merchants.js';
import { ngosRouter } from './routes/ngos.js';
import { settlementRouter } from './routes/settlement.js';
import { transactionsRouter } from './routes/transactions.js';
import { getPlatformKeys } from './services/platformKeys.js';

/**
 * Builds the Express application without binding a port, so tests can mount it with
 * supertest and index.ts can own the process lifecycle.
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        // Native apps send no Origin header; browsers must match the allow-list.
        if (!origin || config.corsOrigins.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.)/.test(origin)) return cb(null, true);
        cb(new Error('Origin not allowed by CORS'));
      },
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(requestLogger);

  // Liveness: process is up. Readiness: database reachable.
  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'freepay-api', version: '0.1.0', env: config.env, uptime_s: Math.round(process.uptime()), platform_kid: getPlatformKeys().kid });
  });
  app.get(
    '/health/ready',
    async (_req, res) => {
      const db = await checkDb();
      res.status(db.ok ? 200 : 503).json({ ok: db.ok, db: db.ok ? 'up' : 'down', latency_ms: db.latencyMs, ...(db.ok ? {} : { error: db.error }) });
    },
  );

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/merchants', merchantsRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/settlement', settlementRouter);
  app.use('/api/crowd', crowdRouter);
  app.use('/api/emergency', emergencyRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/ngos', ngosRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/demo', demoRouter);

  app.use((_req, _res, next) => next(notFound('Route not found')));
  app.use(errorHandler);
  return app;
}
