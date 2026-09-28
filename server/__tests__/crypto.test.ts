import { canonicalize, generateKeyPair, isValidBase64Key, keyPairFromSeed, randomNonce, signObject, verifyObject } from '../src/services/crypto.js';

describe('canonicalize', () => {
  it('sorts keys recursively and drops undefined', () => {
    const a = { b: 1, a: { z: [3, { y: 2, x: 1 }], k: 'v' }, u: undefined };
    const b = { a: { k: 'v', z: [3, { x: 1, y: 2 }] }, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('{"a":{"k":"v","z":[3,{"x":1,"y":2}]},"b":1}');
  });

  it('matches the cross-platform fixture byte for byte', () => {
    // The mobile app has the same fixture in __tests__/crypto.test.ts.
    const fixture = {
      v: 1,
      type: 'OFFLINE_PAYMENT',
      transaction_id: '5d4c0c2e-6c3e-4f1b-9d7d-8a6f2f4b1c11',
      nonce: '00112233445566778899aabbccddeeff',
      amount: 12000,
      currency: 'INR',
      merchant_id: '33333333-3333-4333-8333-000000000001',
      payer_id: '11111111-1111-4111-8111-000000000001',
      device_id: 'device-abc',
      created_at: '2026-09-20T06:00:00.000Z',
      expires_at: '2026-09-30T06:00:00.000Z',
    };
    expect(canonicalize(fixture)).toBe(
      '{"amount":12000,"created_at":"2026-09-20T06:00:00.000Z","currency":"INR","device_id":"device-abc","expires_at":"2026-09-30T06:00:00.000Z","merchant_id":"33333333-3333-4333-8333-000000000001","nonce":"00112233445566778899aabbccddeeff","payer_id":"11111111-1111-4111-8111-000000000001","transaction_id":"5d4c0c2e-6c3e-4f1b-9d7d-8a6f2f4b1c11","type":"OFFLINE_PAYMENT","v":1}',
    );
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize({ a: NaN })).toThrow();
  });
});

describe('ed25519 signing', () => {
  it('signs and verifies an object', () => {
    const kp = generateKeyPair();
    const payload = { amount: 100, nonce: randomNonce() };
    const sig = signObject(payload, kp.secretKey);
    expect(verifyObject(payload, sig, kp.publicKey)).toBe(true);
  });

  it('detects any tampering of the payload', () => {
    const kp = generateKeyPair();
    const payload = { amount: 100, merchant: 'a' };
    const sig = signObject(payload, kp.secretKey);
    expect(verifyObject({ ...payload, amount: 101 }, sig, kp.publicKey)).toBe(false);
    expect(verifyObject({ ...payload, merchant: 'b' }, sig, kp.publicKey)).toBe(false);
  });

  it('rejects signatures from a different key', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const payload = { x: 1 };
    expect(verifyObject(payload, signObject(payload, a.secretKey), b.publicKey)).toBe(false);
  });

  it('never throws on garbage input', () => {
    const kp = generateKeyPair();
    expect(verifyObject({ x: 1 }, 'not-base64!!', kp.publicKey)).toBe(false);
    expect(verifyObject({ x: 1 }, 'AAAA', 'short')).toBe(false);
  });

  it('derives deterministic keys from a seed', () => {
    const seed = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
    expect(keyPairFromSeed(seed).publicKey).toBe(keyPairFromSeed(seed).publicKey);
    expect(() => keyPairFromSeed('AAAA')).toThrow(/32 bytes/);
  });

  it('validates key encoding', () => {
    expect(isValidBase64Key(generateKeyPair().publicKey)).toBe(true);
    expect(isValidBase64Key('nope')).toBe(false);
  });

  it('generates 32 hex char nonces', () => {
    const n = randomNonce();
    expect(n).toMatch(/^[0-9a-f]{32}$/);
    expect(randomNonce()).not.toBe(n);
  });
});
