import { areaPath, donutAngles, donutSegment, labelIndices, linearScale, niceMax, niceTicks, roundedBarPath, smoothPath, stackSeries } from '@/components/charts/chartMath';
import { compactNum, formatMetric, groupIndian, inr, minutes, relativeTime, shortId } from '@/lib/format';

describe('chart math', () => {
  it('linear scale maps domain to range', () => {
    const s = linearScale([0, 100], [0, 500]);
    expect(s(0)).toBe(0);
    expect(s(50)).toBe(250);
    expect(s(100)).toBe(500);
    const flipped = linearScale([0, 10], [200, 0]);
    expect(flipped(10)).toBe(0);
    expect(linearScale([5, 5], [0, 10])(5)).toBe(0);
  });

  it('nice ticks use 1/2/5 steps and cover the max', () => {
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(950)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(niceTicks(0)).toEqual([0]);
    expect(niceMax(31)).toBe(40);
  });

  it('smooth path starts with M and has one cubic per segment', () => {
    const d = smoothPath([[0, 10], [10, 0], [20, 10]]);
    expect(d.startsWith('M0,10')).toBe(true);
    expect((d.match(/ C/g) ?? []).length).toBe(2);
    expect(smoothPath([[3, 4]])).toBe('M3,4');
    expect(smoothPath([])).toBe('');
  });

  it('area path closes to the baseline', () => {
    const d = areaPath('M0,10 C1,1 2,2 20,10', 0, 20, 100);
    expect(d.endsWith('L20,100 L0,100 Z')).toBe(true);
  });

  it('donut angles sum to a full circle and respect gaps', () => {
    const a = donutAngles([1, 1, 2], 0);
    expect(a[2].end).toBeCloseTo(Math.PI * 2, 6);
    expect(a[2].frac).toBe(0.5);
    const gapped = donutAngles([1, 1], 0.1);
    expect(gapped[0].start).toBeCloseTo(0.05, 6);
    expect(donutAngles([0, 0])).toEqual([{ start: 0, end: 0, frac: 0 }, { start: 0, end: 0, frac: 0 }]);
  });

  it('donut segment produces two arcs', () => {
    const d = donutSegment(100, 100, 90, 60, 0, Math.PI / 2);
    expect((d.match(/A/g) ?? []).length).toBe(2);
    expect(d.startsWith('M100,10')).toBe(true);
    expect(donutSegment(0, 0, 1, 0.5, 1, 1)).toBe('');
  });

  it('rounded bars keep a square baseline and rounded data end', () => {
    const v = roundedBarPath(10, 20, 20, 50, 'v');
    expect(v.startsWith('M10,70')).toBe(true);
    expect(v).toContain('Q10,20 14,20');
    const h = roundedBarPath(0, 0, 100, 18, 'h');
    expect(h).toContain('Q100,0 100,4');
    expect(roundedBarPath(0, 0, 0, 10, 'v')).toBe('');
  });

  it('stacks series cumulatively and ignores negatives', () => {
    expect(stackSeries([[1, 2, 3]])).toEqual([[{ start: 0, end: 1 }, { start: 1, end: 3 }, { start: 3, end: 6 }]]);
    expect(stackSeries([[1, -5, 1]])[0][2]).toEqual({ start: 1, end: 2 });
  });

  it('label indices never exceed the budget and keep the last one', () => {
    expect(labelIndices(5, 8)).toEqual([0, 1, 2, 3, 4]);
    const idx = labelIndices(24, 6);
    expect(idx.length).toBeLessThanOrEqual(7);
    expect(idx[idx.length - 1]).toBe(23);
  });
});

describe('format helpers', () => {
  it('formats INR in the Indian grouping', () => {
    expect(groupIndian('1234567')).toBe('12,34,567');
    expect(inr(123456789)).toBe('₹12,34,567');
    expect(inr(123456789, { paise: true })).toBe('₹12,34,567.89');
    expect(inr(48250000, { compact: true })).toBe('₹4.83 L');
    expect(inr(2_50_00_000_00, { compact: true })).toBe('₹2.5 Cr');
    expect(inr(-500)).toBe('-₹5');
  });

  it('formats metrics by unit', () => {
    expect(formatMetric(1234, 'int')).toBe('1,234');
    expect(formatMetric(37.5, 'pct')).toBe('37.5%');
    expect(formatMetric(0.4, 'min')).toBe('< 1 min');
    expect(minutes(95)).toBe('1.6 h');
    expect(compactNum(150000)).toBe('1.5L');
    expect(compactNum(2500)).toBe('2.5k');
  });

  it('relative time and ids', () => {
    const now = Date.parse('2026-09-21T10:00:00Z');
    expect(relativeTime('2026-09-21T09:58:00Z', now)).toBe('2 min ago');
    expect(relativeTime('2026-09-21T10:00:20Z', now)).toBe('in a moment');
    expect(relativeTime(null)).toBe('—');
    expect(shortId('5d4c0c2e-6c3e-4f1b-9d7d-8a6f2f4b1c11')).toBe('5D4C0C2E');
  });
});
