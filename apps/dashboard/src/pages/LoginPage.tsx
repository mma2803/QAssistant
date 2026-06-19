import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';

/**
 * Identity Platform email/password sign-in (spec 5.1). The tenant field selects
 * the GCIP tenant; it defaults to the build-time VITE_FIREBASE_TENANT_ID and can
 * be overridden for multi-tenant operators. On success the AuthProvider
 * bootstraps /auth/me and the router routes by role (or to the forced
 * password-change screen if the marker is set).
 */
export function LoginPage(): JSX.Element {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState(import.meta.env.VITE_FIREBASE_TENANT_ID ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password, tenantId || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card auth-card col" onSubmit={onSubmit}>
        <h2 style={{ margin: 0 }}>Sign in</h2>
        <label className="col" style={{ gap: 4 }}>
          <span className="muted">Email</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="muted">Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="muted">Tenant ID (optional)</span>
          <input
            type="text"
            value={tenantId}
            placeholder="GCIP tenant id"
            onChange={(e) => setTenantId(e.target.value)}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
