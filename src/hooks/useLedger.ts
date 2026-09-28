import { useCallback, useEffect, useRef, useState } from 'react';
import type { LedgerTransaction } from '../domain/types';
import type { Ledger, LedgerStats, ListOptions } from '../services/ledger';
import { useAuth } from '../providers/AuthProvider';

/**
 * Tiny change bus: any write to the ledger calls `bumpLedger()` and every hook below
 * re-reads. Cheaper and more predictable than wiring SQLite change notifications.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
export function bumpLedger() {
  for (const l of listeners) l();
}
function useLedgerVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const l = () => setV((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return v;
}

export function useLedger(): Ledger | null {
  return useAuth().ledger;
}

const EMPTY_STATS: LedgerStats = {
  todayCount: 0,
  todayAmount: 0,
  todayOfflineCount: 0,
  pendingCount: 0,
  pendingAmount: 0,
  syncedCount: 0,
  syncedAmount: 0,
  settledCount: 0,
  settledAmount: 0,
  failedCount: 0,
  totalCount: 0,
  totalAmount: 0,
};

export function useLedgerStats(direction: 'IN' | 'OUT'): { stats: LedgerStats; loading: boolean; refresh: () => void } {
  const ledger = useLedger();
  const version = useLedgerVersion();
  const [stats, setStats] = useState<LedgerStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!ledger) return;
    let alive = true;
    ledger.stats(direction).then((s) => {
      if (alive) {
        setStats(s);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [ledger, direction, version, tick]);
  return { stats, loading, refresh: useCallback(() => setTick((t) => t + 1), []) };
}

export function useLedgerList(opts: ListOptions): { rows: LedgerTransaction[]; loading: boolean; refresh: () => void } {
  const ledger = useLedger();
  const version = useLedgerVersion();
  const [rows, setRows] = useState<LedgerTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(opts);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    if (!ledger) return;
    let alive = true;
    ledger.list(optsRef.current).then((r) => {
      if (alive) {
        setRows(r);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [ledger, key, version, tick]);
  return { rows, loading, refresh: useCallback(() => setTick((t) => t + 1), []) };
}

export function useLedgerTransaction(id: string | undefined): { txn: LedgerTransaction | null; loading: boolean } {
  const ledger = useLedger();
  const version = useLedgerVersion();
  const [txn, setTxn] = useState<LedgerTransaction | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!ledger || !id) {
      setLoading(false);
      return;
    }
    let alive = true;
    ledger.get(id).then((t) => {
      if (alive) {
        setTxn(t);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [ledger, id, version]);
  return { txn, loading };
}

export function usePendingCount(): number {
  return useLedgerStats('IN').stats.pendingCount;
}
