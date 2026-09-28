import * as Location from 'expo-location';

/** Location wrapper: permission + a single fix with a sane timeout, or null. */
export interface Fix {
  lat: number;
  lng: number;
  accuracy_m: number | null;
}

/** Demo fallback: Sangam Ghat, so SOS/crowd screens work on a desk without GPS. */
export const DEMO_FIX: Fix = { lat: 25.4268, lng: 81.8843, accuracy_m: 25 };

export async function getCurrentFix(timeoutMs = 8000): Promise<Fix | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!pos) return null;
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy ?? null };
  } catch {
    return null;
  }
}

/** Haversine distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
