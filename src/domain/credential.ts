import { isValidBase64Key, signObject, verifyObject } from './crypto';
import { authorizationExpiry, type LimitConfig } from './limits';
import type {
  MerchantQR,
  PaymentAuthorization,
  Receipt,
  ScannedPayload,
  SignedNgoCredit,
  SignedPaymentQR,
  SignedReceipt,
  SignedWalletCertificate,
  TxnMode,
  TxnStatus,
} from './types';

/**
 * Credential rules: build the pilgrim's payment authorisation and verify everything a
 * device can verify OFFLINE. Randomness (ids/nonces) is injected so the logic stays pure.
 */
export const OFFLINE_CREDENTIAL_MAX_AGE_MS = 10 * 24 * 60 * 60 * 1000;

export interface VerificationFailure {
  code: string;
  message: string;
}
export interface Verification {
  ok: boolean;
  failures: VerificationFailure[];
}

/* ------------------------------------------------------------------ */
/* Parsing scanned codes                                                */
/* ------------------------------------------------------------------ */
export function parseScannedPayload(raw: string): ScannedPayload {
  try {
    const obj = JSON.parse(raw) as { t?: string; v?: number };
    if (obj?.v !== 1) return { kind: 'UNKNOWN', raw };
    switch (obj.t) {
      case 'FREEPAY_PAY':
        return { kind: 'PAYMENT', data: obj as SignedPaymentQR };
      case 'FREEPAY_MERCHANT':
        return { kind: 'MERCHANT', data: obj as MerchantQR };
      case 'FREEPAY_RECEIPT':
        return { kind: 'RECEIPT', data: obj as SignedReceipt };
      case 'FREEPAY_NGO_CREDIT':
        return { kind: 'NGO_CREDIT', data: obj as SignedNgoCredit };
      default:
        return { kind: 'UNKNOWN', raw };
    }
  } catch {
    return { kind: 'UNKNOWN', raw };
  }
}

/* ------------------------------------------------------------------ */
/* Building a payment authorisation (pilgrim side)                      */
/* ------------------------------------------------------------------ */
export interface BuildAuthInput {
  cert: SignedWalletCertificate;
  deviceSecretKey: string;
  merchantId: string;
  amount: number;
  transactionId: string;
  nonce: string;
  now: Date;
  limits: LimitConfig;
  memo?: string;
}

export function buildPaymentQR(input: BuildAuthInput): SignedPaymentQR {
  const auth: PaymentAuthorization = {
    v: 1,
    type: 'OFFLINE_PAYMENT',
    transaction_id: input.transactionId,
    nonce: input.nonce,
    amount: input.amount,
    currency: 'INR',
    merchant_id: input.merchantId,
    payer_id: input.cert.cert.sub,
    device_id: input.cert.cert.device_id,
    created_at: input.now.toISOString(),
    expires_at: authorizationExpiry(input.now, input.cert.cert.expires_at, input.limits).toISOString(),
    ...(input.memo ? { memo: input.memo } : {}),
  };
  return { v: 1, t: 'FREEPAY_PAY', auth, auth_sig: signObject(auth, input.deviceSecretKey), cert: input.cert };
}

/* ------------------------------------------------------------------ */
/* Verification (vendor side, fully offline)                            */
/* ------------------------------------------------------------------ */
export function verifyWalletCertificate(signed: SignedWalletCertificate, platformPublicKey: string, now = new Date()): Verification {
  const failures: VerificationFailure[] = [];
  const cert = signed?.cert;
  if (!cert || cert.v !== 1 || cert.role !== 'PILGRIM') {
    return { ok: false, failures: [{ code: 'INVALID_CERTIFICATE', message: 'Malformed wallet credential' }] };
  }
  if (!platformPublicKey) failures.push({ code: 'NO_PLATFORM_KEY', message: 'This device has no platform key to verify against' });
  else if (!verifyObject(cert, signed.sig, platformPublicKey)) failures.push({ code: 'INVALID_CERTIFICATE', message: 'Credential was not issued by Free Pay' });
  const issued = Date.parse(cert.issued_at);
  const expires = Date.parse(cert.expires_at);
  if (Number.isNaN(issued) || Number.isNaN(expires)) failures.push({ code: 'INVALID_CERTIFICATE', message: 'Credential has invalid dates' });
  else {
    if (expires <= now.getTime()) failures.push({ code: 'CERT_EXPIRED', message: 'Wallet credential has expired' });
    if (expires - issued > OFFLINE_CREDENTIAL_MAX_AGE_MS + 60_000) failures.push({ code: 'CERT_TTL_TOO_LONG', message: 'Credential validity exceeds 10 days' });
  }
  if (!isValidBase64Key(cert.pk)) failures.push({ code: 'INVALID_CERTIFICATE', message: 'Credential carries an invalid key' });
  return { ok: failures.length === 0, failures };
}

