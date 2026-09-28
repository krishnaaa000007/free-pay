'use client';
import React from 'react';
import { AreaChart, SERIES } from '../charts/Charts';
import { Card, ErrorBanner, MetricCard, Pill, type Metric } from '../ui';
import { inr, num, relativeTime } from '@/lib/format';
import { useApi } from '@/lib/useApi';

export interface Overview {
  generated_at: string;
  metrics: Metric[];
  daily: Array<{ day: string; txns: number; gmv: number; offline: number; new_users: number; settled: number; review: number }>;
}

/** ~18 stat cards + a 7-day volume chart. Polls every 30 s so the room feels live. */
export function OverviewTab() {
  const { data, error, loading, refresh, updatedAt } = useApi<Overview>('/api/admin/overview', { pollMs: 30_000 });
  const labels = data?.daily.map((d) => new Date(d.day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })) ?? [];

  return (
    <>
      <ErrorBanner error={error} onRetry={refresh} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span className="live-dot" />
        <span className="muted" style={{ fontSize: 12 }}>
          Live · refreshed {updatedAt ? relativeTime(new Date(updatedAt).toISOString()) : '—'} · polling every 30 s
        </span>
      </div>
      <div className="grid grid-metrics" style={{ marginBottom: 16 }}>
        {loading && !data
          ? Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="metric">
                <div className="skeleton" style={{ width: '50%' }} />
                <div className="skeleton" style={{ width: '70%', height: 26, marginTop: 8 }} />
              </div>
            ))
          : data?.metrics.map((m) => <MetricCard key={m.key} m={m} />)}
      </div>
      <div className="grid grid-2">
        <Card title="Volume, last 7 days" hint="GMV per day (all modes)">
          {data ? <AreaChart labels={labels} series={[{ name: 'GMV', values: data.daily.map((d) => d.gmv / 100), color: SERIES[0] }]} format={(v) => inr(v * 100, { compact: true })} /> : null}
        </Card>
        <Card title="Payments per day" hint="Offline vs total">
          {data ? (
            <AreaChart
              labels={labels}
              series={[
                { name: 'All payments', values: data.daily.map((d) => d.txns), color: SERIES[1] },
                { name: 'Offline', values: data.daily.map((d) => d.offline), color: SERIES[0] },
              ]}
              format={(v) => num(v)}
            />
          ) : null}
        </Card>
      </div>
      {data ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <Pill tone="saffron">Offline-first</Pill>
          <Pill tone="info">Row-level security enforced</Pill>
          <Pill tone="success">Append-only ledger</Pill>
          <Pill tone="gold">Sandbox settlement</Pill>
        </div>
      ) : null}
    </>
  );
}
