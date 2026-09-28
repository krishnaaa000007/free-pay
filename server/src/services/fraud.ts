import type { FraudConfig } from '../config.js';
import type { VerificationFailure } from './credentials.js';
import type { FraudFlag, FraudSeverity, FraudVerdict, TxnMode } from './types.js';

/**
 * Fraud engine. Pure and deterministic: every stateful fact it needs (was this nonce
 * seen? how much has the payer spent today?) is looked up by the caller and passed in
 * via `FraudContext`, which keeps the rules trivially unit-testable.
 *
 * HARD flags reject the transaction. SOFT flags mark it suspicious but accept it.
 * REVIEW flags accept it but queue it for a human look.
 */
export interface FraudInput {
  transactionId: string;
  nonce: string;
  amount: number;
  createdAt: string;
  expiresAt: string;
  merchantId: string;
  payerId: string;
  deviceId: string;
  mode: TxnMode;
  /** Merchant owned by the vendor account that is submitting the transaction. */
  submittingMerchantId?: string;
}

export interface FraudContext {
  now: Date;
  nonceSeen: boolean;
  transactionIdSeen: boolean;
  merchantKnown: boolean;
  /** True when `deviceId` is a registered device of `payerId`. */
  payerDeviceRegistered: boolean;
  /** Sum (paise) of the payer's OFFLINE transactions in the rolling 24h before this one. */
  payerDailyOfflineTotal: number;
  /** Number of payer transactions inside the velocity window. */
  payerRecentTxnCount: number;
  /** Failures reported by the stateless credential verifier. */
  verificationFailures?: VerificationFailure[];
}

export const FRAUD_CODES = {
  NON_POSITIVE_AMOUNT: 'NON_POSITIVE_AMOUNT',
  DUPLICATE_NONCE: 'DUPLICATE_NONCE',
  REPLAYED_TRANSACTION_ID: 'REPLAYED_TRANSACTION_ID',
  EXPIRED_AUTHORIZATION: 'EXPIRED_AUTHORIZATION',
  STALE_OFFLINE_AUTHORIZATION: 'STALE_OFFLINE_AUTHORIZATION',
  TAMPERED_EXPIRY: 'TAMPERED_EXPIRY',
  FUTURE_DATED: 'FUTURE_DATED',
  EXCEEDS_SINGLE_TXN_LIMIT: 'EXCEEDS_SINGLE_TXN_LIMIT',
  EXCEEDS_DAILY_LIMIT: 'EXCEEDS_DAILY_LIMIT',
  MERCHANT_MISMATCH: 'MERCHANT_MISMATCH',
  UNKNOWN_MERCHANT: 'UNKNOWN_MERCHANT',
  DEVICE_MISMATCH: 'DEVICE_MISMATCH',
  ABOVE_REVIEW_THRESHOLD: 'ABOVE_REVIEW_THRESHOLD',
  HIGH_VELOCITY: 'HIGH_VELOCITY',
  VENDOR_DEVICE_UNREGISTERED: 'VENDOR_DEVICE_UNREGISTERED',
} as const;

const SOFT_CODES = new Set<string>([
  FRAUD_CODES.UNKNOWN_MERCHANT,
  FRAUD_CODES.DEVICE_MISMATCH,
  FRAUD_CODES.VENDOR_DEVICE_UNREGISTERED,
]);

function severityFor(code: string): FraudSeverity {
  if (SOFT_CODES.has(code)) return 'SOFT';
  if (code === FRAUD_CODES.ABOVE_REVIEW_THRESHOLD || code === FRAUD_CODES.HIGH_VELOCITY) return 'REVIEW';
  return 'HARD';
}

function flag(code: string, message: string): FraudFlag {
  return { code, severity: severityFor(code), message };
}

