import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { TxnRow } from '@/components/TxnRow';
import { Card, EmptyState, Screen, Segmented, StatTile, T } from '@/components/ui';
import { formatINR } from '@/domain/money';
import { dayLabel } from '@/domain/time';
import type { TxnStatus } from '@/domain/types';
import { useLedgerList, useLedgerStats } from '@/hooks/useLedger';
import { useSync } from '@/hooks/useSync';
import { useI18n } from '@/providers/I18nProvider';
import { layout, spacing } from '@/theme';

type Filter = 'ALL' | TxnStatus;

/** Pilgrim payment history, grouped by day, straight from the on-device ledger. */
export default function PilgrimHistory() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>('ALL');
  const { rows, loading, refresh } = useLedgerList({ direction: 'OUT', limit: 200, status: filter === 'ALL' ? undefined : filter });
  const { stats } = useLedgerStats('OUT');
  const { syncNow, syncing, canSync } = useSync();

  const groups = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = dayLabel(r.created_at);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <Screen
      title={t('history')}
      subtitle={t('paymentsCount', { count: stats.totalCount })}
      bottomInset={layout.tabBarHeight}
      refreshing={syncing}
      onRefresh={() => {
        refresh();
        if (canSync) void syncNow();
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
        style={{ marginBottom: spacing.lg }}
      />

      {!loading && rows.length === 0 ? (
        <EmptyState icon="wallet-outline" title={t('noPayments')} />
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
