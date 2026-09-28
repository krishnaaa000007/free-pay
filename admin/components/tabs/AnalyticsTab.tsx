'use client';
import React, { useState } from 'react';
import { AreaChart, DonutChart, HBarChart, ProgressRows, SERIES, StackedBarChart } from '../charts/Charts';
import { Card, ErrorBanner } from '../ui';
import { inr, num } from '@/lib/format';
import { useApi } from '@/lib/useApi';

interface Analytics {
  hourly: Array<{ hour: number; txns: number; gmv: number; offline: number; online: number }>;
  modes: Array<{ mode: string; txns: number; gmv: number }>;
  topVendors: Array<{ id: string; name: string; category: string; txns: number; gmv: number; offline_pct: number }>;
  statusByDay: Array<{ day: string; synced: number; settled: number; failed: number; review: number }>;
  settlementProgress: Array<{ id: string; name: string; settled: number; synced: number; processing: number }>;
  categories: Array<{ category: string; gmv: number; txns: number }>;
  fraudFlags: Array<{ flag: string; count: number }>;
  syncLatency: Array<{ bucket: string; count: number }>;
}
interface Trends {
  days: number;
  series: Array<{ day: string; txns: number; gmv: number; offline_share: number; active_pilgrims: number; active_vendors: number; sync_latency_min: number; new_users: number }>;
}

const MODE_LABEL: Record<string, string> = { OFFLINE: 'Offline', ONLINE: 'Online', NGO_CREDIT: 'NGO credit' };

/** Area, donut, horizontal bar, stacked bar, progress and sparkline forms — all custom SVG. */
export function AnalyticsTab() {
  const [days, setDays] = useState(14);
  const a = useApi<Analytics>('/api/admin/analytics', { pollMs: 60_000 });
  const t = useApi<Trends>(`/api/admin/analytics/trends?days=${days}`, { deps: [days] });
  const d = a.data;
  const trend = t.data?.series ?? [];
  const trendLabels = trend.map((s) => new Date(s.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));

  return (
    <>
      <ErrorBanner error={a.error ?? t.error} onRetry={() => { void a.refresh(); void t.refresh(); }} />

      <Card
        title={`Trends, last ${days} days`}
        hint="GMV and offline share of payments"
        right={
          <div className="tabs-inline">
            {[7, 14, 30].map((n) => (
              <button key={n} className={days === n ? 'active' : ''} onClick={() => setDays(n)}>
                {n}d
              </button>
            ))}
          </div>
        }
        style={{ marginBottom: 16 }}
      >
        <div className="grid grid-2">
          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              GMV per day
            </div>
            <AreaChart labels={trendLabels} series={[{ name: 'GMV', values: trend.map((s) => s.gmv / 100), color: SERIES[0] }]} format={(v) => inr(v * 100, { compact: true })} height={200} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              Offline share of payments (%)
            </div>
            <AreaChart labels={trendLabels} series={[{ name: 'Offline share', values: trend.map((s) => s.offline_share), color: SERIES[1] }]} format={(v) => `${Math.round(v)}%`} height={200} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              Active pilgrims and vendors per day
            </div>
            <AreaChart
              labels={trendLabels}
              series={[
                { name: 'Pilgrims', values: trend.map((s) => s.active_pilgrims), color: SERIES[1] },
                { name: 'Vendors', values: trend.map((s) => s.active_vendors), color: SERIES[3] },
              ]}
              format={(v) => num(v)}
              height={200}
              area={false}
            />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              Average offline sync latency (minutes)
            </div>
            <AreaChart labels={trendLabels} series={[{ name: 'Sync latency', values: trend.map((s) => s.sync_latency_min), color: SERIES[2] }]} format={(v) => `${Math.round(v)} m`} height={200} />
          </div>
        </div>
      </Card>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card title="Payments by hour of day" hint="Last 7 days · the twin snan/aarti peaks">
          {d ? (
            <StackedBarChart
              labels={d.hourly.map((h) => `${h.hour}`)}
              series={[
                { name: 'Offline', values: d.hourly.map((h) => h.offline), color: SERIES[0] },
                { name: 'Online + NGO', values: d.hourly.map((h) => h.online), color: SERIES[1] },
              ]}
              format={(v) => num(v)}
            />
          ) : null}
        </Card>
        <Card title="Payment mode mix" hint="By value">
          {d ? <DonutChart slices={d.modes.map((m, i) => ({ label: MODE_LABEL[m.mode] ?? m.mode, value: m.gmv, color: SERIES[i] }))} format={(v) => inr(v, { compact: true })} centerLabel="processed" /> : null}
        </Card>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card title="Top stalls by value" hint="Lifetime GMV, direct-labelled">
          {d ? <HBarChart items={d.topVendors.map((v) => ({ label: v.name, value: v.gmv, hint: `${v.txns} payments · ${v.offline_pct}% offline` }))} format={(v) => inr(v, { compact: true })} /> : null}
        </Card>
        <Card title="Ledger status per day" hint="Last 7 days">
          {d ? (
            <StackedBarChart
              labels={d.statusByDay.map((s) => s.day)}
              series={[
                { name: 'Settled', values: d.statusByDay.map((s) => s.settled), color: SERIES[2] },
                { name: 'Synced', values: d.statusByDay.map((s) => s.synced), color: SERIES[1] },
                { name: 'Failed', values: d.statusByDay.map((s) => s.failed), color: SERIES[4] },
              ]}
              format={(v) => num(v)}
            />
          ) : null}
        </Card>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card title="Settlement pipeline per stall" hint="Settled · processing · awaiting">
          {d ? (
            <ProgressRows
              rows={d.settlementProgress.map((p) => ({ label: p.name, values: [p.settled, p.processing, p.synced] }))}
              segments={[
                { name: 'Settled', color: SERIES[2] },
                { name: 'Processing', color: SERIES[1] },
                { name: 'Awaiting', color: 'var(--series-muted)' },
              ]}
              format={(v) => inr(v, { compact: true })}
            />
          ) : null}
        </Card>
        <Card title="Categories" hint="Share of value">
          {d ? <DonutChart slices={d.categories.map((c, i) => ({ label: c.category, value: c.gmv, color: SERIES[i % SERIES.length] }))} format={(v) => inr(v, { compact: true })} centerLabel="by category" size={180} /> : null}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Fraud engine flags" hint="Across ledger + rejected attempts">
          {d ? <HBarChart items={d.fraudFlags.map((f) => ({ label: f.flag.replace(/_/g, ' ').toLowerCase(), value: f.count }))} format={(v) => num(v)} color={SERIES[4]} labelWidth={200} /> : null}
        </Card>
        <Card title="Offline sync latency" hint="How long payments waited for a signal">
          {d ? <HBarChart items={d.syncLatency.map((s) => ({ label: s.bucket, value: s.count }))} format={(v) => num(v)} color={SERIES[2]} labelWidth={100} /> : null}
        </Card>
      </div>
    </>
  );
}
