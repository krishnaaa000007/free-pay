import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { Merchant, SignedWalletCertificate, User } from '../domain/types';
import { ApiError, get, post } from '../services/api';
import { openLedger, type Ledger } from '../services/ledger';
import { toast } from '../services/notifications';
import { loadWalletCertificate, provisionDevice, refreshCredential as refreshCredentialApi, refreshPlatformKey, getPlatformPublicKey } from '../services/payment';
import { clearSession, prefGet, prefSet, secureGet, secureSet } from '../services/storage';

/**
 * Session state. Persisted so the app opens straight into the signed-in experience even
 * with no network: the JWT, cached profile and wallet certificate all live on-device.
 */
export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface RegisterInput {
  name: string;
  phone: string;
  password: string;
  role: 'PILGRIM' | 'VENDOR';
  language: string;
  stall?: { name: string; category: string };
}

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  merchant: Merchant | null;
  ledger: Ledger | null;
  credential: SignedWalletCertificate | null;
  login: (phone: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshCredential: () => Promise<SignedWalletCertificate | null>;
  updateProfile: (patch: { name?: string; language?: string }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface LoginResponse {
  token: string;
  user: User;
  merchant: Merchant | null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [credential, setCredential] = useState<SignedWalletCertificate | null>(null);
  const bootstrapped = useRef(false);

  const ensureLedger = useCallback(async (u: User) => {
    const l = await openLedger(u.id);
    setLedger(l);
    return l;
  }, []);

  /** Register the device key (and fetch a wallet certificate for pilgrims). Non-fatal when offline. */
  const provision = useCallback(async (u: User) => {
    try {
      if (!(await getPlatformPublicKey())) await refreshPlatformKey();
      const r = await provisionDevice(Platform.OS, Platform.select({ ios: 'iPhone', android: 'Android', default: 'Web' }));
      if (u.role === 'PILGRIM' && r.credential) setCredential(r.credential);
    } catch {
      // Offline at sign-in: fall back to whatever credential is already on the device.
      setCredential(await loadWalletCertificate());
    }
  }, []);

  const adopt = useCallback(
    async (r: LoginResponse) => {
      await secureSet('token', r.token);
      await prefSet('user', r.user);
      if (r.merchant) await prefSet('merchant', r.merchant);
      setUser(r.user);
      setMerchant(r.merchant ?? null);
      await ensureLedger(r.user);
      await provision(r.user);
      setStatus('signedIn');
      return r.user;
    },
    [ensureLedger, provision],
  );

  // Bootstrap from device storage.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      const token = await secureGet('token');
      const cachedUser = await prefGet<User>('user', true);
      if (!token || !cachedUser) {
        setStatus('signedOut');
        return;
      }
      setUser(cachedUser);
      setMerchant(await prefGet<Merchant>('merchant', true));
      setCredential(await loadWalletCertificate());
      await ensureLedger(cachedUser);
      setStatus('signedIn');
      // Best-effort refresh; ignore failures (offline).
      try {
        const me = await get<{ user: User; merchant: Merchant | null }>('/api/auth/me');
        setUser(me.user);
        setMerchant(me.merchant ?? null);
        await prefSet('user', me.user);
        if (me.merchant) await prefSet('merchant', me.merchant);
        // Whenever we have signal, re-assert this device's key and top up the wallet
        // credential. The call is an idempotent upsert, and an offline-first wallet should
        // never pass up a chance to refresh a credential that expires in 10 days. It also
        // heals a device whose registration the server no longer has.
        await provision(me.user);
      } catch (err) {
        if (err instanceof ApiError && err.isAuth) {
          await clearSession();
          setStatus('signedOut');
          setUser(null);
        }
      }
    })();
  }, [ensureLedger, provision]);

  const login = useCallback(
    async (phone: string, password: string) => {
      const r = await post<LoginResponse>('/api/auth/login', { phone, password }, { auth: false });
      return adopt(r);
    },
    [adopt],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const r = await post<LoginResponse>('/api/auth/register', input, { auth: false });
      return adopt(r);
    },
    [adopt],
  );

  const logout = useCallback(async () => {
    await clearSession();
    setUser(null);
    setMerchant(null);
    setLedger(null);
    setCredential(null);
    setStatus('signedOut');
  }, []);

  const refreshProfile = useCallback(async () => {
    const me = await get<{ user: User; merchant: Merchant | null }>('/api/auth/me');
    setUser(me.user);
    setMerchant(me.merchant ?? null);
    await prefSet('user', me.user);
    if (me.merchant) await prefSet('merchant', me.merchant);
  }, []);

  const refreshCredential = useCallback(async () => {
    try {
      const c = await refreshCredentialApi();
      setCredential(c);
      toast.success('Wallet credential refreshed', `Valid until ${new Date(c.cert.expires_at).toLocaleDateString('en-IN')}`, 'cred');
      return c;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Device not registered yet (e.g. first sign-in happened offline).
        if (user) await provision(user);
        return loadWalletCertificate();
      }
      throw err;
    }
  }, [provision, user]);

  const updateProfile = useCallback(async (patchBody: { name?: string; language?: string }) => {
    const r = await (await import('../services/api')).patch<{ user: User }>('/api/auth/profile', patchBody);
    setUser(r.user);
    await prefSet('user', r.user);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, merchant, ledger, credential, login, register, logout, refreshProfile, refreshCredential, updateProfile }),
    [status, user, merchant, ledger, credential, login, register, logout, refreshProfile, refreshCredential, updateProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
