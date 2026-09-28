import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AiAssistantSheet } from '@/components/AiAssistantSheet';
import { QrCard } from '@/components/QrCard';
import { TxnRow } from '@/components/TxnRow';
import { Avatar, Button, Card, EmptyState, Icon, IconButton, Pill, SectionHeader, Sparkline, StatTile, T } from '@/components/ui';
import { formatINR } from '@/domain/money';
import { relativeTime } from '@/domain/time';
import { useLedgerList, useLedgerStats } from '@/hooks/useLedger';
import { useSync } from '@/hooks/useSync';
import { useDemoBroadcast } from '@/hooks/useDemoBroadcast';
import { useAuth } from '@/providers/AuthProvider';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { get } from '@/services/api';
import { useQuery } from '@tanstack/react-query';
import { colors, layout, radii, shadows, spacing } from '@/theme';

/** Vendor dashboard: today's takings, sync health, stall QR and the latest payments. */
export default function VendorDashboard() {
  const { t } = useI18n();
  const router = useRouter();
  const { user, merchant } = useAuth();
  const { isOnline } = useNetwork();
  const { stats } = useLedgerStats('IN');
  const { rows: recent } = useLedgerList({ direction: 'IN', limit: 6 });
  const { syncNow, syncing, lastSyncAt } = useSync();
  const [aiOpen, setAiOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const stallQr = useQuery({
    queryKey: ['stall-qr', merchant?.id],
    queryFn: () => get<{ payload: string }>('/api/merchants/me/qr'),
    enabled: isOnline && !!merchant,
    staleTime: 10 * 60_000,
  });

  // Desktop demo: let the pilgrim's window pick this code up off the other screen.
  useDemoBroadcast('MERCHANT', qrOpen ? stallQr.data?.payload : null);

  const avgTicket = stats.todayCount ? Math.round(stats.todayAmount / stats.todayCount) : 0;
  const offlineShare = stats.todayCount ? Math.round((stats.todayOfflineCount / stats.todayCount) * 100) : 0;
  const hourly = useHourlySpark(recent.map((r) => r.created_at));

  return (
    <View style={{ flex: 1, backgroundColor: colors.parchment }}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <T variant="caption">{merchant?.code ?? t('dashboard')}</T>
            <T variant="display" numberOfLines={1}>
              {merchant?.name ?? user?.name}
            </T>
          </View>
          <Pill label={isOnline ? t('online') : t('offline')} tone={isOnline ? 'success' : 'warning'} dot />
          <IconButton icon="sparkles-outline" tone="saffron" onPress={() => setAiOpen(true)} label={t('assistant')} />
          <Pressable onPress={() => router.push('/(vendor)/more')}>
            <Avatar name={user?.name ?? '?'} seed={user?.avatar_seed ?? 0} size={42} />
          </Pressable>
        </View>

        <Card tone="saffron" padding={spacing.xl}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T variant="label" style={{ color: colors.onSaffron, opacity: 0.85 }}>
              {t('todaySales')}
            </T>
            <Sparkline data={hourly} width={90} height={26} color={colors.onSaffron} />
          </View>
          <T variant="hero" style={{ color: colors.onSaffron, marginTop: spacing.sm }}>
            {formatINR(stats.todayAmount, { showPaise: false })}
          </T>
          <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md }}>
            <Mini label={t('paymentsCount', { count: stats.todayCount })} />
            <Mini label={`${t('averageTicket')} ${formatINR(avgTicket, { showPaise: false })}`} />
            <Mini label={`${offlineShare}% ${t('offline').toLowerCase()}`} />
          </View>
        </Card>

        <View style={styles.tiles}>
          <StatTile label={t('pendingSync')} value={String(stats.pendingCount)} hint={formatINR(stats.pendingAmount, { showPaise: false })} tone={stats.pendingCount ? 'warning' : 'success'} icon="cloud-upload-outline" />
          <StatTile label={t('syncedCount')} value={String(stats.syncedCount)} hint={formatINR(stats.syncedAmount, { showPaise: false })} tone="info" icon="cloud-done-outline" />
          <StatTile label={t('settledCount')} value={String(stats.settledCount)} hint={formatINR(stats.settledAmount, { showPaise: false })} tone="success" icon="checkmark-circle-outline" />
        </View>

        <Card style={{ marginTop: spacing.lg }} padding={spacing.md}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={[styles.syncIcon, { backgroundColor: stats.pendingCount ? colors.warningSoft : colors.successSoft }]}>
              <Icon name={stats.pendingCount ? 'cloud-upload-outline' : 'cloud-done-outline'} size={22} color={stats.pendingCount ? colors.warning : colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong">{stats.pendingCount ? t('itemsPending', { count: stats.pendingCount }) : t('allSynced')}</T>
              <T variant="caption">
                {t('lastSync')}: {lastSyncAt ? relativeTime(lastSyncAt) : '—'}
              </T>
            </View>
            <Button title={syncing ? t('syncing') : t('syncNow')} size="sm" variant={stats.pendingCount ? 'primary' : 'secondary'} disabled={!isOnline} loading={syncing} onPress={() => void syncNow()} />
          </View>
        </Card>

        <View style={styles.actions}>
          <Action icon="scan-outline" label={t('acceptPayment')} tone={colors.saffron} onPress={() => router.push('/(vendor)/accept')} />
          <Action icon="qr-code-outline" label={t('showMyQr')} tone={colors.ink} onPress={() => setQrOpen((v) => !v)} />
          <Action icon="cash-outline" label={t('settlement')} tone={colors.success} onPress={() => router.push('/(vendor)/settlement')} />
          <Action icon="alert-circle-outline" label={t('sos')} tone={colors.danger} onPress={() => router.push('/emergency')} />
        </View>

        {qrOpen ? (
          <View style={{ marginTop: spacing.lg }}>
            {stallQr.data?.payload ? (
              <QrCard value={stallQr.data.payload} caption={t('stallQrHint')} badge={merchant?.name} />
            ) : (
              <Card tone="alt" elevated={false}>
                <T variant="caption">{isOnline ? t('loading') : t('errNetwork')}</T>
              </Card>
            )}
          </View>
        ) : null}

        <SectionHeader title={t('recentPayments')} action={t('viewAll')} onAction={() => router.push('/(vendor)/transactions')} style={{ marginTop: spacing.xxl }} />
        <Card padding={spacing.md}>
          {recent.length === 0 ? (
            <EmptyState icon="storefront-outline" title={t('acceptPayment')} body={t('vendorVerifyHint')} action={<Button title={t('acceptPayment')} size="sm" icon="scan-outline" onPress={() => router.push('/(vendor)/accept')} />} />
          ) : (
            recent.map((r, i) => <TxnRow key={r.id} txn={r} last={i === recent.length - 1} />)
          )}
        </Card>

        <Pressable onPress={() => router.push('/demo')} style={styles.demoLink}>
          <Icon name="play-circle-outline" size={18} color={colors.muted} />
          <T variant="caption">{t('demoMode')} · {t('demoModeDesc')}</T>
        </Pressable>
      </ScrollView>
      <AiAssistantSheet visible={aiOpen} onClose={() => setAiOpen(false)} screen="vendor-dashboard" />
    </View>
  );
}

