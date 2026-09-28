import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import type { CrowdEdge, CrowdZone } from '../domain/types';
import { colors } from '../theme';

/**
 * Stylised "grounds view" of the mela: the river, ghats, roads and zones as a schematic
 * SVG driven by `map_x/map_y` (0-1000). Density renders as a warm heat halo per zone.
 * Works offline and on every platform, no map keys required.
 */
export const DENSITY_COLORS = { LOW: colors.densityLow, MODERATE: colors.densityModerate, HIGH: colors.densityHigh, CRITICAL: colors.densityCritical } as const;

const kindGlyph: Record<string, string> = { GHAT: '〰', ROAD: '⋯', MARKET: '⛩', CAMP: '⛺', GATE: '⛩', MEDICAL: '✚', TRANSIT: '⛟' };

export interface MelaMapProps {
  zones: CrowdZone[];
  edges?: CrowdEdge[];
  /** Highlighted route as ordered zone ids. */
  route?: string[];
  /** Zone ids to render with an "avoid" hatch. */
  avoided?: string[];
  selectedId?: string | null;
  onSelect?: (zone: CrowdZone) => void;
  height?: number;
  /** Pulse critical zones. */
  live?: boolean;
  userPosition?: { map_x: number; map_y: number } | null;
}

export function MelaMap({ zones, edges = [], route, avoided = [], selectedId, onSelect, height = 320, live = true, userPosition }: MelaMapProps) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!live) return;
    const loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: false }), Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: false })]));
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);

  const byId = new Map(zones.map((z) => [z.id, z]));
  const routeSet = new Set(route ?? []);
  const routeSegments: Array<[CrowdZone, CrowdZone]> = [];
  if (route) for (let i = 1; i < route.length; i++) {
    const a = byId.get(route[i - 1]);
    const b = byId.get(route[i]);
    if (a && b) routeSegments.push([a, b]);
  }

  return (
    <View style={[styles.wrap, { height }]}>
      <Svg width="100%" height="100%" viewBox="0 0 1000 900" preserveAspectRatio="xMidYMid meet">
        <Defs>
          {(['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] as const).map((k) => (
            <RadialGradient key={k} id={`halo-${k}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={DENSITY_COLORS[k]} stopOpacity={0.55} />
              <Stop offset="100%" stopColor={DENSITY_COLORS[k]} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>

        {/* parchment ground with faint grid */}
        <Rect x={0} y={0} width={1000} height={900} fill={colors.cardAlt} />
        {Array.from({ length: 10 }).map((_, i) => (
          <Line key={`v${i}`} x1={i * 100} y1={0} x2={i * 100} y2={900} stroke={colors.hairline} strokeWidth={1} />
        ))}
        {Array.from({ length: 9 }).map((_, i) => (
          <Line key={`h${i}`} x1={0} y1={i * 100} x2={1000} y2={i * 100} stroke={colors.hairline} strokeWidth={1} />
        ))}

        {/* the river (Ganga) sweeping across the bottom */}
        <Path d="M -20 700 C 150 640, 300 760, 500 720 C 700 680, 850 760, 1020 700 L 1020 920 L -20 920 Z" fill="#CFE0E8" opacity={0.9} />
        <Path d="M -20 730 C 150 680, 300 790, 500 750 C 700 710, 850 790, 1020 730" stroke="#A9C4D3" strokeWidth={3} fill="none" opacity={0.8} />
        <Path d="M -20 780 C 150 730, 300 830, 500 800 C 700 770, 850 840, 1020 780" stroke="#A9C4D3" strokeWidth={2} fill="none" opacity={0.6} />
        <SvgText x={860} y={860} fontSize={26} fill="#6E8FA0" fontStyle="italic" fontFamily="serif">
          Ganga
        </SvgText>

        {/* paths between zones */}
        {edges.map((e) => {
          const a = byId.get(e.from_zone);
          const b = byId.get(e.to_zone);
          if (!a || !b || a.id > b.id) return null;
          return <Line key={`${e.from_zone}-${e.to_zone}`} x1={a.map_x} y1={a.map_y} x2={b.map_x} y2={b.map_y} stroke={colors.borderStrong} strokeWidth={10} strokeLinecap="round" opacity={0.7} strokeDasharray="1 18" />;
        })}

        {/* density halos */}
        {zones.map((z) => (
          <Circle key={`halo-${z.id}`} cx={z.map_x} cy={z.map_y} r={70 + z.density * 90} fill={`url(#halo-${z.level})`} />
        ))}

        {/* suggested route */}
        {routeSegments.map(([a, b], i) => (
          <Line key={`r${i}`} x1={a.map_x} y1={a.map_y} x2={b.map_x} y2={b.map_y} stroke={colors.success} strokeWidth={16} strokeLinecap="round" opacity={0.9} />
        ))}

        {/* zones */}
        {zones.map((z) => {
          const c = DENSITY_COLORS[z.level];
          const onRoute = routeSet.has(z.id);
          const isAvoided = avoided.includes(z.id);
          const selected = selectedId === z.id;
          const r = 34 + Math.min(z.density, 1.3) * 14;
          return (
            <G key={z.id} {...(onSelect ? (Platform.OS === 'web' ? { onClick: () => onSelect(z) } : { onPress: () => onSelect(z) }) : {})}>
              {selected ? <Circle cx={z.map_x} cy={z.map_y} r={r + 14} fill="none" stroke={colors.ink} strokeWidth={4} strokeDasharray="8 8" /> : null}
              <Circle cx={z.map_x} cy={z.map_y} r={r} fill={c} stroke={onRoute ? colors.success : colors.card} strokeWidth={onRoute ? 8 : 5} />
              {isAvoided ? <Line x1={z.map_x - r * 0.6} y1={z.map_y - r * 0.6} x2={z.map_x + r * 0.6} y2={z.map_y + r * 0.6} stroke={colors.card} strokeWidth={6} strokeLinecap="round" /> : null}
              <SvgText x={z.map_x} y={z.map_y + 9} fontSize={26} textAnchor="middle" fill={colors.white} fontWeight="700">
                {kindGlyph[z.kind] ?? '●'}
              </SvgText>
              <SvgText x={z.map_x} y={z.map_y + r + 30} fontSize={24} textAnchor="middle" fill={colors.ink} fontWeight="600" fontFamily="serif">
                {z.name}
              </SvgText>
              <SvgText x={z.map_x} y={z.map_y + r + 54} fontSize={19} textAnchor="middle" fill={colors.muted}>
                {Math.round(z.density * 100)}% · {compact(z.head_count)}
              </SvgText>
            </G>
          );
        })}

        {userPosition ? (
          <G>
            <Circle cx={userPosition.map_x} cy={userPosition.map_y} r={22} fill={colors.info} opacity={0.25} />
            <Circle cx={userPosition.map_x} cy={userPosition.map_y} r={11} fill={colors.info} stroke={colors.white} strokeWidth={4} />
          </G>
        ) : null}
      </Svg>

      {/* Pulse overlay for critical zones: cheap Animated view instead of animating SVG props */}
      {live
        ? zones
            .filter((z) => z.level === 'CRITICAL')
            .map((z) => (
              <Animated.View
                key={`pulse-${z.id}`}
                pointerEvents="none"
                style={[
                  styles.pulse,
                  {
                    left: `${(z.map_x / 1000) * 100}%`,
                    top: `${(z.map_y / 900) * 100}%`,
                    opacity: Animated.subtract(0.5, Animated.multiply(pulse, 0.5)),
                    transform: [{ translateX: -40 }, { translateY: -40 }, { scale: Animated.add(0.6, Animated.multiply(pulse, 0.9)) }],
                  },
                ]}
              />
            ))
        : null}
      {onSelect ? <Pressable style={StyleSheet.absoluteFill} pointerEvents="none" /> : null}
    </View>
  );
}

function compact(n: number): string {
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

const styles = StyleSheet.create({
  wrap: { width: '100%', borderRadius: 20, overflow: 'hidden', backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.hairline },
  pulse: { position: 'absolute', width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: colors.densityCritical },
});
