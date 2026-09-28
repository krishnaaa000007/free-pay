import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { SosButton } from '@/components/SosButton';
import { Button, Card, Icon, Pill, Screen, SectionHeader, T, type IconName } from '@/components/ui';
import { useCountdown, useEmergencyContacts } from '@/hooks/useData';
import { speechLanguageTag } from '@/i18n';
import { useAuth } from '@/providers/AuthProvider';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { ApiError, patch, post } from '@/services/api';
import { DEMO_FIX, getCurrentFix, type Fix } from '@/services/location';
import { toast } from '@/services/notifications';
import { colors, radii, spacing } from '@/theme';

type Kind = 'MEDICAL' | 'SECURITY' | 'FIRE' | 'LOST_CHILD' | 'OTHER';
const KINDS: Array<{ kind: Kind; icon: IconName }> = [
  { kind: 'MEDICAL', icon: 'medkit-outline' },
  { kind: 'SECURITY', icon: 'shield-half-outline' },
  { kind: 'FIRE', icon: 'flame-outline' },
  { kind: 'LOST_CHILD', icon: 'people-outline' },
  { kind: 'OTHER', icon: 'help-circle-outline' },
];

interface ActiveSos {
  id: string;
  expires_at: string;
  created_at: string;
  kind: Kind;
  queued?: boolean;
}

/**
 * Emergency SOS. Hold to trigger; location is captured and shared with responders for a
 * limited window (60 min by default). Offline, the SOS is queued locally and the phone
 * numbers are one tap away; it uploads the moment a signal returns.
 */
