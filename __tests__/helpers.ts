import nacl from 'tweetnacl';
import { buildPaymentQR, buildVendorReceipt } from '@/domain/credential';
import { keyPairFromSeed, signObject } from '@/domain/crypto';
import type { LimitConfig } from '@/domain/limits';
import type { SignedPaymentQR, SignedWalletCertificate, WalletCertificate } from '@/domain/types';

export const DAY = 86_400_000;
export const LIMITS: LimitConfig = { maxOfflineTxnPaise: 2000_00, maxOfflineDailyPaise: 5000_00, maxOfflineAgeMs: 10 * DAY };
export const MERCHANT = { id: '33333333-3333-4333-8333-000000000001', name: 'Shankar Chai & Snacks' };
export const PILGRIM_ID = '11111111-1111-4111-8111-000000000001';

/** A fake platform + pilgrim device, mirroring what the server issues. */
export function makePlatform() {
  return keyPairFromSeed(nacl.randomBytes(32));
}

export function makePilgrim(platform: ReturnType<typeof makePlatform>, opts: { now?: Date; ttlMs?: number } = {}) {
  const now = opts.now ?? new Date();
  const kp = keyPairFromSeed(nacl.randomBytes(32));
  const cert: WalletCertificate = {
    v: 1,
    kid: 'test',
    sub: PILGRIM_ID,
    role: 'PILGRIM',
    name: 'Arjun Sharma',
    device_id: 'dev-test-pilgrim',
    pk: kp.publicKey,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (opts.ttlMs ?? 10 * DAY)).toISOString(),
    limits: { per_txn: 2000_00, daily: 5000_00 },
  };
  const signed: SignedWalletCertificate = { cert, sig: signObject(cert, platform.secretKey) };
  return { kp, cert: signed };
}

let seq = 0;
export function makeQr(p: ReturnType<typeof makePilgrim>, amount: number, opts: { now?: Date; merchantId?: string; memo?: string } = {}): SignedPaymentQR {
  seq++;
  return buildPaymentQR({
    cert: p.cert,
    deviceSecretKey: p.kp.secretKey,
    merchantId: opts.merchantId ?? MERCHANT.id,
    amount,
    transactionId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    nonce: String(seq).padStart(32, 'a'),
    now: opts.now ?? new Date(),
    limits: LIMITS,
    memo: opts.memo,
  });
}

export function makeVendor() {
  return keyPairFromSeed(nacl.randomBytes(32));
}

export function makeReceipt(qr: SignedPaymentQR, vendor: ReturnType<typeof makeVendor>, now = new Date()) {
  return buildVendorReceipt({ qr, merchantName: MERCHANT.name, vendorSecretKey: vendor.secretKey, vendorPublicKey: vendor.publicKey, now });
}
