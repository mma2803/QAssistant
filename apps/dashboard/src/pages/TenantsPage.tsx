import { useState } from 'react';
import type { Tenant } from '@qassistant/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDateTime } from '../lib/format';

/**
 * Super-admin tenant provisioning UI (contract 4.1). Backed by the
 * @SuperAdminOnly() /admin/tenants endpoints: create a tenant + its first
 * admin, list tenants, toggle active/inactive. This page is only routed for
 * super-admin (App.tsx); the backend role guard also rejects any other
 * caller, so this is defense in depth, not the sole control.
 */
export function TenantsPage(): JSX.Element {
  const tenants = useAsync<Tenant[]>(() => api.listTenants(), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // create form
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  async function guard(fn: () => Promise<unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await fn();
      tenants.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(): Promise<void> {
    await guard(async () => {
      await api.createTenant({ name, firstAdmin: { email: adminEmail, password: adminPassword } });
      setName('');
      setAdminEmail('');
      setAdminPassword('');
    });
  }

  async function onToggleStatus(t: Tenant): Promise<void> {
    await guard(() =>
      api.updateTenantStatus(t.id, { status: t.status === 'active' ? 'inactive' : 'active' }),
    );
  }

  return (
    <div className="col">
      <h1 style={{ margin: 0 }}>Tenants</h1>
      {error && <div className="error">{error}</div>}

      <div className="card col">
        <h3 style={{ margin: 0 }}>Add tenant</h3>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="col" style={{ gap: 4, minWidth: 220 }}>
            <span className="muted">Tenant name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="col" style={{ gap: 4, minWidth: 220 }}>
            <span className="muted">First admin email</span>
            <input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
            />
          </label>
          <label className="col" style={{ gap: 4, minWidth: 200 }}>
            <span className="muted">First admin initial password</span>
            <input
              type="text"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={busy || !name.trim() || !adminEmail || adminPassword.length < 8}
            onClick={() => void onCreate()}
          >
            Create
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          The tenant slug is generated automatically from its name. The first admin must change
          this password on first sign-in.
        </div>
      </div>

      <div className="card">
        {tenants.loading && <div className="muted">Loading tenants...</div>}
        {tenants.data && tenants.data.length === 0 && (
          <div className="muted">No tenants yet.</div>
        )}
        {tenants.data && tenants.data.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tenants.data.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="muted">
                    <code>{t.slug}</code>
                  </td>
                  <td>
                    <span className={`badge ${t.status === 'active' ? 'active' : ''}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="muted">{formatDateTime(t.createdAt)}</td>
                  <td>
                    <button disabled={busy} onClick={() => void onToggleStatus(t)}>
                      {t.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
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
