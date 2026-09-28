'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

/**
 * Tiny data hook: fetch on mount, optional polling, manual refresh. Keeps the last good
 * data while refreshing so tables never flash empty.
 */
export function useApi<T>(path: string | null, opts: { pollMs?: number; deps?: unknown[] } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      if (!alive.current) return;
      setData(d);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (err) {
      if (!alive.current) return;
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    void load();
    const t = opts.pollMs ? setInterval(() => void load(), opts.pollMs) : null;
    return () => {
      alive.current = false;
      if (t) clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, opts.pollMs, ...(opts.deps ?? [])]);

  return { data, error, loading, updatedAt, refresh: load };
}
