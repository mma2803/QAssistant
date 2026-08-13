/**
 * Artifact-resilience tests: two currently-real behaviors around artifact
 * registration and generation that a client should be aware of.
 *
 * Modeled on e2e-flow.test.ts's setup pattern (service-level testing via
 * buildHarness(), real AdminService/ProjectsService/CaptureService/
 * CodegenService instances constructed via h.asTenant()).
 *
 * 1. CaptureService.registerArtifact performs NO upload verification: it only
 *    checks the client-supplied gcsPath against the server-derived expected
 *    path pattern. It never calls the storage reader to confirm the object
 *    exists, so registering an artifact whose bytes were never staged
 *    succeeds exactly like a real upload would have.
 *
 * 2. When the codegen worker cannot read an artifact's bytes because of a
 *    hard storage failure (MinIO unreachable, connection refused, etc. --
 *    NOT a plain 404/missing-object, which is swallowed gracefully), the
 *    download() call in loadDomReplay/loadNetworkLog is not wrapped in a
 *    try/catch. The exception propagates out of CodegenWorkerService.runTask
 *    (itself not wrapped in try/catch inside its single db.withSuperadmin
 *    transaction), and the inline dispatcher used by generate() propagates it
 *    further, failing the whole generation: no generated_tests row is
 *    created.
 *
 * Runs offline against any reachable Postgres; skips cleanly when none is.
 */
import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDbReachable, ensureSchema, newId } from './helpers/db.js';
import { buildHarness, type Harness, type TenantIdentity } from './helpers/app.js';
import { AdminService } from '../src/admin/admin.service.js';
import { CaptureService } from '../src/capture/capture.service.js';
import { CodegenService } from '../src/codegen/codegen.service.js';
import { artifactObjectPath } from '../src/storage/gcs-signer.service.js';
import { ProjectsService } from '../src/projects/projects.service.js';

let h: Harness | null = null;
let reachable = false;
const tenantIds: string[] = [];

