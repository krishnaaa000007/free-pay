import { appConfig } from '../domain/config';
import {
  buildPaymentQR,
  buildVendorReceipt,
  verifyNgoCredit,
  verifyPaymentQR,
  type Verification,
} from '../domain/credential';
import { evaluateOfflineLimits, rollingDayStart, type LimitCheckResult } from '../domain/limits';
import type {
  LedgerTransaction,
  Merchant,
  ServerTransaction,
  SignedNgoCredit,
  SignedPaymentQR,
  SignedReceipt,
  SignedWalletCertificate,
} from '../domain/types';
import { get, post } from './api';
import { getDeviceIdentity, randomNonce, randomUUID } from './crypto';
import type { Ledger } from './ledger';
import { encodeQr } from './qr';
import { prefGet, prefSet, secureGet, secureSet } from './storage';

/**
 * Payment orchestration for both roles. Pure rules live in /domain; this module wires
 * them to device identity, secure storage, the local ledger and the API.
 */

/* ------------------------------------------------------------------ */
/* Platform key                                                         */
/* ------------------------------------------------------------------ */
let platformKeyCache: string | null = null;

export async function getPlatformPublicKey(): Promise<string> {
  if (appConfig.platformPublicKey) return appConfig.platformPublicKey;
  if (platformKeyCache) return platformKeyCache;
  const cached = await prefGet('platformKey');
  if (cached) platformKeyCache = cached;
  return platformKeyCache ?? '';
}

/** Dev convenience: pull the platform key from the server when the env var is not set. */
export async function refreshPlatformKey(): Promise<string> {
  const r = await get<{ public_key: string }>('/api/auth/platform-key', undefined, { auth: false });
  platformKeyCache = r.public_key;
  await prefSet('platformKey', r.public_key);
  return r.public_key;
}

/* ------------------------------------------------------------------ */
/* Device provisioning + wallet certificate (pilgrim)                   */
/* ------------------------------------------------------------------ */
export async function loadWalletCertificate(): Promise<SignedWalletCertificate | null> {
  const raw = await secureGet('walletCertificate');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SignedWalletCertificate;
  } catch {
    return null;
  }
}

/** Register this device's public key with the server; pilgrims also receive a wallet certificate. */
export async function provisionDevice(platform: string, model?: string): Promise<{ credential: SignedWalletCertificate | null }> {
  const id = await getDeviceIdentity();
  const r = await post<{ credential: SignedWalletCertificate | null }>('/api/auth/device', {
    device_id: id.deviceId,
    public_key: id.publicKey,
    platform,
    model,
  });
  if (r.credential) await secureSet('walletCertificate', JSON.stringify(r.credential));
  return r;
}

export async function refreshCredential(): Promise<SignedWalletCertificate> {
  const id = await getDeviceIdentity();
  const r = await post<{ credential: SignedWalletCertificate }>('/api/auth/credential', { device_id: id.deviceId });
  await secureSet('walletCertificate', JSON.stringify(r.credential));
  return r.credential;
}

/* ------------------------------------------------------------------ */
/* Pilgrim: offline payment                                             */
/* ------------------------------------------------------------------ */
export interface CreateOfflinePaymentInput {
  merchant: Pick<Merchant, 'id' | 'name'>;
  amount: number;
  memo?: string;
  ledger: Ledger;
  payerName: string;
  now?: Date;
}

export interface OfflinePaymentResult {
  qr: SignedPaymentQR;
  payload: string;
  txn: LedgerTransaction;
  limits: LimitCheckResult;
}

export class LimitError extends Error {
  constructor(public result: LimitCheckResult) {
    super('Offline limit exceeded');
  }
}

export class NoCredentialError extends Error {
  constructor() {
    super('No wallet credential on this device');
  }
}

export async function checkOfflineLimits(ledger: Ledger, amount: number, cert?: SignedWalletCertificate | null, now = new Date()): Promise<LimitCheckResult> {
  const dailyOfflineTotal = await ledger.offlineTotalSince('OUT', rollingDayStart(now).toISOString());
  return evaluateOfflineLimits({ amount, dailyOfflineTotal, certLimits: cert?.cert.limits }, appConfig.limits);
}

