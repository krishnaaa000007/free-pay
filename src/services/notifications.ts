/**
 * In-app notification bus. Screens/services publish; the NotificationToaster renders.
 * Pure TypeScript with no native imports so it is fully unit-testable; haptics/sound are
 * attached by the toaster component at render time.
 */
export type NotificationKind = 'success' | 'info' | 'warning' | 'error' | 'sync';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  message?: string;
  createdAt: number;
  /** Auto-dismiss after ms; 0 = sticky until dismissed. */
  ttlMs: number;
  /** Optional dedupe key: a newer notification replaces an older one with the same key. */
  key?: string;
  action?: { label: string; onPress: () => void };
}

export type NotificationInput = Omit<AppNotification, 'id' | 'createdAt' | 'ttlMs'> & { ttlMs?: number };

type Listener = (queue: AppNotification[]) => void;

const DEFAULT_TTL: Record<NotificationKind, number> = { success: 3500, info: 4000, warning: 5000, error: 6000, sync: 3500 };
const MAX_VISIBLE = 3;

let queue: AppNotification[] = [];
const listeners = new Set<Listener>();
let seq = 0;

function emit() {
  for (const l of listeners) l(queue);
}

export function notify(input: NotificationInput): string {
  const id = `n${++seq}`;
  const n: AppNotification = { ...input, id, createdAt: Date.now(), ttlMs: input.ttlMs ?? DEFAULT_TTL[input.kind] };
  queue = [...(input.key ? queue.filter((q) => q.key !== input.key) : queue), n].slice(-MAX_VISIBLE);
  emit();
  return id;
}

export function dismiss(id: string) {
  const before = queue.length;
  queue = queue.filter((q) => q.id !== id);
  if (queue.length !== before) emit();
}

export function dismissAll() {
  queue = [];
  emit();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(queue);
  return () => {
    listeners.delete(listener);
  };
}

export function getQueue(): AppNotification[] {
  return queue;
}

/** Drop notifications whose ttl elapsed. Called by the toaster on a timer. */
export function expire(now = Date.now()): number {
  const before = queue.length;
  queue = queue.filter((q) => q.ttlMs === 0 || now - q.createdAt < q.ttlMs);
  if (queue.length !== before) emit();
  return before - queue.length;
}

export const toast = {
  success: (title: string, message?: string, key?: string) => notify({ kind: 'success', title, message, key }),
  info: (title: string, message?: string, key?: string) => notify({ kind: 'info', title, message, key }),
  warning: (title: string, message?: string, key?: string) => notify({ kind: 'warning', title, message, key }),
  error: (title: string, message?: string, key?: string) => notify({ kind: 'error', title, message, key }),
  sync: (title: string, message?: string) => notify({ kind: 'sync', title, message, key: 'sync' }),
};

/** Test helper. */
export function __resetNotifications() {
  queue = [];
  seq = 0;
  listeners.clear();
}
