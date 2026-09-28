import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, EmptyState, Icon, KV, Pill, Screen, SectionHeader, StatTile, T } from '@/components/ui';
import { formatINR } from '@/domain/money';
import { formatDateTime, relativeTime } from '@/domain/time';
import { useLedger } from '@/hooks/useLedger';
import { useSync } from '@/hooks/useSync';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { ApiError } from '@/services/api';
import { toast } from '@/services/notifications';
import { fetchSettlementSummary, requestSettlement, type SettlementRow } from '@/services/settlement';
import { colors, layout, radii, spacing } from '@/theme';

const statusTone: Record<SettlementRow['status'], 'warning' | 'info' | 'success' | 'danger'> = { PENDING: 'warning', PROCESSING: 'info', COMPLETED: 'success', FAILED: 'danger' };

/** Settlement: what is available, request a payout (sandbox), and the history. */
export default function VendorSettlement() {
  const { t } = useI18n();
  const { isOnline } = useNetwork();
  const qc = useQueryClient();
  const ledger = useLedger();
  const { syncNow } = useSync();

  const summary = useQuery({ queryKey: ['settlement-summary'], queryFn: fetchSettlementSummary, enabled: isOnline });
  const request = useMutation({
    mutationFn: requestSettlement,
    onSuccess: async (r) => {
      toast.success(t('settlementRequested'), `${formatINR(r.settlement.amount)} · ${r.settlement.status} · ${r.provider.providerRef}`);
      await qc.invalidateQueries({ queryKey: ['settlement-summary'] });
      // Pull the new SETTLED statuses into the local ledger.
      if (ledger) await syncNow({ silent: true });
    },
    onError: (err) => toast.error(t('settlementTitle'), err instanceof ApiError ? err.message : t('errGeneric')),
  });

  const s = summary.data;

  return (
    <Screen title={t('settlementTitle')} subtitle={s ? `${s.merchant.name} · ${s.merchant.settlement_account ?? '—'}` : undefined} back bottomInset={layout.tabBarHeight} refreshing={summary.isFetching} onRefresh={() => void summary.refetch()}>
      {!isOnline ? (
        <Card tone="warning" elevated={false}>
          <T variant="body">{t('networkOffline')} — {t('settleHint')}</T>
        </Card>
      ) : null}

      <Card tone="ink" padding={spacing.xl}>
        <T variant="label" style={{ color: colors.onDark, opacity: 0.75 }}>
          {t('availableToSettle')}
        </T>
        <T variant="hero" style={{ color: colors.saffron, marginTop: spacing.xs }}>
          {formatINR(s?.available.amount ?? 0, { showPaise: false })}
        </T>
        <T variant="caption" style={{ color: colors.onDark, opacity: 0.8 }}>
          {t('paymentsCount', { count: s?.available.count ?? 0 })}
          {s?.available.oldest_at ? ` · oldest ${relativeTime(s.available.oldest_at)}` : ''}
        </T>
        <Button
          title={t('requestSettlement')}
          icon="cash-outline"
          size="lg"
          fullWidth
          style={{ marginTop: spacing.xl }}
          disabled={!isOnline || !s || s.available.count === 0}
          loading={request.isPending}
          onPress={() => request.mutate()}
        />
        <View style={styles.sandbox}>
          <Icon name="flask-outline" size={14} color={colors.onDark} />
          <T variant="caption" style={{ color: colors.onDark, opacity: 0.8, flex: 1 }}>
            {t('sandboxNote')}
          </T>
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
        <StatTile label={t('processing')} value={formatINR(s?.processing.amount ?? 0, { showPaise: false })} hint={t('paymentsCount', { count: s?.processing.count ?? 0 })} tone="info" />
        <StatTile label={t('settledCount')} value={formatINR(s?.settled.amount ?? 0, { showPaise: false })} hint={s?.settled.last_at ? relativeTime(s.settled.last_at) : '—'} tone="success" />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <StatTile label={t('todaySales')} value={formatINR(s?.today.amount ?? 0, { showPaise: false })} hint={t('paymentsCount', { count: s?.today.count ?? 0 })} tone="saffron" />
        <StatTile label={t('offlineShare')} value={s?.today.count ? `${Math.round((s.today.offline_count / s.today.count) * 100)}%` : '—'} hint={`${s?.today.offline_count ?? 0} offline`} />
      </View>

      <SectionHeader title={t('recentSettlements')} style={{ marginTop: spacing.xxl }} />
      <Card padding={spacing.md}>
        {!s || s.recent.length === 0 ? (
          <EmptyState icon="cash-outline" title={t('nothingToSettle')} body={t('settleHint')} />
        ) : (
          s.recent.map((r, i) => (
            <View key={r.id} style={[styles.row, i < s.recent.length - 1 && styles.rowDivider]}>
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong">{formatINR(r.amount)}</T>
                <T variant="caption">
                  {formatDateTime(r.requested_at)} · {t('paymentsCount', { count: r.txn_count })}
                  {r.provider_ref ? ` · ${r.provider_ref}` : ''}
                </T>
                {r.failure_reason ? (
                  <T variant="caption" tone="danger">
                    {r.failure_reason}
                  </T>
                ) : null}
              </View>
              <Pill label={r.status === 'COMPLETED' ? t('completed') : r.status === 'PROCESSING' ? t('processing') : r.status} tone={statusTone[r.status]} />
            </View>
          ))
        )}
      </Card>

      {s ? (
        <Card padding={spacing.md} tone="alt" elevated={false} style={{ marginTop: spacing.lg }}>
          <KV label={t('merchant')} value={`${s.merchant.name} (${s.merchant.code})`} />
          <KV label="Account" value={s.merchant.settlement_account ?? '—'} mono />
          <KV label="Provider" value="MOCK_SANDBOX" mono last />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sandbox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, backgroundColor: 'rgba(255,255,255,0.08)', padding: spacing.sm, borderRadius: radii.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
});