export interface VerifyPaymentOptions {
  platformPublicKey: string;
  now?: Date;
  /** The scanning vendor's merchant id; mismatch is a hard failure. */
  expectedMerchantId?: string;
  maxOfflineAgeMs?: number;
}

export function verifyPaymentQR(qr: SignedPaymentQR, opts: VerifyPaymentOptions): Verification {
  const now = opts.now ?? new Date();
  const maxAge = Math.min(opts.maxOfflineAgeMs ?? OFFLINE_CREDENTIAL_MAX_AGE_MS, OFFLINE_CREDENTIAL_MAX_AGE_MS);
  const failures: VerificationFailure[] = [];
  if (!qr || qr.v !== 1 || qr.t !== 'FREEPAY_PAY' || !qr.auth || !qr.cert) {
    return { ok: false, failures: [{ code: 'MALFORMED_PAYLOAD', message: 'Not a Free Pay payment code' }] };
  }
  failures.push(...verifyWalletCertificate(qr.cert, opts.platformPublicKey, now).failures);
  const auth = qr.auth;
  if (auth.type !== 'OFFLINE_PAYMENT' || auth.currency !== 'INR') failures.push({ code: 'MALFORMED_PAYLOAD', message: 'Unsupported payment type' });
  if (!verifyObject(auth, qr.auth_sig, qr.cert.cert.pk)) failures.push({ code: 'INVALID_SIGNATURE', message: 'Payment was not signed by the credential holder' });
  if (auth.payer_id !== qr.cert.cert.sub) failures.push({ code: 'PAYER_CERT_MISMATCH', message: 'Payer does not match credential' });
  if (auth.device_id !== qr.cert.cert.device_id) failures.push({ code: 'DEVICE_MISMATCH', message: 'Payment device differs from credential device' });
  if (!Number.isInteger(auth.amount) || auth.amount <= 0) failures.push({ code: 'NON_POSITIVE_AMOUNT', message: 'Invalid amount' });
  if (opts.expectedMerchantId && auth.merchant_id !== opts.expectedMerchantId) failures.push({ code: 'MERCHANT_MISMATCH', message: 'This payment was made out to a different stall' });
  const created = Date.parse(auth.created_at);
  const expires = Date.parse(auth.expires_at);
  if (Number.isNaN(created) || Number.isNaN(expires)) failures.push({ code: 'MALFORMED_PAYLOAD', message: 'Invalid timestamps' });
  else {
    if (expires <= now.getTime()) failures.push({ code: 'EXPIRED_AUTHORIZATION', message: 'Payment code has expired' });
    if (created > now.getTime() + 5 * 60_000) failures.push({ code: 'FUTURE_DATED', message: 'Payment code is dated in the future' });
    if (now.getTime() - created > maxAge) failures.push({ code: 'STALE_OFFLINE_AUTHORIZATION', message: 'Payment code is older than 10 days' });
    if (expires - created > maxAge + 60_000) failures.push({ code: 'TAMPERED_EXPIRY', message: 'Payment code validity is too long' });
    const certExpires = Date.parse(qr.cert.cert.expires_at);
    if (!Number.isNaN(certExpires) && expires > certExpires + 60_000) failures.push({ code: 'TAMPERED_EXPIRY', message: 'Payment outlives its credential' });
  }
  return { ok: failures.length === 0, failures };
}

export function verifyMerchantQR(qr: MerchantQR, platformPublicKey: string): boolean {
  if (!qr || qr.v !== 1 || qr.t !== 'FREEPAY_MERCHANT' || !platformPublicKey) return false;
  const { sig, ...body } = qr;
  return verifyObject(body, sig, platformPublicKey);
}

