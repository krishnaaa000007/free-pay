'use client';
import React from 'react';
import { clearSession, type AdminUser } from '@/lib/auth';
import { API_URL } from '@/lib/api';

export type TabKey = 'overview' | 'analytics' | 'users' | 'vendors' | 'transactions' | 'pending-sync' | 'settlements' | 'crowd' | 'emergencies' | 'audit';

export const TABS: Array<{ key: TabKey; label: string; group: 'Insight' | 'Operations' | 'Safety'; icon: string }> = [
  { key: 'overview', label: 'Overview', group: 'Insight', icon: '◫' },
  { key: 'analytics', label: 'Analytics', group: 'Insight', icon: '◔' },
  { key: 'users', label: 'Users', group: 'Operations', icon: '◉' },
  { key: 'vendors', label: 'Vendors', group: 'Operations', icon: '▣' },
  { key: 'transactions', label: 'Transactions', group: 'Operations', icon: '≡' },
  { key: 'pending-sync', label: 'Pending sync', group: 'Operations', icon: '⟳' },
  { key: 'settlements', label: 'Settlements', group: 'Operations', icon: '₹' },
  { key: 'crowd', label: 'Crowd', group: 'Safety', icon: '◍' },
  { key: 'emergencies', label: 'Emergencies', group: 'Safety', icon: '⚠' },
  { key: 'audit', label: 'Audit', group: 'Safety', icon: '☰' },
];

export function Shell({ tab, onTab, badges, user, children, title, subtitle, right }: { tab: TabKey; onTab: (t: TabKey) => void; badges?: Partial<Record<TabKey, number>>; user: AdminUser | null; children: React.ReactNode; title: string; subtitle?: string; right?: React.ReactNode }) {
  const groups = ['Insight', 'Operations', 'Safety'] as const;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">F</div>
          <div>
            <div className="brand-name">Free Pay</div>
            <div className="brand-sub">Ops console</div>
          </div>
        </div>
        {groups.map((g) => (
          <React.Fragment key={g}>
            <div className="nav-group">{g}</div>
            {TABS.filter((t) => t.group === g).map((t) => (
              <button key={t.key} className={`nav-item ${tab === t.key ? 'active' : ''}`} onClick={() => onTab(t.key)}>
                <span style={{ width: 16, textAlign: 'center', opacity: 0.8 }}>{t.icon}</span>
                {t.label}
                {badges?.[t.key] ? <span className="badge">{badges[t.key]}</span> : null}
              </button>
            ))}
          </React.Fragment>
        ))}
        <div className="sidebar-foot">
          <div>
            <strong style={{ color: 'var(--parchment)' }}>{user?.name ?? 'Admin'}</strong>
            <div style={{ fontSize: 11 }}>{user?.email}</div>
          </div>
          <div className="mono" style={{ opacity: 0.6 }}>
            {API_URL.replace(/^https?:\/\//, '')}
          </div>
          <button
            className="btn sm"
            style={{ alignSelf: 'flex-start', background: 'transparent', color: 'var(--parchment)', borderColor: 'rgba(255,255,255,0.25)' }}
            onClick={() => {
              clearSession();
              window.location.href = '/login';
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div style={{ flex: 1 }}>
            <h1>{title}</h1>
            {subtitle ? <div className="sub">{subtitle}</div> : null}
          </div>
          {right}
        </div>
        {children}
      </main>
    </div>
  );
}
