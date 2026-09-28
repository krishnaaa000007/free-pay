import { keyPairFromSeed, randomSeedB64 } from '../src/services/crypto.js';

/**
 * Generates a platform Ed25519 signing seed and prints both halves.
 *   npm run keys
 * Put PLATFORM_SIGNING_SEED in server/.env and EXPO_PUBLIC_PLATFORM_PUBKEY in the root .env.
 */
const seed = randomSeedB64();
const kp = keyPairFromSeed(seed);

process.stdout.write(`\nFree Pay platform signing key\n=============================\n\n`);
process.stdout.write(`server/.env\n  PLATFORM_SIGNING_SEED=${seed}\n\n`);
process.stdout.write(`.env (mobile)\n  EXPO_PUBLIC_PLATFORM_PUBKEY=${kp.publicKey}\n\n`);
process.stdout.write(`Keep the seed secret. The public key ships inside the app.\n\n`);
