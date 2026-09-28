'use client';
import React, { useState } from 'react';
import { Card, DataTable, ErrorBanner, Pill, StatusPill, type Column } from '../ui';
import { api } from '@/lib/api';
import { dateTime, inr, num, relativeTime, shortId } from '@/lib/format';
import { useApi } from '@/lib/useApi';

/* ------------------------------------------------------------------ */
/* Users                                                                 */
/* ------------------------------------------------------------------ */
interface UserRow {
  id: string;
  name: string;
  phone: string;
  role: string;
  language: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  devices: number;
  payments: number;
  spent: number;
}

export function UsersTab() {
  const [q, setQ] = useState('');
  const { data, error, loading, refresh } = useApi<{ users: UserRow[] }>(`/api/admin/users?q=${encodeURIComponent(q)}&limit=100`, { deps: [q] });
  const cols: Column<UserRow>[] = [
    { key: 'name', header: 'Name', render: (r) => <strong>{r.name}</strong> },
    { key: 'phone', header: 'Phone', render: (r) => <span className="mono">+91 {r.phone}</span> },
    { key: 'role', header: 'Role', render: (r) => <Pill tone={r.role === 'VENDOR' ? 'saffron' : 'info'}>{r.role.toLowerCase()}</Pill> },
    { key: 'language', header: 'Lang' },
    { key: 'devices', header: 'Devices', num: true },
    { key: 'payments', header: 'Payments', num: true, render: (r) => num(r.payments) },
    { key: 'spent', header: 'Spent', num: true, render: (r) => inr(r.spent) },
    { key: 'last_login_at', header: 'Last seen', render: (r) => relativeTime(r.last_login_at) },
    { key: 'created_at', header: 'Joined', render: (r) => dateTime(r.created_at) },
  ];
  return (
    <>
      <ErrorBanner error={error} onRetry={refresh} />
      <Card title="Users" hint={`${data?.users.length ?? 0} accounts`} right={<input className="input" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />}>
        <DataTable rows={data?.users ?? []} columns={cols} loading={loading} />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Vendors                                                               */
/* ------------------------------------------------------------------ */
interface VendorRow {
  id: string;
  code: string;
  name: string;
  category: string;
  is_verified: boolean;
  settlement_account: string | null;
  owner_name: string;
  owner_phone: string;
  zone_name: string | null;
  txns: number;
  gmv: number;
  unsettled: number;
  txns_24h: number;
  pending_count: number | null;
  pending_amount: number | null;
  last_sync_at: string | null;
  network: string | null;
  battery_pct: number | null;
}

export function VendorsTab() {
  const { data, error, loading, refresh } = useApi<{ vendors: VendorRow[] }>('/api/admin/vendors', { pollMs: 60_000 });
  const cols: Column<VendorRow>[] = [
    { key: 'name', header: 'Stall', render: (r) => (<div><strong>{r.name}</strong><div className="muted" style={{ fontSize: 12 }}>{r.code} · {r.category} · {r.zone_name ?? '—'}</div></div>) },
    { key: 'owner', header: 'Owner', render: (r) => (<div>{r.owner_name}<div className="mono muted">+91 {r.owner_phone}</div></div>) },
    { key: 'is_verified', header: 'Verified', render: (r) => (r.is_verified ? <Pill tone="success">verified</Pill> : <Pill tone="warning">pending</Pill>) },
    { key: 'txns', header: 'Payments', num: true, render: (r) => (<span>{num(r.txns)} <span className="muted">({r.txns_24h} today)</span></span>) },
    { key: 'gmv', header: 'GMV', num: true, render: (r) => inr(r.gmv) },
    { key: 'unsettled', header: 'Unsettled', num: true, render: (r) => inr(r.unsettled) },
    { key: 'pending', header: 'Awaiting sync', num: true, render: (r) => (r.pending_count ? <Pill tone="warning">{r.pending_count} · {inr(r.pending_amount ?? 0)}</Pill> : <span className="muted">0</span>) },
    { key: 'device', header: 'Device', render: (r) => (<span className="muted" style={{ fontSize: 12 }}>{r.network ?? '—'}{r.battery_pct !== null ? ` · ${r.battery_pct}%` : ''}<br />sync {relativeTime(r.last_sync_at)}</span>) },
    { key: 'settlement_account', header: 'Account', render: (r) => <span className="mono">{r.settlement_account ?? '—'}</span> },
  ];
  return (
    <>
      <ErrorBanner error={error} onRetry={refresh} />
      <Card title="Vendors" hint={`${data?.vendors.length ?? 0} stalls`}>
        <DataTable rows={data?.vendors ?? []} columns={cols} loading={loading} />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Transactions                                                          */
/* ------------------------------------------------------------------ */
interface TxnRow {
  id: string;
  amount: number;
  mode: string;
  status: string;
  created_at: string;
  synced_at: string | null;
  settled_at: string | null;
  fraud_decision: string | null;
  fraud_flags: string[];
  suspicious: boolean;
  memo: string | null;
  merchant_name: string;
  merchant_code: string;
  payer_name: string | null;
}

export function TransactionsTab() {
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState('');
  const [review, setReview] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const path = `/api/admin/transactions?limit=100${status ? `&status=${status}` : ''}${mode ? `&mode=${mode}` : ''}${review ? '&review=true' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const { data, error, loading, refresh } = useApi<{ transactions: TxnRow[] }>(path, { deps: [path], pollMs: 30_000 });

  const annotate = async (id: string, kind: 'FLAG' | 'UNFLAG' | 'REVIEW_APPROVED' | 'REVIEW_REJECTED') => {
    setBusy(id);
    try {
      await api(`/api/transactions/${id}/annotate`, { method: 'POST', body: { kind, note: `${kind} from ops console` } });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const cols: Column<TxnRow>[] = [
    { key: 'id', header: 'ID', render: (r) => <span className="mono">{shortId(r.id)}</span> },
    { key: 'created_at', header: 'When', render: (r) => (<span>{dateTime(r.created_at)}<div className="muted" style={{ fontSize: 11 }}>{relativeTime(r.created_at)}</div></span>) },
    { key: 'merchant_name', header: 'Stall', render: (r) => (<span>{r.merchant_name}<div className="muted" style={{ fontSize: 11 }}>{r.merchant_code}</div></span>) },
    { key: 'payer_name', header: 'Payer', render: (r) => r.payer_name ?? <span className="muted">NGO credit</span> },
    { key: 'amount', header: 'Amount', num: true, render: (r) => <strong>{inr(r.amount, { paise: true })}</strong> },
    { key: 'mode', header: 'Mode', render: (r) => <StatusPill value={r.mode} /> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill value={r.status} /> },
    { key: 'fraud', header: 'Fraud engine', render: (r) => (<div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}><StatusPill value={r.fraud_decision} />{r.suspicious ? <Pill tone="danger">suspicious</Pill> : null}{r.fraud_flags.map((f) => (<span key={f} className="mono muted">{f.toLowerCase()}</span>))}</div>) },
    { key: 'synced_at', header: 'Synced', render: (r) => relativeTime(r.synced_at) },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div style={{ display: 'flex', gap: 4 }}>
          {r.fraud_decision === 'REVIEW' && r.status === 'SYNCED' ? (
            <>
              <button className="btn sm" disabled={busy === r.id} onClick={() => void annotate(r.id, 'REVIEW_APPROVED')}>Approve</button>
              <button className="btn sm danger" disabled={busy === r.id} onClick={() => void annotate(r.id, 'REVIEW_REJECTED')}>Reject</button>
            </>
          ) : r.suspicious ? (
            <button className="btn sm" disabled={busy === r.id} onClick={() => void annotate(r.id, 'UNFLAG')}>Clear flag</button>
          ) : (
            <button className="btn sm ghost" disabled={busy === r.id} onClick={() => void annotate(r.id, 'FLAG')}>Flag</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <ErrorBanner error={error} onRetry={refresh} />
      <Card
        title="Transactions"
        hint="Append-only ledger: ops can annotate or flag, never edit amounts"
        right={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Search stall, payer or id" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="SYNCED">Synced</option>
              <option value="SETTLED">Settled</option>
              <option value="FAILED">Failed</option>
            </select>
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">All modes</option>
              <option value="OFFLINE">Offline</option>
              <option value="ONLINE">Online</option>
              <option value="NGO_CREDIT">NGO credit</option>
            </select>
            <button className={`btn ${review ? 'primary' : ''}`} onClick={() => setReview((v) => !v)}>
              Needs review
            </button>
          </div>
        }
      >
        <DataTable rows={data?.transactions ?? []} columns={cols} loading={loading} />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pending sync                                                          */
/* ------------------------------------------------------------------ */
interface PendingVendor {
  merchant_id: string;
  merchant_name: string;
  merchant_code: string;
  owner_name: string;
  zone_name: string | null;
  device_id: string | null;
  pending_count: number;
  pending_amount: number;
  last_sync_at: string | null;
  last_seen_at: string;
  seconds_since_seen: number;
  seconds_since_sync: number;
  app_version: string | null;
  battery_pct: number | null;
  network: string | null;
}
interface Batch {
  id: string;
  merchant_name: string;
  item_count: number;
  accepted: number;
  review: number;
  rejected: number;
  duplicates: number;
  received_at: string;
}
interface Rejected {
  id: number;
  transaction_id: string;
  merchant_name: string | null;
  payer_name: string | null;
  amount: number | null;
  reasons: string[];
  rejected_at: string;
}

export function PendingSyncTab() {
  const { data, error, loading, refresh } = useApi<{ vendors: PendingVendor[]; batches: Batch[]; rejected: Rejected[] }>('/api/admin/pending-sync', { pollMs: 15_000 });
  const stale = (s: number) => s > 3600;
  const totalPending = data?.vendors.reduce((a, v) => a + v.pending_count, 0) ?? 0;
  const totalAmount = data?.vendors.reduce((a, v) => a + v.pending_amount, 0) ?? 0;

  const cols: Column<PendingVendor>[] = [
    { key: 'merchant_name', header: 'Stall', render: (r) => (<div><strong>{r.merchant_name}</strong><div className="muted" style={{ fontSize: 12 }}>{r.merchant_code} · {r.zone_name ?? '—'} · {r.owner_name}</div></div>) },
    { key: 'pending_count', header: 'Awaiting', num: true, render: (r) => (r.pending_count ? <Pill tone={r.pending_count > 10 ? 'danger' : 'warning'}>{r.pending_count}</Pill> : <Pill tone="success">0</Pill>) },
    { key: 'pending_amount', header: 'Value', num: true, render: (r) => inr(r.pending_amount) },
    { key: 'network', header: 'Network', render: (r) => <StatusPill value={r.network === 'offline' ? 'OFFLINE' : r.network ? 'ONLINE' : undefined} /> },
    { key: 'battery_pct', header: 'Battery', num: true, render: (r) => (r.battery_pct === null ? '—' : <span style={{ color: r.battery_pct < 25 ? 'var(--danger)' : undefined }}>{r.battery_pct}%</span>) },
    { key: 'last_sync_at', header: 'Last sync', render: (r) => <span style={{ color: stale(r.seconds_since_sync) ? 'var(--danger)' : undefined }}>{relativeTime(r.last_sync_at)}</span> },
    { key: 'last_seen_at', header: 'Last seen', render: (r) => relativeTime(r.last_seen_at) },
    { key: 'device_id', header: 'Device', render: (r) => <span className="mono muted">{r.device_id ?? '—'} · v{r.app_version ?? '?'}</span> },
  ];

  return (
    <>
      <ErrorBanner error={error} onRetry={refresh} />
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="metric" style={{ ['--accent' as string]: 'var(--warning)' }}><span className="label">Payments awaiting sync</span><span className="value">{num(totalPending)}</span><span className="hint">across {data?.vendors.filter((v) => v.pending_count > 0).length ?? 0} stalls</span></div>
        <div className="metric" style={{ ['--accent' as string]: 'var(--saffron)' }}><span className="label">Value in flight</span><span className="value">{inr(totalAmount, { compact: true })}</span><span className="hint">verified offline, not yet on the ledger</span></div>
        <div className="metric" style={{ ['--accent' as string]: 'var(--danger)' }}><span className="label">Stale devices (&gt; 1 h)</span><span className="value">{data?.vendors.filter((v) => stale(v.seconds_since_sync) && v.pending_count > 0).length ?? 0}</span><span className="hint">send a runner with a hotspot</span></div>
      </div>
      <Card title="Vendor devices" hint="Heartbeats from the vendor app · polling every 15 s" style={{ marginBottom: 16 }}>
        <DataTable rows={data?.vendors ?? []} columns={cols} loading={loading} rowKey={(r) => r.merchant_id} />
      </Card>
      <div className="grid grid-2">
        <Card title="Recent sync batches">
          <DataTable
            rows={data?.batches ?? []}
            columns={[
              { key: 'received_at', header: 'Received', render: (r) => dateTime(r.received_at) },
              { key: 'merchant_name', header: 'Stall' },
              { key: 'item_count', header: 'Items', num: true },
              { key: 'accepted', header: 'OK', num: true, render: (r) => <span style={{ color: 'var(--success)' }}>{r.accepted}</span> },
              { key: 'review', header: 'Review', num: true, render: (r) => <span style={{ color: 'var(--warning)' }}>{r.review}</span> },
              { key: 'rejected', header: 'Rejected', num: true, render: (r) => <span style={{ color: 'var(--danger)' }}>{r.rejected}</span> },
              { key: 'duplicates', header: 'Dup', num: true },
            ]}
            loading={loading}
            empty="No batches yet"
          />
        </Card>
        <Card title="Rejected by the fraud engine" hint="Kept off-ledger for audit">
          <DataTable
            rows={data?.rejected ?? []}
            columns={[
              { key: 'rejected_at', header: 'When', render: (r) => relativeTime(r.rejected_at) },
              { key: 'merchant_name', header: 'Stall', render: (r) => r.merchant_name ?? '—' },
              { key: 'payer_name', header: 'Payer', render: (r) => r.payer_name ?? '—' },
              { key: 'amount', header: 'Amount', num: true, render: (r) => (r.amount ? inr(r.amount) : '—') },
              { key: 'reasons', header: 'Reasons', render: (r) => r.reasons.map((x) => <Pill key={x} tone="danger">{x.replace(/_/g, ' ').toLowerCase()}</Pill>) },
            ]}
            loading={loading}
            empty="Nothing rejected"
          />
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Settlements                                                           */
/* ------------------------------------------------------------------ */
interface SettlementRow {
  id: string;
  merchant_name: string;
  merchant_code: string;
  settlement_account: string | null;
  amount: number;
  txn_count: number;
  status: string;
  provider: string;
  provider_ref: string | null;
  requested_at: string;
  processed_at: string | null;
  failure_reason: string | null;
}

export function SettlementsTab() {
  const { data, error, loading, refresh } = useApi<{ settlements: SettlementRow[] }>('/api/admin/settlements', { pollMs: 30_000 });
  const rows = data?.settlements ?? [];
  const sum = (f: (r: SettlementRow) => boolean) => rows.filter(f).reduce((a, r) => a + r.amount, 0);
  return (
    <>
      <ErrorBanner error={error} onRetry={refresh} />
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="metric" style={{ ['--accent' as string]: 'var(--success)' }}><span className="label">Completed</span><span className="value">{inr(sum((r) => r.status === 'COMPLETED'), { compact: true })}</span><span className="hint">{rows.filter((r) => r.status === 'COMPLETED').length} payouts</span></div>
        <div className="metric" style={{ ['--accent' as string]: 'var(--info)' }}><span className="label">Processing / pending</span><span className="value">{inr(sum((r) => r.status === 'PROCESSING' || r.status === 'PENDING'), { compact: true })}</span><span className="hint">{rows.filter((r) => r.status !== 'COMPLETED' && r.status !== 'FAILED').length} open</span></div>
        <div className="metric" style={{ ['--accent' as string]: 'var(--gold)' }}><span className="label">Provider</span><span className="value" style={{ fontSize: 18 }}>MOCK_SANDBOX</span><span className="hint">no real money moves in this prototype</span></div>
      </div>
      <Card title="Settlement batches" hint="One batch = every synced payment of a stall at request time">
        <DataTable
          rows={rows}
          columns={[
            { key: 'requested_at', header: 'Requested', render: (r) => dateTime(r.requested_at) },
            { key: 'merchant_name', header: 'Stall', render: (r) => (<div><strong>{r.merchant_name}</strong><div className="muted" style={{ fontSize: 12 }}>{r.merchant_code} · {r.settlement_account ?? 'no account'}</div></div>) },
            { key: 'amount', header: 'Amount', num: true, render: (r) => <strong>{inr(r.amount)}</strong> },
            { key: 'txn_count', header: 'Payments', num: true },
            { key: 'status', header: 'Status', render: (r) => (<div><StatusPill value={r.status} />{r.failure_reason ? <div className="muted" style={{ fontSize: 11 }}>{r.failure_reason}</div> : null}</div>) },
            { key: 'provider_ref', header: 'Reference', render: (r) => <span className="mono">{r.provider_ref ?? '—'}</span> },
            { key: 'processed_at', header: 'Processed', render: (r) => relativeTime(r.processed_at) },
          ]}
          loading={loading}
        />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Audit                                                                 */
/* ------------------------------------------------------------------ */
interface AuditRow {
  id: number;
  actor_id: string | null;
  actor_role: string | null;
  actor_name: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export function AuditTab() {
  const [q, setQ] = useState('');
  const { data, error, loading, refresh } = useApi<{ audit: AuditRow[] }>(`/api/admin/audit?limit=150&q=${encodeURIComponent(q)}`, { deps: [q], pollMs: 30_000 });
  return (
    <>
      <ErrorBanner error={error} onRetry={refresh} />
      <Card title="Audit trail" hint="Append-only; every privileged action and every sync lands here" right={<input className="input" placeholder="Filter by action or entity" value={q} onChange={(e) => setQ(e.target.value)} />}>
        <DataTable
          rows={data?.audit ?? []}
          columns={[
            { key: 'created_at', header: 'When', render: (r) => (<span>{dateTime(r.created_at)}<div className="muted" style={{ fontSize: 11 }}>{relativeTime(r.created_at)}</div></span>) },
            { key: 'actor', header: 'Actor', render: (r) => (<span>{r.actor_name ?? <span className="mono">{shortId(r.actor_id)}</span>} <Pill tone={r.actor_role === 'ADMIN' ? 'danger' : r.actor_role === 'VENDOR' ? 'saffron' : 'info'}>{(r.actor_role ?? '?').toLowerCase()}</Pill></span>) },
            { key: 'action', header: 'Action', render: (r) => <strong className="mono">{r.action}</strong> },
            { key: 'entity', header: 'Entity', render: (r) => <span className="mono muted">{r.entity ?? '—'} {shortId(r.entity_id)}</span> },
            { key: 'meta', header: 'Details', render: (r) => <span className="mono muted">{r.meta ? JSON.stringify(r.meta).slice(0, 90) : ''}</span> },
          ]}
          loading={loading}
        />
      </Card>
    </>
  );
}
