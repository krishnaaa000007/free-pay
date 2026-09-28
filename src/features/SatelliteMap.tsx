import React from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';
import { DENSITY_COLORS } from '../components/MelaMap';
import type { CrowdZone } from '../domain/types';
import { colors, radii } from '../theme';

/**
 * Real map (Apple Maps / Google Maps via react-native-maps) with density circles.
 * Loaded lazily by CrowdScreen so the grounds view never depends on native map modules.
 */
export function SatelliteMap({ zones, selectedId, onSelect, route, height = 360 }: { zones: CrowdZone[]; selectedId?: string | null; onSelect?: (z: CrowdZone) => void; route?: CrowdZone[]; height?: number }) {
  const center = zones.length
    ? { latitude: zones.reduce((a, z) => a + z.lat, 0) / zones.length, longitude: zones.reduce((a, z) => a + z.lng, 0) / zones.length }
    : { latitude: 25.43, longitude: 81.88 };
  return (
    <View style={[styles.wrap, { height }]}>
      <MapView style={StyleSheet.absoluteFill} initialRegion={{ ...center, latitudeDelta: 0.022, longitudeDelta: 0.022 }} mapType="standard" showsUserLocation>
        {zones.map((z) => (
          <React.Fragment key={z.id}>
            <Circle center={{ latitude: z.lat, longitude: z.lng }} radius={z.radius_m * (0.7 + z.density * 0.6)} fillColor={hexToRgba(DENSITY_COLORS[z.level], 0.32)} strokeColor={DENSITY_COLORS[z.level]} strokeWidth={selectedId === z.id ? 4 : 1.5} />
            <Marker coordinate={{ latitude: z.lat, longitude: z.lng }} title={z.name} description={`${Math.round(z.density * 100)}% of capacity`} pinColor={DENSITY_COLORS[z.level]} onPress={() => onSelect?.(z)} />
          </React.Fragment>
        ))}
        {route && route.length > 1 ? <Polyline coordinates={route.map((z) => ({ latitude: z.lat, longitude: z.lng }))} strokeColor={colors.success} strokeWidth={6} /> : null}
      </MapView>
    </View>
  );
}

function hexToRgba(hex: string, alpha: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const styles = StyleSheet.create({
  wrap: { width: '100%', borderRadius: radii.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.hairline },
});
