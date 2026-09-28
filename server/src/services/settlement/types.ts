/**
 * Settlement provider abstraction. A real deployment plugs in a payout rail (bank
 * transfer / UPI payout / aggregator). The POC ships ONLY a sandbox that never moves money.
 */
export interface PayoutRequest {
  settlementId: string;
  merchantId: string;
  merchantName: string;
  /** Masked destination account, for display only. */
  destinationMasked: string | null;
  amount: number; // paise
  txnCount: number;
  currency: 'INR';
  idempotencyKey: string;
}

export interface PayoutResult {
  provider: string;
  providerRef: string;
  status: 'COMPLETED' | 'PROCESSING' | 'FAILED';
  processedAt: string;
  failureReason?: string;
  /** Explicit marker so nobody mistakes sandbox output for a real transfer. */
  sandbox: true;
}

export interface SettlementProvider {
  readonly name: string;
  initiatePayout(req: PayoutRequest): Promise<PayoutResult>;
}
