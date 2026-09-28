import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useLedgerStats } from '../hooks/useLedger';
import { useSync } from '../hooks/useSync';
import { useAuth } from '../providers/AuthProvider';
import { useNetwork } from '../providers/NetworkProvider';

/**
 * Headless component: pushes the vendor's queue (or pulls pilgrim statuses) the moment
 * connectivity returns, when the app comes to the foreground, and on a slow heartbeat
 * while online. Backs off after failures so a flaky link does not hammer the API.
 */
const HEARTBEAT_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export function AutoSyncManager() {
  const { isOnline } = useNetwork();
  const { status, user } = useAuth();
  const { syncNow } = useSync();
  const { stats } = useLedgerStats('IN');
  const wasOnline = useRef(isOnline);
  const backoff = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = async (reason: string) => {
    if (!isOnline || status !== 'signedIn') return;
    const summary = await syncNow({ silent: reason === 'heartbeat' });
    if (summary?.error) backoff.current = Math.min(MAX_BACKOFF_MS, backoff.current ? backoff.current * 2 : 15_000);
    else backoff.current = 0;
  };

  // Network came back.
  useEffect(() => {
    if (isOnline && !wasOnline.current) void run('reconnect');
    wasOnline.current = isOnline;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // Sign-in completed while online.
  useEffect(() => {
    if (status === 'signedIn' && isOnline) void run('signin');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run('foreground');
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, status]);

  // Heartbeat while there is something to push (vendors) or to refresh (pilgrims).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!isOnline || status !== 'signedIn') return;
    const wait = Math.max(HEARTBEAT_MS, backoff.current);
    const shouldRun = user?.role === 'VENDOR' ? true : stats.pendingCount >= 0;
    if (!shouldRun) return;
    timer.current = setTimeout(() => void run('heartbeat'), wait);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, status, stats.pendingCount, user?.role]);

  return null;
}
