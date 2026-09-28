import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';
import { bytesToHex, keyPairFromSeed } from '../domain/crypto';
import { secureGet, secureSet } from './storage';

/**
 * Device identity. Each phone generates ONE Ed25519 keypair on first launch and keeps the
 * secret in the OS keystore. The public key is registered with the server (device binding)
 * and, for pilgrims, embedded in the platform-signed wallet certificate.
 */
let prngReady = false;

/** tweetnacl needs a CSPRNG; React Native has none by default, so wire expo-crypto. */
export function ensurePrng() {
  if (prngReady) return;
  nacl.setPRNG((x, n) => {
    const bytes = Crypto.getRandomBytes(n);
    for (let i = 0; i < n; i++) x[i] = bytes[i];
  });
  prngReady = true;
}

export interface DeviceIdentity {
  deviceId: string;
  publicKey: string;
  secretKey: string;
}

let cached: DeviceIdentity | null = null;

export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  if (cached) return cached;
  ensurePrng();
  const [sk, pk, id] = await Promise.all([secureGet('deviceSecretKey'), secureGet('devicePublicKey'), secureGet('deviceId')]);
  if (sk && pk && id) {
    cached = { deviceId: id, publicKey: pk, secretKey: sk };
    return cached;
  }
  const seed = Crypto.getRandomBytes(nacl.sign.seedLength);
  const kp = keyPairFromSeed(seed);
  const deviceId = 'dev-' + bytesToHex(Crypto.getRandomBytes(8));
  await Promise.all([secureSet('deviceSecretKey', kp.secretKey), secureSet('devicePublicKey', kp.publicKey), secureSet('deviceId', deviceId)]);
  cached = { deviceId, publicKey: kp.publicKey, secretKey: kp.secretKey };
  return cached;
}

export function randomNonce(bytes = 16): string {
  return bytesToHex(Crypto.getRandomBytes(bytes));
}

export function randomUUID(): string {
  return Crypto.randomUUID();
}

/** Test helper: reset the cached identity (used after sign-out in tests). */
export function __resetDeviceIdentityCache() {
  cached = null;
}
