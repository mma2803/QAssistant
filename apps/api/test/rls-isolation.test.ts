/**
 * Task 6.3 - cross-tenant isolation.
 *
 * Verifies, against the real schema + canonical RLS policy, that:
 *   1. a tenant-A session var cannot read tenant-B rows;
 *   2. a missing app.tenant_id sees zero rows (deny-by-default);
 *   3. RLS WITH CHECK denies cross-tenant writes (insert/update into another
 *      tenant) and denies inserts with no tenant var set;
 *   4. the read-own-row policy on `tenants` exposes only the caller's tenant;
 *   5. a non-provisioned identity (no tenant_users row) resolves to no acting
 *      user, which the transaction interceptor treats as unauthenticated -> the
 *      DB analogue of "a non-provisioned email cannot sign in".
 *   6. the tenant-settings feature (GET/PUT /tenant/settings) is not backed by
 *      a separate `tenant_settings` table -- it reads/writes the default_test_*
 *      columns on `tenants` itself (migrations 0002/0003/0008) -- so its
 *      isolation is the tenant_self_read / tenant_self_update_defaults
 *      policies on `tenants`, exercised here against those specific columns.
 *   7. `codegen_jobs` has NO row-level-security policy at all (migration 0009
 *      creates it without `ENABLE ROW LEVEL SECURITY` and grants app_user full
 *      DML) -- a deliberate choice documented in cloud-tasks.service.ts
 *      ("internal plumbing only ... always runs on the BYPASSRLS pool"). This
 *      suite proves that fact against the schema rather than trusting the
 *      comment: a tenant-scoped session can see another tenant's job row.
 *
 * Skips cleanly if no Postgres is reachable.
 */
import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDbReachable,
  ensureSchema,
  makePools,
  withTenant,
  provisionTenant,
  cleanupTenants,
  withNoTenantConnection,
  newId,
  type Pools,
} from './helpers/db.js';

let pools: Pools | null = null;
let reachable = false;
const tenantIds: string[] = [];

let tenantA = '';
let tenantB = '';
let adminA = '';
let adminB = '';
let projectA = '';
let projectB = '';
let sessionA = '';
let sessionB = '';
let jiraA = '';
let jiraB = '';
let artifactA = '';
let artifactB = '';
let flagA = '';
let flagB = '';
let generatedA = '';
let generatedB = '';
let commentA = '';
let commentB = '';

