import { appConfig } from '../domain/config';
import { secureGet } from './storage';

/**
 * Thin fetch wrapper: bearer token, JSON, timeouts and a normalised ApiError. Every
 * network call in the app goes through here so offline handling stays in one place.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
  get isAuth() {
    return this.status === 401;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
  query?: Record<string, string | number | boolean | undefined>;
  /** Explicit bearer token (used by the demo to act as the vendor). */
  token?: string;
}

let baseUrl = appConfig.apiUrl;
export function setApiBaseUrl(url: string) {
  baseUrl = url.replace(/\/$/, '');
}
export function getApiBaseUrl() {
  return baseUrl;
}

/** Demo hook: when the app simulates "offline", every request fails fast like a dead radio. */
let forcedOffline = false;
export function setForcedOffline(v: boolean) {
  forcedOffline = v;
}
export function isForcedOffline() {
  return forcedOffline;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (forcedOffline) throw new ApiError(0, 'NETWORK_SIMULATED_OFFLINE', 'Network is simulated offline');
  const { method = 'GET', body, auth = true, timeoutMs = 15_000, query, token } = opts;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  else if (auth) {
    const stored = await secureGet('token');
    if (stored) headers.authorization = `Bearer ${stored}`;
  }
  const qs = query
    ? '?' +
      Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}${qs}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw new ApiError(0, 'NETWORK', (err as Error)?.name === 'AbortError' ? 'Request timed out' : 'Cannot reach the server');
  }
  clearTimeout(timer);

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return json as T;
}

export const get = <T>(path: string, query?: RequestOptions['query'], opts?: Omit<RequestOptions, 'method' | 'body' | 'query'>) =>
  api<T>(path, { ...opts, method: 'GET', query });
export const post = <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) => api<T>(path, { ...opts, method: 'POST', body });
export const patch = <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) => api<T>(path, { ...opts, method: 'PATCH', body });

/** Cheap reachability probe used by the network provider. */
export async function pingServer(timeoutMs = 4000): Promise<boolean> {
  try {
    await api<{ ok: boolean }>('/health', { auth: false, timeoutMs });
    return true;
  } catch {
    return false;
  }
}
