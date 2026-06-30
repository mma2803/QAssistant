/**
 * DB-backed coverage for the configurable-test-type change, driven through the
 * real service layer + inline codegen worker (same harness as e2e-flow):
 *   - a backend generation reads the session's network_log artifact, persists
 *     testType='backend' on the row and in promptInputsSummary, and grounds the
 *     prompt in the captured traffic (recording.network source);
 *   - the tenant default test type round-trips through TenantSettingsService
 *     under RLS (proves the column-level GRANT from migration 0008);
 *   - a second tenant cannot read the first tenant's generated test (isolation).
 *
 * Runs offline against any reachable Postgres; skips cleanly when none is.
 */
import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import type { NetworkLogChunk } from '@qassistant/shared';
import { isDbReachable, ensureSchema, newId } from './helpers/db.js';
import { buildHarness, type Harness, type TenantIdentity } from './helpers/app.js';
import { AdminService } from '../src/admin/admin.service.js';
import { ProjectsService } from '../src/projects/projects.service.js';
import { CaptureService } from '../src/capture/capture.service.js';
import { CodegenService } from '../src/codegen/codegen.service.js';
import { TenantSettingsService } from '../src/tenant-settings/tenant-settings.service.js';
import { JiraValidationService } from '../src/jira/jira-validation.service.js';
import { artifactObjectPath } from '../src/storage/gcs-signer.service.js';
import { AppException } from '../src/auth/errors.js';
import type { RequestContext } from '../src/auth/request-context.js';

let h: Harness | null = null;
let reachable = false;
const tenantIds: string[] = [];

function jiraValidationFor(ctx: RequestContext, harness: Harness): JiraValidationService {
  return new JiraValidationService(ctx, harness.jira, harness.secrets);
}

async function provisionTenant(prefix: string): Promise<TenantIdentity> {
  const adminSvc = new AdminService(h!.db, h!.firebaseAs());
  const result = await adminSvc.createTenant({
    name: `${prefix} ${newId()}`,
    firstAdmin: { email: `admin-${newId()}@${prefix}.test`, password: 'initial-pw-1' },
  });
  tenantIds.push(result.tenant.id);
  return {
    uid: result.firstAdmin.gcipUid,
    role: 'admin',
    tenantId: result.tenant.id,
    actingUserId: result.firstAdmin.id,
    mustChangePassword: true,
  };
}

before(async () => {
  reachable = await isDbReachable();
  if (!reachable) {
    console.warn('[configurable-test-type-e2e] no Postgres reachable; skipping.');
    return;
  }
  await ensureSchema();
  h = await buildHarness();
});

after(async () => {
  if (h) {
    if (tenantIds.length > 0) {
      await h.db.withSuperadmin(async ({ client }) => {
        await client.query(
          'UPDATE generated_tests SET source_comment_id = NULL WHERE tenant_id = ANY($1::uuid[])',
          [tenantIds],
        );
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
      });
    }
    await h.close();
  }
});

