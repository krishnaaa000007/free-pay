/** Display formatting helpers (pure, unit-tested). */

export function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  let rest = intPart.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return parts.join(',') + ',' + last3;
}

/** Paise -> "₹1,23,456" (optionally compact: ₹4.8 L / ₹1.2 Cr). */
export function inr(paise: number, opts: { compact?: boolean; paise?: boolean } = {}): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  if (opts.compact) {
    if (rupees >= 1_00_00_000) return `${sign}₹${trim((rupees / 1_00_00_000).toFixed(2))} Cr`;
    if (rupees >= 1_00_000) return `${sign}₹${trim((rupees / 1_00_000).toFixed(2))} L`;
    if (rupees >= 10_000) return `${sign}₹${trim((rupees / 1000).toFixed(1))}k`;
  }
  return `${sign}₹${groupIndian(String(rupees))}${opts.paise && p ? '.' + String(p).padStart(2, '0') : ''}`;
}
const trim = (s: string) => s.replace(/\.?0+$/, '');

export function num(n: number): string {
  return groupIndian(String(Math.round(n)));
}

export function compactNum(n: number): string {
  if (n >= 1_00_000) return `${trim((n / 1_00_000).toFixed(1))}L`;
  if (n >= 1000) return `${trim((n / 1000).toFixed(1))}k`;
  return String(Math.round(n));
}

export function pct(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = now - Date.parse(iso);
  const s = Math.round(Math.abs(diff) / 1000);
  const future = diff < 0;
  const fmt = (v: number, u: string) => (future ? `in ${v} ${u}` : `${v} ${u} ago`);
  if (s < 45) return future ? 'in a moment' : 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return fmt(m, 'min');
  const h = Math.round(m / 60);
  if (h < 24) return fmt(h, 'h');
  const d = Math.round(h / 24);
  if (d < 14) return fmt(d, 'd');
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function shortId(id: string | null | undefined): string {
  return (id ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();
}

export function minutes(n: number): string {
  if (n < 1) return '< 1 min';
  if (n < 60) return `${Math.round(n)} min`;
  return `${(n / 60).toFixed(1)} h`;
}

/** Format a metric by its declared unit. */
export function formatMetric(value: number, format: 'inr' | 'int' | 'pct' | 'min'): string {
  switch (format) {
    case 'inr':
      return inr(value, { compact: value >= 10_000_00 });
    case 'pct':
      return pct(value, value % 1 ? 1 : 0);
    case 'min':
      return minutes(value);
    default:
      return num(value);
  }
}