function Mini({ label }: { label: string }) {
  return (
    <T variant="caption" style={{ color: colors.onSaffron, opacity: 0.9 }}>
      {label}
    </T>
  );
}

function Action({ icon, label, tone, onPress }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; tone: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { transform: [{ scale: 0.96 }] }]}>
      <View style={[styles.actionIcon, { backgroundColor: tone }]}>
        <Icon name={icon} size={24} color={colors.white} />
      </View>
      <T variant="caption" weight="600" style={{ color: colors.ink, textAlign: 'center' }} numberOfLines={2}>
        {label}
      </T>
    </Pressable>
  );
}

/** Tiny per-hour histogram of the last payments for the hero sparkline. */
function useHourlySpark(times: string[]): number[] {
  const buckets = new Array(8).fill(0);
  const now = Date.now();
  for (const t of times) {
    const h = Math.floor((now - Date.parse(t)) / 3_600_000);
    if (h >= 0 && h < 8) buckets[7 - h]++;
  }
  return buckets;
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: layout.screenPadding, paddingTop: 56, paddingBottom: layout.tabBarHeight + 48, maxWidth: layout.maxContentWidth, alignSelf: 'center', width: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  syncIcon: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xl },
  action: { alignItems: 'center', gap: spacing.sm, width: 76 },
  actionIcon: { width: 58, height: 58, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', ...shadows.card },
  demoLink: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: spacing.xl, paddingVertical: spacing.sm },
});