export default function Emergency() {
  const { t, language } = useI18n();
  const router = useRouter();
  const { user } = useAuth();
  const { isOnline } = useNetwork();
  const { contacts, shareTtlMin } = useEmergencyContacts();
  const [kind, setKind] = useState<Kind>('MEDICAL');
  const [active, setActive] = useState<ActiveSos | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [busy, setBusy] = useState(false);
  const countdown = useCountdown(active?.expires_at ?? null);

  useEffect(() => {
    if (countdown.expired && active) setActive(null);
  }, [countdown.expired, active]);

  // Flush a queued SOS when the network returns.
  useEffect(() => {
    if (isOnline && active?.queued) void send(active.kind, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // Periodic location trail while active.
  useEffect(() => {
    if (!active || active.queued || !isOnline) return;
    const id = setInterval(async () => {
      const f = (await getCurrentFix(5000)) ?? DEMO_FIX;
      setFix(f);
      await patch(`/api/emergency/${active.id}/location`, { lat: f.lat, lng: f.lng, accuracy_m: f.accuracy_m ?? undefined }).catch(() => undefined);
    }, 30_000);
    return () => clearInterval(id);
  }, [active, isOnline]);

  const send = async (k: Kind, flushing = false) => {
    setBusy(true);
    const f = (await getCurrentFix()) ?? DEMO_FIX;
    setFix(f);
    try {
      if (!isOnline) throw new ApiError(0, 'OFFLINE', 'offline');
      const r = await post<{ emergency: { id: string; created_at: string; expires_at: string } }>('/api/emergency/sos', {
        kind: k,
        lat: f.lat,
        lng: f.lng,
        accuracy_m: f.accuracy_m ?? undefined,
        note: undefined,
      });
      setActive({ id: r.emergency.id, created_at: r.emergency.created_at, expires_at: r.emergency.expires_at, kind: k });
      toast.success(t('sosSent'), t('respondersNotified'), 'sos');
      void Speech.speak(t('sosSpoken'), { language: speechLanguageTag(language) });
    } catch {
      if (!flushing) {
        setActive({ id: 'queued', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + shareTtlMin * 60_000).toISOString(), kind: k, queued: true });
        toast.warning(t('sosSent'), t('sosOfflineNote'), 'sos');
      }
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    if (active && !active.queued) await post(`/api/emergency/${active.id}/resolve`, {}).catch(() => undefined);
    setActive(null);
    toast.success(t('resolve'));
  };

  const call = (number: string) => void Linking.openURL(`tel:${number}`).catch(() => undefined);

  return (
    <Screen title={t('emergencyTitle')} back headerTone="light">
      {active ? (
        <Card tone={active.queued ? 'warning' : 'danger'} elevated={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={[styles.pulse, { backgroundColor: active.queued ? colors.warning : colors.danger }]}>
              <Icon name="radio" size={24} color={colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="heading">{active.queued ? t('sosOfflineNote').split('.')[0] : t('sosSent')}</T>
              <T variant="caption">{active.queued ? t('sosOfflineNote') : `${t('sharingLocation')} · ${t('locationSharedFor', { minutes: Math.ceil(countdown.totalSeconds / 60) })}`}</T>
            </View>
            <T variant="title" style={{ color: active.queued ? colors.warning : colors.danger }}>
              {countdown.label}
            </T>
          </View>
          {!active.queued ? (
            <T variant="body" style={{ marginTop: spacing.md }}>
              {t('helpOnWay')}
            </T>
          ) : null}
          {fix ? (
            <T variant="mono" style={{ marginTop: spacing.sm }}>
              {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)} ±{Math.round(fix.accuracy_m ?? 0)} m
            </T>
          ) : null}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <Button title={t('resolve')} variant="success" icon="checkmark" style={{ flex: 1 }} onPress={() => void resolve()} />
            <Button title={t('speakHelp')} variant="secondary" icon="volume-high-outline" onPress={() => void Speech.speak(t('sosSpoken'), { language: speechLanguageTag(language) })} />
          </View>
        </Card>
      ) : (
        <>
          <T variant="label" style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}>
            {t('whatHappened')}
          </T>
          <View style={styles.kinds}>
            {KINDS.map((k) => {
              const on = kind === k.kind;
              return (
                <Pressable key={k.kind} onPress={() => setKind(k.kind)} style={[styles.kind, on && styles.kindActive]}>
                  <Icon name={k.icon} size={20} color={on ? colors.white : colors.danger} />
                  <T variant="caption" weight="600" style={{ color: on ? colors.white : colors.ink }}>
                    {t(`sos${k.kind}`)}
                  </T>
                </Pressable>
              );
            })}
          </View>
          <SosButton onTrigger={() => void send(kind)} label={t('holdToSos')} disabled={busy} />
          <T variant="caption" align="center" style={{ maxWidth: 300, alignSelf: 'center' }}>
            {isOnline ? t('sharingLocation') + ` (${shareTtlMin} min)` : t('sosOfflineNote')}
          </T>
        </>
      )}

      <SectionHeader title={t('contacts')} style={{ marginTop: spacing.xxl }} />
      <View style={{ gap: spacing.sm }}>
        {contacts.map((c) => (
          <Pressable key={c.number} onPress={() => call(c.number)} style={({ pressed }) => [styles.contact, pressed && { backgroundColor: colors.saffronSoft }]}>
            <View style={styles.contactIcon}>
              <Icon name="call" size={18} color={colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong">{c.label}</T>
              <T variant="caption">{t('callHelp')}</T>
            </View>
            <T variant="title" tone="saffron">
              {c.number}
            </T>
          </Pressable>
        ))}
      </View>

      <Card tone="alt" elevated={false} style={{ marginTop: spacing.xl }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <Pill label={user?.name ?? ''} tone="ink" size="sm" />
          <T variant="caption" style={{ flex: 1 }}>
            {isOnline ? t('networkOnline') : t('networkOffline')} · {t('locationSharedFor', { minutes: shareTtlMin })}
          </T>
        </View>
        <Button title={t('lostPerson')} variant="ghost" icon="search-outline" size="sm" style={{ marginTop: spacing.sm }} onPress={() => router.push('/lost-person')} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 9, borderRadius: radii.pill, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.dangerSoft },
  kindActive: { backgroundColor: colors.danger, borderColor: colors.danger },
  pulse: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  contact: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, borderRadius: radii.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.hairline },
  contactIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
});
