// Deterministic environment for the server test-suite.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = 'test-jwt-secret-not-for-production';
process.env.PLATFORM_SIGNING_SEED = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
process.env.PLATFORM_KEY_ID = 'test-kid';
process.env.FRAUD_MAX_SINGLE_OFFLINE_INR = '2000';
process.env.FRAUD_MAX_DAILY_OFFLINE_INR = '5000';
process.env.FRAUD_REVIEW_THRESHOLD_INR = '1500';
process.env.FRAUD_MAX_OFFLINE_AGE_DAYS = '10';
process.env.ONLINE_RECEIPT_TTL_MIN = '15';
process.env.EMERGENCY_SHARE_TTL_MIN = '60';
process.env.OPENAI_API_KEY = '';
// DB tests use the docker-compose defaults unless overridden.
process.env.DB_HOST = process.env.DB_HOST ?? 'localhost';
process.env.DB_PORT = process.env.DB_PORT ?? '5434';
