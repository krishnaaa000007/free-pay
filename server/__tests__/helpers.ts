import { buildSignedPaymentQR, issueWalletCertificate } from '../src/services/credentials.js';
import { generateKeyPair, signObject } from '../src/services/crypto.js';
import { getPlatformKeys } from '../src/services/platformKeys.js';
import type { Receipt, SignedPaymentQR, SignedReceipt } from '../src/services/types.js';

export const PILGRIM_ID = '11111111-1111-4111-8111-000000000001';
export const MERCHANT_ID = '33333333-3333-4333-8333-000000000001';
export const OTHER_MERCHANT_ID = '33333333-3333-4333-8333-000000000002';

export const DAY = 24 * 60 * 60 * 1000;

/** A pilgrim device with a valid, platform-issued wallet certificate. */
export function makePilgrimDevice(opts: { now?: Date; ttlMs?: number; userId?: string; deviceId?: string } = {}) {
  const now = opts.now ?? new Date();
  const kp = generateKeyPair();
  const deviceId = opts.deviceId ?? 'device-' + kp.publicKey.slice(0, 8);
  const cert = issueWalletCertificate({
    userId: opts.userId ?? PILGRIM_ID,
    name: 'Arjun Sharma',
    deviceId,
    devicePublicKey: kp.publicKey,
    perTxnLimitPaise: 2000_00,
    dailyLimitPaise: 5000_00,
    ttlMs: opts.ttlMs ?? 10 * DAY,
    now,
  });
  return { kp, deviceId, cert };
}

export function makePaymentQR(
  device: ReturnType<typeof makePilgrimDevice>,
  amountPaise: number,
  opts: { now?: Date; merchantId?: string; ttlMs?: number; overrides?: Partial<SignedPaymentQR['auth']> } = {},
): SignedPaymentQR {
  return buildSignedPaymentQR({
    cert: device.cert,
    deviceSecretKey: device.kp.secretKey,
    merchantId: opts.merchantId ?? MERCHANT_ID,
    amountPaise,
    now: opts.now,
    ttlMs: opts.ttlMs,
    overrides: opts.overrides,
  });
}

/** A vendor device signing an offline receipt for a scanned QR. */
export function makeVendorReceipt(qr: SignedPaymentQR, vendorKp = generateKeyPair(), now = new Date()): SignedReceipt {
  const receipt: Receipt = {
    v: 1,
    type: 'RECEIPT',
    transaction_id: qr.auth.transaction_id,
    nonce: qr.auth.nonce,
    amount: qr.auth.amount,
    currency: 'INR',
    merchant_id: qr.auth.merchant_id,
    merchant_name: 'Shankar Chai & Snacks',
    payer_id: qr.auth.payer_id,
    mode: 'OFFLINE',
    status: 'PENDING_SYNC',
    created_at: qr.auth.created_at,
    expires_at: qr.auth.expires_at,
    synced_at: null,
    issued_at: now.toISOString(),
  };
  return { v: 1, t: 'FREEPAY_RECEIPT', receipt, sig: signObject(receipt, vendorKp.secretKey), signer_pk: vendorKp.publicKey, issuer: 'VENDOR_DEVICE' };
}

export const platformPublicKey = () => getPlatformKeys().publicKey;
