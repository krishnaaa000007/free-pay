import type { LedgerTransaction, ServerTransaction, SignedPaymentQR, SignedReceipt, SyncResult } from '../domain/types';
import { toReconcileEntries } from '../domain/reconcile';
import { get, post } from './api';
import { getDeviceIdentity } from './crypto';
import type { Ledger } from './ledger';
import { toast } from './notifications';
import { prefSet } from './storage';

export { toReconcileEntries };

/**
 * Sync engine.
 *  - Vendors push PENDING_SYNC receipts in batches; each result updates the local row.
 *  - Both roles pull server-side status (SYNCED -> SETTLED) for their recent rows.
 * A single in-flight promise guards against overlapping runs from NetInfo + timers.
 */
export interface SyncSummary {
  attempted: number;
  accepted: number;
  review: number;
  rejected: number;
  duplicates: number;
  failed: number;
  syncedAt: string | null;
  error?: string;
}

const BATCH_SIZE = 50;
let inFlight: Promise<SyncSummary> | null = null;

export function isSyncInFlight() {
  return inFlight !== null;
}

export function pushPendingTransactions(ledger: Ledger, opts: { clientInfo?: { appVersion?: string; batteryPct?: number; network?: string }; silent?: boolean } = {}): Promise<SyncSummary> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const summary: SyncSummary = { attempted: 0, accepted: 0, review: 0, rejected: 0, duplicates: 0, failed: 0, syncedAt: null };
    try {
      const device = await getDeviceIdentity();
      const pending = await ledger.pending();
      summary.attempted = pending.length;
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE);
        const items = batch
          .filter((t) => t.payload_json && t.receipt_json)
          .map((t) => ({
            payload: JSON.parse(t.payload_json!) as SignedPaymentQR,
            receipt: JSON.parse(t.receipt_json!) as SignedReceipt,
            accepted_at: t.accepted_at ?? t.created_at,
            vendor_device_id: t.device_id,
          }));
        const remaining = pending.length - (i + batch.length);
        const remainingAmount = pending.slice(i + batch.length).reduce((a, t) => a + t.amount, 0);
        const r = await post<{ batch_id: string | null; synced_at: string; results: SyncResult[] }>('/api/transactions/sync', {
          device_id: device.deviceId,
          items,
          pending_after_sync: { count: remaining, amount: remainingAmount },
          client: { app_version: opts.clientInfo?.appVersion, battery_pct: opts.clientInfo?.batteryPct, network: opts.clientInfo?.network },
        });
        for (const res of r.results) {
          await ledger.applySyncResult(res.transaction_id, {
            status: res.status,
            synced_at: res.synced_at ?? r.synced_at,
            flags: res.flags,
            error: res.decision === 'REJECT' ? res.message ?? res.flags.join(', ') : null,
          });
          if (res.decision === 'ACCEPT') summary.accepted++;
          else if (res.decision === 'REVIEW') summary.review++;
          else if (res.decision === 'DUPLICATE') summary.duplicates++;
          else summary.rejected++;
        }
        summary.syncedAt = r.synced_at;
      }
      if (summary.attempted > 0) {
        await ledger.addSyncLog({ at: new Date().toISOString(), items: summary.attempted, accepted: summary.accepted, review: summary.review, rejected: summary.rejected, duplicates: summary.duplicates, error: null });
        await prefSet('lastSyncAt', summary.syncedAt ?? new Date().toISOString());
        if (!opts.silent) toast.sync(`${summary.accepted + summary.review + summary.duplicates} payments synced`, summary.rejected ? `${summary.rejected} rejected by fraud checks` : undefined);
      } else {
        await prefSet('lastSyncAt', new Date().toISOString());
      }
      return summary;
    } catch (err) {
      const message = (err as Error).message;
      summary.error = message;
      summary.failed = summary.attempted;
      if (summary.attempted > 0) {
        for (const t of await ledger.pending()) await ledger.recordAttempt(t.id, message);
        await ledger.addSyncLog({ at: new Date().toISOString(), items: summary.attempted, accepted: 0, review: 0, rejected: 0, duplicates: 0, error: message });
      }
      return summary;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Vendor heartbeat so the ops dashboard sees unsynced volume even before a sync happens. */
export async function sendHeartbeat(ledger: Ledger, clientInfo?: { appVersion?: string; batteryPct?: number; network?: string }) {
  const device = await getDeviceIdentity();
  const stats = await ledger.stats('IN');
  await post('/api/transactions/heartbeat', {
    device_id: device.deviceId,
    pending_count: stats.pendingCount,
    pending_amount: stats.pendingAmount,
    client: { app_version: clientInfo?.appVersion, battery_pct: clientInfo?.batteryPct, network: clientInfo?.network },
  });
}

/**
 * Pull server statuses for our local rows (both roles). The server only returns rows the
 * caller may see (RLS), so this is safe to call blindly.
 */
export async function pullStatuses(ledger: Ledger, direction: 'IN' | 'OUT'): Promise<number> {
  const local = await ledger.list({ direction, limit: 300 });
  if (local.length === 0) return 0;
  const since = local[local.length - 1].created_at;
  const r = await get<{ transactions: ServerTransaction[] }>('/api/transactions', { since, limit: 200 });
  const byId = new Map(r.transactions.map((t) => [t.id, t]));
  let updated = 0;
  for (const t of local) {
    const s = byId.get(t.id);
    if (!s) continue;
    if (s.status !== t.status || (s.settled_at && !t.settled_at)) {
      await ledger.updateStatus(t.id, s.status, { settled_at: s.settled_at, synced_at: s.synced_at });
      updated++;
    }
  }
  return updated;
}

/** Pilgrims have no upload queue; they only pull. Convenience wrapper. */
export async function syncPilgrim(ledger: Ledger): Promise<number> {
  return pullStatuses(ledger, 'OUT');
}

export async function reconcileWithServer(ledger: Ledger) {
  const rows = await ledger.list({ direction: 'IN', limit: 500 });
  return post<{
    matched: number;
    deviceTotal: number;
    serverTotal: number;
    discrepancies: Array<{ transaction_id: string; kind: string; severity: string }>;
    resend: string[];
    apply: Array<{ transaction_id: string; status: LedgerTransaction['status'] }>;
    healthy: boolean;
  }>('/api/transactions/reconcile', { entries: toReconcileEntries(rows) });
}
