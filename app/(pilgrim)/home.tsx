import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AiAssistantSheet } from '@/components/AiAssistantSheet';
import { CredentialCard } from '@/components/CredentialCard';
import { TxnRow } from '@/components/TxnRow';
import { Avatar, Card, EmptyState, Icon, IconButton, Pill, SectionHeader, T, type IconName } from '@/components/ui';
import { rollingDayStart } from '@/domain/limits';
import { formatINR } from '@/domain/money';
import { appConfig } from '@/domain/config';
import { useMerchants } from '@/hooks/useData';
import { useLedger, useLedgerList, useLedgerStats } from '@/hooks/useLedger';
import { useSync } from '@/hooks/useSync';
import { useAuth } from '@/providers/AuthProvider';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { colors, layout, radii, shadows, spacing } from '@/theme';

const categoryIcon: Record<string, IconName> = { FOOD: 'restaurant-outline', PUJA: 'flower-outline', CRAFT: 'color-palette-outline', TRANSPORT: 'boat-outline', GENERAL: 'storefront-outline' };

export default function PilgrimHome() {
  const { t } = useI18n();
  const { user, credential, refreshCredential } = useAuth();
  const { isOnline } = useNetwork();
  const router = useRouter();
  const ledger = useLedger();
  const { stats } = useLedgerStats('OUT');
  const { rows: recent } = useLedgerList({ direction: 'OUT', limit: 5 });
  const { merchants } = useMerchants();
  const { syncNow, syncing } = useSync();
  const [aiOpen, setAiOpen] = useState(false);
  const [refreshingCred, setRefreshingCred] = useState(false);
  const [rollingSpend, setRollingSpend] = useState(0);

  useEffect(() => {
    if (!ledger) return;
    ledger.offlineTotalSince('OUT', rollingDayStart(new Date()).toISOString()).then(setRollingSpend);
  }, [ledger, stats.totalCount]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('goodMorning') : hour < 17 ? t('goodAfternoon') : t('goodEvening');
  const dailyLimit = Math.min(appConfig.limits.maxOfflineDailyPaise, credential?.cert.limits.daily ?? Infinity);
  const remaining = Math.max(0, dailyLimit - rollingSpend);

  const actions: Array<{ icon: IconName; label: string; tone: string; onPress: () => void }> = [
    { icon: 'qr-code-outline', label: t('payNow'), tone: colors.saffron, onPress: () => router.push('/(pilgrim)/scan') },
    { icon: 'people-outline', label: t('crowdMap'), tone: colors.info, onPress: () => router.push('/crowd') },
    { icon: 'alert-circle-outline', label: t('sos'), tone: colors.danger, onPress: () => router.push('/emergency') },
    { icon: 'search-outline', label: t('lostPerson'), tone: colors.indigo, onPress: () => router.push('/lost-person') },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.parchment }}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <T variant="caption">{greeting}</T>
            <T variant="display" numberOfLines={1}>
              {user?.name.split(' ')[0] ?? t('namaste')}
            </T>
          </View>
          <Pill label={isOnline ? t('online') : t('offline')} tone={isOnline ? 'success' : 'warning'} dot />
          <IconButton icon="sparkles-outline" tone="saffron" onPress={() => setAiOpen(true)} label={t('assistant')} />
          <Pressable onPress={() => router.push('/(pilgrim)/profile')}>
            <Avatar name={user?.name ?? '?'} seed={user?.avatar_seed ?? 0} size={42} />
          </Pressable>
        </View>

        <CredentialCard
          credential={credential}
          remainingToday={remaining}
          online={isOnline}
          refreshing={refreshingCred}
          onRefresh={() => {
            setRefreshingCred(true);
            refreshCredential().finally(() => setRefreshingCred(false));
          }}
        />

        <View style={styles.actions}>
          {actions.map((a) => (
            <Pressable key={a.label} onPress={a.onPress} style={({ pressed }) => [styles.action, pressed && { transform: [{ scale: 0.96 }] }]}>
              <View style={[styles.actionIcon, { backgroundColor: a.tone }]}>
                <Icon name={a.icon} size={24} color={colors.white} />
              </View>
              <T variant="caption" weight="600" style={{ color: colors.ink }} numberOfLines={1}>
                {a.label}
              </T>
            </Pressable>
          ))}
        </View>

        <View style={styles.statsRow}>
          <Card style={{ flex: 1 }} padding={spacing.md}>
            <T variant="label">{t('spentToday')}</T>
            <T variant="title" style={{ marginTop: 4 }}>
              {formatINR(stats.todayAmount, { showPaise: false })}
            </T>
            <T variant="caption">{t('paymentsCount', { count: stats.todayCount })}</T>
          </Card>
          <Card style={{ flex: 1 }} padding={spacing.md} onPress={() => router.push('/(pilgrim)/history')}>
            <T variant="label">{t('pendingSync')}</T>
            <T variant="title" style={{ marginTop: 4, color: stats.pendingCount ? colors.warning : colors.success }}>
              {stats.pendingCount}
            </T>
            <T variant="caption" numberOfLines={1}>
              {stats.pendingCount ? t('willSyncWhenOnline') : t('allSynced')}
            </T>
          </Card>
        </View>

        <SectionHeader title={t('nearbyStalls')} action={t('viewAll')} onAction={() => router.push('/(pilgrim)/scan')} style={{ marginTop: spacing.xxl }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}>
          {merchants.slice(0, 8).map((m) => (
            <Pressable key={m.id} onPress={() => router.push({ pathname: '/pay', params: { merchant_id: m.id, merchant_name: m.name, category: m.category, verified: m.is_verified ? '1' : '0' } })} style={({ pressed }) => [styles.stall, shadows.card, pressed && { opacity: 0.85 }]}>
              <View style={styles.stallIcon}>
                <Icon name={categoryIcon[m.category] ?? 'storefront-outline'} size={20} color={colors.saffronDeep} />
              </View>
              <T variant="bodyStrong" numberOfLines={1} style={{ marginTop: spacing.sm }}>
                {m.name}
              </T>
              <T variant="caption" numberOfLines={1}>
                {m.zone_name ?? m.code}
              </T>
              {m.is_verified ? (
                <View style={{ position: 'absolute', top: 10, right: 10 }}>
                  <Icon name="checkmark-circle" size={16} color={colors.success} />
                </View>
              ) : null}
            </Pressable>
          ))}
          {merchants.length === 0 ? (
            <Card tone="alt" elevated={false} style={{ width: 240 }}>
              <T variant="caption">{isOnline ? t('loading') : t('errNetwork')}</T>
            </Card>
          ) : null}
        </ScrollView>

        <SectionHeader title={t('recentPayments')} action={t('viewAll')} onAction={() => router.push('/(pilgrim)/history')} style={{ marginTop: spacing.xxl }} />
        <Card padding={spacing.md}>
          {recent.length === 0 ? (
            <EmptyState icon="wallet-outline" title={t('noPayments')} />
          ) : (
            recent.map((r, i) => <TxnRow key={r.id} txn={r} last={i === recent.length - 1} />)
          )}
        </Card>

        <Pressable onPress={() => router.push('/demo')} style={styles.demoLink}>
          <Icon name="play-circle-outline" size={18} color={colors.muted} />
          <T variant="caption">{t('demoMode')} · {t('demoModeDesc')}</T>
        </Pressable>
        {isOnline ? (
          <Pressable onPress={() => void syncNow()} style={[styles.demoLink, { marginTop: 0 }]}>
            <Icon name={syncing ? 'sync-circle' : 'sync-outline'} size={18} color={colors.muted} />
            <T variant="caption">{syncing ? t('syncing') : t('syncNow')}</T>
          </Pressable>
        ) : null}
      </ScrollView>
      <AiAssistantSheet visible={aiOpen} onClose={() => setAiOpen(false)} screen="pilgrim-home" />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: layout.screenPadding, paddingTop: 56, paddingBottom: layout.tabBarHeight + 48, maxWidth: layout.maxContentWidth, alignSelf: 'center', width: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xl },
  action: { alignItems: 'center', gap: spacing.sm, width: 74 },
  actionIcon: { width: 58, height: 58, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', ...shadows.card },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  stall: { width: 150, backgroundColor: colors.card, borderRadius: radii.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.hairline },
  stallIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.saffronSoft, alignItems: 'center', justifyContent: 'center' },
  demoLink: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: spacing.xl, paddingVertical: spacing.sm },
});
