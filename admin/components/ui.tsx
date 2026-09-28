'use client';
import React from 'react';
import { Sparkline } from './charts/Charts';
import { formatMetric } from '@/lib/format';

/* ------------------------------------------------------------------ */
/* Pill                                                                  */
/* ------------------------------------------------------------------ */
export type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'saffron' | 'gold';
export function Pill({ tone = 'neutral', children, dot }: { tone?: PillTone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={`pill ${tone === 'neutral' ? '' : tone}`}>
      {dot ? <i className="dot" /> : null}
      {children}
    </span>
  );
}

const statusTone: Record<string, PillTone> = {
  PENDING_SYNC: 'warning',
  SYNCED: 'info',
  SETTLED: 'success',
  FAILED: 'danger',
  PENDING: 'warning',
  PROCESSING: 'info',
  COMPLETED: 'success',
  ACTIVE: 'danger',
  ACKNOWLEDGED: 'warning',
  RESOLVED: 'success',
  EXPIRED: 'neutral',
  OPEN: 'danger',
  FOUND: 'success',
  CLOSED: 'neutral',
  ACCEPT: 'success',
  REVIEW: 'gold',
  REJECT: 'danger',
  OFFLINE: 'saffron',
  ONLINE: 'info',
  NGO_CREDIT: 'gold',
  LOW: 'success',
  MODERATE: 'gold',
  HIGH: 'warning',
  CRITICAL: 'danger',
};
export function StatusPill({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="muted">—</span>;
  const label = value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return <Pill tone={statusTone[value] ?? 'neutral'}>{label}</Pill>;
}

/* ------------------------------------------------------------------ */
/* Metric card                                                           */
/* ------------------------------------------------------------------ */
export interface Metric {
  key: string;
  label: string;
  value: number;
  format: 'inr' | 'int' | 'pct' | 'min';
  hint?: string;
  spark?: number[];
  tone?: 'neutral' | 'good' | 'warn' | 'danger';
}
const accent: Record<NonNullable<Metric['tone']>, string> = { neutral: 'var(--saffron)', good: 'var(--success)', warn: 'var(--warning)', danger: 'var(--danger)' };

export function MetricCard({ m }: { m: Metric }) {
  const tone = m.tone ?? 'neutral';
  return (
    <div className="metric" style={{ ['--accent' as string]: accent[tone] }}>
      <span className="label">{m.label}</span>
      <span className="value">{formatMetric(m.value, m.format)}</span>
      <div className="foot">
        <span className="hint">{m.hint ?? ''}</span>
        {m.spark && m.spark.some((v) => v > 0) ? <Sparkline data={m.spark} color={accent[tone]} /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card + table                                                          */
/* ------------------------------------------------------------------ */
export function Card({ title, hint, right, children, style }: { title?: string; hint?: string; right?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section className="card" style={style}>
      {title ? (
        <div className="card-head">
          <div>
            <h3>{title}</h3>
            {hint ? <div className="hint">{hint}</div> : null}
          </div>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  num?: boolean;
  width?: number | string;
}

export function DataTable<T extends object>({ rows, columns, empty = 'Nothing here yet', loading, rowKey }: { rows: T[]; columns: Column<T>[]; empty?: string; loading?: boolean; rowKey?: (row: T, i: number) => string }) {
  if (loading && rows.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ width: `${90 - i * 10}%` }} />
        ))}
      </div>
    );
  }
  if (rows.length === 0) return <div className="empty">{empty}</div>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? 'num' : undefined} style={{ width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : String((r as { id?: string | number }).id ?? i)}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : undefined}>
                  {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="card" style={{ background: 'var(--danger-soft)', borderColor: 'transparent', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <span style={{ flex: 1, color: 'var(--danger)', fontWeight: 600 }}>{error}</span>
      {onRetry ? (
        <button className="btn sm" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
