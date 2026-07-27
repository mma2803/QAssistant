/**
 * Real Postgres-backed codegen job queue (cloud-tasks.service.ts): claim,
 * success, retry-with-backoff, and eventual MAX_ATTEMPTS -> failed. Every
 * other test in this suite uses the synchronous 'inline' dispatcher, so the
 * actual polling loop (PostgresCloudTasksDispatcher.enqueueGenerate +
 * CodegenPollerService.tick/claimOne/markFailed) had zero coverage before
 * this file.
 *
 * Drives CodegenPollerService directly rather than waiting on its real
 * setInterval (3s): tick()/claimOne()/markFailed() are `private` only at the
 * TypeScript level (erased at runtime), so a test can call them directly via
 * an `as any` cast -- the standard way to exercise a poller's step function
 * without sleeping for real in a test.
 *
 * Skips cleanly if no Postgres is reachable.
 */
import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { isDbReachable, ensureSchema, newId } from './helpers/db.js';
import { buildHarness, type Harness, type TenantIdentity } from './helpers/app.js';
import { AdminService } from '../src/admin/admin.service.js';
import { ProjectsService } from '../src/projects/projects.service.js';
import { CaptureService } from '../src/capture/capture.service.js';
import { CodegenService } from '../src/codegen/codegen.service.js';
import { CodegenWorkerService } from '../src/codegen/codegen-worker.service.js';
import {
  PostgresCloudTasksDispatcher,
  CodegenPollerService,
} from '../src/codegen/cloud-tasks.service.js';
import { JiraValidationService } from '../src/jira/jira-validation.service.js';
import type { GeminiClient } from '../src/codegen/gemini.service.js';
import { codegenJobs, generatedTests } from '../src/db/schema.js';
import type { RequestContext } from '../src/auth/request-context.js';

let h: Harness | null = null;
let reachable = false;
const tenantIds: string[] = [];

function jiraValidationFor(ctx: RequestContext): JiraValidationService {
  return new JiraValidationService(ctx, h!.jira, h!.secrets);
}

/** Provision a tenant + project + a stopped, work-context-having session, ready to generate against. */
async function setUpSession(): Promise<{ admin: TenantIdentity; sessionId: string; tenantId: string }> {
  const adminSvc = new AdminService(h!.db, h!.identity);
  const result = await adminSvc.createTenant({
    name: 'Poller Test Co',
    firstAdmin: { email: `poller-admin-${newId()}@example.test`, password: 'initial-pw-1' },
  });
  const tenantId = result.tenant.id;
  tenantIds.push(tenantId);
  const admin: TenantIdentity = {
    uid: result.firstAdmin.id,
    role: 'admin',
    tenantId,
    actingUserId: result.firstAdmin.id,
    mustChangePassword: false,
  };

  const project = await h!.asTenant(admin, async (ctx) => {
    const projects = new ProjectsService(ctx, h!.secrets, jiraValidationFor(ctx));
    return projects.createProject({
      name: 'Poller project',
      baseUrl: 'https://poller.example.test',
      screenshotDefault: false,
      maskingSelectors: [],
      inactivityTimeoutSeconds: 900,
    });
  });

  const session = await h!.asTenant(admin, async (ctx) => {
    const capture = new CaptureService(ctx, jiraValidationFor(ctx), h!.signer);
    const started = await capture.startSession({
      projectId: project.id,
      description: 'Poller test session',
    });
    return capture.stopSession(started.id);
  });

  return { admin, sessionId: session.id, tenantId };
}

/**
 * Enqueue a real codegen job through CodegenService, backed by the Postgres
 * dispatcher, then back-date its run_at by a full second.
 *
 * codegenJobs.runAt defaults via Postgres's own now() (microsecond
 * precision) at insert time; claimOne's `run_at <= now()` predicate compares
 * it against a JS `Date` (millisecond precision, no sub-millisecond
 * component). This test runs fast enough that the enqueue and the first
 * claim attempt can land within the same millisecond -- if the row's actual
 * (sub-millisecond) run_at is even slightly past that millisecond's :000
 * boundary, the comparison can evaluate false and claimOne finds nothing,
 * even though the row is "obviously" already due. Confirmed by direct
 * reproduction: this raced intermittently (job left unclaimed, attempts
 * stuck at 0) only under full-suite load, never in isolation. A full-second
 * margin removes any precision/timing ambiguity.
 */
async function enqueueRealJob(admin: TenantIdentity, sessionId: string): Promise<void> {
  const pgDispatcher = new PostgresCloudTasksDispatcher(h!.db);
  await h!.asTenant(admin, async (ctx) => {
    const codegen = new CodegenService(ctx, pgDispatcher);
    return codegen.generate(sessionId, { kind: 'playwright_test' });
  });
  await h!.db.withSuperadmin(async ({ db }) => {
    await db
      .update(codegenJobs)
      .set({ runAt: new Date(Date.now() - 1000) })
      .where(eq(codegenJobs.tenantId, admin.tenantId));
  });
}

