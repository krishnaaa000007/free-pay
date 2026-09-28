import { useCallback, useEffect, useRef, useState } from 'react';
import { appConfig } from '../domain/config';
import { useAuth } from '../providers/AuthProvider';
import { useNetwork } from '../providers/NetworkProvider';
import { isSyncInFlight, pushPendingTransactions, sendHeartbeat, syncPilgrim, type SyncSummary } from '../services/sync';
import { prefGet } from '../services/storage';
import { bumpLedger } from './useLedger';

/**
 * Sync controller. Vendors push their queue; pilgrims pull statuses. Exposes a manual
 * `syncNow` for the Sync screen and is driven automatically by AutoSyncManager.
 */
export function useSync() {
  const { ledger, user } = useAuth();
  const { isOnline, type } = useNetwork();
  const [syncing, setSyncing] = useState(false);
  const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    prefGet('lastSyncAt').then((v) => setLastSyncAt(v));
  }, [lastSummary]);

  const syncNow = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!ledger || !user || busy.current || isSyncInFlight()) return null;
      busy.current = true;
      setSyncing(true);
      try {
        if (user.role === 'VENDOR') {
          const summary = await pushPendingTransactions(ledger, { clientInfo: { appVersion: appConfig.version, network: type }, silent: opts.silent });
          if (!summary.error) {
            try {
              await sendHeartbeat(ledger, { appVersion: appConfig.version, network: type });
            } catch {
              /* heartbeat is best-effort */
            }
          }
          setLastSummary(summary);
          bumpLedger();
          return summary;
        }
        const updated = await syncPilgrim(ledger);
        const summary: SyncSummary = { attempted: updated, accepted: updated, review: 0, rejected: 0, duplicates: 0, failed: 0, syncedAt: new Date().toISOString() };
        setLastSummary(summary);
        if (updated) bumpLedger();
        return summary;
      } finally {
        busy.current = false;
        setSyncing(false);
      }
    },
    [ledger, user, type],
  );

  return { syncNow, syncing, lastSummary, lastSyncAt, canSync: isOnline && !!ledger };
}
