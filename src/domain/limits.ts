/**
 * Offline limit rules, evaluated on-device before a payment is authorised (pilgrim) and
 * before it is accepted (vendor). The server re-runs the same checks on sync.
 */
export interface LimitConfig {
  maxOfflineTxnPaise: number;
  maxOfflineDailyPaise: number;
  maxOfflineAgeMs: number;
}

export interface LimitCheckInput {
  amount: number;
  /** Sum of the payer's offline spend in the rolling 24h window (paise). */
  dailyOfflineTotal: number;
  /** Optional per-credential limits carried by the wallet certificate. */
  certLimits?: { per_txn: number; daily: number };
}

export type LimitFailure =
  | 'NON_POSITIVE_AMOUNT'
  | 'EXCEEDS_SINGLE_TXN_LIMIT'
  | 'EXCEEDS_DAILY_LIMIT'
  | 'EXCEEDS_CERT_TXN_LIMIT'
  | 'EXCEEDS_CERT_DAILY_LIMIT';

export interface LimitCheckResult {
  ok: boolean;
  failures: LimitFailure[];
  /** Remaining offline allowance for today after this payment (paise, >= 0). */
  remainingToday: number;
  effectivePerTxnLimit: number;
  effectiveDailyLimit: number;
}

export function evaluateOfflineLimits(input: LimitCheckInput, cfg: LimitConfig): LimitCheckResult {
  const failures: LimitFailure[] = [];
  const perTxn = Math.min(cfg.maxOfflineTxnPaise, input.certLimits?.per_txn ?? Infinity);
  const daily = Math.min(cfg.maxOfflineDailyPaise, input.certLimits?.daily ?? Infinity);

  if (!Number.isInteger(input.amount) || input.amount <= 0) failures.push('NON_POSITIVE_AMOUNT');
  if (input.amount > cfg.maxOfflineTxnPaise) failures.push('EXCEEDS_SINGLE_TXN_LIMIT');
  else if (input.amount > perTxn) failures.push('EXCEEDS_CERT_TXN_LIMIT');
  if (input.dailyOfflineTotal + input.amount > cfg.maxOfflineDailyPaise) failures.push('EXCEEDS_DAILY_LIMIT');
  else if (input.dailyOfflineTotal + input.amount > daily) failures.push('EXCEEDS_CERT_DAILY_LIMIT');

  return {
    ok: failures.length === 0,
    failures,
    remainingToday: Math.max(0, daily - input.dailyOfflineTotal - (failures.length ? 0 : input.amount)),
    effectivePerTxnLimit: perTxn,
    effectiveDailyLimit: daily,
  };
}

/** Rolling 24h window start. */
export function rollingDayStart(now: Date): Date {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

/**
 * The expiry to stamp on a new offline authorisation: the shorter of the configured max
 * offline age and the wallet certificate's own expiry.
 */
export function authorizationExpiry(now: Date, certExpiresAt: string, cfg: LimitConfig): Date {
  const byAge = now.getTime() + cfg.maxOfflineAgeMs;
  const byCert = Date.parse(certExpiresAt);
  return new Date(Math.min(byAge, Number.isNaN(byCert) ? byAge : byCert));
}

export function credentialHealth(certExpiresAt: string, now = new Date()): { state: 'FRESH' | 'EXPIRING' | 'EXPIRED'; daysLeft: number; hoursLeft: number } {
  const ms = Date.parse(certExpiresAt) - now.getTime();
  const daysLeft = Math.max(0, Math.floor(ms / 86_400_000));
  const hoursLeft = Math.max(0, Math.floor(ms / 3_600_000));
  if (ms <= 0) return { state: 'EXPIRED', daysLeft: 0, hoursLeft: 0 };
  if (ms < 2 * 86_400_000) return { state: 'EXPIRING', daysLeft, hoursLeft };
  return { state: 'FRESH', daysLeft, hoursLeft };
}
