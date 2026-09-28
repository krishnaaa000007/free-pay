import { config } from '../config.js';
import { logger } from '../logger.js';
import { keyPairFromSeed, randomSeedB64, type KeyPairB64 } from './crypto.js';

/**
 * The platform signing key. It signs wallet certificates, merchant QR codes, online
 * receipts and NGO credits. Its PUBLIC half ships inside the mobile app so every
 * device can verify platform-issued artefacts fully offline.
 *
 * In production PLATFORM_SIGNING_SEED must be set (and ideally live in a KMS/HSM).
 * In development we generate an ephemeral key and warn loudly, because any
 * credential issued with it will stop verifying after a restart.
 */
let cached: (KeyPairB64 & { kid: string; ephemeral: boolean }) | null = null;

export function getPlatformKeys() {
  if (cached) return cached;
  const kid = config.platform.keyId;
  if (config.platform.signingSeed) {
    cached = { ...keyPairFromSeed(config.platform.signingSeed), kid, ephemeral: false };
  } else {
    if (config.isProd) {
      throw new Error('PLATFORM_SIGNING_SEED is required in production');
    }
    const seed = randomSeedB64();
    cached = { ...keyPairFromSeed(seed), kid, ephemeral: true };
    logger.warn('PLATFORM_SIGNING_SEED not set; using an EPHEMERAL platform key', {
      hint: 'run `npm run keys` and put the seed in server/.env and the public key in the app .env',
      publicKey: cached.publicKey,
    });
  }
  return cached;
}

/** Test helper: force a specific seed (used by the security test-suite). */
export function __setPlatformSeedForTests(seedB64: string, kid = 'test-kid') {
  cached = { ...keyPairFromSeed(seedB64), kid, ephemeral: false };
  return cached;
}
