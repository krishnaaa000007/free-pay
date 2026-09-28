import 'dotenv/config';
import { z } from 'zod';

/**
 * Central, validated runtime configuration.
 * All money limits are configured in INR in the environment and exposed here in PAISE
 * (integers) so the rest of the codebase never does floating point money math.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => (v ?? '').toLowerCase() === 'true' || v === '1');

const intFromEnv = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().finite().nonnegative());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intFromEnv(4000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:3001,http://localhost:8081'),

  JWT_SECRET: z.string().min(8).default('dev-only-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  PLATFORM_SIGNING_SEED: z.string().optional(),
  PLATFORM_KEY_ID: z.string().default('freepay-platform-dev'),

  DATABASE_URL: z.string().optional(),
  DATABASE_ADMIN_URL: z.string().optional(),
  // One process per request on a serverless host: a large pool per instance would exhaust
  // the database's connection limit as instances scale out. Keep it small there.
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: intFromEnv(5432),
  DB_NAME: z.string().default('freepay'),
  DB_USER: z.string().default('freepay_app'),
  DB_PASSWORD: z.string().default('freepay_app_dev_password'),
  DB_SSL: bool,
  DB_ADMIN_USER: z.string().default('postgres'),
  DB_ADMIN_PASSWORD: z.string().default('postgres'),

  SSH_TUNNEL_ENABLED: bool,
  SSH_HOST: z.string().optional(),
  SSH_PORT: intFromEnv(22),
  SSH_USER: z.string().optional(),
  SSH_PASSWORD: z.string().optional(),
  SSH_PRIVATE_KEY_PATH: z.string().optional(),
  SSH_REMOTE_DB_HOST: z.string().default('127.0.0.1'),
  SSH_REMOTE_DB_PORT: intFromEnv(5432),
  SSH_LOCAL_PORT: intFromEnv(15432),

  FRAUD_MAX_SINGLE_OFFLINE_INR: intFromEnv(2000),
  FRAUD_MAX_DAILY_OFFLINE_INR: intFromEnv(5000),
  FRAUD_REVIEW_THRESHOLD_INR: intFromEnv(1500),
  FRAUD_MAX_OFFLINE_AGE_DAYS: intFromEnv(10),
  FRAUD_VELOCITY_WINDOW_MIN: intFromEnv(10),
  FRAUD_VELOCITY_MAX_TXNS: intFromEnv(12),
  ONLINE_RECEIPT_TTL_MIN: intFromEnv(15),

  EMERGENCY_SHARE_TTL_MIN: intFromEnv(60),
  EMERGENCY_CONTACTS: z
    .string()
    .default('Mela Control Room:1077,Police:112,Ambulance:108,Lost and Found:1098'),

  DEMO_MODE: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;

/** The absolute ceiling for offline credential age. Env may lower it, never raise it. */
export const HARD_MAX_OFFLINE_AGE_DAYS = 10;

/** Convert rupees to integer paise. */
export const INR = (rupees: number) => Math.round(rupees * 100);

export interface FraudConfig {
  maxSingleOfflinePaise: number;
  maxDailyOfflinePaise: number;
  reviewThresholdPaise: number;
  maxOfflineAgeMs: number;
  velocityWindowMs: number;
  velocityMaxTxns: number;
}

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jwt: { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN },
  platform: { signingSeed: env.PLATFORM_SIGNING_SEED, keyId: env.PLATFORM_KEY_ID },
  db: {
    url: env.DATABASE_URL,
    adminUrl: env.DATABASE_ADMIN_URL,
    host: env.DB_HOST,
    port: env.DB_PORT,
    name: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL,
    poolMax: env.DB_POOL_MAX,
    adminUser: env.DB_ADMIN_USER,
    adminPassword: env.DB_ADMIN_PASSWORD,
  },
  ssh: {
    enabled: env.SSH_TUNNEL_ENABLED,
    host: env.SSH_HOST,
    port: env.SSH_PORT,
    user: env.SSH_USER,
    password: env.SSH_PASSWORD,
    privateKeyPath: env.SSH_PRIVATE_KEY_PATH,
    remoteDbHost: env.SSH_REMOTE_DB_HOST,
    remoteDbPort: env.SSH_REMOTE_DB_PORT,
    localPort: env.SSH_LOCAL_PORT,
  },
  fraud: {
    maxSingleOfflinePaise: INR(env.FRAUD_MAX_SINGLE_OFFLINE_INR),
    maxDailyOfflinePaise: INR(env.FRAUD_MAX_DAILY_OFFLINE_INR),
    reviewThresholdPaise: INR(env.FRAUD_REVIEW_THRESHOLD_INR),
    maxOfflineAgeMs:
      Math.min(env.FRAUD_MAX_OFFLINE_AGE_DAYS, HARD_MAX_OFFLINE_AGE_DAYS) * 24 * 60 * 60 * 1000,
    velocityWindowMs: env.FRAUD_VELOCITY_WINDOW_MIN * 60 * 1000,
    velocityMaxTxns: env.FRAUD_VELOCITY_MAX_TXNS,
  } satisfies FraudConfig,
  onlineReceiptTtlMs: env.ONLINE_RECEIPT_TTL_MIN * 60 * 1000,
  emergency: {
    shareTtlMs: env.EMERGENCY_SHARE_TTL_MIN * 60 * 1000,
    contacts: env.EMERGENCY_CONTACTS.split(',')
      .map((pair) => {
        const idx = pair.lastIndexOf(':');
        return idx === -1
          ? null
          : { label: pair.slice(0, idx).trim(), number: pair.slice(idx + 1).trim() };
      })
      .filter((c): c is { label: string; number: string } => !!c && !!c.label && !!c.number),
  },
  openai: { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL },
  /** Enables /api/demo (single-device pitch walkthrough). Never on in production. */
  // /api/demo provisions throw-away device keys and relays QR payloads: useful for a
  // pitch, and something that must never appear in a real deployment by accident. Outside
  // production it is on unless switched off; in production it stays off unless DEMO_MODE
  // is explicitly "true", which is a deliberate act for a demo deployment.
  demoMode:
    env.NODE_ENV !== 'production'
      ? (env.DEMO_MODE ?? 'true').toLowerCase() !== 'false'
      : (env.DEMO_MODE ?? '').toLowerCase() === 'true',
};

export type AppConfig = typeof config;
