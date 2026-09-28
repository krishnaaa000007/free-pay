import { randomUUID } from 'node:crypto';
import { isValidBase64Key, randomNonce, signObject, verifyObject } from './crypto.js';
import { getPlatformKeys } from './platformKeys.js';
import type {
  MerchantQR,
  PaymentAuthorization,
  SignedPaymentQR,
  SignedWalletCertificate,
  WalletCertificate,
} from './types.js';

/**
 * Credential layer: issue and verify the signed artefacts that make offline payments
 * trustworthy. Verification here is purely cryptographic/structural and STATELESS;
 * stateful checks (nonce reuse, limits, device binding) live in the fraud engine.
 */

export const OFFLINE_CREDENTIAL_MAX_AGE_MS = 10 * 24 * 60 * 60 * 1000;

export interface IssueCertificateInput {
  userId: string;
  name: string;
  deviceId: string;
  devicePublicKey: string;
  perTxnLimitPaise: number;
  dailyLimitPaise: number;
  /** Validity in ms; hard-capped to 10 days. */
  ttlMs: number;
  now?: Date;
}

export function issueWalletCertificate(input: IssueCertificateInput): SignedWalletCertificate {
  if (!isValidBase64Key(input.devicePublicKey)) {
    throw new Error('Invalid device public key');
  }
  const now = input.now ?? new Date();
  const ttl = Math.min(input.ttlMs, OFFLINE_CREDENTIAL_MAX_AGE_MS);
  const keys = getPlatformKeys();
  const cert: WalletCertificate = {
    v: 1,
    kid: keys.kid,
    sub: input.userId,
    role: 'PILGRIM',
    name: input.name,
    device_id: input.deviceId,
    pk: input.devicePublicKey,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttl).toISOString(),
    limits: { per_txn: input.perTxnLimitPaise, daily: input.dailyLimitPaise },
  };
  return { cert, sig: signObject(cert, keys.secretKey) };
}

export interface VerificationFailure {
  code: string;
  message: string;
}

export interface CertificateVerification {
  ok: boolean;
  failures: VerificationFailure[];
}

