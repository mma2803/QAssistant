/**
 * Test database helper.
 *
 * These integration tests exercise the real PostgreSQL schema and the canonical
 * row-level-security policies from `src/db/migrations` against a live Postgres
 * (the docker-compose emulator by default). They run offline as long as a
 * Postgres is reachable; if none is reachable the suites skip rather than fail
 * (see `tryConnect` / the `before` guards in each test file).
 *
 * Roles used (contract section 8):
 *   - app_migrator  : owns the schema, runs DDL + the RLS migration.
 *   - app_user      : RLS-enforced runtime role (NOBYPASSRLS, not owner).
 *   - app_superadmin: BYPASSRLS provisioning role.
 *
 * The helper bootstraps the roles and applies every migration file in
 * `src/db/migrations` (in lexical order) idempotently, so the suite is
 * self-contained and does not require `npm run db:migrate` first. New
 * migrations are picked up automatically — no hard-coded file list to update.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Pool } from 'pg';
import { uuidv7 } from 'uuidv7';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'src', 'db', 'migrations');

const env = process.env;

const DB_HOST = env.TEST_DB_HOST ?? env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(env.TEST_DB_PORT ?? env.DB_PORT ?? 5432);
const DB_NAME = env.TEST_DB_NAME ?? env.DB_NAME ?? 'qassistant';

// Bootstrap superuser (docker-compose default: postgres/postgres). Used only to
// create the app roles if they are missing.
const BOOTSTRAP_USER = env.TEST_DB_BOOTSTRAP_USER ?? env.DB_BOOTSTRAP_USER ?? 'postgres';
const BOOTSTRAP_PASSWORD = env.TEST_DB_BOOTSTRAP_PASSWORD ?? env.DB_BOOTSTRAP_PASSWORD ?? 'postgres';

const MIGRATOR_USER = env.DB_MIGRATOR_USER ?? 'app_migrator';
const MIGRATOR_PASSWORD = env.DB_MIGRATOR_PASSWORD ?? 'app_migrator_pw';
const APP_USER = env.DB_USER ?? 'app_user';
const APP_PASSWORD = env.DB_PASSWORD ?? 'app_user_pw';
const SUPERADMIN_USER = env.DB_SUPERADMIN_USER ?? 'app_superadmin';
const SUPERADMIN_PASSWORD = env.DB_SUPERADMIN_PASSWORD ?? 'app_superadmin_pw';

export const newId = (): string => uuidv7();

function baseConfig(user: string, password: string) {
  return { host: DB_HOST, port: DB_PORT, database: DB_NAME, user, password };
}

/** True if a Postgres accepting the bootstrap user is reachable. */
export async function isDbReachable(): Promise<boolean> {
  const client = new Client({ ...baseConfig(BOOTSTRAP_USER, BOOTSTRAP_PASSWORD), connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    return false;
  }
}

/**
 * Ensure the three app roles exist with the right RLS posture and that both
 * migrations have been applied. Idempotent. Returns silently when already done.
 */
export async function ensureSchema(): Promise<void> {
  const admin = new Client(baseConfig(BOOTSTRAP_USER, BOOTSTRAP_PASSWORD));
  await admin.connect();
  try {
    await admin.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_migrator') THEN
          CREATE ROLE app_migrator LOGIN PASSWORD '${MIGRATOR_PASSWORD}' CREATEDB;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
          CREATE ROLE app_user LOGIN PASSWORD '${APP_PASSWORD}';
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_superadmin') THEN
          CREATE ROLE app_superadmin LOGIN PASSWORD '${SUPERADMIN_PASSWORD}' BYPASSRLS;
        END IF;
      END
      $$;
    `);
    await admin.query('GRANT ALL ON SCHEMA public TO app_migrator');
    await admin.query('GRANT USAGE ON SCHEMA public TO app_user, app_superadmin');
    // Let the migrator own future objects without owning them as the superuser.
    await admin.query(`ALTER SCHEMA public OWNER TO app_migrator`);
    // The RLS migration runs `ALTER ROLE ... BYPASSRLS/NOBYPASSRLS`, which
    // requires superuser. In docker-compose the roles are created with the
    // right posture by postgres-init (run as superuser) so the migration's
    // ALTER is a privileged no-op; for the self-bootstrapping test path we grant
    // the migrator superuser locally so the same migration file applies cleanly.
    await admin.query('ALTER ROLE app_migrator SUPERUSER');
  } finally {
    await admin.end();
  }

  // Apply migrations as the migrator (DDL owner), tracked in __migrations.
  const migrator = new Client(baseConfig(MIGRATOR_USER, MIGRATOR_PASSWORD));
  await migrator.connect();
  try {
    await migrator.query(`
      CREATE TABLE IF NOT EXISTS "__migrations" (
        "name" text PRIMARY KEY,
        "applied_at" timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const applied = await migrator.query('SELECT 1 FROM "__migrations" WHERE name = $1', [file]);
      if ((applied.rowCount ?? 0) > 0) continue;
      const sqlText = await readFile(join(migrationsDir, file), 'utf8');
      await migrator.query('BEGIN');
      try {
        await migrator.query(sqlText);
        await migrator.query('INSERT INTO "__migrations" (name) VALUES ($1)', [file]);
        await migrator.query('COMMIT');
      } catch (err) {
        await migrator.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await migrator.end();
  }
}

export interface Pools {
  app: Pool;
  superadmin: Pool;
  close(): Promise<void>;
}

/** Build the runtime (RLS) and superadmin (BYPASSRLS) pools, mirroring src/db/pool.ts. */
export function makePools(): Pools {
  const app = new Pool({ ...baseConfig(APP_USER, APP_PASSWORD), max: 4 });
  const superadmin = new Pool({ ...baseConfig(SUPERADMIN_USER, SUPERADMIN_PASSWORD), max: 2 });
  return {
    app,
    superadmin,
    async close() {
      await Promise.all([app.end(), superadmin.end()]);
    },
  };
}

/**
 * Run `work` inside a transaction on the RLS pool with app.tenant_id set
 * transaction-locally (exactly the runtime path in DbService.withTenant). When
 * `tenantId` is null, the variable is left unset (the "forgot to set it" case
 * the deny-by-default policy must handle).
 */
export async function withTenant<T>(
  pools: Pools,
  tenantId: string | null,
  work: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pools.app.connect();
  try {
    await client.query('BEGIN');
    if (tenantId !== null) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    }
    const out = await work(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `work` on a brand-new app_user connection that has NEVER had
 * app.tenant_id set, modeling a request that reached the DB without the tenant
 * transaction var (the deny-by-default case in the contract).
 *
 * We use a fresh `Client` rather than a pooled connection on purpose: once a
 * custom GUC has been touched via set_config(..., true) on a backend,
 * current_setting('app.tenant_id', true) returns '' (empty string) rather than
 * NULL on that pooled connection after the transaction resets. The runtime
 * never hits that because DbService.withTenant always sets the var; a connection
 * that genuinely never set it returns NULL, which makes the policy deny-all.
 */
export async function withNoTenantConnection<T>(
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(baseConfig(APP_USER, APP_PASSWORD));
  await client.connect();
  try {
    await client.query('BEGIN');
    const out = await work(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    await client.end();
  }
}

// Placeholder argon2id hash of a fixed test password ("test-password-not-real").
// Good enough for RLS/isolation tests that never exercise login; tests that
// need a real working password provision users through the HTTP API instead
// (see e2e-flow.test.ts / http-e2e.test.ts), which calls PasswordService.
const PLACEHOLDER_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1zYWx0LXRlc3Q$MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA';

/** Provision a tenant + admin user via the BYPASSRLS superadmin pool (provisioning path). */
export async function provisionTenant(
  pools: Pools,
  opts: { tenantName: string; slug: string; adminEmail: string },
): Promise<{ tenantId: string; adminUserId: string }> {
  const client = await pools.superadmin.connect();
  try {
    await client.query('BEGIN');
    const tenantId = newId();
    await client.query(
      'INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,$4)',
      [tenantId, opts.tenantName, opts.slug, 'active'],
    );
    const adminUserId = newId();
    await client.query(
      `INSERT INTO tenant_users (id, tenant_id, email, password_hash, role, status, must_change_password)
       VALUES ($1,$2,$3,$4,'admin','active',true)`,
      [adminUserId, tenantId, opts.adminEmail, PLACEHOLDER_PASSWORD_HASH],
    );
    await client.query('COMMIT');
    return { tenantId, adminUserId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Remove all rows created by tests (run as superadmin so RLS does not hide them). */
export async function cleanupTenants(pools: Pools, tenantIds: string[]): Promise<void> {
  if (tenantIds.length === 0) return;
  const client = await pools.superadmin.connect();
  try {
    await client.query(
      'UPDATE generated_tests SET source_comment_id = NULL WHERE tenant_id = ANY($1::uuid[])',
      [tenantIds],
    );
    // Child-to-parent order to respect ON DELETE RESTRICT FKs.
    for (const table of [
      'generation_comments',
      'generated_tests',
      'flags',
      'artifacts',
      'sessions',
      'jira_configs',
      'projects',
      'tenant_users',
    ]) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
    }
    await client.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenantIds]);
  } finally {
    client.release();
  }
}