export function evaluateTransaction(input: FraudInput, ctx: FraudContext, cfg: FraudConfig): FraudVerdict {
  const flags: FraudFlag[] = [];
  const nowMs = ctx.now.getTime();

  // Signature / certificate failures from the stateless verifier come first.
  for (const f of ctx.verificationFailures ?? []) {
    if (!flags.some((x) => x.code === f.code)) flags.push(flag(f.code, f.message));
  }

  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    flags.push(flag(FRAUD_CODES.NON_POSITIVE_AMOUNT, 'Amount must be a positive integer number of paise'));
  }
  if (ctx.nonceSeen) {
    flags.push(flag(FRAUD_CODES.DUPLICATE_NONCE, 'Nonce has already been used'));
  }
  if (ctx.transactionIdSeen) {
    flags.push(flag(FRAUD_CODES.REPLAYED_TRANSACTION_ID, 'Transaction id has already been recorded'));
  }

  const created = Date.parse(input.createdAt);
  const expires = Date.parse(input.expiresAt);
  if (!Number.isNaN(expires) && expires <= nowMs && !has(flags, FRAUD_CODES.EXPIRED_AUTHORIZATION)) {
    flags.push(flag(FRAUD_CODES.EXPIRED_AUTHORIZATION, 'Authorisation expired before it was synced'));
  }
  if (!Number.isNaN(created)) {
    if (created > nowMs + 5 * 60_000 && !has(flags, FRAUD_CODES.FUTURE_DATED)) {
      flags.push(flag(FRAUD_CODES.FUTURE_DATED, 'Authorisation is dated in the future'));
    }
    if (input.mode === 'OFFLINE' && nowMs - created > cfg.maxOfflineAgeMs && !has(flags, FRAUD_CODES.STALE_OFFLINE_AUTHORIZATION)) {
      flags.push(
        flag(
          FRAUD_CODES.STALE_OFFLINE_AUTHORIZATION,
          `Offline authorisation is older than the ${Math.round(cfg.maxOfflineAgeMs / 86_400_000)} day maximum`,
        ),
      );
    }
    if (!Number.isNaN(expires) && expires - created > cfg.maxOfflineAgeMs + 60_000 && !has(flags, FRAUD_CODES.TAMPERED_EXPIRY)) {
      flags.push(flag(FRAUD_CODES.TAMPERED_EXPIRY, 'Validity window is longer than the platform allows'));
    }
  }

  if (input.mode === 'OFFLINE') {
    if (input.amount > cfg.maxSingleOfflinePaise) {
      flags.push(
        flag(
          FRAUD_CODES.EXCEEDS_SINGLE_TXN_LIMIT,
          `Offline amount exceeds the per-transaction limit of ${cfg.maxSingleOfflinePaise / 100} INR`,
        ),
      );
    }
    if (ctx.payerDailyOfflineTotal + input.amount > cfg.maxDailyOfflinePaise) {
      flags.push(
        flag(
          FRAUD_CODES.EXCEEDS_DAILY_LIMIT,
          `Offline spend would exceed the rolling daily limit of ${cfg.maxDailyOfflinePaise / 100} INR`,
        ),
      );
    }
  }

  if (input.submittingMerchantId && input.submittingMerchantId !== input.merchantId) {
    flags.push(flag(FRAUD_CODES.MERCHANT_MISMATCH, 'Authorisation was issued to a different merchant'));
  }
  if (!ctx.merchantKnown) {
    flags.push(flag(FRAUD_CODES.UNKNOWN_MERCHANT, 'Merchant is not registered on the platform'));
  }
  if (!ctx.payerDeviceRegistered && !has(flags, FRAUD_CODES.DEVICE_MISMATCH)) {
    flags.push(flag(FRAUD_CODES.DEVICE_MISMATCH, 'Signing device is not bound to the payer account'));
  }
  if (input.amount > cfg.reviewThresholdPaise) {
    flags.push(flag(FRAUD_CODES.ABOVE_REVIEW_THRESHOLD, `Amount above review threshold of ${cfg.reviewThresholdPaise / 100} INR`));
  }
  if (ctx.payerRecentTxnCount >= cfg.velocityMaxTxns) {
    flags.push(flag(FRAUD_CODES.HIGH_VELOCITY, 'Unusually many transactions from this payer in a short window'));
  }

  const hard = flags.some((f) => f.severity === 'HARD');
  const review = flags.some((f) => f.severity === 'REVIEW');
  const soft = flags.some((f) => f.severity === 'SOFT');

  return {
    decision: hard ? 'REJECT' : review || soft ? 'REVIEW' : 'ACCEPT',
    flags,
    suspicious: soft,
  };
}

function has(flags: FraudFlag[], code: string) {
  return flags.some((f) => f.code === code);
}

/** Start of the rolling 24h window that ends at `at`. */
export function rollingDayStart(at: Date): Date {
  return new Date(at.getTime() - 24 * 60 * 60 * 1000);
}
