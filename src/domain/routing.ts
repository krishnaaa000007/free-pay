import type { CrowdEdge, CrowdZone } from './types';

/**
 * On-device copy of the server's least-crowded routing so the feature keeps working
 * offline on the cached zone graph. Same cost model as server/src/services/crowd.ts.
 */
export function walkingSpeed(density: number): number {
  const base = 75;
  return base * Math.max(0.25, 1 - Math.min(density, 1.3) * 0.6);
}

export interface LocalRoute {
  path: CrowdZone[];
  distance_m: number;
  eta_min: number;
  max_density: number;
  avoided: CrowdZone[];
  shortest: { path: CrowdZone[]; distance_m: number; eta_min: number; max_density: number } | null;
}

export function suggestRoute(zones: CrowdZone[], edges: CrowdEdge[], fromId: string, toId: string, opts: { avoidCritical?: boolean } = {}): LocalRoute | null {
  const byId = new Map(zones.map((z) => [z.id, z]));
  if (!byId.has(fromId) || !byId.has(toId)) return null;
  const adj = new Map<string, CrowdEdge[]>();
  for (const e of edges) adj.set(e.from_zone, [...(adj.get(e.from_zone) ?? []), e]);

  const run = (cost: (e: CrowdEdge, to: CrowdZone) => number, exclude: (z: CrowdZone) => boolean) => {
    const dist = new Map<string, number>([[fromId, 0]]);
    const prev = new Map<string, string>();
    const done = new Set<string>();
    for (;;) {
      let cur: string | null = null;
      let best = Infinity;
      for (const [id, d] of dist) if (!done.has(id) && d < best) [best, cur] = [d, id];
      if (cur === null || cur === toId) break;
      done.add(cur);
      for (const e of adj.get(cur) ?? []) {
        const to = byId.get(e.to_zone);
        if (!to || done.has(to.id) || (to.id !== toId && exclude(to))) continue;
        const nd = best + cost(e, to);
        if (nd < (dist.get(to.id) ?? Infinity)) {
          dist.set(to.id, nd);
          prev.set(to.id, cur);
        }
      }
    }
    if (!dist.has(toId)) return null;
    const path: CrowdZone[] = [];
    let c: string | undefined = toId;
    while (c) {
      path.unshift(byId.get(c)!);
      if (c === fromId) break;
      c = prev.get(c);
    }
    return path;
  };

  const summarize = (path: CrowdZone[]) => {
    let distance = 0;
    let eta = 0;
    let max = 0;
    for (let i = 1; i < path.length; i++) {
      const e = (adj.get(path[i - 1].id) ?? []).find((x) => x.to_zone === path[i].id);
      const d = e?.distance_m ?? 0;
      distance += d;
      eta += d / walkingSpeed(path[i].density);
      max = Math.max(max, path[i].density);
    }
    return { distance_m: distance, eta_min: Math.round(eta), max_density: Math.round(max * 100) / 100 };
  };

  const congestion = (e: CrowdEdge, to: CrowdZone) => e.distance_m / walkingSpeed(to.density) + (to.density >= 0.9 ? 40 : to.density >= 0.65 ? 8 : 0);
  let path = run(congestion, (z) => (opts.avoidCritical ?? true) && z.density >= 0.9);
  if (!path) path = run(congestion, () => false);
  if (!path) return null;
  const shortest = run((e) => e.distance_m, () => false);
  const ids = new Set(path.map((p) => p.id));
  return {
    path,
    ...summarize(path),
    avoided: zones.filter((z) => z.density >= 0.9 && !ids.has(z.id) && z.id !== fromId && z.id !== toId),
    shortest: shortest ? { path: shortest, ...summarize(shortest) } : null,
  };
}