async function seedChildRows(
  client: import('pg').PoolClient,
  ids: {
    tenantId: string;
    adminId: string;
    projectId: string;
    sessionId: string;
    jiraId: string;
    artifactId: string;
    flagId: string;
    generatedId: string;
    commentId: string;
    label: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO jira_configs
       (id, tenant_id, project_id, base_url, project_key, token_secret_ref, status)
     VALUES ($1,$2,$3,$4,$5,$6,'active')`,
    [
      ids.jiraId,
      ids.tenantId,
      ids.projectId,
      `https://jira-${ids.label}.example.com`,
      ids.label.toUpperCase(),
      `local://jira-${ids.label}`,
    ],
  );
  await client.query(
    `INSERT INTO artifacts
       (id, tenant_id, project_id, session_id, type, seq, gcs_path, content_type, size_bytes, compression, captured_at)
     VALUES ($1,$2,$3,$4,'dom_chunk',0,$5,'application/json',2,'none',now())`,
    [ids.artifactId, ids.tenantId, ids.projectId, ids.sessionId, `${ids.label}/dom-0.json`],
  );
  await client.query(
    `INSERT INTO flags
       (id, tenant_id, project_id, session_id, selector, note, event_offset_ms)
     VALUES ($1,$2,$3,$4,$5,$6,100)`,
    [ids.flagId, ids.tenantId, ids.projectId, ids.sessionId, `#${ids.label}`, `Flag ${ids.label}`],
  );
  await client.query(
    `INSERT INTO generated_tests
       (id, tenant_id, project_id, session_id, version, kind, model_tier, model_id, code, prompt_inputs_summary, created_by)
     VALUES ($1,$2,$3,$4,1,'playwright_test','pro','model-test',$5,$6::jsonb,$7)`,
    [
      ids.generatedId,
      ids.tenantId,
      ids.projectId,
      ids.sessionId,
      `test('${ids.label}', () => {})`,
      JSON.stringify({ sources: [] }),
      ids.adminId,
    ],
  );
  await client.query(
    `INSERT INTO generation_comments
       (id, tenant_id, project_id, session_id, generated_test_id, body, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      ids.commentId,
      ids.tenantId,
      ids.projectId,
      ids.sessionId,
      ids.generatedId,
      `Comment ${ids.label}`,
      ids.adminId,
    ],
  );
}

before(async () => {
  reachable = await isDbReachable();
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn('[rls-isolation] no Postgres reachable; skipping. Run `npm run dev:infra` first.');
    return;
  }
  await ensureSchema();
  pools = makePools();

  const provA = await provisionTenant(pools, {
    tenantName: 'Tenant A',
    slug: `tenant-a-${newId()}`,
    adminEmail: `admin-a-${newId()}@example.com`,
  });
  tenantA = provA.tenantId;
  adminA = provA.adminUserId;
  tenantIds.push(tenantA);

  const provB = await provisionTenant(pools, {
    tenantName: 'Tenant B',
    slug: `tenant-b-${newId()}`,
    adminEmail: `admin-b-${newId()}@example.com`,
  });
  tenantB = provB.tenantId;
  adminB = provB.adminUserId;
  tenantIds.push(tenantB);

  // Seed one project + session per tenant via the RLS path (each scoped to its tenant).
  projectA = newId();
  projectB = newId();
  sessionA = newId();
  sessionB = newId();
  jiraA = newId();
  jiraB = newId();
  artifactA = newId();
  artifactB = newId();
  flagA = newId();
  flagB = newId();
  generatedA = newId();
  generatedB = newId();
  commentA = newId();
  commentB = newId();

  await withTenant(pools, tenantA, async (c) => {
    await c.query('INSERT INTO projects (id, tenant_id, name, base_url) VALUES ($1,$2,$3,$4)', [
      projectA,
      tenantA,
      'Proj A',
      'https://a.example.com',
    ]);
    await c.query(
      `INSERT INTO sessions (id, tenant_id, project_id, recorded_by, description, screenshot_enabled, status, started_at)
      VALUES ($1,$2,$3,$4,$5,false,'active',now())`,
      [sessionA, tenantA, projectA, adminA, 'session A work context'],
    );
    await seedChildRows(c, {
      tenantId: tenantA,
      adminId: adminA,
      projectId: projectA,
      sessionId: sessionA,
      jiraId: jiraA,
      artifactId: artifactA,
      flagId: flagA,
      generatedId: generatedA,
      commentId: commentA,
      label: 'a',
    });
  });

  await withTenant(pools, tenantB, async (c) => {
    await c.query('INSERT INTO projects (id, tenant_id, name, base_url) VALUES ($1,$2,$3,$4)', [
      projectB,
      tenantB,
      'Proj B',
      'https://b.example.com',
    ]);
    await c.query(
      `INSERT INTO sessions (id, tenant_id, project_id, recorded_by, description, screenshot_enabled, status, started_at)
      VALUES ($1,$2,$3,$4,$5,false,'active',now())`,
      [sessionB, tenantB, projectB, provB.adminUserId, 'session B work context'],
    );
    await seedChildRows(c, {
      tenantId: tenantB,
      adminId: adminB,
      projectId: projectB,
      sessionId: sessionB,
      jiraId: jiraB,
      artifactId: artifactB,
      flagId: flagB,
      generatedId: generatedB,
      commentId: commentB,
      label: 'b',
    });
  });
});

after(async () => {
  if (pools) {
    await cleanupTenants(pools, tenantIds);
    await pools.close();
  }
});

describe('RLS cross-tenant isolation', () => {
  it('tenant A cannot read tenant B rows', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantA, async (c) => {
      const projects = await c.query('SELECT id FROM projects');
      const sessions = await c.query('SELECT id FROM sessions');
      const ids = projects.rows.map((r) => r.id);
      assert.ok(ids.includes(projectA), 'tenant A sees its own project');
      assert.ok(!ids.includes(projectB), 'tenant A must NOT see tenant B project');
      assert.ok(
        sessions.rows.every((r) => r.id !== sessionB),
        'tenant A must NOT see tenant B session',
      );
    });
  });

  it('tenant B cannot read tenant A rows', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantB, async (c) => {
      const projects = await c.query('SELECT id FROM projects');
      const ids = projects.rows.map((r) => r.id);
      assert.ok(ids.includes(projectB));
      assert.ok(!ids.includes(projectA), 'tenant B must NOT see tenant A project');
    });
  });

  it('missing app.tenant_id sees zero rows (deny-by-default)', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withNoTenantConnection(async (c) => {
      const projects = await c.query('SELECT count(*)::int AS n FROM projects');
      const sessions = await c.query('SELECT count(*)::int AS n FROM sessions');
      const users = await c.query('SELECT count(*)::int AS n FROM tenant_users');
      const tenants = await c.query('SELECT count(*)::int AS n FROM tenants');
      assert.equal(projects.rows[0].n, 0, 'no tenant var -> zero projects');
      assert.equal(sessions.rows[0].n, 0, 'no tenant var -> zero sessions');
      assert.equal(users.rows[0].n, 0, 'no tenant var -> zero users');
      assert.equal(tenants.rows[0].n, 0, 'no tenant var -> zero tenants (read-own-row policy)');
    });
  });

  it('tenants read-own-row policy exposes only the callers tenant', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantA, async (c) => {
      const rows = await c.query('SELECT id FROM tenants');
      assert.equal(rows.rowCount, 1, 'exactly one tenant row visible');
      assert.equal(rows.rows[0].id, tenantA, 'and it is the caller tenant');
    });
  });

  it('tenant-settings defaults are invisible cross-tenant (no tenant_settings table -- columns on tenants)', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    // The GET/PUT /tenant/settings API (TenantSettingsService) reads and writes
    // default_test_framework/default_test_language/default_test_type directly
    // on `tenants` -- there is no standalone `tenant_settings` table in the
    // schema. Isolation therefore rides on the same tenant_self_read policy
    // used above; assert it here against those specific columns.
    await withTenant(pools, tenantA, async (c) => {
      const rows = await c.query(
        'SELECT id, default_test_framework, default_test_language, default_test_type FROM tenants WHERE id = $1',
        [tenantB],
      );
      assert.equal(rows.rowCount, 0, 'tenant A cannot select tenant B settings row at all');
    });
  });

  it('tenant A cannot update tenant B tenant-settings defaults (zero rows affected, not an error)', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    // Migration 0003's tenant_self_update_defaults policy (FOR UPDATE, USING +
    // WITH CHECK both `id = current_setting('app.tenant_id')`) scopes the
    // column-level UPDATE grant on default_* columns to the caller's own row.
    // app_user DOES have the column grant, so a mismatch is not a permission
    // error -- it is an RLS-filtered zero-row UPDATE, same shape as the
    // sessions/tenant_users cross-tenant UPDATE tests below.
    await withTenant(pools, tenantA, async (c) => {
      const res = await c.query("UPDATE tenants SET default_test_framework = 'Cypress' WHERE id = $1", [
        tenantB,
      ]);
      assert.equal(res.rowCount, 0, 'tenant B row is invisible under tenant_self_update_defaults, so 0 rows updated');
    });
    await withTenant(pools, tenantB, async (c) => {
      const r = await c.query('SELECT default_test_framework FROM tenants WHERE id = $1', [tenantB]);
      assert.equal(r.rows[0].default_test_framework, 'Playwright', 'tenant B default framework unchanged');
    });
  });

  it('RLS WITH CHECK denies a cross-tenant insert', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    // Acting as tenant A, try to insert a project tagged with tenant B's id.
    await assert.rejects(
      () =>
        withTenant(pools as Pools, tenantA, async (c) => {
          await c.query('INSERT INTO projects (id, tenant_id, name, base_url) VALUES ($1,$2,$3,$4)', [
            newId(),
            tenantB,
            'smuggled',
            'https://evil.example.com',
          ]);
        }),
      /row-level security|policy/i,
      'WITH CHECK must reject inserting a row for another tenant',
    );
  });

  it('RLS denies inserts when no tenant var is set', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        withNoTenantConnection(async (c) => {
          await c.query('INSERT INTO projects (id, tenant_id, name, base_url) VALUES ($1,$2,$3,$4)', [
            newId(),
            tenantA,
            'no-scope',
            'https://x.example.com',
          ]);
        }),
      /row-level security|policy/i,
      'no tenant var -> WITH CHECK is false -> insert denied',
    );
  });

  it('tenant A cannot update tenant B rows (zero rows affected, not an error)', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantA, async (c) => {
      const res = await c.query("UPDATE sessions SET summary = 'tampered' WHERE id = $1", [sessionB]);
      assert.equal(res.rowCount, 0, 'tenant B session is invisible to tenant A, so 0 rows updated');
    });
    // Confirm tenant B's row is untouched.
    await withTenant(pools, tenantB, async (c) => {
      const r = await c.query('SELECT summary FROM sessions WHERE id = $1', [sessionB]);
      assert.equal(r.rows[0].summary, null, 'tenant B session summary unchanged');
    });
  });

  it('a non-provisioned identity resolves to no acting user (cannot act)', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    // The transaction interceptor resolves the acting user by id (the token's
    // uid claim) within the tenant transaction; a non-provisioned id resolves
    // to no row and the request is rejected as unauthenticated. Model that
    // lookup here.
    await withTenant(pools, tenantA, async (c) => {
      const r = await c.query('SELECT id FROM tenant_users WHERE id = $1', [newId()]);
      assert.equal(r.rowCount, 0, 'unknown identity has no tenant_users row -> no acting user');
    });
  });

  it('tenant_users exposes only users from the active tenant', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantA, async (c) => {
      const rows = await c.query('SELECT id FROM tenant_users ORDER BY id');
      assert.deepEqual(rows.rows.map((row) => row.id), [adminA]);
      assert.ok(!rows.rows.some((row) => row.id === adminB));
    });
  });

  it('jira_configs exposes only configuration from the active tenant', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantA, async (c) => {
      const rows = await c.query('SELECT id FROM jira_configs');
      assert.deepEqual(rows.rows.map((row) => row.id), [jiraA]);
      assert.ok(!rows.rows.some((row) => row.id === jiraB));
    });
  });

  it('artifacts exposes only objects from the active tenant', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantA, async (c) => {
      const rows = await c.query('SELECT id FROM artifacts');
      assert.deepEqual(rows.rows.map((row) => row.id), [artifactA]);
      assert.ok(!rows.rows.some((row) => row.id === artifactB));
    });
  });

  it('flags exposes only selectors from the active tenant', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantA, async (c) => {
      const rows = await c.query('SELECT id FROM flags');
      assert.deepEqual(rows.rows.map((row) => row.id), [flagA]);
      assert.ok(!rows.rows.some((row) => row.id === flagB));
    });
  });

  it('generated_tests exposes only versions from the active tenant', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantA, async (c) => {
      const rows = await c.query('SELECT id FROM generated_tests');
      assert.deepEqual(rows.rows.map((row) => row.id), [generatedA]);
      assert.ok(!rows.rows.some((row) => row.id === generatedB));
    });
  });

  it('generation_comments exposes only review comments from the active tenant', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantA, async (c) => {
      const rows = await c.query('SELECT id FROM generation_comments');
      assert.deepEqual(rows.rows.map((row) => row.id), [commentA]);
      assert.ok(!rows.rows.some((row) => row.id === commentB));
    });
  });

  it('tenant A cannot delete tenant B projects', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantA, async (c) => {
      const result = await c.query('DELETE FROM projects WHERE id = $1', [projectB]);
      assert.equal(result.rowCount, 0);
    });
    await withTenant(pools, tenantB, async (c) => {
      const result = await c.query('SELECT id FROM projects WHERE id = $1', [projectB]);
      assert.equal(result.rowCount, 1);
    });
  });

  it('tenant A cannot delete tenant B sessions', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantA, async (c) => {
      const result = await c.query('DELETE FROM sessions WHERE id = $1', [sessionB]);
      assert.equal(result.rowCount, 0);
    });
    await withTenant(pools, tenantB, async (c) => {
      const result = await c.query('SELECT id FROM sessions WHERE id = $1', [sessionB]);
      assert.equal(result.rowCount, 1);
    });
  });

  it('tenant A cannot update tenant B users', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantA, async (c) => {
      const result = await c.query("UPDATE tenant_users SET role = 'qa-engineer' WHERE id = $1", [
        adminB,
      ]);
      assert.equal(result.rowCount, 0);
    });
    await withTenant(pools, tenantB, async (c) => {
      const result = await c.query('SELECT role FROM tenant_users WHERE id = $1', [adminB]);
      assert.equal(result.rows[0].role, 'admin');
    });
  });

  it('RLS WITH CHECK denies cross-tenant artifact inserts', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        withTenant(pools as Pools, tenantA, async (c) => {
          await c.query(
            `INSERT INTO artifacts
               (id, tenant_id, project_id, session_id, type, seq, gcs_path, content_type, size_bytes, compression, captured_at)
             VALUES ($1,$2,$3,$4,'dom_chunk',1,'b/smuggled.json','application/json',2,'none',now())`,
            [newId(), tenantB, projectB, sessionB],
          );
        }),
      /row-level security|policy/i,
    );
  });

  it('RLS WITH CHECK denies cross-tenant flag inserts', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        withTenant(pools as Pools, tenantA, async (c) => {
          await c.query(
            `INSERT INTO flags (id, tenant_id, project_id, session_id, selector)
             VALUES ($1,$2,$3,$4,'#smuggled')`,
            [newId(), tenantB, projectB, sessionB],
          );
        }),
      /row-level security|policy/i,
    );
  });

  it('RLS WITH CHECK denies cross-tenant generated-test inserts', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        withTenant(pools as Pools, tenantA, async (c) => {
          await c.query(
            `INSERT INTO generated_tests
               (id, tenant_id, project_id, session_id, version, kind, model_tier, model_id, code, prompt_inputs_summary, created_by)
             VALUES ($1,$2,$3,$4,2,'playwright_test','pro','model-test','test code','{}'::jsonb,$5)`,
            [newId(), tenantB, projectB, sessionB, adminB],
          );
        }),
      /row-level security|policy/i,
    );
  });

  it('RLS WITH CHECK denies cross-tenant generation-comment inserts', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        withTenant(pools as Pools, tenantA, async (c) => {
          await c.query(
            `INSERT INTO generation_comments
               (id, tenant_id, project_id, session_id, generated_test_id, body, created_by)
             VALUES ($1,$2,$3,$4,$5,'smuggled comment',$6)`,
            [newId(), tenantB, projectB, sessionB, generatedB, adminB],
          );
        }),
      /row-level security|policy/i,
    );
  });

  it('codegen_jobs has no RLS policy at all (deliberate: internal plumbing, BYPASSRLS-only access)', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    // Migration 0009 creates `codegen_jobs` with no `ENABLE ROW LEVEL SECURITY`
    // / `FORCE ROW LEVEL SECURITY` and its trailing grants block explicitly
    // hands app_user full SELECT/INSERT/UPDATE/DELETE on it alongside the other
    // "platform/plumbing" tables, with the comment: "the four new tables ...
    // No RLS is enabled on them (nothing here is queried by request-time
    // tenant context)". cloud-tasks.service.ts makes the same claim at the
    // call site ("No RLS on this table ... always runs on the BYPASSRLS
    // pool") and both PostgresCloudTasksDispatcher.enqueueGenerate and
    // CodegenPollerService's claim query use db.withSuperadmin exclusively --
    // never a tenant-scoped transaction. Prove the absence of a policy
    // directly (rather than trusting the comments): acting as tenant A on the
    // RLS-enforced app_user pool, a plain SELECT must ALSO return tenant B's
    // job row, because there is no tenant_isolation predicate to filter it.
    // Isolation for this table is therefore an application-discipline
    // guarantee (always go through the BYPASSRLS pool), not a DB-enforced one.
    const jobA = newId();
    const jobB = newId();
    try {
      await pools.superadmin.query(
        `INSERT INTO codegen_jobs (id, tenant_id, session_id, payload, status)
         VALUES ($1,$2,$3,$4::jsonb,'pending')`,
        [jobA, tenantA, sessionA, JSON.stringify({ kind: 'generate' })],
      );
      await pools.superadmin.query(
        `INSERT INTO codegen_jobs (id, tenant_id, session_id, payload, status)
         VALUES ($1,$2,$3,$4::jsonb,'pending')`,
        [jobB, tenantB, sessionB, JSON.stringify({ kind: 'generate' })],
      );

      await withTenant(pools, tenantA, async (c) => {
        const rows = await c.query('SELECT id FROM codegen_jobs WHERE id = ANY($1)', [[jobA, jobB]]);
        const ids = rows.rows.map((r) => r.id);
        assert.ok(ids.includes(jobA), 'tenant A sees its own job');
        assert.ok(
          ids.includes(jobB),
          'no RLS on codegen_jobs -> tenant A session ALSO sees tenant B job (proves no isolation policy exists)',
        );
      });
    } finally {
      // Clean up explicitly: codegen_jobs is not in cleanupTenants' table list,
      // and its session_id FK (ON DELETE RESTRICT) would otherwise block the
      // after() hook from deleting sessionA/sessionB.
      await pools.superadmin.query('DELETE FROM codegen_jobs WHERE id = ANY($1)', [[jobA, jobB]]);
    }
  });

  it('same-tenant child writes remain allowed by WITH CHECK', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    await withTenant(pools, tenantA, async (c) => {
      const id = newId();
      const inserted = await c.query(
        `INSERT INTO flags (id, tenant_id, project_id, session_id, selector)
         VALUES ($1,$2,$3,$4,'#allowed') RETURNING id`,
        [id, tenantA, projectA, sessionA],
      );
      assert.equal(inserted.rows[0].id, id);
      const deleted = await c.query('DELETE FROM flags WHERE id = $1', [id]);
      assert.equal(deleted.rowCount, 1);
    });
  });

  it('transaction-local tenant scope is cleared after commit', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    const client = await pools.app.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const inside = await client.query("SELECT current_setting('app.tenant_id', true) AS value");
      assert.equal(inside.rows[0].value, tenantA);
      await client.query('COMMIT');

      await client.query('BEGIN');
      const afterCommit = await client.query(
        "SELECT current_setting('app.tenant_id', true) AS value",
      );
      assert.ok(!afterCommit.rows[0].value, 'tenant scope must not leak after commit');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('one pooled connection can switch tenant scope between transactions without leakage', async (t) => {
    if (!reachable || !pools) return t.skip('no Postgres');
    const client = await pools.app.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const asA = await client.query('SELECT id FROM projects ORDER BY id');
      await client.query('COMMIT');
      assert.deepEqual(asA.rows.map((row) => row.id), [projectA]);

      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
      const asB = await client.query('SELECT id FROM projects ORDER BY id');
      await client.query('COMMIT');
      assert.deepEqual(asB.rows.map((row) => row.id), [projectB]);
    } finally {
      client.release();
    }
  });
});
