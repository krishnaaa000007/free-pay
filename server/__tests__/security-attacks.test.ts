/**
 * Security attack suite: each test plays an adversary against the stateless credential
 * layer + the fraud engine, exactly as the sync pipeline chains them.
 */
import { config } from '../src/config.js';
import { issueWalletCertificate, verifyPaymentQR } from '../src/services/credentials.js';
import { generateKeyPair, keyPairFromSeed, randomSeedB64, signObject } from '../src/services/crypto.js';
import { evaluateTransaction, type FraudContext } from '../src/services/fraud.js';
import { verifyToken, signToken } from '../src/middleware.js';
import type { SignedPaymentQR, WalletCertificate } from '../src/services/types.js';
import { DAY, makePaymentQR, makePilgrimDevice, MERCHANT_ID, OTHER_MERCHANT_ID, PILGRIM_ID } from './helpers.js';

const now = new Date('2026-09-20T10:00:00Z');

/** Runs the same chain the server runs on sync: verify -> fraud engine. */
function adjudicate(qr: SignedPaymentQR, ctx: Partial<FraudContext> = {}, submittingMerchantId = MERCHANT_ID) {
  const verification = verifyPaymentQR(qr, { now, maxOfflineAgeMs: config.fraud.maxOfflineAgeMs });
  return evaluateTransaction(
    {
      transactionId: qr.auth.transaction_id,
      nonce: qr.auth.nonce,
      amount: qr.auth.amount,
      createdAt: qr.auth.created_at,
      expiresAt: qr.auth.expires_at,
      merchantId: qr.auth.merchant_id,
      payerId: qr.auth.payer_id,
      deviceId: qr.auth.device_id,
      mode: 'OFFLINE',
      submittingMerchantId,
    },
    {
      now,
      nonceSeen: false,
      transactionIdSeen: false,
      merchantKnown: true,
      payerDeviceRegistered: true,
      payerDailyOfflineTotal: 0,
      payerRecentTxnCount: 0,
      verificationFailures: verification.failures,
      ...ctx,
    },
    config.fraud,
  );
}
const codes = (v: { flags: Array<{ code: string }> }) => v.flags.map((f) => f.code);

describe('attack: replay', () => {
  it('re-presenting the same QR at the same stall is rejected (nonce + txn id)', () => {
    const d = makePilgrimDevice({ now });
    const qr = makePaymentQR(d, 15000, { now });
    expect(adjudicate(qr).decision).toBe('ACCEPT');
    const replay = adjudicate(qr, { nonceSeen: true, transactionIdSeen: true });
    expect(replay.decision).toBe('REJECT');
    expect(codes(replay)).toEqual(expect.arrayContaining(['DUPLICATE_NONCE', 'REPLAYED_TRANSACTION_ID']));
  });

  it('a copied QR presented at a different stall is rejected (merchant mismatch)', () => {
    const d = makePilgrimDevice({ now });
    const qr = makePaymentQR(d, 15000, { now });
    const v = adjudicate(qr, {}, OTHER_MERCHANT_ID);
    expect(v.decision).toBe('REJECT');
    expect(codes(v)).toContain('MERCHANT_MISMATCH');
  });

  it('changing the nonce to dodge the duplicate check breaks the signature', () => {
    const d = makePilgrimDevice({ now });
    const qr = makePaymentQR(d, 15000, { now });
    const mutated = { ...qr, auth: { ...qr.auth, nonce: 'ffffffffffffffffffffffffffffffff' } };
    expect(codes(adjudicate(mutated))).toContain('INVALID_SIGNATURE');
  });
});

describe('attack: tampering', () => {
  it('editing the amount after signing is detected', () => {
    const d = makePilgrimDevice({ now });
    const qr = makePaymentQR(d, 1000, { now });
    const forged = { ...qr, auth: { ...qr.auth, amount: 100 } };
    const v = adjudicate(forged);
    expect(v.decision).toBe('REJECT');
    expect(codes(v)).toContain('INVALID_SIGNATURE');
  });

  it('extending expires_at on a stale credential is caught by the server-side backstop', () => {
    const created = new Date(now.getTime() - 20 * DAY);
    const d = makePilgrimDevice({ now: created });
    // Attacker re-signs with the legitimate device key (compromised phone) but stretches expiry to 30 days.
    const qr = makePaymentQR(d, 1000, { now: created, overrides: { expires_at: new Date(created.getTime() + 30 * DAY).toISOString() } });
    const v = adjudicate(qr);
    expect(v.decision).toBe('REJECT');
    expect(codes(v)).toEqual(expect.arrayContaining(['STALE_OFFLINE_AUTHORIZATION', 'TAMPERED_EXPIRY']));
  });

  it('a credential cannot outlive its wallet certificate', () => {
    const d = makePilgrimDevice({ now, ttlMs: 2 * DAY });
    const qr = makePaymentQR(d, 1000, { now, overrides: { expires_at: new Date(now.getTime() + 9 * DAY).toISOString() } });
    expect(codes(adjudicate(qr))).toContain('TAMPERED_EXPIRY');
  });

  it('raising limits inside the certificate invalidates the platform signature', () => {
    const d = makePilgrimDevice({ now });
    const cert: WalletCertificate = { ...d.cert.cert, limits: { per_txn: 10_000_00, daily: 100_000_00 } };
    const qr = makePaymentQR({ ...d, cert: { cert, sig: d.cert.sig } }, 5000_00, { now });
    const v = adjudicate(qr);
    expect(codes(v)).toContain('INVALID_CERTIFICATE');
    expect(codes(v)).toContain('EXCEEDS_SINGLE_TXN_LIMIT'); // limits are enforced from server config, not the QR
    expect(v.decision).toBe('REJECT');
  });
});

