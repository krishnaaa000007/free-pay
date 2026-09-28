import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { MapSimulationLoader } from '../components/MapSimulationLoader';
import { DENSITY_COLORS, MelaMap } from '../components/MelaMap';
import { Button, Card, Icon, Pill, Screen, Segmented, T, type IconName } from '../components/ui';
import { relativeTime } from '../domain/time';
import type { CrowdZone } from '../domain/types';
import { useCrowd } from '../hooks/useData';
import { useI18n } from '../providers/I18nProvider';
import { useNetwork } from '../providers/NetworkProvider';
import { colors, radii, spacing } from '../theme';

const trendIcon: Record<NonNullable<CrowdZone['trend']>, IconName> = { RISING: 'trending-up', FALLING: 'trending-down', STEADY: 'remove' };

/**
 * Crowd density screen. The schematic "grounds view" is the default because it works
 * offline and without map keys; the satellite view (react-native-maps) is one tap away.
 */
export function CrowdScreen({ embedded, bottomInset = 0 }: { embedded?: boolean; bottomInset?: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const { isOnline } = useNetwork();
  const { zones, edges, summary, loading, fromCache, refetch } = useCrowd();
  const [view, setView] = useState<'grounds' | 'map'>('grounds');
  const [selected, setSelected] = useState<CrowdZone | null>(null);
  const [simulating, setSimulating] = useState(true);

  // A short "sensor sweep" on first open makes the map feel alive rather than static.
  useEffect(() => {
    const t0 = setTimeout(() => setSimulating(false), 1400);
    return () => clearTimeout(t0);
  }, []);

  const sorted = useMemo(() => [...zones].sort((a, b) => b.density - a.density), [zones]);
  const MapView = view === 'map' ? require('./SatelliteMap').SatelliteMap : null;

  return (
    <Screen title={t('crowdTitle')} subtitle={t('crowdSubtitle')} back={!embedded} bottomInset={bottomInset} refreshing={false} onRefresh={() => void refetch()}>
      {summary ? (
        <View style={styles.summaryRow}>
          <Stat label={t('peopleEstimate')} value={compact(summary.people_estimate)} />
          <Stat label={t('densityCRITICAL')} value={String(summary.critical)} tone={summary.critical ? colors.danger : colors.success} />
          <Stat label={t('densityHIGH')} value={String(summary.high)} tone={colors.densityHigh} />
          <Stat label={t('updated')} value={summary.updated_at ? relativeTime(summary.updated_at) : '—'} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
        <Segmented value={view} onChange={setView} options={[{ value: 'grounds', label: t('schematicView') }, { value: 'map', label: t('satelliteView') }]} style={{ flex: 1 }} />
        {fromCache || !isOnline ? <Pill label={t('offline')} tone="warning" icon="cloud-offline-outline" /> : <Pill label="Live" tone="success" dot />}
      </View>

      {loading || simulating ? (
        <MapSimulationLoader />
      ) : view === 'map' && MapView && Platform.OS !== 'web' ? (
        <MapView zones={zones} selectedId={selected?.id} onSelect={setSelected} height={360} />
      ) : (
        <MelaMap zones={zones} edges={edges} selectedId={selected?.id} onSelect={setSelected} height={380} />
      )}

      <View style={styles.legend}>
        {(['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] as const).map((k) => (
          <View key={k} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: DENSITY_COLORS[k] }]} />
            <T variant="caption">{t(`density${k}`)}</T>
          </View>
        ))}
      </View>

      {selected ? (
        <Card style={{ marginTop: spacing.md }} tone="alt" elevated={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={[styles.zoneDot, { backgroundColor: DENSITY_COLORS[selected.level] }]} />
            <View style={{ flex: 1 }}>
              <T variant="heading">{selected.name}</T>
              <T variant="caption">
                {Math.round(selected.density * 100)}% of capacity · {compact(selected.head_count)} people · {selected.trend ? t(`trend${selected.trend}`) : ''}
              </T>
            </View>
            {selected.trend ? <Icon name={trendIcon[selected.trend]} size={20} color={selected.trend === 'RISING' ? colors.danger : selected.trend === 'FALLING' ? colors.success : colors.muted} /> : null}
          </View>
          <Button title={t('suggestRoute')} icon="navigate-outline" size="sm" style={{ marginTop: spacing.md }} onPress={() => router.push({ pathname: '/crowd-route', params: { to: selected.id } })} />
        </Card>
      ) : (
        <Button title={t('suggestRoute')} icon="navigate-outline" fullWidth style={{ marginTop: spacing.md }} onPress={() => router.push('/crowd-route')} />
      )}

      <T variant="heading" style={{ marginTop: spacing.xxl, marginBottom: spacing.sm }}>
        {t('zones')}
      </T>
      <Card padding={spacing.md}>
        {sorted.map((z, i) => (
          <Pressable key={z.id} onPress={() => setSelected(z)} style={[styles.zoneRow, i < sorted.length - 1 && styles.zoneDivider]}>
            <View style={[styles.zoneDot, { backgroundColor: DENSITY_COLORS[z.level] }]} />
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong">{z.name}</T>
              <T variant="caption">
                {z.kind} · {compact(z.head_count)} / {compact(z.capacity)}
              </T>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <T variant="bodyStrong" style={{ color: DENSITY_COLORS[z.level] }}>
                {Math.round(z.density * 100)}%
              </T>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.min(100, z.density * 100)}%`, backgroundColor: DENSITY_COLORS[z.level] }]} />
              </View>
            </View>
            {z.trend ? <Icon name={trendIcon[z.trend]} size={16} color={colors.muted} /> : null}
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.stat}>
      <T variant="title" style={{ color: tone ?? colors.ink }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
      <T variant="caption" numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}

function compact(n: number): string {
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  stat: { flex: 1, backgroundColor: colors.card, borderRadius: radii.md, padding: spacing.sm, alignItems: 'center', borderWidth: 1, borderColor: colors.hairline },
  legend: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  zoneDivider: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  zoneDot: { width: 14, height: 14, borderRadius: 7 },
  bar: { width: 80, height: 5, borderRadius: 3, backgroundColor: colors.parchmentDeep, overflow: 'hidden' },
  barFill: { height: 5, borderRadius: 3 },
});
