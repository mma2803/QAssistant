/**
 * HTTP transport E2E coverage for the OpenSpec MVP contract.
 *
 * This starts the real Nest application and drives its REST surface through
 * real access tokens minted by the app's own /auth/login endpoint, the real
 * auth guard/transaction interceptor, PostgreSQL RLS, validation pipes,
 * controllers, and services. Object storage runs against a real MinIO
 * (STORAGE_DRIVER=s3), started by `npm run dev:infra` / test:e2e:infra.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { ensureSchema, isDbReachable, cleanupTenants, makePools, newId } from './helpers/db.js';
import { inventoryApiRoutes, routeWasRequested } from '../../../scripts/e2e-coverage-lib.mjs';

const MINIO_HEALTH = 'http://127.0.0.1:9000/minio/health/live';
const S3_ENDPOINT = 'http://127.0.0.1:9000';
const INTERNAL_TOKEN = 'local-internal-task-token';
const secretsDir = join(tmpdir(), `qassistant-http-e2e-${process.pid}`);

let app: INestApplication | null = null;
let baseUrl = '';
let available = false;
let tenantId = '';
const requestedRoutes: Array<{ method: string; path: string }> = [];

interface HttpResult<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function request<T = unknown>(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<HttpResult<T>> {
  const requestUrl = new URL(path, 'http://e2e.local');
  requestedRoutes.push({ method: options.method ?? 'GET', path: requestUrl.pathname });
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await res.json()
    : Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body: body as T };
}

/** Sign in via the app's own /auth/login endpoint. `tenantSlug` omitted signs in as super-admin. */
async function signIn(email: string, password: string, tenantSlug?: string): Promise<string> {
  const res = await request<{ accessToken?: string; error?: { message?: string } }>(
    '/api/v1/auth/login',
    { method: 'POST', body: { email, password, tenantSlug } },
  );
  assert.equal(res.status, 201, `Login failed: ${res.body.error?.message ?? res.status}`);
  assert.ok(res.body.accessToken);
  return res.body.accessToken;
}

/** Idempotent super-admin seed, mirroring src/scripts/seed-super-admin.ts. */
async function createSuperAdmin(email: string, password: string): Promise<void> {
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
    const passwordSvc = new PasswordService();
    const tokens = new TokenService(config, db);
    const identity = new IdentityService(db, passwordSvc, tokens);
    await identity.createSuperAdmin(email, password);
  } finally {
    await db.onModuleDestroy();
  }
}

/**
 * Mint an access token for an existing subject directly via TokenService,
 * bypassing the rate-limited POST /auth/login endpoint (the login route is
 * throttled at 10/60s and this file already drives it close to that budget).
 * The resulting token is a real DB-backed opaque token indistinguishable from
 * one /auth/login would have issued, so HTTP calls made with it still exercise
 * the real guard/revocation path end to end.
 */
async function issueAccessToken(
  subjectType: 'tenant_user' | 'super_admin',
  subjectId: string,
): Promise<string> {
  const [{ loadConfig }, { DbService }, { TokenService }] = await Promise.all([
    import('../dist/config/config.service.js'),
    import('../dist/db/db.service.js'),
    import('../dist/auth/token.service.js'),
  ]);
  const config = loadConfig(process.env);
  const db = new DbService(config);
  await db.init();
  try {
    const tokens = new TokenService(config, db);
    const pair = await tokens.issueTokenPair(subjectType, subjectId);
    return pair.accessToken;
  } finally {
    await db.onModuleDestroy();
  }
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_DRIVER = 's3';
  process.env.S3_ENDPOINT = S3_ENDPOINT;
  process.env.S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID ?? 'qassistant-dev';
  process.env.S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY ?? 'qassistant-dev-secret';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  process.env.SECRETS_DRIVER = 'local';
  process.env.LOCAL_SECRETS_DIR = secretsDir;
  process.env.JIRA_DRIVER = 'local';
  process.env.CLOUD_TASKS_DRIVER = 'inline';
  process.env.INTERNAL_TASK_TOKEN = INTERNAL_TOKEN;
  delete process.env.GEMINI_API_KEY;

  available = (await isDbReachable()) && (await reachable(MINIO_HEALTH));
  if (!available) {
    if (process.env.REQUIRE_E2E_INFRA === 'true') {
      throw new Error('HTTP E2E requires local Postgres and MinIO (npm run dev:infra)');
    }
    console.warn('[http-e2e] local Postgres/MinIO unavailable; skipping.');
    return;
  }

  await ensureSchema();

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
  if (tenantId) {
    const pools = makePools();
    try {
      await cleanupTenants(pools, [tenantId]);
    } finally {
      await pools.close();
    }
  }
  await rm(secretsDir, { recursive: true, force: true });
});

