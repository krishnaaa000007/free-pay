'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { Suspense, useEffect, useState } from 'react';
import { Shell, TABS, type TabKey } from '@/components/Shell';
import { AnalyticsTab } from '@/components/tabs/AnalyticsTab';
import { AuditTab, PendingSyncTab, SettlementsTab, TransactionsTab, UsersTab, VendorsTab } from '@/components/tabs/OpsTabs';
import { OverviewTab } from '@/components/tabs/OverviewTab';
import { CrowdTab, EmergenciesTab } from '@/components/tabs/SafetyTabs';
import { getToken, getUser, type AdminUser } from '@/lib/auth';
import { useApi } from '@/lib/useApi';

const TITLES: Record<TabKey, [string, string]> = {
  overview: ['Overview', 'Live health of payments, sync and safety across the mela'],
  analytics: ['Analytics', 'Volume, mix, settlement pipeline and fraud signals'],
  users: ['Users', 'Pilgrims and vendors registered on the platform'],
  vendors: ['Vendors', 'Stalls, verification, sync health and unsettled value'],
  transactions: ['Transactions', 'The append-only ledger with the fraud engine verdicts'],
  'pending-sync': ['Pending sync', 'Offline payments verified on device, not yet uploaded'],
  settlements: ['Settlements', 'Payout batches through the sandbox provider'],
  crowd: ['Crowd', 'Density across the grounds and demo surge controls'],
  emergencies: ['Emergencies', 'Live SOS with time-boxed location sharing, lost-person board'],
  audit: ['Audit', 'Every privileged action, append-only'],
};

function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [ready, setReady] = useState(false);
  const tab = ((params.get('tab') as TabKey) ?? 'overview') as TabKey;
  const setTab = (t: TabKey) => router.replace(t === 'overview' ? '/' : `/?tab=${t}`);
  const badges = useApi<{ metrics: Array<{ key: string; value: number }> }>(ready ? '/api/admin/overview' : null, { pollMs: 60_000 });

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setUser(getUser());
    setReady(true);
  }, [router]);

  if (!ready) return null;
  const metric = (k: string) => badges.data?.metrics.find((m) => m.key === k)?.value ?? 0;
  const [title, subtitle] = TITLES[tab] ?? TITLES.overview;

  return (
    <Shell
      tab={tab}
      onTab={setTab}
      user={user}
      title={title}
      subtitle={subtitle}
      badges={{ 'pending-sync': metric('pending_sync'), emergencies: metric('emergencies'), transactions: metric('pending_review') }}
      right={
        <>
          <a className="btn" href="/stage.html" target="_blank" rel="noreferrer" title="Two-phone demo stage">
            Demo stage ↗
          </a>
          <a className="btn" href="http://localhost:8081" target="_blank" rel="noreferrer" title="Expo dev server">
            Mobile app ↗
          </a>
        </>
      }
    >
      {tab === 'overview' && <OverviewTab />}
      {tab === 'analytics' && <AnalyticsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'vendors' && <VendorsTab />}
      {tab === 'transactions' && <TransactionsTab />}
      {tab === 'pending-sync' && <PendingSyncTab />}
      {tab === 'settlements' && <SettlementsTab />}
      {tab === 'crowd' && <CrowdTab />}
      {tab === 'emergencies' && <EmergenciesTab />}
      {tab === 'audit' && <AuditTab />}
      {!TABS.some((t) => t.key === tab) ? <OverviewTab /> : null}
    </Shell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