/* ------------------------------------------------------------------ */
/* Receipts                                                             */
/* ------------------------------------------------------------------ */
export interface BuildReceiptInput {
  qr: SignedPaymentQR;
  merchantName: string;
  vendorSecretKey: string;
  vendorPublicKey: string;
  now: Date;
  status?: TxnStatus;
  mode?: TxnMode;
}

/** Vendor device signs a receipt the moment it accepts an offline payment. */
export function buildVendorReceipt(input: BuildReceiptInput): SignedReceipt {
  const { auth } = input.qr;
  const receipt: Receipt = {
    v: 1,
    type: 'RECEIPT',
    transaction_id: auth.transaction_id,
    nonce: auth.nonce,
    amount: auth.amount,
    currency: 'INR',
    merchant_id: auth.merchant_id,
    merchant_name: input.merchantName,
    payer_id: auth.payer_id,
    mode: input.mode ?? 'OFFLINE',
    status: input.status ?? 'PENDING_SYNC',
    created_at: auth.created_at,
    expires_at: auth.expires_at,
    synced_at: null,
    issued_at: input.now.toISOString(),
  };
  return { v: 1, t: 'FREEPAY_RECEIPT', receipt, sig: signObject(receipt, input.vendorSecretKey), signer_pk: input.vendorPublicKey, issuer: 'VENDOR_DEVICE' };
}

export function verifyReceipt(signed: SignedReceipt, platformPublicKey: string, now = new Date()): { ok: boolean; reason?: string; expired?: boolean } {
  if (!signed || signed.v !== 1 || signed.t !== 'FREEPAY_RECEIPT' || !signed.receipt) return { ok: false, reason: 'MALFORMED_RECEIPT' };
  const key = signed.issuer === 'PLATFORM' ? platformPublicKey : signed.signer_pk;
  if (signed.issuer === 'PLATFORM' && signed.signer_pk !== platformPublicKey) return { ok: false, reason: 'UNTRUSTED_SIGNER' };
  if (!verifyObject(signed.receipt, signed.sig, key)) return { ok: false, reason: 'INVALID_SIGNATURE' };
  const expires = Date.parse(signed.receipt.expires_at);
  if (signed.receipt.mode === 'ONLINE' && !Number.isNaN(expires) && expires <= now.getTime()) return { ok: false, reason: 'RECEIPT_EXPIRED', expired: true };
  return { ok: true };
}

export function verifyNgoCredit(signed: SignedNgoCredit, platformPublicKey: string, now = new Date()): { ok: boolean; reason?: string } {
  if (!signed || signed.v !== 1 || signed.t !== 'FREEPAY_NGO_CREDIT' || !signed.credit) return { ok: false, reason: 'MALFORMED_CREDIT' };
  if (!verifyObject(signed.credit, signed.sig, platformPublicKey)) return { ok: false, reason: 'INVALID_SIGNATURE' };
  if (Date.parse(signed.credit.expires_at) <= now.getTime()) return { ok: false, reason: 'CREDIT_EXPIRED' };
  if (!Number.isInteger(signed.credit.amount) || signed.credit.amount <= 0) return { ok: false, reason: 'NON_POSITIVE_AMOUNT' };
  return { ok: true };
}

/** Human copy for failure codes, used by the vendor verify screen. */
export const FAILURE_TITLES: Record<string, string> = {
  INVALID_CERTIFICATE: 'Credential not trusted',
  CERT_EXPIRED: 'Credential expired',
  CERT_TTL_TOO_LONG: 'Credential invalid',
  INVALID_SIGNATURE: 'Signature invalid',
  PAYER_CERT_MISMATCH: 'Payer mismatch',
  DEVICE_MISMATCH: 'Device mismatch',
  NON_POSITIVE_AMOUNT: 'Invalid amount',
  MERCHANT_MISMATCH: 'Wrong stall',
  EXPIRED_AUTHORIZATION: 'Code expired',
  FUTURE_DATED: 'Clock problem',
  STALE_OFFLINE_AUTHORIZATION: 'Code too old',
  TAMPERED_EXPIRY: 'Code tampered',
  MALFORMED_PAYLOAD: 'Not a payment code',
  NO_PLATFORM_KEY: 'Device not provisioned',
  DUPLICATE_NONCE: 'Already used',
  REPLAYED_TRANSACTION_ID: 'Already used',
  EXCEEDS_SINGLE_TXN_LIMIT: 'Over offline limit',
  EXCEEDS_DAILY_LIMIT: 'Over daily limit',
};
