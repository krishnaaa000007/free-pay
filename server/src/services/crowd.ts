/**
 * Crowd intelligence: density classification and least-crowded routing over the zone
 * graph. Pure functions; the route layer feeds them rows from the database.
 */
export interface ZoneNode {
  id: string;
  code: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  radius_m: number;
  capacity: number;
  map_x: number;
  map_y: number;
  /** 0..1+ occupancy ratio (head_count / capacity). */
  density: number;
  head_count: number;
  recorded_at: string | null;
  trend?: 'RISING' | 'FALLING' | 'STEADY';
}

export interface ZoneEdge {
  from_zone: string;
  to_zone: string;
  distance_m: number;
}

export type DensityLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export function densityLevel(density: number): DensityLevel {
  if (density >= 0.9) return 'CRITICAL';
  if (density >= 0.65) return 'HIGH';
  if (density >= 0.35) return 'MODERATE';
  return 'LOW';
}

/** Walking speed in metres/minute, degraded by crowd density. */
export function walkingSpeed(density: number): number {
  const base = 75; // ~4.5 km/h
  const factor = Math.max(0.25, 1 - Math.min(density, 1.3) * 0.6);
  return base * factor;
}

export interface RouteResult {
  path: ZoneNode[];
  distance_m: number;
  eta_min: number;
  max_density: number;
  avoided: ZoneNode[];
  /** The naive shortest path, for comparison in the UI. */
  shortest: { path: ZoneNode[]; distance_m: number; eta_min: number; max_density: number } | null;
}

/**
 * Dijkstra over zones. Edge cost = walking time through the destination zone, with a
 * congestion penalty that grows steeply near critical density so the route steers around
 * dangerous crush points. `avoidCritical` hard-excludes CRITICAL zones when a path exists.
 */
export function suggestRoute(
  zones: ZoneNode[],
  edges: ZoneEdge[],
  fromId: string,
  toId: string,
  opts: { avoidCritical?: boolean } = {},
): RouteResult | null {
  const byId = new Map(zones.map((z) => [z.id, z]));
  if (!byId.has(fromId) || !byId.has(toId)) return null;

  const adjacency = new Map<string, ZoneEdge[]>();
  for (const e of edges) {
    if (!adjacency.has(e.from_zone)) adjacency.set(e.from_zone, []);
    adjacency.get(e.from_zone)!.push(e);
  }

  const run = (costFn: (e: ZoneEdge, to: ZoneNode) => number, exclude: (z: ZoneNode) => boolean) => {
    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const visited = new Set<string>();
    dist.set(fromId, 0);
    while (true) {
      let current: string | null = null;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (!visited.has(id) && d < best) {
          best = d;
          current = id;
        }
      }
      if (current === null) break;
      if (current === toId) break;
      visited.add(current);
      for (const e of adjacency.get(current) ?? []) {
        const to = byId.get(e.to_zone);
        if (!to || visited.has(to.id)) continue;
        if (to.id !== toId && exclude(to)) continue;
        const nd = best + costFn(e, to);
        if (nd < (dist.get(to.id) ?? Infinity)) {
          dist.set(to.id, nd);
          prev.set(to.id, current);
        }
      }
    }
    if (!dist.has(toId)) return null;
    const path: ZoneNode[] = [];
    let cur: string | undefined = toId;
    while (cur) {
      path.unshift(byId.get(cur)!);
      if (cur === fromId) break;
      cur = prev.get(cur);
    }
    return path;
  };

  const summarize = (path: ZoneNode[]) => {
    let distance = 0;
    let eta = 0;
    let maxDensity = 0;
    for (let i = 1; i < path.length; i++) {
      const e = (adjacency.get(path[i - 1].id) ?? []).find((x) => x.to_zone === path[i].id);
      const d = e?.distance_m ?? 0;
      distance += d;
      eta += d / walkingSpeed(path[i].density);
      maxDensity = Math.max(maxDensity, path[i].density);
    }
    return { distance_m: distance, eta_min: Math.round(eta), max_density: Math.round(maxDensity * 100) / 100 };
  };

  const congestionCost = (e: ZoneEdge, to: ZoneNode) => {
    const time = e.distance_m / walkingSpeed(to.density);
    const penalty = to.density >= 0.9 ? 40 : to.density >= 0.65 ? 8 : 0;
    return time + penalty;
  };

  let path = run(congestionCost, (z) => (opts.avoidCritical ?? true) && z.density >= 0.9);
  if (!path) path = run(congestionCost, () => false);
  if (!path) return null;

  const shortestPath = run((e) => e.distance_m, () => false);
  const summary = summarize(path);
  const pathIds = new Set(path.map((p) => p.id));
  const avoided = zones.filter((z) => z.density >= 0.9 && !pathIds.has(z.id) && z.id !== fromId && z.id !== toId);

  return {
    path,
    ...summary,
    avoided,
    shortest: shortestPath ? { path: shortestPath, ...summarize(shortestPath) } : null,
  };
}

export function computeTrend(readings: Array<{ density: number; recorded_at: string }>): 'RISING' | 'FALLING' | 'STEADY' {
  if (readings.length < 2) return 'STEADY';
  const sorted = [...readings].sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  const first = sorted[Math.max(0, sorted.length - 3)].density;
  const last = sorted[sorted.length - 1].density;
  const delta = last - first;
  if (delta > 0.06) return 'RISING';
  if (delta < -0.06) return 'FALLING';
  return 'STEADY';
}