describe('configurable-test-type (DB-backed)', () => {
  it('generates a backend test grounded in the session network_log and persists testType', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const admin = await provisionTenant('acme-bk');
    const tenantId = admin.tenantId;

    // Project + recorded session.
    const project = await h.asTenant(admin, async (ctx) => {
      const projects = new ProjectsService(ctx, h!.secrets, jiraValidationFor(ctx, h!));
      return projects.createProject({
        name: `proj-${newId()}`,
        baseUrl: 'https://api.acme.test',
        screenshotDefault: false,
        maskingSelectors: [],
        inactivityTimeoutSeconds: 900,
      });
    });
    const session = await h.asTenant(admin, async (ctx) => {
      const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
      return capture.startSession({
        projectId: project.id,
        description: 'Exercise the cart API',
        screenshotEnabled: false,
      });
    });

    // Stage a network_log artifact (gzipped JSON chunk) and register it.
    const netPath = artifactObjectPath({
      tenantId,
      projectId: project.id,
      sessionId: session.id,
      type: 'network_log',
      seq: 0,
    });
    const chunk: NetworkLogChunk = {
      entries: [
        {
          method: 'POST',
          url: 'https://api.acme.test/cart/items',
          status: 201,
          requestHeaders: { 'content-type': 'application/json' },
          responseHeaders: { 'content-type': 'application/json' },
          requestBody: '{"sku":"ABC","qty":2}',
          responseBody: '{"id":"cart_1","itemCount":2}',
          startedAtMs: 0,
          durationMs: 12,
        },
      ],
    };
    h.reader.put(netPath, gzipSync(Buffer.from(JSON.stringify(chunk), 'utf8')));

    await h.asTenant(admin, async (ctx) => {
      const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
      await capture.registerArtifact(session.id, {
        type: 'network_log',
        seq: 0,
        gcsPath: netPath,
        contentType: 'application/json',
        sizeBytes: 256,
        compression: 'gzip',
        capturedAt: new Date().toISOString(),
      });
      await capture.stopSession(session.id);
    });

    // Generate with a per-generation backend override -> inline worker.
    await h.asTenant(admin, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.generate(session.id, { kind: 'playwright_test', testType: 'backend' });
    });

    const gens = await h.asTenant(admin, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.listGenerations(session.id);
    });
    assert.equal(gens.length, 1, 'one generated version');
    const gen = gens[0]!;
    assert.equal(gen.testType, 'backend', 'row records the resolved backend test type');
    assert.equal(
      gen.promptInputsSummary.testType,
      'backend',
      'prompt summary records the backend test type',
    );
    assert.ok(
      gen.promptInputsSummary.sources.some((s) => s.label === 'recording.network'),
      'the captured network traffic was used as a source',
    );
    assert.ok(
      !gen.promptInputsSummary.sources.some((s) => s.label === 'recording.dom'),
      'a backend test does not use the DOM-replay source',
    );
  });

  it('tenant default test type round-trips under RLS (column GRANT works)', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const admin = await provisionTenant('acme-settings');
    const updated = await h.asTenant(admin, async (ctx) => {
      const settings = new TenantSettingsService(ctx);
      return settings.update({
        defaultTestFramework: 'Playwright',
        defaultTestLanguage: 'TypeScript',
        defaultTestType: 'backend',
      });
    });
    assert.equal(updated.defaultTestType, 'backend');
    const read = await h.asTenant(admin, async (ctx) => new TenantSettingsService(ctx).get());
    assert.equal(read.defaultTestType, 'backend', 'persisted default test type reads back');
  });

  it("a second tenant cannot read the first tenant's generated test", async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const a = await provisionTenant('iso-a');
    const b = await provisionTenant('iso-b');

    // Tenant A produces a generated test (UI is fine for this isolation check).
    // Each step is its own committed transaction so the inline worker (which runs
    // in a separate superadmin transaction) sees the persisted session.
    const sessionId = await h.asTenant(a, async (ctx) => {
      const projects = new ProjectsService(ctx, h!.secrets, jiraValidationFor(ctx, h!));
      const project = await projects.createProject({
        name: `proj-${newId()}`,
        baseUrl: 'https://app.iso-a.test',
        screenshotDefault: false,
        maskingSelectors: [],
        inactivityTimeoutSeconds: 900,
      });
      const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
      const s = await capture.startSession({
        projectId: project.id,
        description: 'iso',
        screenshotEnabled: false,
      });
      await capture.stopSession(s.id);
      return s.id;
    });
    const genId = await h.asTenant(a, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      await codegen.generate(sessionId, { kind: 'playwright_test' });
      const list = await codegen.listGenerations(sessionId);
      return list[0]!.id;
    });
    assert.ok(sessionId && genId);

    await assert.rejects(
      () =>
        h!.asTenant(b, async (ctx) => {
          const codegen = new CodegenService(ctx, h!.dispatcher);
          return codegen.getGeneration(genId);
        }),
      (err: unknown) => err instanceof AppException && err.code === 'not_found',
      "tenant B is denied the other tenant's generated test",
    );
  });
});
