/** JWT storage for the dashboard (browser only). */
const KEY = 'freepay.admin.token';
const USER = 'freepay.admin.user';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN';
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(KEY);
}
export function setSession(token: string, user: AdminUser) {
  window.localStorage.setItem(KEY, token);
  window.localStorage.setItem(USER, JSON.stringify(user));
}
export function getUser(): AdminUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER);
    return raw ? (JSON.parse(raw) as AdminUser) : null;
  } catch {
    return null;
  }
}
export function clearSession() {
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(USER);
}
