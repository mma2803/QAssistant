/**
 * HTTP E2E coverage for reusable tenant signup links (change: tenant-signup-links).
 *
 * Boots the real Nest app (local storage/secrets drivers — no MinIO needed) and
 * drives the real REST surface: the super-admin issues a link, a public
 * (unauthenticated) recipient redeems it, and the guard/validation/RLS path all
 * run for real. Skips cleanly when no local Postgres is reachable.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import type { INestApplication } from '@nestjs/common';
import { ensureSchema, isDbReachable, cleanupTenants, makePools, newId } from './helpers/db.js';

const secretsDir = join(tmpdir(), `qassistant-signup-e2e-${process.pid}`);

let app: INestApplication | null = null;
let baseUrl = '';
let available = false;
let superAdminId = '';
const createdTenantIds: string[] = [];

interface HttpResult<T = unknown> {
  status: number;
  body: T;
}

async function request<T = unknown>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<HttpResult<T>> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await res.json() : null;
  return { status: res.status, body: body as T };
}

async function signIn(email: string, password: string, tenantSlug?: string): Promise<HttpResult<{ accessToken?: string; mustChangePassword?: boolean }>> {
  return request('/api/v1/auth/login', { method: 'POST', body: { email, password, tenantSlug } });
}

/** Idempotent super-admin seed; returns the super_admins.id (needed as the link's created_by). */
async function createSuperAdmin(email: string, password: string): Promise<string> {
  const [{ loadConfig }, { DbService }, { PasswordService }, { TokenService }, { IdentityService }] =
    await Promise.all([
      import('../dist/config/config.service.js'),
      import('../dist/db/db.service.js'),
      import('../dist/auth/password.service.js'),
      import('../dist/auth/token.service.js'),
      import('../dist/auth/identity.service.js'),
    ]);
  const config = loadConfig(process.env);
  const db = new DbService(config);
  await db.init();
  try {
    const identity = new IdentityService(db, new PasswordService(), new TokenService(config, db));
    return await identity.createSuperAdmin(email, password);
  } finally {
    await db.onModuleDestroy();
  }
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_DRIVER = 'local';
  process.env.SECRETS_DRIVER = 'local';
  process.env.LOCAL_SECRETS_DIR = secretsDir;
  process.env.CLOUD_TASKS_DRIVER = 'inline';
  process.env.INTERNAL_TASK_TOKEN = 'local-internal-task-token';

  available = await isDbReachable();
  if (!available) {
    if (process.env.REQUIRE_E2E_INFRA === 'true') {
      throw new Error('signup-links E2E requires local Postgres (npm run dev:infra)');
    }
    console.warn('[signup-links] local Postgres unavailable; skipping.');
    return;
  }

  await ensureSchema();
  superAdminId = await createSuperAdmin(`signup-ops-${newId()}@example.test`, 'super-admin-pw-123');

  const [{ NestFactory }, { AppModule }, { HttpExceptionFilter }] = await Promise.all([
    import('@nestjs/core'),
    import('../dist/app.module.js'),
    import('../dist/auth/http-exception.filter.js'),
  ]);
  app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app?.close();
  const pools = makePools();
  try {
    await cleanupTenants(pools, createdTenantIds);
    if (superAdminId) {
      const client = await pools.superadmin.connect();
      try {
        await client.query('DELETE FROM tenant_invitations WHERE created_by = $1', [superAdminId]);
        await client.query('DELETE FROM super_admins WHERE id = $1', [superAdminId]);
      } finally {
        client.release();
      }
    }
  } finally {
    await pools.close();
  }
  await rm(secretsDir, { recursive: true, force: true });
});

