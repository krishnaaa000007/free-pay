import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, EmptyState, Icon, Input, Pill, Screen, Segmented, T } from '@/components/ui';
import { relativeTime } from '@/domain/time';
import { useCrowd } from '@/hooks/useData';
import { useAuth } from '@/providers/AuthProvider';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { ApiError, get, post } from '@/services/api';
import { toast } from '@/services/notifications';
import { colors, radii, spacing } from '@/theme';

interface LostReport {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  description: string | null;
  last_seen_zone_name: string | null;
  last_seen_at: string;
  contact_phone: string;
  status: 'OPEN' | 'FOUND' | 'CLOSED';
  reporter_name: string | null;
  created_at: string;
}

/** Lost-person reporting + the live board of open reports nearby. */
export default function LostPerson() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { isOnline } = useNetwork();
  const { zones } = useCrowd();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'report' | 'board'>('report');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<'M' | 'F' | 'O' | null>(null);
  const [description, setDescription] = useState('');
  const [zone, setZone] = useState<string | null>(null);
  const [phone, setPhone] = useState(user?.phone ?? '');

  const reports = useQuery({ queryKey: ['lost-persons'], queryFn: () => get<{ reports: LostReport[] }>('/api/emergency/lost-person'), enabled: isOnline });
  const submit = useMutation({
    mutationFn: () =>
      post('/api/emergency/lost-person', {
        name: name.trim(),
        age: age ? Number(age) : undefined,
        gender: gender ?? undefined,
        description: description.trim() || undefined,
        last_seen_zone_id: zone ?? undefined,
        contact_phone: phone,
      }),
    onSuccess: () => {
      toast.success(t('reportSubmitted'), t('lostSubtitle'));
      setName('');
      setAge('');
      setDescription('');
      setGender(null);
      void qc.invalidateQueries({ queryKey: ['lost-persons'] });
      setTab('board');
    },
    onError: (err) => toast.error(t('lostTitle'), err instanceof ApiError ? err.message : t('errGeneric')),
  });
  const markFound = useMutation({
    mutationFn: (id: string) => post(`/api/emergency/lost-person/${id}/found`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['lost-persons'] }),
  });

  const valid = name.trim().length >= 1 && /^\d{10}$/.test(phone);

  return (
    <Screen title={t('lostTitle')} subtitle={t('lostSubtitle')} back keyboard>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'report', label: t('submitReport') }, { value: 'board', label: t('openReports') }]} style={{ marginBottom: spacing.lg }} />

      {tab === 'report' ? (
        <View style={{ gap: spacing.lg }}>
          {!isOnline ? (
            <Card tone="warning" elevated={false}>
              <T variant="body">{t('networkOffline')} — {t('sosOfflineNote')}</T>
            </Card>
          ) : null}
          <Input label={t('personName')} icon="person-outline" value={name} onChangeText={setName} placeholder="Aarav Patel" autoCapitalize="words" />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Input label={t('age')} icon="calendar-outline" value={age} onChangeText={(v) => setAge(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" placeholder="6" containerStyle={{ flex: 1 }} />
            <View style={{ flex: 1.6 }}>
              <T variant="label" style={{ marginBottom: spacing.xs }}>
                {t('gender')}
              </T>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                {(['M', 'F', 'O'] as const).map((g) => (
                  <Pressable key={g} onPress={() => setGender(g)} style={[styles.chip, gender === g && styles.chipActive]}>
                    <T variant="caption" weight="600" style={{ color: gender === g ? colors.onSaffron : colors.ink }}>
                      {t(`gender${g}`)}
                    </T>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
          <Input label={t('description')} icon="shirt-outline" value={description} onChangeText={setDescription} placeholder="Red kurta, yellow cap, speaks Gujarati" multiline numberOfLines={3} style={{ minHeight: 70 }} />
          <View>
            <T variant="label" style={{ marginBottom: spacing.xs }}>
              {t('lastSeen')}
            </T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
              {zones.map((z) => (
                <Pressable key={z.id} onPress={() => setZone(z.id)} style={[styles.chip, zone === z.id && styles.chipActive]}>
                  <T variant="caption" weight="600" style={{ color: zone === z.id ? colors.onSaffron : colors.ink }}>
                    {z.name}
                  </T>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <Input label={t('contactPhone')} icon="call-outline" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
          <Button title={t('submitReport')} icon="megaphone-outline" size="lg" fullWidth disabled={!valid || !isOnline} loading={submit.isPending} onPress={() => submit.mutate()} />
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          {!reports.data || reports.data.reports.length === 0 ? (
            <EmptyState icon="search-outline" title={t('openReports')} body={isOnline ? '—' : t('errNetwork')} />
          ) : (
            reports.data.reports.map((r) => (
              <Card key={r.id} padding={spacing.md}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <View style={[styles.avatar, { backgroundColor: r.status === 'OPEN' ? colors.dangerSoft : colors.successSoft }]}>
                    <Icon name={r.status === 'OPEN' ? 'search' : 'checkmark'} size={20} color={r.status === 'OPEN' ? colors.danger : colors.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong">
                      {r.name}
                      {r.age ? `, ${r.age}` : ''}
                      {r.gender ? ` · ${t(`gender${r.gender as 'M' | 'F' | 'O'}`)}` : ''}
                    </T>
                    <T variant="caption" numberOfLines={2}>
                      {r.description ?? '—'}
                    </T>
                    <T variant="caption">
                      {t('lastSeen')} {r.last_seen_zone_name ?? '—'} · {relativeTime(r.last_seen_at)}
                    </T>
                  </View>
                  <Pill label={r.status === 'OPEN' ? t('openReports').split(' ')[0] : t('found')} tone={r.status === 'OPEN' ? 'danger' : 'success'} />
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'center' }}>
                  <T variant="caption" style={{ flex: 1 }}>
                    {t('reportedBy')} {r.reporter_name ?? '—'} · {r.contact_phone}
                  </T>
                  {r.status === 'OPEN' ? <Button title={t('markFound')} size="sm" variant="secondary" onPress={() => markFound.mutate(r.id)} /> : null}
                </View>
              </Card>
            ))
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radii.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.saffron, borderColor: colors.saffron },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
