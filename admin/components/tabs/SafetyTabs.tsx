'use client';
import React, { useEffect, useState } from 'react';
import { Sparkline } from '../charts/Charts';
import { Card, DataTable, ErrorBanner, Pill, StatusPill } from '../ui';
import { api } from '@/lib/api';
import { compactNum, dateTime, num, relativeTime } from '@/lib/format';
import { useApi } from '@/lib/useApi';

/* ------------------------------------------------------------------ */
/* Crowd                                                                 */
/* ------------------------------------------------------------------ */
interface Zone {
  id: string;
  code: string;
  name: string;
  kind: string;
  capacity: number;
  map_x: number;
  map_y: number;
  density: number;
  head_count: number;
  recorded_at: string | null;
  history: Array<{ t: string; d: number }> | null;
  stalls: number;
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
}
const DENSITY: Record<Zone['level'], string> = { LOW: 'var(--density-low)', MODERATE: 'var(--density-moderate)', HIGH: 'var(--density-high)', CRITICAL: 'var(--density-critical)' };
const GLYPH: Record<string, string> = { GHAT: '〰', ROAD: '⋯', MARKET: '⛩', CAMP: '⛺', GATE: '⛩', MEDICAL: '✚', TRANSIT: '⛟' };

export function CrowdTab() {
  const { data, error, loading, refresh } = useApi<{ zones: Zone[] }>('/api/admin/crowd', { pollMs: 20_000 });
  const [selected, setSelected] = useState<Zone | null>(null);
  const [sim, setSim] = useState<number>(0.95);
  const [busy, setBusy] = useState(false);
  const zones = data?.zones ?? [];
  const people = zones.reduce((a, z) => a + z.head_count, 0);

  const simulate = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api('/api/crowd/simulate', { method: 'POST', body: { zone_id: selected.id, density: sim } });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ErrorBanner error={error} onRetry={refresh} />
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="metric" style={{ ['--accent' as string]: 'var(--saffron)' }}><span className="label">People on the grounds</span><span className="value">{compactNum(people)}</span><span className="hint">estimated from {zones.length} zones</span></div>
        <div className="metric" style={{ ['--accent' as string]: 'var(--danger)' }}><span className="label">Critical zones</span><span className="value">{zones.filter((z) => z.level === 'CRITICAL').length}</span><span className="hint">{zones.filter((z) => z.level === 'HIGH').length} more crowded</span></div>
        <div className="metric" style={{ ['--accent' as string]: 'var(--info)' }}><span className="label">Last reading</span><span className="value" style={{ fontSize: 20 }}>{relativeTime(zones[0]?.recorded_at)}</span><span className="hint">polling every 20 s</span></div>
      </div>
      <div className="grid grid-2" style={{ gridTemplateColumns: '1.3fr 1fr', marginBottom: 16 }}>
        <Card title="Grounds view" hint="Click a zone · halo size = density">
          <svg viewBox="0 0 1000 900" style={{ width: '100%', height: 'auto', display: 'block', background: 'var(--surface-alt)', borderRadius: 14 }} role="img" aria-label="Crowd density map">
            <path d="M -20 700 C 150 640, 300 760, 500 720 C 700 680, 850 760, 1020 700 L 1020 920 L -20 920 Z" fill="#CFE0E8" opacity={0.9} />
            <text x={860} y={860} fontSize={26} fill="#6E8FA0" fontStyle="italic" fontFamily="serif">Ganga</text>
            {zones.map((z) => (
              <g key={z.id} onClick={() => setSelected(z)} style={{ cursor: 'pointer' }}>
                <circle cx={z.map_x} cy={z.map_y} r={70 + z.density * 90} fill={DENSITY[z.level]} opacity={0.18} />
                <circle cx={z.map_x} cy={z.map_y} r={34 + Math.min(z.density, 1.3) * 14} fill={DENSITY[z.level]} stroke={selected?.id === z.id ? 'var(--ink)' : 'var(--surface)'} strokeWidth={selected?.id === z.id ? 6 : 4} />
                <text x={z.map_x} y={z.map_y + 9} fontSize={24} textAnchor="middle" fill="#fff" fontWeight={700}>{GLYPH[z.kind] ?? '●'}</text>
                <text x={z.map_x} y={z.map_y + 78} fontSize={22} textAnchor="middle" fill="var(--ink)" fontFamily="var(--font-display)">{z.name}</text>
                <text x={z.map_x} y={z.map_y + 100} fontSize={18} textAnchor="middle" fill="var(--muted)">{Math.round(z.density * 100)}% · {compactNum(z.head_count)}</text>
              </g>
            ))}
          </svg>
          <div className="legend">
            {(['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] as const).map((k) => (
              <span key={k}><i style={{ background: DENSITY[k], borderRadius: 6 }} />{k.toLowerCase()}</span>
            ))}
          </div>
        </Card>
        <Card title={selected ? selected.name : 'Zone detail'} hint={selected ? `${selected.kind} · capacity ${num(selected.capacity)} · ${selected.stalls} stalls` : 'Select a zone on the map'}>
          {selected ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span className="hero" style={{ color: DENSITY[selected.level] }}>{Math.round(selected.density * 100)}%</span>
                <StatusPill value={selected.level} />
              </div>
              <div className="muted" style={{ marginTop: 4 }}>{num(selected.head_count)} people · updated {relativeTime(selected.recorded_at)}</div>
              <div style={{ marginTop: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>Last 24 h</div>
                <Sparkline data={(selected.history ?? []).map((h) => h.d)} width={320} height={60} color={DENSITY[selected.level]} />
              </div>
              <div style={{ marginTop: 16, borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Simulate a surge (demo control)</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="range" min={0} max={1.3} step={0.05} value={sim} onChange={(e) => setSim(Number(e.target.value))} style={{ flex: 1 }} />
                  <span className="tnum" style={{ width: 44 }}>{Math.round(sim * 100)}%</span>
                  <button className="btn primary sm" disabled={busy} onClick={() => void simulate()}>Push reading</button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty">Tap a zone to see its trend and push a simulated reading.</div>
          )}
        </Card>
      </div>
      <Card title="All zones">
        <DataTable
          rows={[...zones].sort((a, b) => b.density - a.density)}
          columns={[
            { key: 'name', header: 'Zone', render: (z) => (<span><strong>{z.name}</strong> <span className="muted">{z.code}</span></span>) },
            { key: 'kind', header: 'Kind' },
            { key: 'level', header: 'Level', render: (z) => <StatusPill value={z.level} /> },
            { key: 'density', header: 'Density', num: true, render: (z) => `${Math.round(z.density * 100)}%` },
            { key: 'head_count', header: 'People', num: true, render: (z) => num(z.head_count) },
            { key: 'capacity', header: 'Capacity', num: true, render: (z) => num(z.capacity) },
            { key: 'history', header: '24 h', render: (z) => <Sparkline data={(z.history ?? []).map((h) => h.d)} color={DENSITY[z.level]} /> },
            { key: 'stalls', header: 'Stalls', num: true },
          ]}
          loading={loading}
        />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Emergencies + lost persons                                            */
/* ------------------------------------------------------------------ */
interface Emergency {
  id: string;
  kind: string;
  note: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  created_at: string;
  expires_at: string;
  acknowledged_at: string | null;
  reporter_name: string | null;
  reporter_phone: string | null;
  zone_name: string | null;
  seconds_remaining: number;
}
interface Lost {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  description: string | null;
  last_seen_zone_name: string | null;
  last_seen_at: string;
  contact_phone: string;
  status: string;
  reporter_name: string | null;
}
interface Stats {
  active: number;
  resolved_24h: number;
  total: number;
  avg_ack_minutes: number | null;
}

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function EmergenciesTab() {
  const { data, error, loading, refresh, updatedAt } = useApi<{ live: Emergency[]; stats: Stats; lost: Lost[] }>('/api/admin/emergencies', { pollMs: 10_000 });
  const [busy, setBusy] = useState<string | null>(null);
  useTick(1000);
  const act = async (path: string) => {
    setBusy(path);
    try {
      await api(path, { method: 'POST', body: {} });
      await refresh();
    } finally {
      setBusy(null);
    }
  };
  const remaining = (e: Emergency) => {
    const secs = Math.max(0, e.seconds_remaining - Math.round(((Date.now() - (updatedAt ?? Date.now())) / 1000)));
    return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  };

  return (
    <>
      <ErrorBanner error={error} onRetry={refresh} />
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="metric" style={{ ['--accent' as string]: 'var(--danger)' }}><span className="label">Live SOS</span><span className="value">{data?.stats.active ?? 0}</span><span className="hint">location shared for 60 min, then hidden by RLS</span></div>
        <div className="metric" style={{ ['--accent' as string]: 'var(--success)' }}><span className="label">Resolved, 24 h</span><span className="value">{data?.stats.resolved_24h ?? 0}</span><span className="hint">{data?.stats.total ?? 0} lifetime</span></div>
        <div className="metric" style={{ ['--accent' as string]: 'var(--info)' }}><span className="label">Median time to acknowledge</span><span className="value">{data?.stats.avg_ack_minutes != null ? `${data.stats.avg_ack_minutes} min` : '—'}</span><span className="hint">control room response</span></div>
      </div>
      <Card title="Live emergencies" hint="Responder view · polling every 10 s" style={{ marginBottom: 16 }}>
        <DataTable
          rows={data?.live ?? []}
          columns={[
            { key: 'status', header: 'Status', render: (e) => <StatusPill value={e.status} /> },
            { key: 'kind', header: 'Kind', render: (e) => <Pill tone={e.kind === 'MEDICAL' ? 'danger' : e.kind === 'LOST_CHILD' ? 'gold' : 'warning'}>{e.kind.replace('_', ' ').toLowerCase()}</Pill> },
            { key: 'reporter_name', header: 'Reporter', render: (e) => (<span>{e.reporter_name ?? '—'}<div className="mono muted">{e.reporter_phone ? `+91 ${e.reporter_phone}` : ''}</div></span>) },
            { key: 'note', header: 'Note', render: (e) => e.note ?? <span className="muted">—</span> },
            { key: 'zone_name', header: 'Zone', render: (e) => e.zone_name ?? '—' },
            { key: 'lat', header: 'Location', render: (e) => (e.lat != null && e.lng != null ? <a className="mono" href={`https://maps.google.com/?q=${e.lat},${e.lng}`} target="_blank" rel="noreferrer" style={{ color: 'var(--info)' }}>{e.lat.toFixed(4)}, {e.lng.toFixed(4)}</a> : '—') },
            { key: 'created_at', header: 'Raised', render: (e) => relativeTime(e.created_at) },
            { key: 'seconds_remaining', header: 'Sharing ends', render: (e) => <span className="mono" style={{ color: e.seconds_remaining < 600 ? 'var(--danger)' : undefined }}>{remaining(e)}</span> },
            {
              key: 'actions',
              header: '',
              render: (e) => (
                <div style={{ display: 'flex', gap: 4 }}>
                  {e.status === 'ACTIVE' ? <button className="btn sm primary" disabled={!!busy} onClick={() => void act(`/api/emergency/${e.id}/acknowledge`)}>Acknowledge</button> : null}
                  <button className="btn sm" disabled={!!busy} onClick={() => void act(`/api/emergency/${e.id}/resolve`)}>Resolve</button>
                </div>
              ),
            },
          ]}
          loading={loading}
          empty="No live emergencies. 🙏"
        />
      </Card>
      <Card title="Lost-person reports">
        <DataTable
          rows={data?.lost ?? []}
          columns={[
            { key: 'status', header: 'Status', render: (l) => <StatusPill value={l.status} /> },
            { key: 'name', header: 'Person', render: (l) => (<span><strong>{l.name}</strong>{l.age ? `, ${l.age}` : ''}{l.gender ? ` · ${l.gender}` : ''}</span>) },
            { key: 'description', header: 'Description', render: (l) => l.description ?? '—' },
            { key: 'last_seen_zone_name', header: 'Last seen', render: (l) => (<span>{l.last_seen_zone_name ?? '—'}<div className="muted" style={{ fontSize: 11 }}>{dateTime(l.last_seen_at)}</div></span>) },
            { key: 'reporter_name', header: 'Reported by', render: (l) => (<span>{l.reporter_name ?? '—'}<div className="mono muted">+91 {l.contact_phone}</div></span>) },
            { key: 'actions', header: '', render: (l) => (l.status === 'OPEN' ? <button className="btn sm" disabled={!!busy} onClick={() => void act(`/api/emergency/lost-person/${l.id}/found`)}>Mark found</button> : null) },
          ]}
          loading={loading}
          empty="No reports"
        />
      </Card>
    </>
  );
}