describe('attack: forged identity', () => {
  it('a self-issued certificate (attacker platform key) is rejected', () => {
    const attackerPlatform = keyPairFromSeed(randomSeedB64());
    const deviceKp = generateKeyPair();
    const cert: WalletCertificate = {
      v: 1,
      kid: 'test-kid',
      sub: PILGRIM_ID,
      role: 'PILGRIM',
      name: 'Mallory',
      device_id: 'evil-device',
      pk: deviceKp.publicKey,
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 9 * DAY).toISOString(),
      limits: { per_txn: 2000_00, daily: 5000_00 },
    };
    const signedCert = { cert, sig: signObject(cert, attackerPlatform.secretKey) };
    const qr = makePaymentQR({ kp: deviceKp, deviceId: 'evil-device', cert: signedCert }, 500_00, { now });
    const v = adjudicate(qr);
    expect(v.decision).toBe('REJECT');
    expect(codes(v)).toContain('INVALID_CERTIFICATE');
  });

  it('an authorisation signed by a different device than the certificate names is rejected', () => {
    const d = makePilgrimDevice({ now });
    const otherPhone = generateKeyPair();
    const qr = makePaymentQR({ ...d, kp: otherPhone }, 500_00, { now });
    expect(codes(adjudicate(qr))).toContain('INVALID_SIGNATURE');
  });

  it('payer id in the authorisation must match the certificate subject', () => {
    const d = makePilgrimDevice({ now });
    const qr = makePaymentQR(d, 500_00, { now, overrides: { payer_id: '11111111-1111-4111-8111-000000000099' } });
    expect(codes(adjudicate(qr))).toContain('PAYER_CERT_MISMATCH');
  });
});

describe('attack: device binding', () => {
  it('a valid QR from a device that is not registered to the payer is flagged suspicious (soft)', () => {
    const d = makePilgrimDevice({ now });
    const qr = makePaymentQR(d, 500_00, { now });
    const v = adjudicate(qr, { payerDeviceRegistered: false });
    expect(v.decision).toBe('REVIEW');
    expect(v.suspicious).toBe(true);
    expect(codes(v)).toContain('DEVICE_MISMATCH');
  });
});

describe('attack: limit evasion', () => {
  it('splitting a large purchase into many offline payments hits the rolling daily cap', () => {
    const d = makePilgrimDevice({ now });
    let spent = 0;
    let rejected = 0;
    for (let i = 0; i < 6; i++) {
      const qr = makePaymentQR(d, 1000_00, { now });
      const v = adjudicate(qr, { payerDailyOfflineTotal: spent });
      if (v.decision === 'REJECT') rejected++;
      else spent += qr.auth.amount;
    }
    expect(spent).toBe(5000_00);
    expect(rejected).toBe(1);
  });

  it('the certificate limits cannot loosen the server configuration', () => {
    const d = makePilgrimDevice({ now });
    const cert = issueWalletCertificate({
      userId: PILGRIM_ID,
      name: 'A',
      deviceId: d.deviceId,
      devicePublicKey: d.kp.publicKey,
      perTxnLimitPaise: 10_000_00,
      dailyLimitPaise: 50_000_00,
      ttlMs: DAY,
      now,
    });
    const qr = makePaymentQR({ ...d, cert }, 3000_00, { now });
    expect(codes(adjudicate(qr))).toContain('EXCEEDS_SINGLE_TXN_LIMIT');
  });
});

describe('attack: auth tokens', () => {
  it('tokens signed with another secret are rejected', () => {
    const token = signToken({ sub: PILGRIM_ID, role: 'ADMIN' });
    expect(verifyToken(token).role).toBe('ADMIN');
    const parts = token.split('.');
    const forged = parts[0] + '.' + parts[1] + '.AAAA' + parts[2].slice(4);
    expect(() => verifyToken(forged)).toThrow();
  });

  it('role escalation by editing the payload breaks the signature', () => {
    const token = signToken({ sub: PILGRIM_ID, role: 'PILGRIM' });
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.role = 'ADMIN';
    const forged = [h, Buffer.from(JSON.stringify(payload)).toString('base64url'), s].join('.');
    expect(() => verifyToken(forged)).toThrow();
  });
});
