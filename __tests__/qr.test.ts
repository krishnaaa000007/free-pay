import { parseScannedPayload, verifyMerchantQR, verifyPaymentQR, verifyReceipt } from '@/domain/credential';
import { signObject } from '@/domain/crypto';
import { decodeQr, encodeQr, qrErrorLevel, shortId } from '@/services/qr';
import { DAY, makePilgrim, makePlatform, makeQr, makeReceipt, makeVendor, MERCHANT } from './helpers';

describe('QR encoding', () => {
  const platform = makePlatform();
  const pilgrim = makePilgrim(platform);

  it('round-trips a payment code through the QR string', () => {
    const qr = makeQr(pilgrim, 12000);
    const raw = encodeQr(qr);
    const parsed = decodeQr(raw);
    expect(parsed.kind).toBe('PAYMENT');
    if (parsed.kind === 'PAYMENT') {
      expect(parsed.data.auth.amount).toBe(12000);
      expect(verifyPaymentQR(parsed.data, { platformPublicKey: platform.publicKey, expectedMerchantId: MERCHANT.id }).ok).toBe(true);
    }
  });

  it('keeps a full payment code under ~1.5 KB so it fits a scannable QR', () => {
    const raw = encodeQr(makeQr(pilgrim, 12000, { memo: 'Chai and samosa' }));
    expect(raw.length).toBeLessThan(1500);
    expect(['L', 'M']).toContain(qrErrorLevel(raw));
  });

  it('classifies stall codes, receipts and unknown payloads', () => {
    const body = { v: 1 as const, t: 'FREEPAY_MERCHANT' as const, merchant_id: MERCHANT.id, name: MERCHANT.name, category: 'FOOD' };
    const merchantQr = { ...body, sig: signObject(body, platform.secretKey) };
    expect(parseScannedPayload(JSON.stringify(merchantQr)).kind).toBe('MERCHANT');
    expect(verifyMerchantQR(merchantQr, platform.publicKey)).toBe(true);
    expect(verifyMerchantQR({ ...merchantQr, name: 'Fake' }, platform.publicKey)).toBe(false);

    const receipt = makeReceipt(makeQr(pilgrim, 500), makeVendor());
    expect(parseScannedPayload(encodeQr(receipt)).kind).toBe('RECEIPT');
    expect(verifyReceipt(receipt, platform.publicKey).ok).toBe(true);

    expect(parseScannedPayload('upi://pay?pa=x@ybl').kind).toBe('UNKNOWN');
    expect(parseScannedPayload('{"v":2,"t":"FREEPAY_PAY"}').kind).toBe('UNKNOWN');
    expect(parseScannedPayload('not json').kind).toBe('UNKNOWN');
  });

  it('short ids are 8 upper-case chars', () => {
    expect(shortId('5d4c0c2e-6c3e-4f1b-9d7d-8a6f2f4b1c11')).toBe('5D4C0C2E');
  });
});

describe('offline verification on the vendor device', () => {
  const platform = makePlatform();
  const now = new Date('2026-09-20T10:00:00Z');

  it('rejects a code for a different stall', () => {
    const p = makePilgrim(platform, { now });
    const qr = makeQr(p, 1000, { now, merchantId: '33333333-3333-4333-8333-000000000002' });
    const r = verifyPaymentQR(qr, { platformPublicKey: platform.publicKey, expectedMerchantId: MERCHANT.id, now });
    expect(r.failures.map((f) => f.code)).toContain('MERCHANT_MISMATCH');
  });

  it('rejects a credential from another platform', () => {
    const rogue = makePlatform();
    const p = makePilgrim(rogue, { now });
    const qr = makeQr(p, 1000, { now });
    expect(verifyPaymentQR(qr, { platformPublicKey: platform.publicKey, now }).failures.map((f) => f.code)).toContain('INVALID_CERTIFICATE');
  });

  it('rejects stale and expired codes', () => {
    const p = makePilgrim(platform, { now });
    const qr = makeQr(p, 1000, { now });
    expect(verifyPaymentQR(qr, { platformPublicKey: platform.publicKey, now: new Date(now.getTime() + 11 * DAY) }).failures.map((f) => f.code)).toEqual(expect.arrayContaining(['EXPIRED_AUTHORIZATION', 'STALE_OFFLINE_AUTHORIZATION']));
  });

  it('a device with no platform key cannot verify (fails closed)', () => {
    const p = makePilgrim(platform, { now });
    const qr = makeQr(p, 1000, { now });
    const r = verifyPaymentQR(qr, { platformPublicKey: '', now });
    expect(r.ok).toBe(false);
    expect(r.failures[0].code).toBe('NO_PLATFORM_KEY');
  });

  it('the authorisation never outlives the credential', () => {
    const p = makePilgrim(platform, { now, ttlMs: 2 * DAY });
    const qr = makeQr(p, 1000, { now });
    expect(Date.parse(qr.auth.expires_at)).toBeLessThanOrEqual(Date.parse(p.cert.cert.expires_at));
  });
});