describe('HTTP REST surface', () => {
  it('returns stable error envelopes for missing and invalid bearer tokens', async (t) => {
    if (!available || !app) return t.skip('local emulators unavailable');

    const missing = await request<{ error: { code: string; message: string } }>('/api/v1/projects');
    assert.equal(missing.status, 401);
    assert.deepEqual(missing.body, {
      error: { code: 'unauthenticated', message: 'Missing bearer token' },
    });

    const invalid = await request<{ error: { code: string; message: string } }>('/api/v1/projects', {
      token: 'not-a-real-token',
    });
    assert.equal(invalid.status, 401);
    assert.deepEqual(invalid.body, {
      error: { code: 'unauthenticated', message: 'Invalid or expired token' },
    });
  });

  it('enforces privileged route scope, request validation, and internal tokens', async (t) => {
    if (!available || !app) return t.skip('local emulators unavailable');

    const suffix = newId();
    const email = `scope-${suffix}@example.test`;
    const password = 'scope-password-123';
    await createSuperAdmin(email, password);
    const token = await signIn(email, password);

    const malformed = await request<{ error: { code: string } }>('/api/v1/admin/tenants', {
      method: 'POST',
      token,
      body: { name: '' },
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'validation_failed');

    const tenantRoute = await request<{ error: { code: string } }>('/api/v1/projects', { token });
    assert.equal(tenantRoute.status, 403);
    assert.equal(tenantRoute.body.error.code, 'forbidden');

    const internal = await request<{ error: { code: string } }>(
      '/api/v1/internal/tasks/inactivity-sweep',
      { method: 'POST', headers: { 'x-internal-task-token': 'wrong-token' }, body: {} },
    );
    assert.equal(internal.status, 401);
    assert.equal(internal.body.error.code, 'unauthenticated');
  });

  it('covers the complete user-facing MVP flow and protected internal routes', async (t) => {
    if (!available || !app) return t.skip('local emulators unavailable');

    const suffix = newId();
    const superEmail = `ops-${suffix}@example.test`;
    const adminEmail = `admin-${suffix}@example.test`;
    const qaEmail = `qa-${suffix}@example.test`;
    const managedEmail = `managed-${suffix}@example.test`;
    const initialPassword = 'initial-password-123';
    const adminPassword = 'admin-password-456';
    const qaPassword = 'qa-password-456';

    await createSuperAdmin(superEmail, initialPassword);
    const superToken = await signIn(superEmail, initialPassword);

    // GET /auth/me is explicitly allowlisted for super-admin (@AllowSuperAdmin
    // on top of the tenant-only @Roles class default) so the dashboard's
    // super-admin session can bootstrap its own identity the same way a
    // tenant user does.
    const superMe = await request<{
      role: string;
      tenantId: string | null;
      tenant: unknown;
      projects: unknown[];
    }>('/api/v1/auth/me', { token: superToken });
    assert.equal(superMe.status, 200);
    assert.equal(superMe.body.role, 'super-admin');
    assert.equal(superMe.body.tenantId, null);
    assert.equal(superMe.body.tenant, null);
    assert.deepEqual(superMe.body.projects, []);

    const health = await request<{ status: string; db: string }>('/health');
    assert.equal(health.status, 200, JSON.stringify(health.body));
    assert.deepEqual(health.body, { status: 'ok', db: 'up' });

    const unauthenticated = await request('/api/v1/projects');
    assert.equal(unauthenticated.status, 401);

    const provision = await request<{
      tenant: { id: string; slug: string };
      firstAdmin: { id: string };
    }>('/api/v1/admin/tenants', {
      method: 'POST',
      token: superToken,
      body: {
        name: `Acme ${suffix.slice(0, 6)}`,
        firstAdmin: { email: adminEmail, password: initialPassword },
      },
    });
    assert.equal(provision.status, 201);
    tenantId = provision.body.tenant.id;
    const tenantSlug = provision.body.tenant.slug;

    const tenants = await request<unknown[]>('/api/v1/admin/tenants', { token: superToken });
    assert.equal(tenants.status, 200);
    assert.ok(tenants.body.length >= 1);

    let adminToken = await signIn(adminEmail, initialPassword, tenantSlug);
    const forcedMe = await request<{ mustChangePassword: boolean }>('/api/v1/auth/me', {
      token: adminToken,
    });
    assert.equal(forcedMe.status, 200);
    assert.equal(forcedMe.body.mustChangePassword, true);

    const forcedGate = await request('/api/v1/projects', { token: adminToken });
    assert.equal(forcedGate.status, 403);
    assert.equal((forcedGate.body as { error: { code: string } }).error.code, 'must_change_password');

    const changed = await request<{ mustChangePassword: boolean }>(
      '/api/v1/auth/complete-password-change',
      { method: 'POST', token: adminToken, body: { newPassword: adminPassword } },
    );
    assert.equal(changed.status, 201);
    assert.equal(changed.body.mustChangePassword, false);
    adminToken = await signIn(adminEmail, adminPassword, tenantSlug);

    const adminMe = await request<{ role: string; tenantId: string }>('/api/v1/auth/me', {
      token: adminToken,
    });
    assert.equal(adminMe.status, 200);
    assert.equal(adminMe.body.role, 'admin');
    assert.equal(adminMe.body.tenantId, tenantId);

    // Login edge cases (contract 4.2): wrong password, an email that doesn't
    // exist, and a tenantSlug that doesn't exist all fail identically with a
    // generic "Invalid credentials" message (auth-routes.service.ts calls
    // verifyDummyPassword on every miss branch so failure timing doesn't leak
    // which branch was hit). Uses request() directly, not signIn(), since
    // these are expected to fail.
    const wrongPassword = await request<{ error: { code: string; message: string } }>(
      '/api/v1/auth/login',
      { method: 'POST', body: { email: adminEmail, password: 'not-the-real-password', tenantSlug } },
    );
    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(wrongPassword.body, {
      error: { code: 'unauthenticated', message: 'Invalid credentials' },
    });

    const unknownEmail = await request<{ error: { code: string; message: string } }>(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: { email: `nobody-${suffix}@example.test`, password: adminPassword, tenantSlug },
      },
    );
    assert.equal(unknownEmail.status, 401);
    assert.deepEqual(unknownEmail.body, {
      error: { code: 'unauthenticated', message: 'Invalid credentials' },
    });

    const unknownTenantSlug = await request<{ error: { code: string; message: string } }>(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: { email: adminEmail, password: adminPassword, tenantSlug: `no-such-tenant-${suffix}` },
      },
    );
    assert.equal(unknownTenantSlug.status, 401);
    assert.deepEqual(unknownTenantSlug.body, {
      error: { code: 'unauthenticated', message: 'Invalid credentials' },
    });

    const qaCreated = await request<{ id: string }>('/api/v1/users', {
      method: 'POST',
      token: adminToken,
      body: { email: qaEmail, password: initialPassword, role: 'qa-engineer' },
    });
    assert.equal(qaCreated.status, 201);

    const managedCreated = await request<{ id: string }>('/api/v1/users', {
      method: 'POST',
      token: adminToken,
      body: { email: managedEmail, password: initialPassword, role: 'qa-engineer' },
    });
    assert.equal(managedCreated.status, 201);

    // Capture the managed user's access token now, before they get disabled
    // below, so we can prove the disable step revokes it. Minted directly
    // (not via /auth/login) to avoid tripping the login route's own rate
    // limit, which this file already drives close to its budget.
    const managedToken = await issueAccessToken('tenant_user', managedCreated.body.id);
    const managedMeBeforeDisable = await request('/api/v1/auth/me', { token: managedToken });
    assert.equal(managedMeBeforeDisable.status, 200);

    const users = await request<unknown[]>('/api/v1/users', { token: adminToken });
    assert.equal(users.status, 200);
    assert.ok(users.body.length >= 3);

    const managedUpdated = await request<{ role: string; status: string }>(
      `/api/v1/users/${managedCreated.body.id}`,
      {
        method: 'PATCH',
        token: adminToken,
        body: { role: 'admin', status: 'disabled' },
      },
    );
    assert.equal(managedUpdated.status, 200);
    assert.equal(managedUpdated.body.role, 'admin');
    assert.equal(managedUpdated.body.status, 'disabled');

    // Disabling a user revokes every outstanding token for them
    // (identity.service.ts's setTenantUserDisabled -> revokeAllForSubject), so
    // the token captured before the disable step must now be rejected over HTTP.
    const managedMeAfterDisable = await request<{ error: { code: string; message: string } }>(
      '/api/v1/auth/me',
      { token: managedToken },
    );
    assert.equal(managedMeAfterDisable.status, 401);
    assert.deepEqual(managedMeAfterDisable.body, {
      error: { code: 'unauthenticated', message: 'Invalid or expired token' },
    });

    const reset = await request<{ mustChangePassword: boolean }>(
      `/api/v1/users/${managedCreated.body.id}/reset-password`,
      {
        method: 'POST',
        token: adminToken,
        body: { password: 'managed-reset-password' },
      },
    );
    assert.equal(reset.status, 201);
    assert.equal(reset.body.mustChangePassword, true);

    let qaToken = await signIn(qaEmail, initialPassword, tenantSlug);
    const qaForcedMe = await request<{ mustChangePassword: boolean }>('/api/v1/auth/me', {
      token: qaToken,
    });
    assert.equal(qaForcedMe.status, 200);
    assert.equal(qaForcedMe.body.mustChangePassword, true);

    // must_change_password gate applies to qa-engineer too, not just admin:
    // a freshly-issued qa-engineer token is blocked from a normal authenticated
    // route until the forced password change completes (mirrors the admin
    // forcedGate assertion above).
    const qaForcedGate = await request('/api/v1/projects', { token: qaToken });
    assert.equal(qaForcedGate.status, 403);
    assert.equal((qaForcedGate.body as { error: { code: string } }).error.code, 'must_change_password');

    const qaAdminDenied = await request('/api/v1/users', { token: qaToken });
    assert.equal(qaAdminDenied.status, 403);
    const qaChanged = await request('/api/v1/auth/complete-password-change', {
      method: 'POST',
      token: qaToken,
      body: { newPassword: qaPassword },
    });
    assert.equal(qaChanged.status, 201);
    qaToken = await signIn(qaEmail, qaPassword, tenantSlug);

    const projectCreated = await request<{ id: string }>('/api/v1/projects', {
      method: 'POST',
      token: adminToken,
      body: {
        name: `Checkout ${suffix.slice(0, 6)}`,
        baseUrl: 'https://checkout.example.test',
        screenshotDefault: true,
        maskingSelectors: ['input[type=password]'],
        inactivityTimeoutSeconds: 900,
      },
    });
    assert.equal(projectCreated.status, 201);
    const projectId = projectCreated.body.id;

    const projectList = await request<unknown[]>('/api/v1/projects', { token: qaToken });
    assert.equal(projectList.status, 200);
    assert.ok(projectList.body.length >= 1);
    const projectDetail = await request(`/api/v1/projects/${projectId}`, { token: qaToken });
    assert.equal(projectDetail.status, 200);

    const projectUpdated = await request<{ screenshotDefault: boolean }>(
      `/api/v1/projects/${projectId}`,
      { method: 'PATCH', token: adminToken, body: { screenshotDefault: false } },
    );
    assert.equal(projectUpdated.status, 200);
    assert.equal(projectUpdated.body.screenshotDefault, false);

    const knowledge = await request<{ knowledgeMd: string }>(
      `/api/v1/projects/${projectId}/knowledge`,
      {
        method: 'PUT',
        token: adminToken,
        body: { knowledgeMd: '# Checkout\nUse stable selectors.', defaultCredsSecretRef: null },
      },
    );
    assert.equal(knowledge.status, 200);
    assert.match(knowledge.body.knowledgeMd, /stable selectors/);

    // Per-project default framework (configurable-test-framework). Open to any
    // tenant user -> exercise as a qa-engineer (not admin).
    const projFramework = await request<{
      defaultTestFramework: string | null;
      defaultTestLanguage: string | null;
    }>(`/api/v1/projects/${projectId}/test-framework`, {
      method: 'PUT',
      token: qaToken,
      body: { defaultTestFramework: 'Cypress', defaultTestLanguage: 'JavaScript' },
    });
    assert.equal(projFramework.status, 200);
    assert.equal(projFramework.body.defaultTestFramework, 'Cypress');
    assert.equal(projFramework.body.defaultTestLanguage, 'JavaScript');

    const jira = await request(`/api/v1/projects/${projectId}/jira`, {
      method: 'PUT',
      token: adminToken,
      body: {
        baseUrl: 'https://jira.example.test',
        projectKey: 'QA',
        token: 'read-only-local-token',
      },
    });
    assert.equal(jira.status, 200);
    const jiraTest = await request<{ ok: boolean }>(`/api/v1/projects/${projectId}/jira/test`, {
      method: 'POST',
      token: adminToken,
    });
    assert.equal(jiraTest.status, 201);
    assert.equal(jiraTest.body.ok, true);

    const invalidStart = await request('/api/v1/sessions', {
      method: 'POST',
      token: qaToken,
      body: { projectId },
    });
    assert.equal(invalidStart.status, 400);

    const started = await request<{ id: string }>('/api/v1/sessions', {
      method: 'POST',
      token: qaToken,
      body: { projectId, jiraId: 'QA-42', screenshotEnabled: true },
    });
    assert.equal(started.status, 201);
    const sessionId = started.body.id;

    const query = new URLSearchParams({
      'items[0][type]': 'dom_chunk',
      'items[0][seq]': '0',
      'items[1][type]': 'screenshot',
      'items[1][seq]': '1',
    });
    const uploadUrls = await request<{
      items: Array<{ type: string; gcsPath: string; uploadUrl: string; requiredHeaders: Record<string, string> }>;
    }>(`/api/v1/sessions/${sessionId}/upload-urls?${query}`, { token: qaToken });
    assert.equal(uploadUrls.status, 200);
    assert.equal(uploadUrls.body.items.length, 2);

    const domEvents = Buffer.from(JSON.stringify([{ type: 4, timestamp: Date.now(), data: {} }]));
    const screenshot = Buffer.from('fake-webp-image');
    const uploadedArtifacts: Array<{ id: string; type: string }> = [];
    for (const item of uploadUrls.body.items) {
      const bytes = item.type === 'dom_chunk' ? domEvents : screenshot;
      const upload = await fetch(item.uploadUrl, {
        method: 'PUT',
        headers: item.requiredHeaders,
        body: bytes,
      });
      assert.ok(upload.ok, `artifact upload failed: ${upload.status}`);
      const artifact = await request<{ id: string; type: string }>(
        `/api/v1/sessions/${sessionId}/artifacts`,
        {
          method: 'POST',
          token: qaToken,
          body: {
            type: item.type,
            seq: item.type === 'dom_chunk' ? 0 : 1,
            gcsPath: item.gcsPath,
            contentType: item.requiredHeaders['Content-Type'],
            sizeBytes: bytes.length,
            checksum: null,
            compression: 'none',
            capturedAt: new Date().toISOString(),
          },
        },
      );
      assert.equal(artifact.status, 201);
      uploadedArtifacts.push(artifact.body);
    }

    const flag = await request(`/api/v1/sessions/${sessionId}/flags`, {
      method: 'POST',
      token: qaToken,
      body: { selector: '[data-testid=success]', note: 'Success state', eventOffsetMs: 4200 },
    });
    assert.equal(flag.status, 201);
    const stopped = await request<{ status: string }>(`/api/v1/sessions/${sessionId}/stop`, {
      method: 'POST',
      token: qaToken,
    });
    assert.equal(stopped.status, 201);
    assert.equal(stopped.body.status, 'completed');

    const generated = await request(`/api/v1/sessions/${sessionId}/generate`, {
      method: 'POST',
      token: qaToken,
      body: { kind: 'playwright_test' },
    });
    assert.equal(generated.status, 202);
    const generations = await request<{ items: Array<{ id: string; modelTier: string }> }>(
      `/api/v1/sessions/${sessionId}/generations`,
      { token: qaToken },
    );
    assert.equal(generations.status, 200);
    assert.equal(generations.body.items.length, 1);
    assert.equal(generations.body.items[0]?.modelTier, 'pro');
    const generatedTestId = generations.body.items[0]!.id;

    const generationDetail = await request(`/api/v1/generations/${generatedTestId}`, {
      token: adminToken,
    });
    assert.equal(generationDetail.status, 200);
    const approved = await request<{ reviewStatus: string }>(
      `/api/v1/generations/${generatedTestId}/approve`,
      { method: 'POST', token: adminToken },
    );
    assert.equal(approved.status, 201);
    assert.equal(approved.body.reviewStatus, 'approved');

    // Approval makes the version a ready_to_integrate candidate the MCP server lists.
    const ready = await request<{ items: Array<{ id: string; integrationStatus: string }> }>(
      '/api/v1/generations/ready-to-integrate',
      { token: adminToken },
    );
    assert.equal(ready.status, 200);
    assert.ok(
      ready.body.items.some(
        (g) => g.id === generatedTestId && g.integrationStatus === 'ready_to_integrate',
      ),
      'approved version is listed as ready_to_integrate',
    );

    const ref = 'https://github.com/acme/e2e-tests/pull/7';
    const integrated = await request<{ integrationStatus: string; integrationRef: string | null }>(
      `/api/v1/generations/${generatedTestId}/integrate`,
      { method: 'POST', token: adminToken, body: { status: 'integrated', ref } },
    );
    assert.equal(integrated.status, 201);
    assert.equal(integrated.body.integrationStatus, 'integrated');
    assert.equal(integrated.body.integrationRef, ref);

    const comment = await request<{ id: string }>(`/api/v1/sessions/${sessionId}/comments`, {
      method: 'POST',
      token: qaToken,
      body: { body: 'Assert the visible receipt.', generatedTestId },
    });
    assert.equal(comment.status, 201);
    const regenerated = await request(`/api/v1/sessions/${sessionId}/regenerate`, {
      method: 'POST',
      token: qaToken,
      body: { kind: 'playwright_test', sourceCommentId: comment.body.id },
    });
    assert.equal(regenerated.status, 202);

    const sessionList = await request<{ items: unknown[] }>(
      `/api/v1/dashboard/sessions?projectId=${projectId}&status=completed&limit=20`,
      { token: adminToken },
    );
    assert.equal(sessionList.status, 200);
    assert.equal(sessionList.body.items.length, 1);
    const qaSessionList = await request<{ items: unknown[] }>('/api/v1/dashboard/sessions', {
      token: qaToken,
    });
    assert.equal(qaSessionList.status, 200);
    assert.equal(qaSessionList.body.items.length, 1);

    const detail = await request<{ flags: unknown[]; generations: unknown[] }>(
      `/api/v1/dashboard/sessions/${sessionId}`,
      { token: adminToken },
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.flags.length, 1);
    assert.equal(detail.body.generations.length, 2);

    const replay = await request<{ events: unknown[]; chunkCount: number }>(
      `/api/v1/dashboard/sessions/${sessionId}/replay`,
      { token: adminToken },
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.chunkCount, 1);
    assert.equal(replay.body.events.length, 1);

    const screenshotArtifact = uploadedArtifacts.find((artifact) => artifact.type === 'screenshot');
    assert.ok(screenshotArtifact);
    const artifactBytes = await request<Buffer>(
      `/api/v1/dashboard/sessions/${sessionId}/artifacts/${screenshotArtifact.id}`,
      { token: adminToken },
    );
    assert.equal(artifactBytes.status, 200);
    assert.equal(Buffer.compare(artifactBytes.body, screenshot), 0);

    const metrics = await request<{ metrics: unknown[] }>('/api/v1/dashboard/metrics', {
      token: adminToken,
    });
    assert.equal(metrics.status, 200);
    assert.ok(metrics.body.metrics.length >= 2);
    const ranking = await request<{ ranking: unknown[] }>('/api/v1/dashboard/ranking', {
      token: adminToken,
    });
    assert.equal(ranking.status, 200);
    assert.ok(ranking.body.ranking.length >= 2);

    const exported = await request<Buffer>(`/api/v1/sessions/${sessionId}/export`, {
      token: qaToken,
    });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type') ?? '', /application\/zip/);
    assert.ok(exported.body.length > 100);

    const deleted = await request<{ deletedAt: string | null }>(`/api/v1/sessions/${sessionId}`, {
      method: 'DELETE',
      token: qaToken,
    });
    assert.equal(deleted.status, 200);
    assert.ok(deleted.body.deletedAt);
    const restored = await request<{ deletedAt: string | null }>(
      `/api/v1/sessions/${sessionId}/restore`,
      { method: 'POST', token: adminToken },
    );
    assert.equal(restored.status, 201);
    assert.equal(restored.body.deletedAt, null);

    const inactivityDenied = await request('/api/v1/internal/tasks/inactivity-sweep', {
      method: 'POST',
      body: {},
    });
    assert.equal(inactivityDenied.status, 401);
    const inactivity = await request<{ closedSessionIds: string[] }>(
      '/api/v1/internal/tasks/inactivity-sweep',
      { method: 'POST', headers: { 'x-internal-task-token': INTERNAL_TOKEN }, body: {} },
    );
    assert.equal(inactivity.status, 200);
    assert.deepEqual(inactivity.body.closedSessionIds, []);

    const internalGenerate = await request<{ ok: true }>('/api/v1/internal/tasks/generate', {
      method: 'POST',
      headers: { 'x-internal-task-token': INTERNAL_TOKEN },
      body: {
        jobId: newId(),
        tenantId,
        projectId,
        sessionId,
        createdBy: qaCreated.body.id,
        kind: 'replay_script',
        modelTier: 'flash',
        framework: 'Playwright',
        language: 'TypeScript',
      },
    });
    assert.equal(internalGenerate.status, 200);
    assert.equal(internalGenerate.body.ok, true);

    const purge = await request<{ purgedSessionIds: string[] }>(
      `/api/v1/internal/tasks/purge?now=${encodeURIComponent('2000-01-01T00:00:00.000Z')}`,
      { method: 'POST', headers: { 'x-internal-task-token': INTERNAL_TOKEN } },
    );
    assert.equal(purge.status, 200);
    assert.deepEqual(purge.body.purgedSessionIds, []);

    const jiraDeleted = await request(`/api/v1/projects/${projectId}/jira`, {
      method: 'DELETE',
      token: adminToken,
    });
    assert.equal(jiraDeleted.status, 204);

    const tenantInactive = await request<{ status: string }>(
      `/api/v1/admin/tenants/${tenantId}`,
      { method: 'PATCH', token: superToken, body: { status: 'inactive' } },
    );
    assert.equal(tenantInactive.status, 200);
    assert.equal(tenantInactive.body.status, 'inactive');
    const tenantActive = await request<{ status: string }>(
      `/api/v1/admin/tenants/${tenantId}`,
      { method: 'PATCH', token: superToken, body: { status: 'active' } },
    );
    assert.equal(tenantActive.status, 200);
    assert.equal(tenantActive.body.status, 'active');

    const deletedForPurge = await request(`/api/v1/sessions/${sessionId}`, {
      method: 'DELETE',
      token: qaToken,
    });
    assert.equal(deletedForPurge.status, 200);
    const purged = await request<{ purgedSessionIds: string[] }>(
      `/api/v1/internal/tasks/purge?now=${encodeURIComponent('2100-01-01T00:00:00.000Z')}`,
      { method: 'POST', headers: { 'x-internal-task-token': INTERNAL_TOKEN } },
    );
    assert.equal(purged.status, 200);
    assert.ok(purged.body.purgedSessionIds.includes(sessionId));

    // Tenant-wide codegen default (change: configurable-test-framework). Any
    // tenant user may read AND change it — exercise as a qa-engineer (not admin)
    // to prove the route is not admin-gated.
    const settingsRead = await request<{ defaultTestFramework: string; defaultTestLanguage: string }>(
      '/api/v1/tenant/settings',
      { token: qaToken },
    );
    assert.equal(settingsRead.status, 200);
    assert.equal(settingsRead.body.defaultTestFramework, 'Playwright');
    assert.equal(settingsRead.body.defaultTestLanguage, 'TypeScript');

    const settingsUpdate = await request<{ defaultTestFramework: string; defaultTestLanguage: string }>(
      '/api/v1/tenant/settings',
      {
        method: 'PUT',
        token: qaToken,
        body: { defaultTestFramework: 'Cypress', defaultTestLanguage: 'JavaScript' },
      },
    );
    assert.equal(settingsUpdate.status, 200);
    assert.equal(settingsUpdate.body.defaultTestFramework, 'Cypress');
    assert.equal(settingsUpdate.body.defaultTestLanguage, 'JavaScript');

    // Refresh + logout (full auth lifecycle, not just login).
    const freshLogin = await request<{ accessToken: string; refreshToken: string }>(
      '/api/v1/auth/login',
      { method: 'POST', body: { email: adminEmail, password: adminPassword, tenantSlug } },
    );
    assert.equal(freshLogin.status, 201);
    const refreshed = await request<{ accessToken: string; refreshToken: string }>(
      '/api/v1/auth/refresh',
      { method: 'POST', body: { refreshToken: freshLogin.body.refreshToken } },
    );
    assert.equal(refreshed.status, 201);
    assert.ok(refreshed.body.accessToken);
    const meAfterRefresh = await request<{ role: string }>('/api/v1/auth/me', {
      token: refreshed.body.accessToken,
    });
    assert.equal(meAfterRefresh.status, 200);
    assert.equal(meAfterRefresh.body.role, 'admin');

    const loggedOut = await request<{ ok: true }>('/api/v1/auth/logout', {
      method: 'POST',
      body: { refreshToken: refreshed.body.refreshToken },
    });
    assert.equal(loggedOut.status, 201);
    const refreshAfterLogout = await request<{ error: { code: string } }>('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: refreshed.body.refreshToken },
    });
    assert.equal(refreshAfterLogout.status, 401, 'a logged-out refresh token cannot mint new tokens');

    const apiSource = fileURLToPath(new URL('../src', import.meta.url));
    const missingRoutes = inventoryApiRoutes(apiSource).filter(
      (route) => !routeWasRequested(route, requestedRoutes),
    );
    assert.deepEqual(
      missingRoutes.map((route) => `${route.method} ${route.path}`),
      [],
      'HTTP E2E did not exercise every declared controller route',
    );
  });
});
