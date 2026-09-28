import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { TxnRow } from '@/components/TxnRow';
import { Button, Card, EmptyState, Icon, KV, Pill, Screen, SectionHeader, T } from '@/components/ui';
import { formatINR } from '@/domain/money';
import { formatDateTime, relativeTime } from '@/domain/time';
import { useLedger, useLedgerList, useLedgerStats } from '@/hooks/useLedger';
import { useSync } from '@/hooks/useSync';
import type { SyncLogEntry } from '@/services/ledger';
import { reconcileWithServer } from '@/services/sync';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { toast } from '@/services/notifications';
import { colors, layout, radii, spacing } from '@/theme';

/** Sync centre: queue, last results, history and a server reconciliation check. */
export default function VendorSync() {
  const { t } = useI18n();
  const { isOnline, type, forceOffline } = useNetwork();
  const ledger = useLedger();
  const { stats } = useLedgerStats('IN');
  const { rows: pending } = useLedgerList({ direction: 'IN', status: 'PENDING_SYNC', limit: 50 });
  const { syncNow, syncing, lastSummary, lastSyncAt } = useSync();
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [reconciling, setReconciling] = useState(false);
  const [report, setReport] = useState<Awaited<ReturnType<typeof reconcileWithServer>> | null>(null);

  useEffect(() => {
    if (!ledger) return;
    ledger.syncLogs(10).then(setLogs);
  }, [ledger, lastSummary, stats.pendingCount]);

  const reconcile = async () => {
    if (!ledger) return;
    setReconciling(true);
    try {
      const r = await reconcileWithServer(ledger);
      setReport(r);
      toast[r.healthy ? 'success' : 'warning'](t('reconcile'), `${r.matched} matched · ${r.discrepancies.length} differences`);
    } catch (err) {
      toast.error(t('reconcile'), (err as Error).message);
    } finally {
      setReconciling(false);
    }
  };

  return (
    <Screen title={t('syncTitle')} subtitle={t('syncSubtitle')} bottomInset={layout.tabBarHeight} refreshing={syncing} onRefresh={() => void syncNow()}>
      <Card tone={isOnline ? 'success' : 'warning'} elevated={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Icon name={isOnline ? 'wifi' : 'cloud-offline-outline'} size={26} color={isOnline ? colors.success : colors.warning} />
          <View style={{ flex: 1 }}>
            <T variant="bodyStrong">{isOnline ? t('networkOnline') : forceOffline ? t('networkForcedOffline') : t('networkOffline')}</T>
            <T variant="caption">
              {t('autoSyncOn')} · {type} · {t('lastSync')} {lastSyncAt ? relativeTime(lastSyncAt) : '—'}
            </T>
          </View>
        </View>
      </Card>

      <View style={styles.queueHead}>
        <View>
          <T variant="label">{t('syncQueue')}</T>
          <T variant="display">{stats.pendingCount}</T>
          <T variant="caption">{formatINR(stats.pendingAmount, { showPaise: false })}</T>
        </View>
        <Button title={syncing ? t('syncing') : t('syncNow')} icon="cloud-upload-outline" size="lg" disabled={!isOnline || stats.pendingCount === 0} loading={syncing} onPress={() => void syncNow()} />
      </View>

      {lastSummary && lastSummary.attempted > 0 ? (
        <Card padding={spacing.md} style={{ marginTop: spacing.md }}>
          <T variant="label" style={{ marginBottom: spacing.sm }}>
            {t('results')}
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Pill label={t('acceptedN', { n: lastSummary.accepted })} tone="success" />
            <Pill label={t('reviewN', { n: lastSummary.review })} tone="gold" />
            <Pill label={t('rejectedN', { n: lastSummary.rejected })} tone="danger" />
            <Pill label={t('duplicateN', { n: lastSummary.duplicates })} tone="neutral" />
          </View>
          {lastSummary.error ? (
            <T variant="caption" tone="danger" style={{ marginTop: spacing.sm }}>
              {t('lastError')}: {lastSummary.error}
            </T>
          ) : null}
        </Card>
      ) : null}

      <SectionHeader title={t('queued')} style={{ marginTop: spacing.xxl }} />
      <Card padding={spacing.md}>
        {pending.length === 0 ? (
          <EmptyState icon="cloud-done-outline" title={t('allSynced')} />
        ) : (
          pending.map((r, i) => (
            <View key={r.id}>
              <TxnRow txn={r} last={i === pending.length - 1} />
              {r.sync_attempts > 0 ? (
                <T variant="caption" tone="danger" style={{ marginTop: -spacing.sm, marginBottom: spacing.sm }}>
                  {r.sync_attempts} {t('attempts')} · {r.last_error}
                </T>
              ) : null}
            </View>
          ))
        )}
      </Card>

      <SectionHeader title={t('reconcile')} style={{ marginTop: spacing.xxl }} />
      <Card padding={spacing.md}>
        <T variant="caption">Compares every offline payment on this device with the server ledger and flags any difference.</T>
        <Button title={t('reconcile')} icon="git-compare-outline" variant="secondary" size="sm" style={{ marginTop: spacing.md }} disabled={!isOnline} loading={reconciling} onPress={() => void reconcile()} />
        {report ? (
          <View style={{ marginTop: spacing.md }}>
            <KV label="Matched" value={`${report.matched} / ${report.deviceTotal}`} />
            <KV label="Server rows" value={String(report.serverTotal)} />
            <KV label="Health" value={<Pill label={report.healthy ? 'Healthy' : 'Attention'} tone={report.healthy ? 'success' : 'danger'} />} last={report.discrepancies.length === 0} />
            {report.discrepancies.slice(0, 6).map((d, i) => (
              <KV key={d.transaction_id + d.kind} label={d.kind} value={d.transaction_id.slice(0, 8)} mono last={i === Math.min(6, report.discrepancies.length) - 1} />
            ))}
          </View>
        ) : null}
      </Card>

      <SectionHeader title={t('syncHistory')} style={{ marginTop: spacing.xxl }} />
      <Card padding={spacing.md}>
        {logs.length === 0 ? (
          <T variant="caption">—</T>
        ) : (
          logs.map((l, i) => (
            <View key={l.id} style={[styles.log, i < logs.length - 1 && styles.logDivider]}>
              <Icon name={l.error ? 'close-circle' : 'checkmark-circle'} size={18} color={l.error ? colors.danger : colors.success} />
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong">{l.error ? t('toastSyncFailed') : t('toastSynced', { n: l.accepted + l.review + l.duplicates })}</T>
                <T variant="caption">
                  {formatDateTime(l.at)} · {l.items} items · {l.rejected} rejected{l.error ? ` · ${l.error}` : ''}
                </T>
              </View>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  queueHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, backgroundColor: colors.card, borderRadius: radii.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.hairline },
  log: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm + 2 },
  logDivider: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
});