export function verifyWalletCertificate(
  signed: SignedWalletCertificate,
  opts: { now?: Date; platformPublicKey?: string } = {},
): CertificateVerification {
  const failures: VerificationFailure[] = [];
  const now = opts.now ?? new Date();
  const pk = opts.platformPublicKey ?? getPlatformKeys().publicKey;
  const cert = signed?.cert;

  if (!cert || cert.v !== 1 || cert.role !== 'PILGRIM') {
    return { ok: false, failures: [{ code: 'INVALID_CERTIFICATE', message: 'Malformed wallet certificate' }] };
  }
  if (!verifyObject(cert, signed.sig, pk)) {
    failures.push({ code: 'INVALID_CERTIFICATE', message: 'Certificate signature does not verify against platform key' });
  }
  const issued = Date.parse(cert.issued_at);
  const expires = Date.parse(cert.expires_at);
  if (Number.isNaN(issued) || Number.isNaN(expires)) {
    failures.push({ code: 'INVALID_CERTIFICATE', message: 'Certificate has invalid timestamps' });
  } else {
    if (expires <= now.getTime()) {
      failures.push({ code: 'CERT_EXPIRED', message: 'Wallet certificate has expired' });
    }
    if (expires - issued > OFFLINE_CREDENTIAL_MAX_AGE_MS + 60_000) {
      failures.push({ code: 'CERT_TTL_TOO_LONG', message: 'Certificate validity exceeds the 10 day maximum' });
    }
  }
  if (!isValidBase64Key(cert.pk)) {
    failures.push({ code: 'INVALID_CERTIFICATE', message: 'Certificate carries an invalid device key' });
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Verify a scanned payment QR: certificate chain, the pilgrim's signature over the
 * authorisation, and internal consistency between the two documents.
 */
export function verifyPaymentQR(
  qr: SignedPaymentQR,
  opts: { now?: Date; platformPublicKey?: string; maxOfflineAgeMs?: number } = {},
): CertificateVerification {
  const now = opts.now ?? new Date();
  const maxAge = Math.min(opts.maxOfflineAgeMs ?? OFFLINE_CREDENTIAL_MAX_AGE_MS, OFFLINE_CREDENTIAL_MAX_AGE_MS);
  const failures: VerificationFailure[] = [];

  if (!qr || qr.v !== 1 || qr.t !== 'FREEPAY_PAY' || !qr.auth || !qr.cert) {
    return { ok: false, failures: [{ code: 'MALFORMED_PAYLOAD', message: 'Not a Free Pay payment code' }] };
  }
  const certResult = verifyWalletCertificate(qr.cert, { now, platformPublicKey: opts.platformPublicKey });
  failures.push(...certResult.failures);

  const auth = qr.auth;
  if (auth.type !== 'OFFLINE_PAYMENT' || auth.currency !== 'INR') {
    failures.push({ code: 'MALFORMED_PAYLOAD', message: 'Unsupported authorisation type' });
  }
  if (!verifyObject(auth, qr.auth_sig, qr.cert.cert.pk)) {
    failures.push({ code: 'INVALID_SIGNATURE', message: 'Payment authorisation signature does not verify' });
  }
  if (auth.payer_id !== qr.cert.cert.sub) {
    failures.push({ code: 'PAYER_CERT_MISMATCH', message: 'Authorisation payer does not match certificate subject' });
  }
  if (auth.device_id !== qr.cert.cert.device_id) {
    failures.push({ code: 'DEVICE_MISMATCH', message: 'Authorisation device does not match certificate device' });
  }
  if (!Number.isInteger(auth.amount) || auth.amount <= 0) {
    failures.push({ code: 'NON_POSITIVE_AMOUNT', message: 'Amount must be a positive integer (paise)' });
  }
  if (typeof auth.nonce !== 'string' || auth.nonce.length < 16) {
    failures.push({ code: 'MALFORMED_PAYLOAD', message: 'Nonce too short' });
  }
  const created = Date.parse(auth.created_at);
  const expires = Date.parse(auth.expires_at);
  if (Number.isNaN(created) || Number.isNaN(expires)) {
    failures.push({ code: 'MALFORMED_PAYLOAD', message: 'Authorisation has invalid timestamps' });
  } else {
    if (expires <= now.getTime()) {
      failures.push({ code: 'EXPIRED_AUTHORIZATION', message: 'Payment authorisation has expired' });
    }
    if (created > now.getTime() + 5 * 60_000) {
      failures.push({ code: 'FUTURE_DATED', message: 'Authorisation is dated in the future' });
    }
    if (now.getTime() - created > maxAge) {
      failures.push({ code: 'STALE_OFFLINE_AUTHORIZATION', message: 'Offline authorisation is older than the maximum offline age' });
    }
    if (expires - created > maxAge + 60_000) {
      failures.push({ code: 'TAMPERED_EXPIRY', message: 'Authorisation validity window exceeds the maximum offline age' });
    }
    const certExpires = Date.parse(qr.cert.cert.expires_at);
    if (!Number.isNaN(certExpires) && expires > certExpires + 60_000) {
      failures.push({ code: 'TAMPERED_EXPIRY', message: 'Authorisation outlives its wallet certificate' });
    }
  }
  return { ok: failures.length === 0, failures };
}

/* ------------------------------------------------------------------ */
/* Merchant QR                                                          */
/* ------------------------------------------------------------------ */
export function signMerchantQR(input: Omit<MerchantQR, 'v' | 't' | 'sig'>): MerchantQR {
  const keys = getPlatformKeys();
  const body = { v: 1 as const, t: 'FREEPAY_MERCHANT' as const, ...input };
  return { ...body, sig: signObject(body, keys.secretKey) };
}

export function verifyMerchantQR(qr: MerchantQR, platformPublicKey?: string): boolean {
  if (!qr || qr.v !== 1 || qr.t !== 'FREEPAY_MERCHANT') return false;
  const { sig, ...body } = qr;
  return verifyObject(body, sig, platformPublicKey ?? getPlatformKeys().publicKey);
}

/* ------------------------------------------------------------------ */
/* Test / demo helper: build a fully signed payment QR for a device.    */
/* ------------------------------------------------------------------ */
export function buildSignedPaymentQR(params: {
  cert: SignedWalletCertificate;
  deviceSecretKey: string;
  merchantId: string;
  amountPaise: number;
  now?: Date;
  ttlMs?: number;
  memo?: string;
  overrides?: Partial<PaymentAuthorization>;
}): SignedPaymentQR {
  const now = params.now ?? new Date();
  const ttl = params.ttlMs ?? OFFLINE_CREDENTIAL_MAX_AGE_MS;
  const auth: PaymentAuthorization = {
    v: 1,
    type: 'OFFLINE_PAYMENT',
    transaction_id: randomUUID(),
    nonce: randomNonce(16),
    amount: params.amountPaise,
    currency: 'INR',
    merchant_id: params.merchantId,
    payer_id: params.cert.cert.sub,
    device_id: params.cert.cert.device_id,
    created_at: now.toISOString(),
    expires_at: new Date(Math.min(now.getTime() + ttl, Date.parse(params.cert.cert.expires_at))).toISOString(),
    ...(params.memo ? { memo: params.memo } : {}),
    ...params.overrides,
  };
  return {
    v: 1,
    t: 'FREEPAY_PAY',
    auth,
    auth_sig: signObject(auth, params.deviceSecretKey),
    cert: params.cert,
  };
}
