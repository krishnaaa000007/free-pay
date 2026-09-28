import { computeTrend, densityLevel, suggestRoute, walkingSpeed, type ZoneEdge, type ZoneNode } from '../src/services/crowd.js';
import { issueNgoCredit, verifyNgoCredit } from '../src/services/ngoQr.js';
import { trustScore } from '../src/services/ngoTrust.js';

const zone = (id: string, density: number, x = 0, y = 0): ZoneNode => ({
  id,
  code: id,
  name: id,
  kind: 'AREA',
  lat: 0,
  lng: 0,
  radius_m: 100,
  capacity: 1000,
  map_x: x,
  map_y: y,
  density,
  head_count: Math.round(density * 1000),
  recorded_at: null,
});
const edge = (a: string, b: string, d: number): ZoneEdge[] => [
  { from_zone: a, to_zone: b, distance_m: d },
  { from_zone: b, to_zone: a, distance_m: d },
];

describe('crowd density', () => {
  it('classifies density levels', () => {
    expect(densityLevel(0.1)).toBe('LOW');
    expect(densityLevel(0.5)).toBe('MODERATE');
    expect(densityLevel(0.7)).toBe('HIGH');
    expect(densityLevel(0.95)).toBe('CRITICAL');
  });

  it('walking slows down in dense crowds', () => {
    expect(walkingSpeed(0)).toBeGreaterThan(walkingSpeed(0.8));
    expect(walkingSpeed(1.3)).toBeGreaterThanOrEqual(75 * 0.25);
  });

  it('detects trends from recent readings', () => {
    const t = (d: number[]) => d.map((density, i) => ({ density, recorded_at: new Date(2026, 8, 20, i).toISOString() }));
    expect(computeTrend(t([0.3, 0.4, 0.5]))).toBe('RISING');
    expect(computeTrend(t([0.8, 0.7, 0.6]))).toBe('FALLING');
    expect(computeTrend(t([0.5, 0.51, 0.5]))).toBe('STEADY');
  });
});

describe('route suggestion', () => {
  // A --300-- B(critical) --300-- C
  //  \--500-- D(low)      --500--/
  const zones = [zone('A', 0.2), zone('B', 0.95), zone('C', 0.3), zone('D', 0.1)];
  const edges = [...edge('A', 'B', 300), ...edge('B', 'C', 300), ...edge('A', 'D', 500), ...edge('D', 'C', 500)];

  it('routes around a critical zone even when it is longer', () => {
    const r = suggestRoute(zones, edges, 'A', 'C')!;
    expect(r.path.map((z) => z.id)).toEqual(['A', 'D', 'C']);
    expect(r.distance_m).toBe(1000);
    expect(r.avoided.map((z) => z.id)).toEqual(['B']);
    expect(r.shortest?.path.map((z) => z.id)).toEqual(['A', 'B', 'C']);
    expect(r.max_density).toBeLessThan(0.9);
  });

  it('falls back to the only path when the critical zone is unavoidable', () => {
    const r = suggestRoute(zones, [...edge('A', 'B', 300), ...edge('B', 'C', 300)], 'A', 'C')!;
    expect(r.path.map((z) => z.id)).toEqual(['A', 'B', 'C']);
  });

  it('returns null when zones are unknown or disconnected', () => {
    expect(suggestRoute(zones, edges, 'A', 'Z')).toBeNull();
    expect(suggestRoute(zones, [], 'A', 'C')).toBeNull();
  });
});

describe('NGO trust score', () => {
  it('rewards verified, long-standing NGOs with high redemption', () => {
    const t = trustScore({ verified: true, tenure_years: 15, credits_issued: 640, credits_redeemed: 588, disbursed_total: 48250000, complaints: 1 });
    expect(t.score).toBeGreaterThan(70);
    expect(t.tier).toBe('GOLD');
    expect(t.components).toHaveLength(5);
    const big = trustScore({ verified: true, tenure_years: 15, credits_issued: 640, credits_redeemed: 620, disbursed_total: 400_000_000, complaints: 0 });
    expect(big.tier).toBe('PLATINUM');
  });

  it('puts unverified NGOs with complaints on watch', () => {
    const t = trustScore({ verified: false, tenure_years: 1, credits_issued: 60, credits_redeemed: 31, disbursed_total: 1800000, complaints: 6 });
    expect(t.score).toBeLessThan(50);
    expect(t.tier).toBe('WATCH');
  });

  it('is bounded to 0..100', () => {
    expect(trustScore({ verified: true, tenure_years: 100, credits_issued: 1, credits_redeemed: 1, disbursed_total: 1e12, complaints: 0 }).score).toBe(95);
    expect(trustScore({ verified: false, tenure_years: 0, credits_issued: 0, credits_redeemed: 0, disbursed_total: 0, complaints: 50 }).score).toBe(0);
  });
});

describe('NGO signed credits', () => {
  it('issues a credit that verifies and expires', () => {
    const now = new Date('2026-09-20T08:00:00Z');
    const c = issueNgoCredit({ ngoId: 'n-1', ngoName: 'Annadaan Foundation', amount: 6000, purpose: 'Meal', ttlMs: 3_600_000, now });
    expect(verifyNgoCredit(c, { now }).ok).toBe(true);
    expect(verifyNgoCredit(c, { now: new Date(now.getTime() + 3_600_001) })).toEqual({ ok: false, reason: 'CREDIT_EXPIRED' });
    expect(verifyNgoCredit({ ...c, credit: { ...c.credit, amount: 60000 } }, { now }).reason).toBe('INVALID_SIGNATURE');
  });
});
