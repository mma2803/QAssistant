import { useState } from 'react';
import type { Role, TenantUser } from '@qassistant/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDateTime } from '../lib/format';

/**
 * Admin user-management UI (spec 5.5), backed by the Admin SDK endpoints
 * (contract 4.2): create user, change role, enable/disable, reset password. This
 * page is only routed for admins (App.tsx); a qa-engineer token is also rejected
 * by the backend role guard, so this is defense in depth, not the sole control.
 */
export function UsersPage(): JSX.Element {
  const users = useAsync<TenantUser[]>(() => api.listUsers(), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // create form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('qa-engineer');

  async function guard(fn: () => Promise<unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await fn();
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(): Promise<void> {
    await guard(async () => {
      await api.createUser({ email, password, role });
      setEmail('');
      setPassword('');
      setRole('qa-engineer');
    });
  }

  async function onToggleStatus(u: TenantUser): Promise<void> {
    await guard(() =>
      api.updateUser(u.id, { status: u.status === 'active' ? 'disabled' : 'active' }),
    );
  }

  async function onChangeRole(u: TenantUser, next: Role): Promise<void> {
    if (next === u.role) return;
    await guard(() => api.updateUser(u.id, { role: next }));
  }

  async function onReset(u: TenantUser): Promise<void> {
    const pw = prompt(`New temporary password for ${u.email} (min 8 chars):`);
    if (!pw) return;
    await guard(() => api.resetPassword(u.id, { password: pw }));
  }

  return (
    <div className="col">
      <h1 style={{ margin: 0 }}>Users</h1>
      {error && <div className="error">{error}</div>}

      <div className="card col">
        <h3 style={{ margin: 0 }}>Add user</h3>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="col" style={{ gap: 4, minWidth: 220 }}>
            <span className="muted">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="col" style={{ gap: 4, minWidth: 200 }}>
            <span className="muted">Initial password</span>
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="col" style={{ gap: 4, minWidth: 160 }}>
            <span className="muted">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="qa-engineer">QA engineer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button
            className="primary"
            disabled={busy || !email || password.length < 8}
            onClick={() => void onCreate()}
          >
            Create
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          The new user must change this password on first sign-in.
        </div>
      </div>

      <div className="card">
        {users.loading && <div className="muted">Loading users...</div>}
        {users.data && (
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Must change pw</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>
                    <select
                      value={u.role}
                      disabled={busy}
                      onChange={(e) => void onChangeRole(u, e.target.value as Role)}
                    >
                      <option value="qa-engineer">qa-engineer</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    <span className={`badge ${u.status === 'active' ? 'active' : ''}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="muted">{u.mustChangePassword ? 'yes' : 'no'}</td>
                  <td className="muted">{formatDateTime(u.createdAt)}</td>
                  <td>
                    <div className="row">
                      <button disabled={busy} onClick={() => void onReset(u)}>
                        Reset password
                      </button>
                      <button disabled={busy} onClick={() => void onToggleStatus(u)}>
                        {u.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
