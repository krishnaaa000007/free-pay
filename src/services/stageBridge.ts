import { appConfig } from '../domain/config';

/**
 * Demo bridge — stands in for the camera when a demo is presented on a desktop.
 *
 * Two transports, either or both active:
 *
 *  1. **Stage postMessage** — when the app runs inside the two-phone stage page
 *     (`/stage.html`), the stage relays messages between its two iframes.
 *  2. **Server relay** — when `EXPO_PUBLIC_DEMO_RELAY=1`, windows publish to and poll
 *     `/api/demo/relay`. This is what makes a two-window / two-monitor demo work, where
 *     no camera can see the other screen.
 *
 * What travels is the EXACT QR string a camera would read. Every signature check, expiry
 * check, limit and fraud rule runs unchanged. On a phone (relay off, not embedded) this
 * module is inert and the real camera is used.
 */
export type StageKind = 'MERCHANT' | 'QR' | 'RECEIPT' | 'NETWORK' | 'HELLO';

export type StageMessage =
  | { source: 'freepay'; kind: 'MERCHANT'; payload: string }
  | { source: 'freepay'; kind: 'QR'; payload: string }
  | { source: 'freepay'; kind: 'RECEIPT'; payload: string }
  | { source: 'freepay'; kind: 'NETWORK'; offline: boolean }
  | { source: 'freepay'; kind: 'HELLO'; role?: string };

/** True only when running in a browser inside the stage page's iframe. */
export const isStageEmbedded = (): boolean => {
  try {
    return typeof window !== 'undefined' && !!window.parent && window.parent !== window;
  } catch {
    return false;
  }
};

/** True when the server-backed relay is switched on for this build. */
export const isRelayEnabled = (): boolean => appConfig.demoRelay;

/** Any demo transport available? Screens use this to label themselves honestly. */
export const isDemoBridgeActive = (): boolean => isStageEmbedded() || isRelayEnabled();

/* ------------------------------------------------------------------ */
/* Transport 1: the stage page                                          */
/* ------------------------------------------------------------------ */
function sendToStage(message: StageMessage) {
  if (!isStageEmbedded()) return;
  try {
    window.parent.postMessage(message, '*');
  } catch {
    /* stage not listening */
  }
}

/* ------------------------------------------------------------------ */
/* Transport 2: the server relay                                        */
/* ------------------------------------------------------------------ */
type PayloadKind = 'MERCHANT' | 'QR' | 'RECEIPT';
type Handler = (payload: string) => void;

interface RelayFeed {
  seq: number;
  items: Array<{ seq: number; kind: PayloadKind; payload: string }>;
}

const handlers = new Map<PayloadKind, Set<Handler>>();
const ownSeqs = new Set<number>(); // items this window published — never handle our own
let since = -1; // -1 = not yet primed
let polling: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 1200;
const BROADCAST_MS = 2000;

async function relayPost(kind: PayloadKind, payload: string) {
  if (!isRelayEnabled()) return;
  try {
    const { post } = await import('./api');
    const r = await post<{ seq: number }>('/api/demo/relay', { kind, payload });
    ownSeqs.add(r.seq);
  } catch {
    /* relay is a presentation aid: never let it break a payment */
  }
}

async function relayPoll() {
  const kinds = [...handlers.keys()].filter((k) => (handlers.get(k)?.size ?? 0) > 0);
  if (kinds.length === 0) return;
  try {
    const { get } = await import('./api');
    const priming = since < 0;
    const r = await get<RelayFeed>('/api/demo/relay', { since: priming ? 0 : since, kinds: kinds.join(',') });
    // The first poll only moves the cursor to "now", so opening a screen never replays a
    // code that was on the wall five minutes ago.
    if (priming) {
      since = r.seq;
      return;
    }
    for (const item of r.items) {
      since = Math.max(since, item.seq);
      if (ownSeqs.has(item.seq)) continue; // our own QR, bounced back by the feed
      for (const h of handlers.get(item.kind) ?? []) h(item.payload);
    }
  } catch {
    /* offline, or DEMO_MODE off on the server: stay quiet */
  }
}

function ensurePolling() {
  if (!isRelayEnabled() || polling) return;
  polling = setInterval(() => void relayPoll(), POLL_MS);
  void relayPoll();
}

function maybeStopPolling() {
  const active = [...handlers.values()].some((s) => s.size > 0);
  if (!active && polling) {
    clearInterval(polling);
    polling = null;
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */
function publish(kind: PayloadKind, payload: string) {
  sendToStage({ source: 'freepay', kind, payload } as StageMessage);
  void relayPost(kind, payload);
}

/** A vendor is displaying its stall QR (vendor -> pilgrim). */
export const publishMerchantQr = (payload: string) => publish('MERCHANT', payload);
/** A pilgrim is displaying a payment code (pilgrim -> vendor). */
export const publishQr = (payload: string) => publish('QR', payload);
/** A vendor issued a signed receipt (vendor -> pilgrim). */
export const publishReceipt = (payload: string) => publish('RECEIPT', payload);

/**
 * Keep announcing a payload for as long as it is on screen, the way a QR taped to a stall
 * is continuously there for anyone who points a camera at it. Without this, a code shown
 * *before* the other window opened its scanner would never be picked up, because a fresh
 * subscriber starts reading the feed from "now". Returns a stop function.
 */
export function startBroadcast(kind: PayloadKind, payload: string): () => void {
  publish(kind, payload);
  const timer = setInterval(() => publish(kind, payload), BROADCAST_MS);
  return () => clearInterval(timer);
}

/** Tell the stage which role this window is showing (drives its header labels). */
export const announceRole = (role: string) => sendToStage({ source: 'freepay', kind: 'HELLO', role });

/**
 * Subscribe to one kind of demo message over whichever transports are active.
 * Returns an unsubscribe function; safe to call when no transport is available.
 */
export function subscribe<K extends StageKind>(kind: K, handler: (m: Extract<StageMessage, { kind: K }>) => void): () => void {
  const cleanups: Array<() => void> = [];
  // A broadcast repeats the same string every couple of seconds; act on each distinct code
  // once. Re-entering a screen makes a new subscription, so the same stall QR is picked up
  // again on the next visit.
  const handled = new Set<string>();
  const once = (payload: string, m: Extract<StageMessage, { kind: K }>) => {
    if (handled.has(payload)) return;
    handled.add(payload);
    handler(m);
  };

  if (isStageEmbedded()) {
    const listener = (event: MessageEvent) => {
      const data = event.data as StageMessage | undefined;
      if (!data || data.source !== 'freepay' || data.kind !== kind) return;
      const m = data as Extract<StageMessage, { kind: K }>;
      if ('payload' in data) once(data.payload, m);
      else handler(m);
    };
    window.addEventListener('message', listener);
    cleanups.push(() => window.removeEventListener('message', listener));
  }

  // NETWORK / HELLO are stage-only: the relay needs connectivity, which is exactly what
  // a "cut the network" message would be turning off.
  if (isRelayEnabled() && (kind === 'MERCHANT' || kind === 'QR' || kind === 'RECEIPT')) {
    const k = kind as PayloadKind;
    const wrapped: Handler = (payload) => once(payload, { source: 'freepay', kind: k, payload } as Extract<StageMessage, { kind: K }>);
    if (!handlers.has(k)) handlers.set(k, new Set());
    handlers.get(k)!.add(wrapped);
    ensurePolling();
    cleanups.push(() => {
      handlers.get(k)?.delete(wrapped);
      maybeStopPolling();
    });
  }

  return () => cleanups.forEach((c) => c());
}
