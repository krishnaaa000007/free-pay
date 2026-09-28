import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { LanguagePicker } from '@/components/LanguagePicker';
import { QrCard } from '@/components/QrCard';
import { Avatar, Button, Card, KV, ListRow, Pill, Screen, SectionHeader, T } from '@/components/ui';
import { appConfig } from '@/domain/config';
import { useDemoBroadcast } from '@/hooks/useDemoBroadcast';
import { useAuth } from '@/providers/AuthProvider';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { get } from '@/services/api';
import { layout, spacing } from '@/theme';

/** Vendor "more": stall QR, settlement, safety tools, language, account. */
export default function VendorMore() {
  const { t } = useI18n();
  const router = useRouter();
  const { user, merchant, logout, updateProfile } = useAuth();
  const { isOnline, forceOffline } = useNetwork();
  const [qrOpen, setQrOpen] = useState(false);
  const stallQr = useQuery({ queryKey: ['stall-qr', merchant?.id], queryFn: () => get<{ payload: string }>('/api/merchants/me/qr'), enabled: isOnline && !!merchant && qrOpen, staleTime: 10 * 60_000 });

  // Desktop demo: let the pilgrim's window pick this code up off the other screen.
  useDemoBroadcast('MERCHANT', qrOpen ? stallQr.data?.payload : null);

  const signOut = () =>
    Alert.alert(t('logout'), t('signOutConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('logout'), style: 'destructive', onPress: () => void logout().then(() => router.replace('/(auth)/login')) },
    ]);

  return (
    <Screen title={t('more')} bottomInset={layout.tabBarHeight}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar name={merchant?.name ?? user?.name ?? '?'} seed={user?.avatar_seed ?? 0} size={56} />
          <View style={{ flex: 1 }}>
            <T variant="title" numberOfLines={1}>
              {merchant?.name}
            </T>
            <T variant="caption">
              {user?.name} · +91 {user?.phone}
            </T>
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
              <Pill label={merchant?.code ?? ''} tone="neutral" size="sm" />
              <Pill label={merchant?.category ?? 'GENERAL'} tone="saffron" size="sm" />
              {merchant?.is_verified ? <Pill label={t('verified')} tone="success" size="sm" icon="checkmark-circle" /> : null}
            </View>
          </View>
        </View>
      </Card>

      <SectionHeader title={t('myQr')} style={{ marginTop: spacing.xxl }} />
      {qrOpen && stallQr.data?.payload ? (
        <QrCard value={stallQr.data.payload} caption={t('stallQrHint')} badge={merchant?.name} />
      ) : (
        <Button title={t('showMyQr')} icon="qr-code-outline" variant="secondary" fullWidth disabled={!isOnline} onPress={() => setQrOpen(true)} />
      )}

      <SectionHeader title={t('quickActions')} style={{ marginTop: spacing.xxl }} />
      <Card padding={spacing.md}>
        <ListRow icon="cash-outline" iconTone="success" title={t('settlementTitle')} subtitle={t('settleHint')} chevron onPress={() => router.push('/(vendor)/settlement')} />
        <ListRow icon="cloud-upload-outline" iconTone="info" title={t('syncTitle')} subtitle={t('syncSubtitle')} chevron onPress={() => router.push('/(vendor)/sync')} />
        <ListRow icon="people-outline" iconTone="saffron" title={t('crowdMap')} subtitle={t('crowdSubtitle')} chevron onPress={() => router.push('/crowd')} />
        <ListRow icon="alert-circle-outline" iconTone="danger" title={t('emergencyTitle')} subtitle={t('contacts')} chevron onPress={() => router.push('/emergency')} />
        <ListRow icon="search-outline" iconTone="neutral" title={t('lostPerson')} subtitle={t('lostSubtitle')} chevron onPress={() => router.push('/lost-person')} />
        <ListRow icon="play-circle-outline" iconTone="ink" title={t('demoMode')} subtitle={forceOffline ? t('networkForcedOffline') : t('demoModeDesc')} chevron onPress={() => router.push('/demo')} last />
      </Card>

      <SectionHeader title={t('languagePref')} style={{ marginTop: spacing.xxl }} />
      <LanguagePicker onChange={(lang) => isOnline && void updateProfile({ language: lang }).catch(() => undefined)} />

      <SectionHeader title={t('about')} style={{ marginTop: spacing.xxl }} />
      <Card padding={spacing.md} tone="alt" elevated={false}>
        <KV label={t('version')} value={appConfig.version} />
        <KV label="API" value={appConfig.apiUrl} mono />
        <KV label="Offline limits" value={`₹${appConfig.limits.maxOfflineTxnPaise / 100} / ₹${appConfig.limits.maxOfflineDailyPaise / 100} per day`} last />
      </Card>

      <Button title={t('logout')} variant="ghost" icon="log-out-outline" style={{ alignSelf: 'center', marginTop: spacing.xxl }} onPress={signOut} />
    </Screen>
  );
}
