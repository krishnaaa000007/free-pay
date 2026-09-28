import type { TxnStatus } from './types.js';

/**
 * Reconciliation: compare a vendor device's local ledger with what the server holds and
 * explain every difference. Pure function so it is easy to test and to run on either side.
 */
export interface LedgerEntry {
  transaction_id: string;
  nonce: string;
  amount: number;
  status: TxnStatus;
  created_at: string;
}

export type DiscrepancyKind =
  | 'MISSING_ON_SERVER' // device has it, server never received it -> resync
  | 'MISSING_ON_DEVICE' // server has it, device lost it -> restore
  | 'AMOUNT_MISMATCH' // tampering or corruption; hard alert
  | 'STATUS_BEHIND' // device status is older than server (e.g. server SETTLED)
  | 'STATUS_AHEAD' // device claims a status the server has not reached (suspicious)
  | 'NONCE_MISMATCH';

export interface Discrepancy {
  transaction_id: string;
  kind: DiscrepancyKind;
  device?: Partial<LedgerEntry>;
  server?: Partial<LedgerEntry>;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
}

export interface ReconciliationReport {
  matched: number;
  deviceTotal: number;
  serverTotal: number;
  deviceAmount: number;
  serverAmount: number;
  discrepancies: Discrepancy[];
  /** Transaction ids the device should (re)send. */
  resend: string[];
  /** Server-side status updates the device should apply. */
  apply: Array<{ transaction_id: string; status: TxnStatus }>;
  healthy: boolean;
}

const STATUS_RANK: Record<TxnStatus, number> = { PENDING_SYNC: 0, SYNCED: 1, SETTLED: 2, FAILED: 2 };

export function reconcile(device: LedgerEntry[], server: LedgerEntry[]): ReconciliationReport {
  const serverById = new Map(server.map((s) => [s.transaction_id, s]));
  const deviceById = new Map(device.map((d) => [d.transaction_id, d]));
  const discrepancies: Discrepancy[] = [];
  const resend: string[] = [];
  const apply: ReconciliationReport['apply'] = [];
  let matched = 0;

  for (const d of device) {
    const s = serverById.get(d.transaction_id);
    if (!s) {
      discrepancies.push({ transaction_id: d.transaction_id, kind: 'MISSING_ON_SERVER', device: d, severity: d.status === 'PENDING_SYNC' ? 'INFO' : 'WARN' });
      resend.push(d.transaction_id);
      continue;
    }
    if (s.amount !== d.amount) {
      discrepancies.push({ transaction_id: d.transaction_id, kind: 'AMOUNT_MISMATCH', device: d, server: s, severity: 'CRITICAL' });
      continue;
    }
    if (s.nonce !== d.nonce) {
      discrepancies.push({ transaction_id: d.transaction_id, kind: 'NONCE_MISMATCH', device: d, server: s, severity: 'CRITICAL' });
      continue;
    }
    if (STATUS_RANK[s.status] > STATUS_RANK[d.status]) {
      discrepancies.push({ transaction_id: d.transaction_id, kind: 'STATUS_BEHIND', device: { status: d.status }, server: { status: s.status }, severity: 'INFO' });
      apply.push({ transaction_id: d.transaction_id, status: s.status });
    } else if (STATUS_RANK[s.status] < STATUS_RANK[d.status]) {
      discrepancies.push({ transaction_id: d.transaction_id, kind: 'STATUS_AHEAD', device: { status: d.status }, server: { status: s.status }, severity: 'WARN' });
      apply.push({ transaction_id: d.transaction_id, status: s.status });
    } else {
      matched++;
    }
  }

  for (const s of server) {
    if (!deviceById.has(s.transaction_id)) {
      discrepancies.push({ transaction_id: s.transaction_id, kind: 'MISSING_ON_DEVICE', server: s, severity: 'WARN' });
    }
  }

  const sum = (xs: LedgerEntry[]) => xs.reduce((a, x) => a + (x.status === 'FAILED' ? 0 : x.amount), 0);
  return {
    matched,
    deviceTotal: device.length,
    serverTotal: server.length,
    deviceAmount: sum(device),
    serverAmount: sum(server),
    discrepancies,
    resend,
    apply,
    healthy: !discrepancies.some((d) => d.severity === 'CRITICAL'),
  };
}
