import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path, Polyline } from 'react-native-svg';
import { colors, radii, spacing } from '../../theme';
import { Icon, type IconName } from './Icon';
import { T } from './Text';

/* ------------------------------------------------------------------ */
/* Avatar                                                               */
/* ------------------------------------------------------------------ */
const AVATAR_COLORS = ['#E8891D', '#A63A2A', '#3E7C4A', '#2F6B8A', '#C9A227', '#7A4E9A', '#B5371F', '#3B3F7A', '#C96F0F', '#4F7F6B', '#8A5A2B', '#5B7DB1'];

export function Avatar({ name, seed = 0, size = 44 }: { name: string; seed?: number; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  const bg = AVATAR_COLORS[Math.abs(seed) % AVATAR_COLORS.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <T variant="bodyStrong" style={{ color: colors.white, fontSize: size * 0.38, lineHeight: size * 0.46 }}>
        {initials || '?'}
      </T>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Divider / Section header                                             */
/* ------------------------------------------------------------------ */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: colors.hairline }, style]} />;
}

export function SectionHeader({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <T variant="heading">{title}</T>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <T variant="caption" tone="saffron" weight="600">
            {action}
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* IconButton                                                           */
/* ------------------------------------------------------------------ */
export function IconButton({ icon, onPress, size = 40, tone = 'neutral', label }: { icon: IconName; onPress?: () => void; size?: number; tone?: 'neutral' | 'saffron' | 'ink' | 'danger' | 'ghost'; label?: string }) {
  const bg = tone === 'saffron' ? colors.saffronSoft : tone === 'ink' ? colors.ink : tone === 'danger' ? colors.dangerSoft : tone === 'ghost' ? 'transparent' : colors.card;
  const fg = tone === 'saffron' ? colors.saffronDeep : tone === 'ink' ? colors.onDark : tone === 'danger' ? colors.danger : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, tone === 'neutral' && { borderWidth: 1, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
    >
      <Icon name={icon} size={size * 0.5} color={fg} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* EmptyState                                                           */
/* ------------------------------------------------------------------ */
export function EmptyState({ icon = 'leaf-outline', title, body, action }: { icon?: IconName; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={30} color={colors.saffronDeep} />
      </View>
      <T variant="heading" align="center">
        {title}
      </T>
      {body ? (
        <T variant="caption" align="center" style={{ maxWidth: 280 }}>
          {body}
        </T>
      ) : null}
      {action}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                             */
/* ------------------------------------------------------------------ */
export function Skeleton({ width = '100%', height = 16, radius = radii.sm, style }: { width?: number | `${number}%`; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: colors.parchmentDeep, opacity }, style]} />;
}

/* ------------------------------------------------------------------ */
/* Sparkline                                                            */
/* ------------------------------------------------------------------ */
export function Sparkline({ data, width = 80, height = 28, color = colors.saffron, fill = true }: { data: number[]; width?: number; height?: number; color?: string; fill?: boolean }) {
  if (!data || data.length < 2) return <View style={{ width, height }} />;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => [i * step, height - 2 - ((v - min) / range) * (height - 4)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `M0,${height} L${line.replace(/ /g, ' L')} L${width},${height} Z`;
  return (
    <Svg width={width} height={height}>
      {fill ? <Path d={area} fill={color} opacity={0.15} /> : null}
      <Polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control                                                    */
/* ------------------------------------------------------------------ */
export function Segmented<T extends string>({ options, value, onChange, style }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.segment, style]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.segmentItem, active && styles.segmentActive]}>
            <T variant="caption" weight="600" style={{ color: active ? colors.onSaffron : colors.inkSoft }}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Key/value row for receipts and detail screens                        */
/* ------------------------------------------------------------------ */
export function KV({ label, value, mono, last }: { label: string; value: React.ReactNode; mono?: boolean; last?: boolean }) {
  return (
    <View style={[styles.kv, !last && { borderBottomWidth: 1, borderBottomColor: colors.hairline }]}>
      <T variant="caption" style={{ flex: 1 }}>
        {label}
      </T>
      {typeof value === 'string' || typeof value === 'number' ? (
        <T variant={mono ? 'mono' : 'bodyStrong'} style={{ flex: 1.4, textAlign: 'right' }} numberOfLines={2}>
          {value}
        </T>
      ) : (
        <View style={{ flex: 1.4, alignItems: 'flex-end' }}>{value}</View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Stat tile                                                            */
/* ------------------------------------------------------------------ */
export function StatTile({ label, value, hint, tone = 'default', spark, icon, style }: { label: string; value: string; hint?: string; tone?: 'default' | 'saffron' | 'success' | 'warning' | 'danger' | 'info'; spark?: number[]; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const accent = tone === 'saffron' ? colors.saffron : tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : tone === 'danger' ? colors.danger : tone === 'info' ? colors.info : colors.inkSoft;
  return (
    <View style={[styles.stat, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T variant="label" numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </T>
        {icon ? <Icon name={icon} size={16} color={accent} /> : null}
      </View>
      <T variant="title" style={{ marginTop: spacing.xs }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: spacing.xs }}>
        {hint ? (
          <T variant="caption" numberOfLines={1} style={{ flex: 1 }}>
            {hint}
          </T>
        ) : (
          <View />
        )}
        {spark ? <Sparkline data={spark} width={64} height={22} color={accent} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.saffronSoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  segment: { flexDirection: 'row', backgroundColor: colors.parchmentDeep, borderRadius: radii.pill, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radii.pill },
  segmentActive: { backgroundColor: colors.saffron },
  kv: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2, gap: spacing.md },
  stat: { flex: 1, backgroundColor: colors.card, borderRadius: radii.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.hairline, minWidth: 96 },
});