describe('reusable tenant signup links', () => {
  it('super-admin issues a link; a public recipient redeems it into a tenant + first admin', async (t) => {
    if (!available || !app) return t.skip('local Postgres unavailable');

    const opsEmail = `signup-admin-${newId()}@example.test`;
    await createSuperAdmin(opsEmail, 'super-admin-pw-123');
    const login = await signIn(opsEmail, 'super-admin-pw-123');
    assert.equal(login.status, 201);
    const superToken = login.body.accessToken!;

    // Issue: plaintext token returned once, plus an expiry.
    const issued = await request<{ id: string; token: string; expiresAt: string }>(
      '/api/v1/admin/tenants/invitations',
      { method: 'POST', token: superToken, body: { expiresInDays: 7 } },
    );
    assert.equal(issued.status, 201);
    assert.ok(issued.body.token, 'issue returns a plaintext token');
    assert.ok(issued.body.expiresAt, 'issue returns an expiry');
    const link = issued.body.token;

    // Public validity probe: valid, and leaks nothing but the expiry.
    const probe = await request<{ valid: boolean; expiresAt: string | null }>(
      `/api/v1/signup/${link}`,
    );
    assert.equal(probe.status, 200);
    assert.deepEqual(Object.keys(probe.body).sort(), ['expiresAt', 'valid']);
    assert.equal(probe.body.valid, true);

    // Redeem (unauthenticated) → tenant + first admin, no forced password change.
    const name = `Globex ${newId().slice(0, 8)}`;
    const adminEmail = `owner-${newId()}@globex.test`;
    const redeem = await request<{ tenant: { id: string; slug: string }; firstAdmin: { mustChangePassword: boolean; role: string } }>(
      '/api/v1/signup',
      { method: 'POST', body: { token: link, name, firstAdmin: { email: adminEmail, password: 'Tenant-pass-123' } } },
    );
    assert.equal(redeem.status, 201);
    createdTenantIds.push(redeem.body.tenant.id);
    assert.equal(redeem.body.firstAdmin.role, 'admin');
    assert.equal(redeem.body.firstAdmin.mustChangePassword, false, 'link-created admin is not forced to change password');

    // The first admin signs in immediately with the chosen password — no forced change.
    const adminLogin = await signIn(adminEmail, 'Tenant-pass-123', redeem.body.tenant.slug);
    assert.equal(adminLogin.status, 201);
    assert.equal(adminLogin.body.mustChangePassword, false);

    // Reuse: the SAME link provisions a second, distinct tenant.
    const reuse = await request<{ tenant: { id: string } }>('/api/v1/signup', {
      method: 'POST',
      body: { token: link, name: `Initech ${newId().slice(0, 8)}`, firstAdmin: { email: `owner-${newId()}@initech.test`, password: 'Tenant-pass-123' } },
    });
    assert.equal(reuse.status, 201);
    createdTenantIds.push(reuse.body.tenant.id);
    assert.notEqual(reuse.body.tenant.id, redeem.body.tenant.id);

    // Duplicate tenant name → 409, nothing created.
    const dup = await request<{ error: { code: string } }>('/api/v1/signup', {
      method: 'POST',
      body: { token: link, name, firstAdmin: { email: `dup-${newId()}@globex.test`, password: 'Tenant-pass-123' } },
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'conflict');

    // Listing shows the link active with the count of tenants it provisioned (2).
    const list = await request<Array<{ id: string; status: string; createdTenantCount: number }>>(
      '/api/v1/admin/tenants/invitations',
      { token: superToken },
    );
    assert.equal(list.status, 200);
    const mine = list.body.find((i) => i.id === issued.body.id);
    assert.ok(mine, 'issued link appears in the listing');
    assert.equal(mine!.status, 'active');
    assert.equal(mine!.createdTenantCount, 2);
    // The listing shows WHO used the link (tenant + first-admin email).
    assert.equal(mine!.createdTenants.length, 2);
    assert.ok(
      mine!.createdTenants.some((c: { adminEmail: string | null }) => c.adminEmail === adminEmail),
      'the redeeming admin email is surfaced against the link',
    );

    // Revoke → validity false, redemption forbidden.
    const revoke = await request(`/api/v1/admin/tenants/invitations/${issued.body.id}`, {
      method: 'DELETE',
      token: superToken,
    });
    assert.equal(revoke.status, 204);
    const afterRevoke = await request<{ valid: boolean }>(`/api/v1/signup/${link}`);
    assert.equal(afterRevoke.body.valid, false);
    const redeemRevoked = await request<{ error: { code: string } }>('/api/v1/signup', {
      method: 'POST',
      body: { token: link, name: `Late ${newId().slice(0, 8)}`, firstAdmin: { email: `late-${newId()}@x.test`, password: 'Tenant-pass-123' } },
    });
    assert.equal(redeemRevoked.status, 403);

    // Soft-delete the redeemed tenant → its admin can no longer sign in, and it
    // drops out of the provisioning list (change: tenant soft-delete).
    const deleted = await request(`/api/v1/admin/tenants/${redeem.body.tenant.id}`, {
      method: 'DELETE',
      token: superToken,
    });
    assert.equal(deleted.status, 204);
    const blocked = await signIn(adminEmail, 'Tenant-pass-123', redeem.body.tenant.slug);
    assert.equal(blocked.status, 401, 'a soft-deleted tenant blocks sign-in');
    const tenantsList = await request<Array<{ id: string }>>('/api/v1/admin/tenants', {
      token: superToken,
    });
    assert.ok(!tenantsList.body.some((t2) => t2.id === redeem.body.tenant.id));
  });

  it('rejects unknown and expired links', async (t) => {
    if (!available || !app) return t.skip('local Postgres unavailable');

    // Unknown token.
    const unknown = await request<{ valid: boolean }>(`/api/v1/signup/${'z'.repeat(43)}`);
    assert.equal(unknown.body.valid, false);
    const redeemUnknown = await request<{ error: { code: string } }>('/api/v1/signup', {
      method: 'POST',
      body: { token: 'no-such-token', name: `Nope ${newId().slice(0, 8)}`, firstAdmin: { email: `nope-${newId()}@x.test`, password: 'Tenant-pass-123' } },
    });
    assert.equal(redeemUnknown.status, 404);

    // Expired: insert a link with a past expiry directly (the API can't mint one).
    const expiredToken = `expired-${newId()}`;
    const expiredHash = createHash('sha256').update(expiredToken).digest('hex');
    const pools = makePools();
    try {
      const client = await pools.superadmin.connect();
      try {
        await client.query(
          `INSERT INTO tenant_invitations (id, token_hash, created_by, expires_at)
           VALUES ($1, $2, $3, now() - interval '1 day')`,
          [newId(), expiredHash, superAdminId],
        );
      } finally {
        client.release();
      }
    } finally {
      await pools.close();
    }
    const expiredProbe = await request<{ valid: boolean }>(`/api/v1/signup/${expiredToken}`);
    assert.equal(expiredProbe.body.valid, false);
    const redeemExpired = await request<{ error: { code: string } }>('/api/v1/signup', {
      method: 'POST',
      body: { token: expiredToken, name: `Exp ${newId().slice(0, 8)}`, firstAdmin: { email: `exp-${newId()}@x.test`, password: 'Tenant-pass-123' } },
    });
    assert.equal(redeemExpired.status, 403);
  });
});
