import { OFFLINE_CREDENTIAL_MAX_AGE_MS, signMerchantQR, verifyMerchantQR, verifyPaymentQR, verifyWalletCertificate } from '../src/services/credentials.js';
import { generateKeyPair } from '../src/services/crypto.js';
import { DAY, makePaymentQR, makePilgrimDevice, MERCHANT_ID } from './helpers.js';

const codes = (r: { failures: Array<{ code: string }> }) => r.failures.map((f) => f.code);

describe('wallet certificate', () => {
  it('issues a certificate that verifies against the platform key', () => {
    const d = makePilgrimDevice();
    const r = verifyWalletCertificate(d.cert);
    expect(r.ok).toBe(true);
    expect(d.cert.cert.limits).toEqual({ per_txn: 200000, daily: 500000 });
  });

  it('caps validity at 10 days even if a longer TTL is requested', () => {
    const now = new Date('2026-09-20T00:00:00Z');
    const d = makePilgrimDevice({ now, ttlMs: 90 * DAY });
    expect(Date.parse(d.cert.cert.expires_at) - now.getTime()).toBe(OFFLINE_CREDENTIAL_MAX_AGE_MS);
  });

  it('reports expiry', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    const d = makePilgrimDevice({ now, ttlMs: 2 * DAY });
    expect(codes(verifyWalletCertificate(d.cert, { now: new Date('2026-09-04T00:00:00Z') }))).toContain('CERT_EXPIRED');
  });

  it('fails when the certificate body is edited', () => {
    const d = makePilgrimDevice();
    const forged = { ...d.cert, cert: { ...d.cert.cert, limits: { per_txn: 99999999, daily: 99999999 } } };
    expect(codes(verifyWalletCertificate(forged))).toContain('INVALID_CERTIFICATE');
  });
});

describe('payment QR', () => {
  it('verifies a well-formed offline payment', () => {
    const d = makePilgrimDevice();
    const qr = makePaymentQR(d, 12000);
    expect(verifyPaymentQR(qr)).toEqual({ ok: true, failures: [] });
  });

  it('carries every field the spec requires', () => {
    const d = makePilgrimDevice();
    const qr = makePaymentQR(d, 500);
    expect(qr.auth).toEqual(
      expect.objectContaining({
        amount: 500,
        merchant_id: MERCHANT_ID,
        created_at: expect.any(String),
        expires_at: expect.any(String),
        transaction_id: expect.any(String),
        nonce: expect.stringMatching(/^[0-9a-f]{32}$/),
      }),
    );
  });

  it('rejects an authorisation signed by a key that is not in the certificate', () => {
    const d = makePilgrimDevice();
    const rogue = generateKeyPair();
    const qr = makePaymentQR({ ...d, kp: rogue }, 12000);
    expect(codes(verifyPaymentQR(qr))).toContain('INVALID_SIGNATURE');
  });

  it('flags device mismatch between authorisation and certificate', () => {
    const d = makePilgrimDevice();
    const qr = makePaymentQR(d, 1000, { overrides: { device_id: 'other-device' } });
    expect(codes(verifyPaymentQR(qr))).toContain('DEVICE_MISMATCH');
  });

  it('detects expired and stale authorisations', () => {
    const created = new Date('2026-09-01T00:00:00Z');
    const d = makePilgrimDevice({ now: created });
    const qr = makePaymentQR(d, 1000, { now: created, ttlMs: 2 * DAY });
    expect(codes(verifyPaymentQR(qr, { now: new Date('2026-09-04T00:00:00Z') }))).toContain('EXPIRED_AUTHORIZATION');
    const stale = codes(verifyPaymentQR(qr, { now: new Date('2026-09-15T00:00:00Z') }));
    expect(stale).toContain('STALE_OFFLINE_AUTHORIZATION');
  });

  it('rejects an authorisation whose window is longer than 10 days (tampered expiry)', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    const d = makePilgrimDevice({ now });
    // The device signs a 30 day window; the cert only allows 10.
    const qr = makePaymentQR(d, 1000, { now, overrides: { expires_at: new Date(now.getTime() + 30 * DAY).toISOString() } });
    const failures = codes(verifyPaymentQR(qr, { now }));
    expect(failures).toContain('TAMPERED_EXPIRY');
  });

  it('rejects non-positive amounts', () => {
    const d = makePilgrimDevice();
    expect(codes(verifyPaymentQR(makePaymentQR(d, 0)))).toContain('NON_POSITIVE_AMOUNT');
    expect(codes(verifyPaymentQR(makePaymentQR(d, -50)))).toContain('NON_POSITIVE_AMOUNT');
    expect(codes(verifyPaymentQR(makePaymentQR(d, 10.5)))).toContain('NON_POSITIVE_AMOUNT');
  });

  it('rejects payloads that are not Free Pay codes', () => {
    expect(verifyPaymentQR({ v: 1, t: 'UPI' } as never).ok).toBe(false);
  });
});

describe('merchant QR', () => {
  it('signs and verifies a stall code', () => {
    const qr = signMerchantQR({ merchant_id: MERCHANT_ID, name: 'Shankar Chai', category: 'FOOD' });
    expect(verifyMerchantQR(qr)).toBe(true);
    expect(verifyMerchantQR({ ...qr, name: 'Fake Stall' })).toBe(false);
  });
});
