import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

/**
 * Pure Ed25519 helpers (no randomness, no storage) so they run identically in Jest and on
 * device. Random key generation lives in services/crypto.ts where the PRNG is wired.
 *
 * Canonical JSON: keys sorted recursively, no whitespace, undefined dropped.
 * Must stay byte-identical with server/src/services/crypto.ts.
 */
const { encodeBase64, decodeBase64, decodeUTF8 } = naclUtil;

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot canonicalize non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }
  throw new Error(`Cannot canonicalize value of type ${typeof value}`);
}

export function signObject(payload: unknown, secretKeyB64: string): string {
  const msg = decodeUTF8(canonicalize(payload));
  return encodeBase64(nacl.sign.detached(msg, decodeBase64(secretKeyB64)));
}

export function verifyObject(payload: unknown, sigB64: string, publicKeyB64: string): boolean {
  try {
    const msg = decodeUTF8(canonicalize(payload));
    const sig = decodeBase64(sigB64);
    const pk = decodeBase64(publicKeyB64);
    if (sig.length !== nacl.sign.signatureLength || pk.length !== nacl.sign.publicKeyLength) return false;
    return nacl.sign.detached.verify(msg, sig, pk);
  } catch {
    return false;
  }
}

export function keyPairFromSeed(seed: Uint8Array): { publicKey: string; secretKey: string } {
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return { publicKey: encodeBase64(kp.publicKey), secretKey: encodeBase64(kp.secretKey) };
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isValidBase64Key(b64: string): boolean {
  try {
    return decodeBase64(b64).length === nacl.sign.publicKeyLength;
  } catch {
    return false;
  }
}

/** Short human-friendly fingerprint of a public key, e.g. "7EZN·UH20". */
export function keyFingerprint(publicKeyB64: string): string {
  const clean = publicKeyB64.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `${clean.slice(0, 4)}·${clean.slice(4, 8)}`;
}
