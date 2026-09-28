'use client';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { api, ApiError, API_URL } from '@/lib/api';
import { getToken, setSession, type AdminUser } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@freepay.demo');
  const [password, setPassword] = useState('admin1234');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<'checking' | 'up' | 'down'>('checking');

  useEffect(() => {
    if (getToken()) router.replace('/');
    api<{ ok: boolean; db: string }>('/health/ready', { auth: false })
      .then((r) => setHealth(r.ok ? 'up' : 'down'))
      .catch(() => setHealth('down'));
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: AdminUser }>('/api/auth/admin/login', { method: 'POST', body: { email, password }, auth: false });
      setSession(r.token, r.user);
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-art">
        <div className="brand">
          <div className="brand-mark">F</div>
          <div>
            <div className="brand-name">Free Pay</div>
            <div className="brand-sub">Ops console</div>
          </div>
        </div>
        <div>
          <h1>Payments that keep working when the network does not.</h1>
          <p style={{ opacity: 0.8, maxWidth: 440, marginTop: 16, lineHeight: 1.6 }}>
            Signed offline credentials, an append-only ledger behind PostgreSQL row-level security, a fraud engine on every sync, and crowd-safety tooling for the mela grounds.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 24, fontSize: 12, opacity: 0.7 }}>
          <span>Offline-first</span>
          <span>Ed25519 receipts</span>
          <span>RLS-isolated data</span>
          <span>Sandbox settlement</span>
        </div>
      </div>
      <div className="login-form">
        <form className="login-card" onSubmit={(e) => void submit(e)}>
          <h2>Sign in</h2>
          <p className="muted" style={{ margin: 0 }}>
            Control-room and finance operators. Admin accounts live in a separate table from app users.
          </p>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          {error ? <div style={{ color: 'var(--danger)', fontWeight: 600 }}>{error}</div> : null}
          <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center', padding: 12 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="live-dot" style={{ background: health === 'up' ? 'var(--success)' : health === 'down' ? 'var(--danger)' : 'var(--warning)', animation: health === 'up' ? undefined : 'none' }} />
            API {API_URL} · {health === 'checking' ? 'checking…' : health === 'up' ? 'database up' : 'unreachable or database down'}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Demo login: <span className="mono">admin@freepay.demo</span> / <span className="mono">admin1234</span>
          </div>
        </form>
      </div>
    </div>
  );
}
