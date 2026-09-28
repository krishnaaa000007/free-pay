/** Time formatting helpers (display only). */

export function relativeTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '—';
  const diff = now.getTime() - Date.parse(iso);
  const abs = Math.abs(diff);
  const future = diff < 0;
  const s = Math.round(abs / 1000);
  if (s < 45) return future ? 'in a moment' : 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return future ? `in ${m} min` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return future ? `in ${h} h` : `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return future ? `in ${d} d` : `${d} d ago`;
  return formatDate(iso);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

export function countdown(untilIso: string, now = new Date()): { expired: boolean; label: string; totalSeconds: number } {
  const ms = Date.parse(untilIso) - now.getTime();
  if (ms <= 0) return { expired: true, label: '00:00', totalSeconds: 0 };
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return { expired: false, label: `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, totalSeconds: total };
}

export function isSameLocalDay(aIso: string, bIso: string): boolean {
  const a = new Date(aIso);
  const b = new Date(bIso);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Group by day label for lists. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d >= today) return 'Today';
  if (d >= yesterday) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
}
