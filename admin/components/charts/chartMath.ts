/**
 * Pure geometry for the dependency-free SVG charts. Every function here is unit-tested;
 * the React components only lay out what these return.
 */
export interface Scale {
  (v: number): number;
  domain: [number, number];
  range: [number, number];
}

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const fn = ((v: number) => r0 + ((v - d0) / span) * (r1 - r0)) as Scale;
  fn.domain = domain;
  fn.range = range;
  return fn;
}

/** "Nice" axis ticks: 1/2/5 steps, always including zero when the data does. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const rough = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export function niceMax(max: number, count = 4): number {
  const t = niceTicks(max, count);
  return t[t.length - 1];
}

/** Catmull-Rom -> cubic Bezier smoothing for line/area charts (tension 0 = straight). */
export function smoothPath(points: Array<[number, number]>, tension = 0.5): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  let d = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2;
    d += ` C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

export function areaPath(linePath: string, firstX: number, lastX: number, baselineY: number): string {
  if (!linePath) return '';
  return `${linePath} L${f(lastX)},${f(baselineY)} L${f(firstX)},${f(baselineY)} Z`;
}

/** SVG arc for a donut segment (angles in radians, 0 = 12 o'clock, clockwise). */
export function donutSegment(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number): string {
  const sweep = end - start;
  if (sweep <= 0) return '';
  const large = sweep > Math.PI ? 1 : 0;
  const p = (r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [ax, ay] = p(rOuter, start);
  const [bx, by] = p(rOuter, end);
  const [cx2, cy2] = p(rInner, end);
  const [dx, dy] = p(rInner, start);
  return `M${f(ax)},${f(ay)} A${rOuter},${rOuter} 0 ${large} 1 ${f(bx)},${f(by)} L${f(cx2)},${f(cy2)} A${rInner},${rInner} 0 ${large} 0 ${f(dx)},${f(dy)} Z`;
}

/** Turn values into donut angle ranges (with a small gap between slices). */
export function donutAngles(values: number[], gapRad = 0.03): Array<{ start: number; end: number; frac: number }> {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => ({ start: 0, end: 0, frac: 0 }));
  let acc = 0;
  return values.map((v) => {
    const frac = v / total;
    const start = acc * Math.PI * 2;
    acc += frac;
    const end = acc * Math.PI * 2;
    const g = values.length > 1 ? Math.min(gapRad, (end - start) / 2) : 0;
    return { start: start + g / 2, end: end - g / 2, frac };
  });
}

/** Bar with 4px rounded data-end and a square baseline (horizontal or vertical). */
export function roundedBarPath(x: number, y: number, w: number, h: number, orient: 'v' | 'h', r = 4): string {
  if (w <= 0 || h <= 0) return '';
  if (orient === 'v') {
    const rr = Math.min(r, w / 2, h);
    return `M${f(x)},${f(y + h)} L${f(x)},${f(y + rr)} Q${f(x)},${f(y)} ${f(x + rr)},${f(y)} L${f(x + w - rr)},${f(y)} Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + rr)} L${f(x + w)},${f(y + h)} Z`;
  }
  const rr = Math.min(r, h / 2, w);
  return `M${f(x)},${f(y)} L${f(x + w - rr)},${f(y)} Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + rr)} L${f(x + w)},${f(y + h - rr)} Q${f(x + w)},${f(y + h)} ${f(x + w - rr)},${f(y + h)} L${f(x)},${f(y + h)} Z`;
}

/** Stack rows into cumulative segments: [[a,b,c], ...] -> per row [{start,end}...]. */
export function stackSeries(rows: number[][]): Array<Array<{ start: number; end: number }>> {
  return rows.map((row) => {
    let acc = 0;
    return row.map((v) => {
      const start = acc;
      acc += Math.max(0, v);
      return { start, end: acc };
    });
  });
}

/** Pick evenly spaced label indices so x-axis labels never collide. */
export function labelIndices(count: number, maxLabels: number): number[] {
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil(count / maxLabels);
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  if (out[out.length - 1] !== count - 1) out.push(count - 1);
  return out;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();
