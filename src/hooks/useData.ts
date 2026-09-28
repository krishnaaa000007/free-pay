import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { appConfig } from '../domain/config';
import type { CrowdEdge, CrowdZone, EmergencyContact, Merchant, ServerTransaction } from '../domain/types';
import { useNetwork } from '../providers/NetworkProvider';
import { get } from '../services/api';
import { prefGet, prefSet } from '../services/storage';

/**
 * Server-backed data with an on-device cache so screens render something meaningful
 * offline: the merchant directory, crowd map and emergency contacts are all cached.
 */
function useCachedQuery<T>(key: string, cacheKey: 'merchantsDir' | 'crowd' | 'contacts', fetcher: () => Promise<T>, enabled = true) {
  const { isOnline } = useNetwork();
  const [cached, setCached] = useState<T | null>(null);
  useEffect(() => {
    prefGet<T>(cacheKey, true).then((v) => setCached(v));
  }, [cacheKey]);
  const q = useQuery({
    queryKey: [key],
    queryFn: async () => {
      const data = await fetcher();
      await prefSet(cacheKey, data);
      setCached(data);
      return data;
    },
    enabled: enabled && isOnline,
    staleTime: 60_000,
  });
  return { data: q.data ?? cached, loading: q.isLoading && !cached, error: q.error, refetch: q.refetch, fromCache: !q.data && !!cached };
}

export function useMerchants(q = '') {
  const r = useCachedQuery<{ merchants: Merchant[] }>('merchants', 'merchantsDir', () => get('/api/merchants', { q }));
  const filtered = (r.data?.merchants ?? []).filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()) || m.code.toLowerCase().includes(q.toLowerCase()));
  return { ...r, merchants: filtered };
}

export interface CrowdData {
  zones: CrowdZone[];
  edges: CrowdEdge[];
  summary: { total: number; critical: number; high: number; people_estimate: number; updated_at: string | null };
}

export function useCrowd() {
  const r = useCachedQuery<CrowdData>('crowd', 'crowd', () => get('/api/crowd/zones'));
  return { ...r, zones: r.data?.zones ?? [], edges: r.data?.edges ?? [], summary: r.data?.summary ?? null };
}

export function useEmergencyContacts(): { contacts: EmergencyContact[]; shareTtlMin: number } {
  const r = useCachedQuery<{ contacts: EmergencyContact[]; share_ttl_min: number }>('contacts', 'contacts', () => get('/api/emergency/contacts', undefined, { auth: false }));
  return { contacts: r.data?.contacts ?? appConfig.emergencyContacts, shareTtlMin: r.data?.share_ttl_min ?? 60 };
}

export function useServerTransactions(params: { status?: string; mode?: string; limit?: number } = {}, enabled = true) {
  const { isOnline } = useNetwork();
  return useQuery({
    queryKey: ['server-transactions', params],
    queryFn: () => get<{ transactions: ServerTransaction[] }>('/api/transactions', params),
    enabled: enabled && isOnline,
  });
}

export function useCountdown(untilIso: string | null | undefined, intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!untilIso) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [untilIso, intervalMs]);
  if (!untilIso) return { expired: false, label: '', totalSeconds: 0 };
  const ms = Date.parse(untilIso) - now;
  if (ms <= 0) return { expired: true, label: '00:00', totalSeconds: 0 };
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return { expired: false, label: `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, totalSeconds: total };
}