export async function createOfflinePayment(input: CreateOfflinePaymentInput): Promise<OfflinePaymentResult> {
  const now = input.now ?? new Date();
  const cert = await loadWalletCertificate();
  if (!cert) throw new NoCredentialError();
  const limits = await checkOfflineLimits(input.ledger, input.amount, cert, now);
  if (!limits.ok) throw new LimitError(limits);

  const device = await getDeviceIdentity();
  const qr = buildPaymentQR({
    cert,
    deviceSecretKey: device.secretKey,
    merchantId: input.merchant.id,
    amount: input.amount,
    transactionId: randomUUID(),
    nonce: randomNonce(16),
    now,
    limits: appConfig.limits,
    memo: input.memo,
  });
  const payload = encodeQr(qr);
  const txn: LedgerTransaction = {
    id: qr.auth.transaction_id,
    nonce: qr.auth.nonce,
    direction: 'OUT',
    amount: input.amount,
    currency: 'INR',
    mode: 'OFFLINE',
    status: 'PENDING_SYNC',
    merchant_id: input.merchant.id,
    merchant_name: input.merchant.name,
    payer_id: cert.cert.sub,
    payer_name: input.payerName,
    device_id: device.deviceId,
    created_at: qr.auth.created_at,
    expires_at: qr.auth.expires_at,
    accepted_at: null,
    synced_at: null,
    settled_at: null,
    memo: input.memo ?? null,
    payload_json: payload,
    receipt_json: null,
    sync_attempts: 0,
    last_error: null,
    fraud_flags: [],
  };
  await input.ledger.insert(txn);
  return { qr, payload, txn, limits };
}

/** Pilgrim scans the vendor's receipt QR to attach proof of acceptance to their local record. */
export async function attachVendorReceipt(ledger: Ledger, receipt: SignedReceipt): Promise<LedgerTransaction | null> {
  const txn = await ledger.get(receipt.receipt.transaction_id);
  if (!txn) return null;
  const updated: LedgerTransaction = { ...txn, receipt_json: encodeQr(receipt), accepted_at: receipt.receipt.issued_at };
  await ledger.insert(updated);
  return updated;
}

/* ------------------------------------------------------------------ */
/* Pilgrim: online payment                                               */
/* ------------------------------------------------------------------ */
export async function payOnline(input: { merchant: Pick<Merchant, 'id' | 'name'>; amount: number; memo?: string; ledger: Ledger; payerId: string; payerName: string }) {
  const device = await getDeviceIdentity();
  const r = await post<{ transaction: ServerTransaction; receipt: SignedReceipt; receipt_payload: string }>('/api/transactions/online', {
    merchant_id: input.merchant.id,
    amount: input.amount,
    device_id: device.deviceId,
    memo: input.memo,
  });
  const txn: LedgerTransaction = {
    id: r.transaction.id,
    nonce: r.transaction.nonce,
    direction: 'OUT',
    amount: input.amount,
    currency: 'INR',
    mode: 'ONLINE',
    status: r.transaction.status,
    merchant_id: input.merchant.id,
    merchant_name: input.merchant.name,
    payer_id: input.payerId,
    payer_name: input.payerName,
    device_id: device.deviceId,
    created_at: r.transaction.created_at,
    expires_at: r.transaction.expires_at,
    accepted_at: r.transaction.created_at,
    synced_at: r.transaction.synced_at,
    settled_at: null,
    memo: input.memo ?? null,
    payload_json: null,
    receipt_json: r.receipt_payload,
    sync_attempts: 0,
    last_error: null,
    fraud_flags: r.transaction.fraud_flags ?? [],
  };
  await input.ledger.insert(txn);
  return { txn, receipt: r.receipt, payload: r.receipt_payload };
}

/* ------------------------------------------------------------------ */
/* Vendor: verify + accept                                               */
/* ------------------------------------------------------------------ */
export interface VendorVerification {
  verification: Verification;
  limits: LimitCheckResult;
  duplicate: boolean;
  /** Everything a vendor can check offline passed. */
  acceptable: boolean;
  /** Soft warnings (still acceptable) e.g. an unverified certificate limit. */
  warnings: string[];
}

export async function verifyForVendor(qr: SignedPaymentQR, ctx: { merchantId: string; ledger: Ledger; now?: Date }): Promise<VendorVerification> {
  const now = ctx.now ?? new Date();
  const platformKey = await getPlatformPublicKey();
  const verification = verifyPaymentQR(qr, { platformPublicKey: platformKey, now, expectedMerchantId: ctx.merchantId, maxOfflineAgeMs: appConfig.limits.maxOfflineAgeMs });
  // The vendor cannot know the payer's spend at other stalls; it enforces the per-payment cap
  // and the certificate's own limits. The server enforces the rolling daily cap on sync.
  const limits = evaluateOfflineLimits({ amount: qr.auth?.amount ?? 0, dailyOfflineTotal: 0, certLimits: qr.cert?.cert?.limits }, appConfig.limits);
  const duplicate = qr.auth?.nonce ? await ctx.ledger.hasNonce(qr.auth.nonce) : false;
  const warnings: string[] = [];
  if (qr.auth?.amount > 1500_00) warnings.push('ABOVE_REVIEW_THRESHOLD');
  return { verification, limits, duplicate, acceptable: verification.ok && limits.ok && !duplicate, warnings };
}