async function getJobRow(tenantId: string): Promise<{ id: string; status: string; attempts: number; error: string | null; runAt: Date } | undefined> {
  return h!.db.withSuperadmin(async ({ db }) => {
    const rows = await db.select().from(codegenJobs).where(eq(codegenJobs.tenantId, tenantId)).limit(1);
    return rows[0] as never;
  });
}

async function countGeneratedTests(sessionId: string): Promise<number> {
  return h!.db.withSuperadmin(async ({ db }) => {
    const rows = await db.select().from(generatedTests).where(eq(generatedTests.sessionId, sessionId));
    return rows.length;
  });
}

before(async () => {
  reachable = await isDbReachable();
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn('[codegen-poller] no Postgres reachable; skipping.');
    return;
  }
  await ensureSchema();
  h = await buildHarness();
});

after(async () => {
  if (h) {
    if (tenantIds.length > 0) {
      await h.db.withSuperadmin(async ({ client }) => {
        await client.query('DELETE FROM codegen_jobs WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
        await client.query(
          'UPDATE generated_tests SET source_comment_id = NULL WHERE tenant_id = ANY($1::uuid[])',
          [tenantIds],
        );
        for (const table of ['generated_tests', 'sessions', 'projects', 'tenant_users']) {
          await client.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
        }
        await client.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenantIds]);
      });
    }
    await h.close();
  }
});

describe('real Postgres codegen job queue', () => {
  it('a job the poller claims and successfully runs is marked done and produces a generated_tests row', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const { admin, sessionId, tenantId } = await setUpSession();
    await enqueueRealJob(admin, sessionId);

    const worker = new CodegenWorkerService(h.db, h.reader, h.secrets, h.jira, h.gemini);
    const poller = new CodegenPollerService(h.config, h.db, (payload) => worker.runTask(payload));

    await (poller as unknown as { tick(): Promise<void> }).tick();

    const job = await getJobRow(tenantId);
    assert.ok(job, 'job row should exist');
    assert.equal(job!.status, 'done');
    assert.equal(await countGeneratedTests(sessionId), 1, 'a successful run produces one generated_tests row');
  });

  it('a job that always fails retries with backoff, then is marked failed at MAX_ATTEMPTS -- never producing a generated_tests row', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const { admin, sessionId, tenantId } = await setUpSession();
    await enqueueRealJob(admin, sessionId);

    // A Gemini call that always rejects, matching the real timeout error's
    // shape (gemini.service.ts's withTimeout throws exactly this message).
    // CodegenWorkerService.runTask has no try/catch around the Gemini call,
    // and it runs inside a single db.withSuperadmin transaction, so a
    // rejection here rolls back the whole attempt -- no generated_tests row
    // is ever written for a failed attempt (confirmed below).
    const alwaysFailingGemini: GeminiClient = {
      modelIdForTier: () => 'fake-model',
      generate: async () => {
        throw new Error('Gemini call timed out after 50ms');
      },
    };
    const failingWorker = new CodegenWorkerService(h.db, h.reader, h.secrets, h.jira, alwaysFailingGemini);
    const poller = new CodegenPollerService(h.config, h.db, (payload) => failingWorker.runTask(payload));
    const tick = () => (poller as unknown as { tick(): Promise<void> }).tick();

    // MAX_ATTEMPTS is 5 (cloud-tasks.service.ts). Each failed attempt reschedules
    // run_at into the future via exponential backoff (backoffSeconds), so
    // between attempts we back-date run_at to exercise the real claim -> run
    // -> fail -> reschedule loop repeatedly without sleeping for real in a
    // test. Back-date with a real margin (1s in the past), not to the exact
    // current instant: claimOne's predicate is `run_at <= now()` evaluated by
    // a LATER query, and backing run_at up to precisely `new Date()` leaves
    // zero margin against that later now() -- under load (e.g. running the
    // full suite alongside other files/services) the gap can occasionally be
    // negative, causing claimOne to find no candidate and silently no-op.
    // Confirmed by direct reproduction: this exact race caused an intermittent
    // failure (job attempts stuck at 0) only when run as part of the full
    // suite, never in isolation -- a full-second margin makes it deterministic.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await tick();
      const job = await getJobRow(tenantId);
      assert.ok(job, `job row should exist after attempt ${attempt}`);
      assert.equal(job!.attempts, attempt, `attempts should be ${attempt} after attempt ${attempt}`);
      assert.ok(job!.error?.includes('Gemini call timed out'), 'error should record the Gemini failure message');

      if (attempt < 5) {
        assert.equal(job!.status, 'pending', `still pending (retry scheduled) after attempt ${attempt}`);
        assert.ok(job!.runAt.getTime() > Date.now(), 'run_at should be pushed into the future by backoff');
        await h.db.withSuperadmin(async ({ db }) => {
          await db.update(codegenJobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(codegenJobs.id, job!.id));
        });
      } else {
        assert.equal(job!.status, 'failed', 'reaches failed status at MAX_ATTEMPTS');
      }
    }

    assert.equal(
      await countGeneratedTests(sessionId),
      0,
      'a job that never succeeds must never produce a generated_tests row',
    );
  });
});
