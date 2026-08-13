/**
 * Rate-limit coverage for POST /auth/login and POST /auth/refresh
 * (auth-routes.controller.ts: `@Throttle({ default: { limit: 10, ttl: 60_000 } })`
 * on login, `@Throttle({ default: { limit: 30, ttl: 60_000 } })` on refresh, both
 * behind `@UseGuards(ThrottlerGuard)`).
 *
 * This file boots its OWN Nest application instance, deliberately separate from
 * apps/api/test/http-e2e.test.ts. @nestjs/throttler's default ThrottlerGuard
 * uses an in-memory storage keyed by client IP, scoped to a single app instance
 * (see app.module.ts's `ThrottlerModule.forRoot`, which does not configure a
 * shared/external storage). http-e2e.test.ts calls /auth/login several times
 * across its single shared app instance from the same loopback address; sharing
 * that instance here would let this file's throttle-tripping requests and that
 * file's legitimate logins collide in the same bucket, causing order-dependent
 * flakiness in either file. A dedicated app instance gives this file fresh,
 * isolated throttle state.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { INestApplication } from '@nestjs/common';
import { ensureSchema, isDbReachable, cleanupTenants, makePools, newId } from './helpers/db.js';

const MINIO_HEALTH = 'http://127.0.0.1:9000/minio/health/live';
const S3_ENDPOINT = 'http://127.0.0.1:9000';
const INTERNAL_TOKEN = 'local-internal-task-token';
const secretsDir = join(tmpdir(), `qassistant-auth-rate-limit-${process.pid}`);

let app: INestApplication | null = null;
let baseUrl = '';
let available = false;
let tenantId = '';

interface HttpResult<T = unknown> {
  status: number;
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
  options: { method?: string; body?: unknown } = {},
): Promise<HttpResult<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await res.json()
    : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: body as T };
}

/**
 * Provision a tenant + tenant admin with a REAL, verifiable password hash
 * (unlike helpers/db.ts's `provisionTenant`, whose fixed placeholder hash is
 * only good enough for RLS tests that never call login). Written directly
 * through the BYPASSRLS superadmin pool so setup itself never touches the
 * throttled /auth/login route, keeping the 11-request budget in the test body
 * entirely about the throttle behavior.
 */
async function provisionLoginUser(
  pools: ReturnType<typeof makePools>,
  password: string,
): Promise<{ tenantId: string; slug: string; email: string }> {
  const { PasswordService } = await import('../dist/auth/password.service.js');
  const passwordHash = await new PasswordService().hashPassword(password);

  const id = newId();
  const slug = `rl-${id.slice(0, 8)}`;
  const email = `rl-${id.slice(0, 8)}@example.test`;

  const client = await pools.superadmin.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,$4)', [
      id,
      `RateLimit ${id.slice(0, 6)}`,
      slug,
      'active',
    ]);
    const userId = newId();
    await client.query(
      `INSERT INTO tenant_users (id, tenant_id, email, password_hash, role, status, must_change_password)
       VALUES ($1,$2,$3,$4,'admin','active',false)`,
      [userId, id, email, passwordHash],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { tenantId: id, slug, email };
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
  process.env.CLOUD_TASKS_DRIVER = 'inline';
  process.env.INTERNAL_TASK_TOKEN = INTERNAL_TOKEN;
  delete process.env.GEMINI_API_KEY;

  available = (await isDbReachable()) && (await reachable(MINIO_HEALTH));
  if (!available) {
    if (process.env.REQUIRE_E2E_INFRA === 'true') {
      throw new Error('auth rate-limit tests require local Postgres and MinIO (npm run dev:infra)');
    }
    console.warn('[auth-rate-limit] local Postgres/MinIO unavailable; skipping.');
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

describe('auth route rate limits', () => {
  it('throttles POST /auth/login after 10 requests within the 60s window', async (t) => {
    if (!available || !app) return t.skip('local emulators unavailable');

    const password = 'rate-limit-password-123';
    const pools = makePools();
    let user: { tenantId: string; slug: string; email: string };
    try {
      user = await provisionLoginUser(pools, password);
    } finally {
      await pools.close();
    }
    tenantId = user.tenantId;

    // @Throttle({ default: { limit: 10, ttl: 60_000 } }) on login: the guard
    // runs (and counts) on every request that reaches it regardless of the
    // handler's outcome, so 10 successful logins fill the same bucket a mix of
    // successes/failures would. Using valid credentials throughout keeps the
    // expected status for requests 1-10 unambiguous (201), isolating the
    // assertion to the throttle firing on request 11.
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: user.email, password, tenantSlug: user.slug },
      });
      statuses.push(res.status);
    }

    assert.deepEqual(
      statuses.slice(0, 10),
      Array(10).fill(201),
      `expected the first 10 logins (within the throttle limit) to succeed, got: ${JSON.stringify(statuses)}`,
    );
    assert.equal(
      statuses[10],
      429,
      `expected the 11th login within the same 60s window to be throttled, got: ${JSON.stringify(statuses)}`,
    );
  });

  it('throttles POST /auth/refresh after 30 requests within the 60s window', async (t) => {
    if (!available || !app) return t.skip('local emulators unavailable');

    // ThrottlerGuard runs before the route handler body (Nest's guard pipeline
    // executes all guards before the controller method), so it fires -- and
    // counts the request -- whether or not the refresh token it's given is
    // valid. A single reused, never-issued token is enough to drive the limit:
    // requests 1-30 are rejected as unauthenticated (401, invalid token) by the
    // handler itself, and only request 31 is stopped by the guard (429) before
    // the handler runs at all.
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await request('/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: 'not-a-real-refresh-token' },
      });
      statuses.push(res.status);
    }

    assert.deepEqual(
      statuses.slice(0, 30),
      Array(30).fill(401),
      `expected the first 30 refresh attempts (within the throttle limit) to be rejected as unauthenticated, got: ${JSON.stringify(statuses)}`,
    );
    assert.equal(
      statuses[30],
      429,
      `expected the 31st refresh within the same 60s window to be throttled, got: ${JSON.stringify(statuses)}`,
    );
  });
});
