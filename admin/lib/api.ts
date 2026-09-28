import { clearSession, getToken } from './auth';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Bearer-authenticated JSON fetch. A 401 clears the session and bounces to /login. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const token = getToken();
  if (init.auth !== false && token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'NETWORK', `Cannot reach the API at ${API_URL}`);
  }
  const text = await res.text();
  let json: { error?: { code?: string; message?: string } } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    if (res.status === 401 && init.auth !== false && typeof window !== 'undefined') {
      clearSession();
      window.location.href = '/login';
    }
    throw new ApiError(res.status, json?.error?.code ?? `HTTP_${res.status}`, json?.error?.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}
