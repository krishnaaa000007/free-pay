import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { LanguagePicker } from '@/components/LanguagePicker';
import { Avatar, Button, Card, Icon, Input, KV, ListRow, Pill, Screen, SectionHeader, T } from '@/components/ui';
import { keyFingerprint } from '@/domain/crypto';
import { credentialHealth } from '@/domain/limits';
import { formatDateTime } from '@/domain/time';
import { appConfig } from '@/domain/config';
import { useAuth } from '@/providers/AuthProvider';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { getDeviceIdentity } from '@/services/crypto';
import { colors, layout, spacing } from '@/theme';

/** Shared profile screen (pilgrim + vendor "more" reuse the same building blocks). */
export default function Profile() {
  const { t } = useI18n();
  const { user, merchant, credential, logout, updateProfile, refreshCredential } = useAuth();
  const { isOnline, forceOffline } = useNetwork();
  const router = useRouter();
  const [device, setDevice] = useState<{ deviceId: string; publicKey: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDeviceIdentity().then((d) => setDevice({ deviceId: d.deviceId, publicKey: d.publicKey }));
  }, []);

  const signOut = () => {
    Alert.alert(t('logout'), t('signOutConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('logout'),
        style: 'destructive',
        onPress: () => {
          void logout().then(() => router.replace('/(auth)/login'));
        },
      },
    ]);
  };

  const health = credential ? credentialHealth(credential.cert.expires_at) : null;

  return (
    <Screen title={t('profileTitle')} bottomInset={layout.tabBarHeight}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar name={user?.name ?? '?'} seed={user?.avatar_seed ?? 0} size={60} />
          <View style={{ flex: 1 }}>
            {editing ? (
              <Input value={name} onChangeText={setName} autoFocus />
            ) : (
              <T variant="title" numberOfLines={1}>
                {user?.name}
              </T>
            )}
            <T variant="caption">+91 {user?.phone}</T>
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
              <Pill label={user?.role === 'VENDOR' ? t('iAmVendor') : t('iAmPilgrim')} tone="saffron" size="sm" />
              {merchant ? <Pill label={merchant.code} tone="neutral" size="sm" /> : null}
            </View>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
          {editing ? (
            <>
              <Button
                title={t('save')}
                size="sm"
                loading={saving}
                disabled={!isOnline || name.trim().length < 2}
                onPress={() => {
                  setSaving(true);
                  updateProfile({ name: name.trim() })
                    .then(() => setEditing(false))
                    .finally(() => setSaving(false));
                }}
              />
              <Button title={t('cancel')} size="sm" variant="ghost" onPress={() => setEditing(false)} />
            </>
          ) : (
            <Button title={t('editName')} size="sm" variant="secondary" icon="create-outline" onPress={() => setEditing(true)} disabled={!isOnline} />
          )}
        </View>
      </Card>

      <SectionHeader title={t('languagePref')} style={{ marginTop: spacing.xxl }} />
      <LanguagePicker onChange={(lang) => isOnline && void updateProfile({ language: lang }).catch(() => undefined)} />

      <SectionHeader title={t('security')} style={{ marginTop: spacing.xxl }} />
      <Card padding={spacing.md}>
        <KV label={t('deviceKey')} value={device ? keyFingerprint(device.publicKey) : '…'} mono />
        <KV label="Device ID" value={device?.deviceId ?? '…'} mono />
        {user?.role === 'PILGRIM' ? (
          <>
            <KV
              label={t('credential')}
              value={
                credential ? (
                  <Pill label={health?.state === 'EXPIRED' ? t('statusFAILED') : t('offlineReady')} tone={health?.state === 'EXPIRED' ? 'danger' : health?.state === 'EXPIRING' ? 'warning' : 'success'} dot />
                ) : (
                  <Pill label={t('errNoCredential').split('.')[0]} tone="warning" />
                )
              }
            />
            <KV label={t('expiresAt')} value={credential ? formatDateTime(credential.cert.expires_at) : '—'} />
            <KV label="Platform key" value={keyFingerprint(appConfig.platformPublicKey || 'unset')} mono last />
          </>
        ) : (
          <KV label={t('storedLocally')} value={<Icon name="shield-checkmark" size={18} color={colors.success} />} last />
        )}
      </Card>
      {user?.role === 'PILGRIM' && isOnline ? (
        <Button title={t('refreshCredential')} variant="secondary" icon="refresh-outline" style={{ marginTop: spacing.md }} onPress={() => void refreshCredential()} />
      ) : null}

      <SectionHeader title={t('more')} style={{ marginTop: spacing.xxl }} />
      <Card padding={spacing.md}>
        <ListRow icon="play-circle-outline" iconTone="saffron" title={t('demoMode')} subtitle={forceOffline ? t('networkForcedOffline') : t('demoModeDesc')} chevron onPress={() => router.push('/demo')} />
        <ListRow icon="people-outline" iconTone="info" title={t('crowdMap')} subtitle={t('crowdSubtitle')} chevron onPress={() => router.push('/crowd')} />
        <ListRow icon="alert-circle-outline" iconTone="danger" title={t('emergencyTitle')} subtitle={t('contacts')} chevron onPress={() => router.push('/emergency')} />
        <ListRow icon="search-outline" iconTone="neutral" title={t('lostPerson')} subtitle={t('lostSubtitle')} chevron onPress={() => router.push('/lost-person')} last />
      </Card>

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
