/**
 * Money helpers. Everything internal is integer paise; formatting is for display only.
 */
export const INR = (rupees: number) => Math.round(rupees * 100);

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/** "₹1,23,456" style Indian grouping. */
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

export interface FormatOptions {
  /** Show paise when non-zero (default true). */
  showPaise?: boolean;
  /** Prefix symbol (default ₹). */
  symbol?: string;
  /** Compact lakhs/crores for big numbers. */
  compact?: boolean;
}

export function formatINR(paise: number, opts: FormatOptions = {}): string {
  const { showPaise = true, symbol = '₹', compact = false } = opts;
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;

  if (compact) {
    if (rupees >= 1_00_00_000) return `${sign}${symbol}${trim((rupees / 1_00_00_000).toFixed(2))} Cr`;
    if (rupees >= 1_00_000) return `${sign}${symbol}${trim((rupees / 1_00_000).toFixed(2))} L`;
    if (rupees >= 10_000) return `${sign}${symbol}${trim((rupees / 1000).toFixed(1))}k`;
  }
  const body = groupIndian(String(rupees));
  return `${sign}${symbol}${body}${showPaise && p > 0 ? '.' + String(p).padStart(2, '0') : ''}`;
}

const trim = (s: string) => s.replace(/\.?0+$/, '');

/** Parse keypad input like "120.5" into paise; returns null if not a valid amount. */
export function parseAmountInput(input: string): number | null {
  const cleaned = input.replace(/[^\d.]/g, '');
  if (!cleaned || cleaned === '.') return null;
  const [r, p = ''] = cleaned.split('.');
  if (p.length > 2) return null;
  const rupees = Number(r || '0');
  const paise = Number((p + '00').slice(0, 2));
  if (!Number.isFinite(rupees) || !Number.isFinite(paise)) return null;
  return rupees * 100 + paise;
}
