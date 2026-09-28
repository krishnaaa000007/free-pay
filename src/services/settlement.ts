import { get, post } from './api';

/** Vendor settlement API wrappers. The server's provider is a sandbox: no real money moves. */
export interface SettlementRow {
  id: string;
  merchant_id: string;
  amount: number;
  txn_count: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  provider: string;
  provider_ref: string | null;
  requested_at: string;
  processed_at: string | null;
  failure_reason: string | null;
}

export interface SettlementSummary {
  merchant: { id: string; name: string; code: string; settlement_account: string | null };
  available: { amount: number; count: number; oldest_at: string | null };
  processing: { amount: number; count: number };
  settled: { amount: number; count: number; last_at: string | null };
  today: { amount: number; count: number; offline_count: number };
  recent: SettlementRow[];
}

export const fetchSettlementSummary = () => get<SettlementSummary>('/api/settlement/summary');

export const requestSettlement = () =>
  post<{ settlement: SettlementRow; provider: { provider: string; providerRef: string; status: string; sandbox: true } }>('/api/settlement/request', {});

export const fetchSettlements = () => get<{ settlements: SettlementRow[] }>('/api/settlement');
