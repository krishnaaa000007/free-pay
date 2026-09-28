import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { pingServer, setForcedOffline } from '../services/api';
import { toast } from '../services/notifications';
import { subscribe } from '../services/stageBridge';
import { prefGet, prefSet } from '../services/storage';

/**
 * Connectivity truth for the whole app.
 *  isConnected  - the OS says we have a link (Wi-Fi / cellular)
 *  isReachable  - the Free Pay API answered a health probe recently
 *  forceOffline - demo switch that makes the app behave as if the radio were dead
 *  isOnline     - what screens should use: connected && reachable && !forceOffline
 */
interface NetworkContextValue {
  isOnline: boolean;
  isConnected: boolean;
  isReachable: boolean;
  forceOffline: boolean;
  type: string;
  lastOnlineAt: string | null;
  setForceOffline: (v: boolean) => Promise<void>;
  recheck: () => Promise<boolean>;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setConnected] = useState(true);
  const [isReachable, setReachable] = useState(true);
  const [type, setType] = useState('unknown');
  const [forceOffline, setForce] = useState(false);
  const [lastOnlineAt, setLastOnlineAt] = useState<string | null>(null);
  const previousOnline = useRef<boolean | null>(null);

  useEffect(() => {
    prefGet('forceOffline').then((v) => {
      const on = v === 'true';
      setForce(on);
      setForcedOffline(on);
    });
  }, []);

  const recheck = useCallback(async () => {
    const ok = await pingServer();
    setReachable(ok);
    // Our own API answering is the strongest possible evidence of a usable link, so it
    // overrides the OS signal. On web that signal comes from a probe to a third-party URL,
    // which fails behind a venue firewall - or on a laptop with no internet running the
    // whole stack on localhost - even though Free Pay is perfectly reachable.
    if (ok) setConnected(true);
    return ok;
  }, []);

  useEffect(() => {
    const handle = (state: NetInfoState) => {
      if (state.isConnected) setConnected(true);
      setType(state.type);
      // Probe either way: `recheck` promotes us back to connected if the API answers, and
      // demotes reachability if it does not, so a wrong OS verdict cannot strand the app.
      void recheck();
    };
    const unsub = NetInfo.addEventListener(handle);
    NetInfo.fetch().then(handle);
    // Periodic reachability probe: cheap, and catches "connected but captive/dead" links.
    const timer = setInterval(() => void recheck(), 20_000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [recheck]);

  const isOnline = isConnected && isReachable && !forceOffline;

  useEffect(() => {
    if (previousOnline.current === null) {
      previousOnline.current = isOnline;
      if (isOnline) setLastOnlineAt(new Date().toISOString());
      return;
    }
    if (previousOnline.current !== isOnline) {
      previousOnline.current = isOnline;
      if (isOnline) {
        setLastOnlineAt(new Date().toISOString());
        toast.success('Back online', 'Syncing pending payments…', 'net');
      } else {
        toast.warning('You are offline', 'Payments still work and will sync later', 'net');
      }
    }
  }, [isOnline]);

  const setForceOffline = useCallback(async (v: boolean) => {
    setForce(v);
    setForcedOffline(v);
    await prefSet('forceOffline', String(v));
  }, []);

  // Demo stage: the presenter can cut the network for both phones at once.
  useEffect(() => subscribe('NETWORK', (m) => void setForceOffline(m.offline)), [setForceOffline]);

  const value = useMemo<NetworkContextValue>(
    () => ({ isOnline, isConnected, isReachable, forceOffline, type, lastOnlineAt, setForceOffline, recheck }),
    [isOnline, isConnected, isReachable, forceOffline, type, lastOnlineAt, setForceOffline, recheck],
  );
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used inside NetworkProvider');
  return ctx;
}
