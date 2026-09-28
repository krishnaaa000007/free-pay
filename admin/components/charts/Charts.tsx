'use client';
import React, { useId, useMemo, useState } from 'react';
import { areaPath, donutAngles, donutSegment, labelIndices, linearScale, niceMax, niceTicks, roundedBarPath, smoothPath, stackSeries } from './chartMath';

/**
 * Dependency-free SVG charts following the dataviz method: thin marks, 4px rounded data
 * ends, 2px lines, >=8px markers with a surface ring, 10% area wash, recessive hairline
 * grid, legends for >= 2 series, selective direct labels, hover tooltips on every form.
 */
export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
const INK = 'var(--ink-soft)';
const MUTED = 'var(--muted)';
const GRID = 'var(--hairline)';
const SURFACE = 'var(--surface)';

interface Tip {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="tooltip" style={{ left: tip.x, top: tip.y }}>
      <b>{tip.title}</b>
      {tip.lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  if (items.length < 2) return null;
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <i style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Area / line chart (one or more series over a categorical x)          */
/* ------------------------------------------------------------------ */
export interface Series {
  name: string;
  values: number[];
  color?: string;
}

export function AreaChart({ labels, series, height = 220, format = (v) => String(v), maxLabels = 8, area = true }: { labels: string[]; series: Series[]; height?: number; format?: (v: number) => string; maxLabels?: number; area?: boolean }) {
  const id = useId();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 720;
  const pad = { l: 52, r: 16, t: 14, b: 30 };
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = linearScale([0, Math.max(1, labels.length - 1)], [pad.l, pad.l + iw]);
  const y = linearScale([0, max], [pad.t + ih, pad.t]);
  const ticks = niceTicks(max);
  const paths = useMemo(
    () =>
      series.map((s) => {
        const pts = s.values.map((v, i) => [x(i), y(v)] as [number, number]);
        const line = smoothPath(pts, 0.5);
        return { line, area: areaPath(line, pts[0]?.[0] ?? 0, pts[pts.length - 1]?.[0] ?? 0, y(0)), pts };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, labels.length, max],
  );
  const shown = labelIndices(labels.length, maxLabels);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.max(0, Math.min(labels.length - 1, Math.round(((px - pad.l) / iw) * (labels.length - 1))));
    setHoverIdx(idx);
    setTip({ x: ((x(idx) / W) * rect.width), y: (pad.t / height) * rect.height, title: labels[idx], lines: series.map((s) => `${s.name}: ${format(s.values[idx] ?? 0)}`) });
  };

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} onMouseMove={onMove} onMouseLeave={() => { setTip(null); setHoverIdx(null); }} role="img" aria-label={series.map((s) => s.name).join(', ')}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`${id}-g${i}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color ?? SERIES[i]} stopOpacity={0.18} />
              <stop offset="100%" stopColor={s.color ?? SERIES[i]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} fontSize={11} fill={MUTED} textAnchor="end" className="tnum">
              {format(t)}
            </text>
          </g>
        ))}
        {shown.map((i) => (
          <text key={i} x={x(i)} y={height - 8} fontSize={11} fill={MUTED} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>
            {labels[i]}
          </text>
        ))}
        {paths.map((p, i) => (
          <g key={i}>
            {area ? <path d={p.area} fill={`url(#${id}-g${i})`} /> : null}
            <path d={p.line} fill="none" stroke={series[i].color ?? SERIES[i]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {hoverIdx !== null ? (
          <g>
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={pad.t} y2={pad.t + ih} stroke={INK} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
            {series.map((s, i) => (
              <circle key={i} cx={x(hoverIdx)} cy={y(s.values[hoverIdx] ?? 0)} r={5} fill={s.color ?? SERIES[i]} stroke={SURFACE} strokeWidth={2} />
            ))}
          </g>
        ) : (
          series.map((s, i) => {
            const last = s.values.length - 1;
            return last >= 0 ? <circle key={i} cx={x(last)} cy={y(s.values[last])} r={4} fill={s.color ?? SERIES[i]} stroke={SURFACE} strokeWidth={2} /> : null;
          })
        )}
      </svg>
      <Tooltip tip={tip} />
      <Legend items={series.map((s, i) => ({ label: s.name, color: s.color ?? SERIES[i] }))} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Donut                                                                 */
/* ------------------------------------------------------------------ */
export function DonutChart({ slices, format = (v) => String(v), centerLabel, centerValue, size = 200 }: { slices: Array<{ label: string; value: number; color?: string }>; format?: (v: number) => string; centerLabel?: string; centerValue?: string; size?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const angles = donutAngles(slices.map((s) => s.value));
  const total = slices.reduce((a, s) => a + s.value, 0);
  const c = size / 2;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Share by category">
        {slices.map((s, i) => (
          <path
            key={s.label}
            d={donutSegment(c, c, c - 4, c * 0.62, angles[i].start, angles[i].end)}
            fill={s.color ?? SERIES[i % SERIES.length]}
            opacity={active === null || active === i ? 1 : 0.35}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            style={{ transition: 'opacity .15s' }}
          />
        ))}
        <text x={c} y={c - 4} textAnchor="middle" fontSize={22} fontWeight={700} fill="var(--ink)">
          {active !== null ? `${Math.round(angles[active].frac * 100)}%` : centerValue ?? format(total)}
        </text>
        <text x={c} y={c + 16} textAnchor="middle" fontSize={11} fill={MUTED}>
          {active !== null ? slices[active].label : centerLabel ?? 'total'}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 180 }}>
        {slices.map((s, i) => (
          <div key={s.label} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto auto', gap: 8, alignItems: 'center', fontSize: 13, opacity: active === null || active === i ? 1 : 0.5 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: s.color ?? SERIES[i % SERIES.length] }} />
            <span>{s.label}</span>
            <span className="tnum" style={{ fontWeight: 600 }}>
              {format(s.value)}
            </span>
            <span className="muted tnum" style={{ width: 40, textAlign: 'right' }}>
              {total ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Horizontal bars                                                       */
/* ------------------------------------------------------------------ */
export function HBarChart({ items, format = (v) => String(v), color = SERIES[0], barHeight = 18, labelWidth = 150 }: { items: Array<{ label: string; value: number; hint?: string }>; format?: (v: number) => string; color?: string; barHeight?: number; labelWidth?: number }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const W = 720;
  const rowH = barHeight + 14;
  const H = items.length * rowH + 6;
  const max = niceMax(Math.max(1, ...items.map((i) => i.value)));
  const x = linearScale([0, max], [labelWidth, W - 70]);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ranked bars" onMouseLeave={() => setTip(null)}>
        {items.map((it, i) => {
          const yTop = i * rowH + 3;
          return (
            <g key={it.label} onMouseMove={(e) => { const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: (yTop / H) * r.height, title: it.label, lines: [format(it.value), ...(it.hint ? [it.hint] : [])] }); }}>
              <rect x={0} y={yTop - 3} width={W} height={rowH} fill="transparent" />
              <text x={labelWidth - 10} y={yTop + barHeight / 2 + 4} fontSize={12} fill={INK} textAnchor="end">
                {it.label.length > 22 ? it.label.slice(0, 21) + '…' : it.label}
              </text>
              <rect x={labelWidth} y={yTop} width={W - 70 - labelWidth} height={barHeight} fill={GRID} rx={0} />
              <path d={roundedBarPath(labelWidth, yTop, Math.max(0, x(it.value) - labelWidth), barHeight, 'h')} fill={color} />
              <text x={x(it.value) + 8} y={yTop + barHeight / 2 + 4} fontSize={12} fill={INK} className="tnum">
                {format(it.value)}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stacked columns                                                       */
/* ------------------------------------------------------------------ */
export function StackedBarChart({ labels, series, height = 220, format = (v) => String(v) }: { labels: string[]; series: Series[]; height?: number; format?: (v: number) => string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const W = 720;
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const rows = labels.map((_, i) => series.map((s) => s.values[i] ?? 0));
  const stacks = stackSeries(rows);
  const max = niceMax(Math.max(1, ...stacks.map((r) => r[r.length - 1]?.end ?? 0)));
  const y = linearScale([0, max], [pad.t + ih, pad.t]);
  const slot = iw / Math.max(1, labels.length);
  const bw = Math.min(24, slot * 0.6);
  const ticks = niceTicks(max);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Stacked columns" onMouseLeave={() => setTip(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} fontSize={11} fill={MUTED} textAnchor="end" className="tnum">
              {format(t)}
            </text>
          </g>
        ))}
        {labels.map((label, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={label} onMouseMove={(e) => { const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect(); setTip({ x: (cx / W) * r.width, y: (y(stacks[i][stacks[i].length - 1]?.end ?? 0) / height) * r.height, title: label, lines: series.map((s, k) => `${s.name}: ${format(rows[i][k])}`) }); }}>
              <rect x={cx - slot / 2} y={pad.t} width={slot} height={ih} fill="transparent" />
              {stacks[i].map((seg, k) => {
                const top = y(seg.end);
                const h = y(seg.start) - top;
                if (h <= 0) return null;
                const isTop = k === stacks[i].findLastIndex((s2) => s2.end - s2.start > 0);
                return isTop ? (
                  <path key={k} d={roundedBarPath(cx - bw / 2, top, bw, Math.max(0, h - 2), 'v')} fill={series[k].color ?? SERIES[k]} />
                ) : (
                  <rect key={k} x={cx - bw / 2} y={top} width={bw} height={Math.max(0, h - 2)} fill={series[k].color ?? SERIES[k]} />
                );
              })}
              <text x={cx} y={height - 8} fontSize={11} fill={MUTED} textAnchor="middle">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
      <Legend items={series.map((s, i) => ({ label: s.name, color: s.color ?? SERIES[i] }))} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Progress rows (settlement pipeline per vendor)                         */
/* ------------------------------------------------------------------ */
export function ProgressRows({ rows, segments, format = (v) => String(v) }: { rows: Array<{ label: string; values: number[] }>; segments: Array<{ name: string; color: string }>; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.values.reduce((a, b) => a + b, 0)));
  return (
    <div className="progress">
      {rows.map((r) => {
        const total = r.values.reduce((a, b) => a + b, 0);
        return (
          <div key={r.label} className="progress-row">
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>
              {r.label}
            </span>
            <div className="progress-track" title={segments.map((s, i) => `${s.name}: ${format(r.values[i])}`).join(' · ')}>
              {r.values.map((v, i) => (v > 0 ? <div key={i} className="progress-seg" style={{ width: `${(v / max) * 100}%`, background: segments[i].color }} /> : null))}
            </div>
            <span className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>
              {format(total)}
            </span>
          </div>
        );
      })}
      <Legend items={segments.map((s) => ({ label: s.name, color: s.color }))} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sparkline                                                              */
/* ------------------------------------------------------------------ */
export function Sparkline({ data, width = 84, height = 28, color = SERIES[0] }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const x = linearScale([0, data.length - 1], [2, width - 2]);
  const y = linearScale([0, max], [height - 3, 3]);
  const pts = data.map((v, i) => [x(i), y(v)] as [number, number]);
  const line = smoothPath(pts, 0.4);
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={areaPath(line, pts[0][0], last[0], height)} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} stroke={SURFACE} strokeWidth={1.5} />
    </svg>
  );
}
