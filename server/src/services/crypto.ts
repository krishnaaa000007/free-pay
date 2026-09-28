import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

/**
 * Ed25519 signing primitives shared (by contract) with the mobile app.
 *
 * Signing works over a CANONICAL JSON encoding: keys sorted recursively, no whitespace,
 * `undefined` values dropped. Both sides must produce byte-identical output for the
 * same logical object, which is what makes offline verification possible.
 */

const { encodeBase64, decodeBase64, decodeUTF8 } = naclUtil;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

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

export interface KeyPairB64 {
  publicKey: string;
  secretKey: string;
}

export function generateKeyPair(): KeyPairB64 {
  const kp = nacl.sign.keyPair();
  return { publicKey: encodeBase64(kp.publicKey), secretKey: encodeBase64(kp.secretKey) };
}

/** Derive a deterministic keypair from a 32-byte seed (base64). */
export function keyPairFromSeed(seedB64: string): KeyPairB64 {
  const seed = decodeBase64(seedB64);
  if (seed.length !== nacl.sign.seedLength) {
    throw new Error(`Seed must be ${nacl.sign.seedLength} bytes, got ${seed.length}`);
  }
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return { publicKey: encodeBase64(kp.publicKey), secretKey: encodeBase64(kp.secretKey) };
}

export function randomSeedB64(): string {
  return encodeBase64(nacl.randomBytes(nacl.sign.seedLength));
}

export function signObject(payload: unknown, secretKeyB64: string): string {
  const msg = decodeUTF8(canonicalize(payload));
  const sig = nacl.sign.detached(msg, decodeBase64(secretKeyB64));
  return encodeBase64(sig);
}

export function verifyObject(payload: unknown, sigB64: string, publicKeyB64: string): boolean {
  try {
    const msg = decodeUTF8(canonicalize(payload));
    const sig = decodeBase64(sigB64);
    const pk = decodeBase64(publicKeyB64);
    if (sig.length !== nacl.sign.signatureLength || pk.length !== nacl.sign.publicKeyLength) {
      return false;
    }
    return nacl.sign.detached.verify(msg, sig, pk);
  } catch {
    return false;
  }
}

export function randomNonce(bytes = 16): string {
  return Buffer.from(nacl.randomBytes(bytes)).toString('hex');
}

export function isValidBase64Key(b64: string, expectedLength = nacl.sign.publicKeyLength): boolean {
  try {
    return decodeBase64(b64).length === expectedLength;
  } catch {
    return false;
  }
}