export interface AcceptPaymentInput {
  qr: SignedPaymentQR;
  merchant: Pick<Merchant, 'id' | 'name'>;
  ledger: Ledger;
  now?: Date;
}

export async function acceptOfflinePayment(input: AcceptPaymentInput): Promise<{ txn: LedgerTransaction; receipt: SignedReceipt; payload: string }> {
  const now = input.now ?? new Date();
  const device = await getDeviceIdentity();
  const check = await verifyForVendor(input.qr, { merchantId: input.merchant.id, ledger: input.ledger, now });
  if (!check.acceptable) {
    const reason = check.duplicate ? 'DUPLICATE_NONCE' : check.verification.failures[0]?.code ?? check.limits.failures[0] ?? 'REJECTED';
    throw new Error(reason);
  }
  const receipt = buildVendorReceipt({ qr: input.qr, merchantName: input.merchant.name, vendorSecretKey: device.secretKey, vendorPublicKey: device.publicKey, now });
  const { auth } = input.qr;
  const txn: LedgerTransaction = {
    id: auth.transaction_id,
    nonce: auth.nonce,
    direction: 'IN',
    amount: auth.amount,
    currency: 'INR',
    mode: 'OFFLINE',
    status: 'PENDING_SYNC',
    merchant_id: auth.merchant_id,
    merchant_name: input.merchant.name,
    payer_id: auth.payer_id,
    payer_name: input.qr.cert.cert.name,
    device_id: device.deviceId,
    created_at: auth.created_at,
    expires_at: auth.expires_at,
    accepted_at: now.toISOString(),
    synced_at: null,
    settled_at: null,
    memo: auth.memo ?? null,
    payload_json: encodeQr(input.qr),
    receipt_json: encodeQr(receipt),
    sync_attempts: 0,
    last_error: null,
    fraud_flags: check.warnings,
  };
  await input.ledger.insert(txn);
  await input.ledger.rememberNonce(auth.nonce);
  return { txn, receipt, payload: encodeQr(receipt) };
}

/** Vendor accepts an NGO credit: verified offline, redeemed on the server when online. */
export async function acceptNgoCredit(input: { credit: SignedNgoCredit; merchant: Pick<Merchant, 'id' | 'name'>; ledger: Ledger; online: boolean }) {
  const platformKey = await getPlatformPublicKey();
  const check = verifyNgoCredit(input.credit, platformKey);
  if (!check.ok) throw new Error(check.reason ?? 'INVALID_CREDIT');
  if (await input.ledger.hasNonce(input.credit.credit.nonce)) throw new Error('DUPLICATE_NONCE');
  const device = await getDeviceIdentity();
  let transactionId = randomUUID();
  let status: LedgerTransaction['status'] = 'PENDING_SYNC';
  if (input.online) {
    const r = await post<{ transaction_id: string }>('/api/ngos/credits/redeem', { credit: input.credit, device_id: device.deviceId });
    transactionId = r.transaction_id;
    status = 'SYNCED';
  }
  const now = new Date().toISOString();
  const txn: LedgerTransaction = {
    id: transactionId,
    nonce: input.credit.credit.nonce,
    direction: 'IN',
    amount: input.credit.credit.amount,
    currency: 'INR',
    mode: 'NGO_CREDIT',
    status,
    merchant_id: input.merchant.id,
    merchant_name: input.merchant.name,
    payer_id: null,
    payer_name: input.credit.credit.ngo_name,
    device_id: device.deviceId,
    created_at: now,
    expires_at: input.credit.credit.expires_at,
    accepted_at: now,
    synced_at: status === 'SYNCED' ? now : null,
    settled_at: null,
    memo: `${input.credit.credit.ngo_name}: ${input.credit.credit.purpose}`,
    payload_json: encodeQr(input.credit),
    receipt_json: null,
    sync_attempts: 0,
    last_error: null,
    fraud_flags: [],
  };
  await input.ledger.insert(txn);
  await input.ledger.rememberNonce(input.credit.credit.nonce);
  return txn;
}