before(async () => {
  reachable = await isDbReachable();
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn('[artifact-resilience] no Postgres reachable; skipping. Run `npm run dev:infra` first.');
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

/**
 * Provision a fresh tenant + admin + project + an ACTIVE session with work
 * context. Artifact registration requires an active session (mirrors
 * e2e-flow.test.ts's order: register artifacts, then stop); callers that need
 * the session stopped (e.g. before generating) call CaptureService.stopSession
 * themselves after registering.
 */
async function provisionSession(harness: Harness): Promise<{
  tenantId: string;
  admin: TenantIdentity;
  projectId: string;
  sessionId: string;
}> {
  const adminSvc = new AdminService(harness.db, harness.identity);
  const result = await adminSvc.createTenant({
    name: `Artifact Resilience ${newId()}`,
    firstAdmin: { email: `admin-${newId()}@artifact-resilience.test`, password: 'initial-pw-1' },
  });
  const tenantId = result.tenant.id;
  tenantIds.push(tenantId);
  const admin: TenantIdentity = {
    uid: result.firstAdmin.id,
    role: 'admin',
    tenantId,
    actingUserId: result.firstAdmin.id,
    mustChangePassword: true,
  };

  const project = await harness.asTenant(admin, async (ctx) => {
    const projects = new ProjectsService(ctx);
    return projects.createProject({
      name: 'Resilience app',
      baseUrl: 'https://resilience.acme.test',
      screenshotDefault: false,
      maskingSelectors: [],
      inactivityTimeoutSeconds: 900,
    });
  });
  const projectId = project.id;

  const session = await harness.asTenant(admin, async (ctx) => {
    const capture = new CaptureService(ctx, harness.signer);
    return capture.startSession({ projectId, description: 'Verify resilience under storage failure' });
  });
  const sessionId = session.id;

  return { tenantId, admin, projectId, sessionId };
}

describe('artifact resilience: no upload verification, storage failure during generation', () => {
  it('1. registering an artifact accepts a gcsPath whose bytes were never staged/uploaded', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const { admin, projectId, sessionId } = await provisionSession(h);

    const domPath = artifactObjectPath({
      tenantId: admin.tenantId,
      projectId,
      sessionId,
      type: 'dom_chunk',
      seq: 0,
    });

    // Deliberately do NOT call h.reader.put(...)/putDomChunk(...) -- the bytes
    // are never staged in the fake in-memory reader (i.e. never "uploaded").
    const registered = await h.asTenant(admin, async (ctx) => {
      const capture = new CaptureService(ctx, h!.signer);
      return capture.registerArtifact(sessionId, {
        type: 'dom_chunk',
        seq: 0,
        gcsPath: domPath,
        contentType: 'application/json',
        sizeBytes: 4096,
        checksum: 'sha256-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        compression: 'gzip',
        capturedAt: new Date().toISOString(),
      });
    });

    // Registration succeeds despite the object never having been uploaded: the
    // service only validated the path pattern, never the object's existence,
    // and stores the client-supplied checksum verbatim without verifying it
    // against actual bytes.
    assert.equal(registered.type, 'dom_chunk');
    assert.equal(registered.gcsPath, domPath);
    assert.equal(
      registered.checksum,
      'sha256-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      'the client-supplied checksum is stored verbatim, unverified against any actual content',
    );

    // Prove the bytes really are absent from the fake reader (i.e. this test
    // did not accidentally stage them another way).
    const bytes = await h!.reader.download(domPath);
    assert.equal(bytes, null, 'the object was never uploaded/staged; the reader has nothing for it');

    // Stop the session, matching e2e-flow's order (register while active, then
    // stop) -- not load-bearing for this assertion, kept for setup parity.
    await h.asTenant(admin, async (ctx) => {
      const capture = new CaptureService(ctx, h!.signer);
      return capture.stopSession(sessionId);
    });
  });

  it('2. a hard storage failure while loading artifact bytes fails the whole generation (no generated_tests row)', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const { admin, projectId, sessionId } = await provisionSession(h);

    const domPath = artifactObjectPath({
      tenantId: admin.tenantId,
      projectId,
      sessionId,
      type: 'dom_chunk',
      seq: 0,
    });

    // Register the artifact (as in test 1, no bytes staged), then additionally
    // arrange for the fake reader to simulate a hard failure (connection
    // refused/timeout) for this exact path, rather than a plain missing-object
    // 404. This mirrors S3GcsReader.download's real behavior of re-throwing any
    // error that is not NoSuchKey/404 -- unlike this same fake's default
    // "never put() -> resolves to null" behavior (matching LocalGcsReader),
    // which loadDomReplay's `if (!bytes) continue;` would just skip gracefully.
    await h.asTenant(admin, async (ctx) => {
      const capture = new CaptureService(ctx, h!.signer);
      return capture.registerArtifact(sessionId, {
        type: 'dom_chunk',
        seq: 0,
        gcsPath: domPath,
        contentType: 'application/json',
        sizeBytes: 4096,
        compression: 'gzip',
        capturedAt: new Date().toISOString(),
      });
    });
    h.reader.putFailing(domPath);

    // Stop the session (mirrors e2e-flow's order: register while active, then
    // stop, then generate).
    await h.asTenant(admin, async (ctx) => {
      const capture = new CaptureService(ctx, h!.signer);
      return capture.stopSession(sessionId);
    });

    const before = await h.asTenant(admin, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.listGenerations(sessionId);
    });
    assert.equal(before.length, 0, 'no generated_tests row exists yet');

    // generate() -> CodegenService.enqueue -> InlineCloudTasksDispatcher runs
    // the real worker synchronously; the worker's download() call in
    // loadDomReplay is not wrapped in try/catch, so the simulated storage
    // failure propagates all the way out through runTask's single
    // db.withSuperadmin transaction (which has no try/catch of its own) and
    // out through the inline dispatcher, per its own code comment: "Errors
    // propagate so the caller sees failures."
    await assert.rejects(
      () =>
        h!.asTenant(admin, async (ctx) => {
          const codegen = new CodegenService(ctx, h!.dispatcher);
          return codegen.generate(sessionId, { kind: 'playwright_test' });
        }),
      /simulated storage failure/,
      'a hard storage failure while loading artifact bytes fails the whole generation attempt',
    );

    // No generated_tests row was created: the failed attempt left no partial
    // artifact of the generation (the transaction rolled back).
    const after = await h.asTenant(admin, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.listGenerations(sessionId);
    });
    assert.equal(after.length, 0, 'the failed generation produced no generated_tests row');
  });
});
