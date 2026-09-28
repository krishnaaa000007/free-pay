import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { TxnRow } from '@/components/TxnRow';
import { Card, EmptyState, Pill, Screen, Segmented, StatTile, T } from '@/components/ui';
import { formatINR } from '@/domain/money';
import { dayLabel } from '@/domain/time';
import type { TxnStatus } from '@/domain/types';
import { useServerTransactions } from '@/hooks/useData';
import { useLedgerList, useLedgerStats } from '@/hooks/useLedger';
import { useSync } from '@/hooks/useSync';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { layout, spacing } from '@/theme';

type Filter = 'ALL' | TxnStatus;

/**
 * Vendor transactions. The local ledger is the source of truth on-device; when online we
 * also merge server rows (e.g. settlements that changed status while the phone was off).
 */
export default function VendorTransactions() {
  const { t } = useI18n();
  const { isOnline } = useNetwork();
  const [filter, setFilter] = useState<Filter>('ALL');
  const { rows, loading, refresh } = useLedgerList({ direction: 'IN', limit: 300, status: filter === 'ALL' ? undefined : filter });
  const { stats } = useLedgerStats('IN');
  const { syncNow, syncing } = useSync();
  const server = useServerTransactions({ limit: 100 }, isOnline);

  const merged = useMemo(() => {
    const localIds = new Set(rows.map((r) => r.id));
    const extra = (server.data?.transactions ?? [])
      .filter((s) => !localIds.has(s.id) && (filter === 'ALL' || s.status === filter))
      .map((s) => ({ ...s, kind: 'server' as const, direction: 'IN' as const }));
    return [...rows, ...extra].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [rows, server.data, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof merged>();
    for (const r of merged) {
      const k = dayLabel(r.created_at);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.entries()];
  }, [merged]);

  return (
    <Screen
      title={t('transactionsTitle')}
      subtitle={t('paymentsCount', { count: stats.totalCount })}
      bottomInset={layout.tabBarHeight}
      refreshing={syncing}
      onRefresh={() => {
        refresh();
        void server.refetch();
        void syncNow();
      }}
    >
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
        <StatTile label={t('total')} value={formatINR(stats.totalAmount, { showPaise: false })} hint={t('paymentsCount', { count: stats.totalCount })} tone="saffron" />
        <StatTile label={t('pendingSync')} value={String(stats.pendingCount)} hint={formatINR(stats.pendingAmount, { showPaise: false })} tone={stats.pendingCount ? 'warning' : 'success'} />
      </View>

      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'ALL', label: t('filterAll') },
          { value: 'PENDING_SYNC', label: t('statusPENDING_SYNC') },
          { value: 'SYNCED', label: t('statusSYNCED') },
          { value: 'SETTLED', label: t('statusSETTLED') },
        ]}
        style={{ marginBottom: spacing.md }}
      />
      {server.data && isOnline ? (
        <View style={{ marginBottom: spacing.md }}>
          <Pill label={`${server.data.transactions.length} on server`} tone="info" icon="cloud-outline" size="sm" />
        </View>
      ) : null}

      {!loading && merged.length === 0 ? (
        <EmptyState icon="receipt-outline" title={t('acceptPayment')} body={t('vendorVerifyHint')} />
      ) : (
        groups.map(([day, items]) => (
          <View key={day} style={{ marginBottom: spacing.lg }}>
            <T variant="label" style={{ marginBottom: spacing.sm }}>
              {day}
            </T>
            <Card padding={spacing.md}>
              {items.map((r, i) => (
                <TxnRow key={r.id} txn={r} showTime="clock" last={i === items.length - 1} />
              ))}
            </Card>
          </View>
        ))
      )}
    </Screen>
  );
}
