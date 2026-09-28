import type { LedgerTransaction } from './types';

/** Summarise local ledger rows into the shape the server's reconcile endpoint expects. */
export function toReconcileEntries(rows: LedgerTransaction[]) {
  return rows
    .filter((r) => r.mode === 'OFFLINE')
    .map((r) => ({ transaction_id: r.id, nonce: r.nonce, amount: r.amount, status: r.status, created_at: r.created_at }));
}
