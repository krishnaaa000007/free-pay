import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { canonicalize, isValidBase64Key, keyFingerprint, keyPairFromSeed, signObject, verifyObject } from '@/domain/crypto';

const seed = () => nacl.randomBytes(32);

describe('canonical JSON (must match the server byte for byte)', () => {
  it('produces the cross-platform fixture', () => {
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

  it('is order independent and drops undefined', () => {
    expect(canonicalize({ b: 2, a: 1, u: undefined })).toBe(canonicalize({ a: 1, b: 2 }));
  });
});

describe('device signing', () => {
  it('signs and verifies', () => {
    const kp = keyPairFromSeed(seed());
    const payload = { amount: 500, nonce: 'abc' };
    const sig = signObject(payload, kp.secretKey);
    expect(verifyObject(payload, sig, kp.publicKey)).toBe(true);
    expect(verifyObject({ ...payload, amount: 501 }, sig, kp.publicKey)).toBe(false);
  });

  it('interoperates with a server-style signature (raw tweetnacl)', () => {
    const kp = nacl.sign.keyPair();
    const payload = { hello: 'world', n: 1 };
    const sig = naclUtil.encodeBase64(nacl.sign.detached(naclUtil.decodeUTF8(canonicalize(payload)), kp.secretKey));
    expect(verifyObject(payload, sig, naclUtil.encodeBase64(kp.publicKey))).toBe(true);
  });

  it('validates keys and produces stable fingerprints', () => {
    const kp = keyPairFromSeed(seed());
    expect(isValidBase64Key(kp.publicKey)).toBe(true);
    expect(isValidBase64Key('nope')).toBe(false);
    expect(keyFingerprint(kp.publicKey)).toMatch(/^[A-Z0-9]{4}·[A-Z0-9]{4}$/);
  });
});
