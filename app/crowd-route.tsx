import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MapSimulationLoader } from '@/components/MapSimulationLoader';
import { DENSITY_COLORS, MelaMap } from '@/components/MelaMap';
import { Button, Card, Icon, Pill, Screen, T } from '@/components/ui';
import type { CrowdZone } from '@/domain/types';
import { useCrowd } from '@/hooks/useData';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { get } from '@/services/api';
import { colors, radii, spacing } from '@/theme';

interface RouteResult {
  path: CrowdZone[];
  distance_m: number;
  eta_min: number;
  max_density: number;
  avoided: Array<{ id: string; name: string; density: number }>;
  shortest: { path: CrowdZone[]; distance_m: number; eta_min: number; max_density: number } | null;
}

/**
 * Least-crowded routing. Online it asks the server (which runs Dijkstra with congestion
 * penalties); offline it runs the same algorithm locally on the cached zone graph.
 */
export default function CrowdRoute() {
  const { t } = useI18n();
  const { isOnline } = useNetwork();
  const params = useLocalSearchParams<{ from?: string; to?: string }>();
  const { zones, edges, loading } = useCrowd();
  const [from, setFrom] = useState<string | null>(params.from ?? null);
  const [to, setTo] = useState<string | null>(params.to ?? null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!from && zones.length) setFrom(zones.find((z) => z.kind === 'GATE')?.id ?? zones[0].id);
  }, [zones, from]);

  const find = async () => {
    if (!from || !to) return;
    setBusy(true);
    setRoute(null);
    try {
      if (isOnline) {
        setRoute(await get<RouteResult>('/api/crowd/route', { from, to }));
      } else {
        const { suggestRoute } = await import('@/domain/routing');
        const r = suggestRoute(zones, edges, from, to);
        setRoute(r ? { ...r, avoided: r.avoided.map((z) => ({ id: z.id, name: z.name, density: z.density })) } : null);
      }
    } finally {
      setBusy(false);
    }
  };

  const pathIds = useMemo(() => route?.path.map((z) => z.id) ?? [], [route]);

  return (
    <Screen title={t('routeTitle')} subtitle={t('suggestRoute')} back>
      {loading ? (
        <MapSimulationLoader />
      ) : (
        <MelaMap zones={zones} edges={edges} route={pathIds} avoided={route?.avoided.map((a) => a.id)} height={320} selectedId={to} onSelect={(z) => (!from || (from && to) ? setFrom(z.id) : setTo(z.id))} />
      )}

      <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
        <Picker label={t('from')} zones={zones} value={from} onChange={setFrom} />
        <Picker label={t('to')} zones={zones} value={to} onChange={setTo} />
        <Button title={t('findRoute')} icon="navigate-outline" fullWidth size="lg" disabled={!from || !to || from === to} loading={busy} onPress={() => void find()} />
      </View>

      {route ? (
        <Card style={{ marginTop: spacing.xl }}>
          <View style={{ flexDirection: 'row', gap: spacing.lg }}>
            <Stat icon="time-outline" label={t('eta')} value={`${route.eta_min} ${t('minutesShort')}`} />
            <Stat icon="walk-outline" label={t('distance')} value={`${(route.distance_m / 1000).toFixed(1)} km`} />
            <Stat icon="people-outline" label="Peak" value={`${Math.round(route.max_density * 100)}%`} tone={route.max_density >= 0.9 ? colors.danger : route.max_density >= 0.65 ? colors.densityHigh : colors.success} />
          </View>

          <T variant="label" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
            {t('viaZones')}
          </T>
          <View style={{ gap: spacing.xs }}>
            {route.path.map((z, i) => (
              <View key={z.id} style={styles.step}>
                <View style={[styles.stepDot, { backgroundColor: DENSITY_COLORS[z.level] }]} />
                <T variant="body" style={{ flex: 1 }}>
                  {z.name}
                </T>
                <T variant="caption">{Math.round(z.density * 100)}%</T>
                {i === 0 ? <Pill label={t('from')} size="sm" /> : i === route.path.length - 1 ? <Pill label={t('to')} size="sm" tone="saffron" /> : null}
              </View>
            ))}
          </View>

          {route.avoided.length ? (
            <View style={{ marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs }}>
              <T variant="caption">{t('avoids')}:</T>
              {route.avoided.map((a) => (
                <Pill key={a.id} label={`${a.name} (${Math.round(a.density * 100)}%)`} tone="danger" size="sm" />
              ))}
            </View>
          ) : null}

          {route.shortest && route.shortest.eta_min !== route.eta_min ? (
            <View style={styles.compare}>
              <Icon name="git-compare-outline" size={16} color={colors.muted} />
              <T variant="caption" style={{ flex: 1 }}>
                {t('shortestRoute')}: {route.shortest.eta_min} {t('minutesShort')} through {Math.round(route.shortest.max_density * 100)}% crowd · {t('calmerRoute')}: {route.eta_min} {t('minutesShort')}
              </T>
            </View>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

function Picker({ label, zones, value, onChange }: { label: string; zones: CrowdZone[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <View>
      <T variant="label" style={{ marginBottom: spacing.xs }}>
        {label}
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
        {zones.map((z) => {
          const active = z.id === value;
          return (
            <Pressable key={z.id} onPress={() => onChange(z.id)} style={[styles.chip, active && styles.chipActive]}>
              <View style={[styles.chipDot, { backgroundColor: DENSITY_COLORS[z.level] }]} />
              <T variant="caption" weight="600" style={{ color: active ? colors.onSaffron : colors.ink }}>
                {z.name}
              </T>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; value: string; tone?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon name={icon} size={14} color={colors.muted} />
        <T variant="label">{label}</T>
      </View>
      <T variant="title" style={{ color: tone ?? colors.ink }}>
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.saffron, borderColor: colors.saffron },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  stepDot: { width: 12, height: 12, borderRadius: 6 },
  compare: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, backgroundColor: colors.cardAlt, padding: spacing.sm, borderRadius: radii.sm },
});
