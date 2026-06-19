/**
 * Task 6.2 - end-to-end flow, driven through the REAL service layer.
 *
 * Walks the full MVP business sequence by invoking the actual NestJS services
 * (no inline SQL re-implementation): AdminService, UsersService,
 * AuthRoutesService, ProjectsService, CaptureService, CodegenService + the
 * codegen worker, and DashboardService. Each step runs inside a real
 * DbService.withTenant / withSuperadmin transaction, so RLS, the transaction-
 * local tenant var, and the application-layer role scoping are exercised by the
 * services themselves. Only the external boundaries are faked (Identity Platform
 * via FakeFirebase, GCS via an in-memory reader, Gemini via the production
 * offline FakeGeminiClient):
 *
 *   1. Super-admin provisions a tenant + first admin (AdminService, BYPASSRLS).
 *   2. Admin adds a qa-engineer (UsersService -> Admin SDK + mirror row).
 *   3. Forced password change clears the marker on BOTH the GCIP claim and the
 *      DB mirror (AuthRoutesService.completePasswordChange).
 *   4. Admin creates a project (ProjectsService).
 *   5. qa-engineer starts a project- and work-context-gated session
 *      (CaptureService.startSession; the no-context case is rejected by the
 *      service gate, not just the DB CHECK).
 *   6. dom_chunk + screenshot artifacts are registered (CaptureService) and
 *      their bytes are made readable for the dashboard read endpoints.
 *   7. Session is stopped (CaptureService.stopSession).
 *   8. An asserted Playwright test is generated (CodegenService.generate ->
 *      inline worker -> Pro tier) and then approved (CodegenService.approve).
 *   9. Dashboard reads (DashboardService): admin sees it tenant-wide; the owner
 *      qa-engineer sees it; a second qa-engineer is denied (own-only scope);
 *      inline DOM-replay and screenshot bytes read back through the new
 *      artifact-read endpoints.
 *
 * Runs offline against any reachable Postgres; skips cleanly when none is.
 */
import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDbReachable, ensureSchema, newId } from './helpers/db.js';
import { buildHarness, type Harness, type TenantIdentity } from './helpers/app.js';
import { AdminService } from '../src/admin/admin.service.js';
import { UsersService } from '../src/users/users.service.js';
import { AuthRoutesService } from '../src/auth-routes/auth-routes.service.js';
import { ProjectsService } from '../src/projects/projects.service.js';
import { CaptureService } from '../src/capture/capture.service.js';
import { CodegenService } from '../src/codegen/codegen.service.js';
import { DashboardService } from '../src/dashboard/dashboard.service.js';
import { JiraValidationService } from '../src/jira/jira-validation.service.js';
import { artifactObjectPath } from '../src/storage/gcs-signer.service.js';
import type { RequestContext } from '../src/auth/request-context.js';

let h: Harness | null = null;
let reachable = false;
const tenantIds: string[] = [];

// Identities resolved as the flow provisions them.
let tenantId = '';
let admin: TenantIdentity;
let qa: TenantIdentity;
let otherQa: TenantIdentity;
let projectId = '';
let sessionId = '';
let screenshotArtifactId = '';
let generatedTestId = '';
let sourceCommentId = '';

const DOM_EVENTS = [
  { type: 4, data: { href: 'https://checkout.acme.test/' }, timestamp: 1 },
  { type: 2, data: { node: { id: 1 } }, timestamp: 2 },
];

before(async () => {
  reachable = await isDbReachable();
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn('[e2e-flow] no Postgres reachable; skipping. Run `npm run dev:infra` first.');
    return;
  }
  await ensureSchema();
  h = await buildHarness();
});

after(async () => {
  if (h) {
    // Clean up via the superadmin pool (RLS-bypassing) in FK-safe order.
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

/** Read-only helper to inspect the DB mirror without leaving the service layer. */
async function readMustChangePassword(harness: Harness, userId: string): Promise<boolean> {
  return harness.db.withSuperadmin(async ({ client }) => {
    const r = await client.query('SELECT must_change_password FROM tenant_users WHERE id = $1', [
      userId,
    ]);
    return r.rows[0]?.must_change_password as boolean;
  });
}

describe('end-to-end MVP flow (service layer)', () => {
  it('1. super-admin provisions a tenant + first admin', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const adminSvc = new AdminService(h.db, h.firebaseAs());
    const result = await adminSvc.createTenant({
      name: 'Acme QA',
      firstAdmin: { email: `admin-${newId()}@acme.test`, password: 'initial-pw-1' },
    });

    tenantId = result.tenant.id;
    tenantIds.push(tenantId);
    admin = {
      uid: result.firstAdmin.gcipUid,
      role: 'admin',
      tenantId,
      actingUserId: result.firstAdmin.id,
      mustChangePassword: true,
    };
    assert.ok(tenantId && admin.actingUserId);
    assert.equal(result.firstAdmin.role, 'admin');
    assert.equal(result.firstAdmin.mustChangePassword, true);
    // The GCIP-side account exists with the forced-change marker on its claim.
    assert.equal(h.firebase.getUserByUid(admin.uid)?.claims.mustChangePassword, true);
  });

  it('2. admin adds a qa-engineer (Admin SDK + mirror, mustChangePassword=true)', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const created = await h.asTenant(admin, async (ctx) => {
      const users = new UsersService(ctx, h!.firebaseAs());
      return users.createUser({
        email: `qa-${newId()}@acme.test`,
        password: 'initial-pw-2',
        role: 'qa-engineer',
      });
    });
    qa = {
      uid: created.gcipUid,
      role: 'qa-engineer',
      tenantId,
      actingUserId: created.id,
      mustChangePassword: true,
    };
    assert.equal(created.role, 'qa-engineer');
    assert.equal(created.mustChangePassword, true);
    assert.equal(h.firebase.getUserByUid(qa.uid)?.claims.mustChangePassword, true);

    // A second qa-engineer, used later to prove own-only dashboard scoping.
    const other = await h.asTenant(admin, async (ctx) => {
      const users = new UsersService(ctx, h!.firebaseAs());
      return users.createUser({
        email: `qa2-${newId()}@acme.test`,
        password: 'initial-pw-3',
        role: 'qa-engineer',
      });
    });
    otherQa = {
      uid: other.gcipUid,
      role: 'qa-engineer',
      tenantId,
      actingUserId: other.id,
    };
  });

  it('3. forced password change clears the marker (GCIP claim + DB mirror)', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const out = await h.asTenant(qa, async (ctx) => {
      const auth = new AuthRoutesService(ctx, h!.firebaseAs());
      return auth.completePasswordChange({ newPassword: 'new-strong-pw-9' });
    });
    assert.equal(out.mustChangePassword, false);

    // Authoritative source: the GCIP claim no longer carries the marker.
    const claims = h.firebase.getUserByUid(qa.uid)?.claims ?? {};
    assert.equal(claims.mustChangePassword, undefined, 'marker cleared on the GCIP claim');
    assert.equal(claims.role, 'qa-engineer', 'role claim preserved');
    assert.equal(claims.tenantId, tenantId, 'tenantId claim preserved');
    // The new password was set in GCIP as part of completing the change.
    assert.equal(h.firebase.getUserByUid(qa.uid)?.password, 'new-strong-pw-9');
    // Read-model mirror is cleared too.
    assert.equal(await readMustChangePassword(h, qa.actingUserId), false);
    qa.mustChangePassword = false;
  });

  it('4. admin creates a project', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const project = await h.asTenant(admin, async (ctx) => {
      const projects = new ProjectsService(ctx, h!.secrets, jiraValidationFor(ctx, h!));
      return projects.createProject({
        name: 'Checkout app',
        baseUrl: 'https://checkout.acme.test',
        screenshotDefault: false,
        maskingSelectors: [],
        inactivityTimeoutSeconds: 900,
      });
    });
    projectId = project.id;
    assert.equal(project.status, 'active');
    assert.equal(project.baseUrl, 'https://checkout.acme.test');
  });

  it('5. qa-engineer starts a project + work-context-gated session', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');

    // No work context (no jiraId, no description) is rejected by the service gate.
    await assert.rejects(
      () =>
        h!.asTenant(qa, async (ctx) => {
          const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
          // Bypass the DTO refinement to prove the SERVICE gate, not just Zod.
          return capture.startSession({ projectId } as never);
        }),
      /work|description|jira|required/i,
      'a session with no work context is blocked by CaptureService',
    );

    // With a non-empty description, the session is created; recorded_by is the
    // server-derived acting user (never client-supplied).
    const session = await h.asTenant(qa, async (ctx) => {
      const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
      return capture.startSession({ projectId, description: 'Verify the discount code flow' });
    });
    sessionId = session.id;
    assert.equal(session.status, 'active');
    assert.equal(session.recordedBy, qa.actingUserId, 'recorded_by stamped to the acting user');
    assert.equal(session.description, 'Verify the discount code flow');
    assert.equal(session.jiraId, null);
  });

  it('6. dom_chunk + screenshot artifacts are registered and made readable', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const domPath = artifactObjectPath({ tenantId, projectId, sessionId, type: 'dom_chunk', seq: 0 });
    const shotPath = artifactObjectPath({ tenantId, projectId, sessionId, type: 'screenshot', seq: 0 });
    // Stage the bytes the dashboard read endpoints will serve.
    h.reader.putDomChunk(domPath, DOM_EVENTS);
    h.reader.put(shotPath, Buffer.from('fake-webp-bytes'));

    const [dom, shot] = await h.asTenant(qa, async (ctx) => {
      const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
      const d = await capture.registerArtifact(sessionId, {
        type: 'dom_chunk',
        seq: 0,
        gcsPath: domPath,
        contentType: 'application/json',
        sizeBytes: 1024,
        compression: 'gzip',
        capturedAt: new Date().toISOString(),
      });
      const s = await capture.registerArtifact(sessionId, {
        type: 'screenshot',
        seq: 0,
        gcsPath: shotPath,
        contentType: 'image/webp',
        sizeBytes: 2048,
        compression: 'none',
        capturedAt: new Date().toISOString(),
      });
      return [d, s];
    });
    assert.equal(dom.type, 'dom_chunk');
    assert.equal(shot.type, 'screenshot');
    screenshotArtifactId = shot.id;

    // Path tampering (a gcsPath outside the session prefix) is rejected.
    await assert.rejects(
      () =>
        h!.asTenant(qa, async (ctx) => {
          const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
          return capture.registerArtifact(sessionId, {
            type: 'screenshot',
            seq: 1,
            gcsPath: `someone-else/${projectId}/${sessionId}/shots/1.webp`,
            contentType: 'image/webp',
            sizeBytes: 10,
            compression: 'none',
            capturedAt: new Date().toISOString(),
          });
        }),
      /prefix|path/i,
      'an artifact path outside the session prefix is rejected',
    );
  });

  it('7. session is stopped (completed, ended_at set)', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const stopped = await h.asTenant(qa, async (ctx) => {
      const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
      return capture.stopSession(sessionId);
    });
    assert.equal(stopped.status, 'completed');
    assert.equal(stopped.closeReason, 'stopped');
    assert.ok(stopped.endedAt, 'ended_at set on stop');
  });

  it('8. an asserted Playwright test is generated (Pro tier) and approved', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    // Generate: enqueue -> inline dispatcher -> real worker -> Gemini (Pro) -> row.
    const job = await h.asTenant(qa, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.generate(sessionId, { kind: 'playwright_test' });
    });
    assert.ok(job.jobId, 'a job id is returned');

    const generations = await h.asTenant(qa, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.listGenerations(sessionId);
    });
    assert.equal(generations.length, 1, 'one generated version');
    const gen = generations[0]!;
    generatedTestId = gen.id;
    assert.equal(gen.kind, 'playwright_test');
    assert.equal(gen.modelTier, 'pro', 'Playwright tests route to the Pro tier');
    assert.equal(gen.reviewStatus, 'draft', 'starts as a draft pending review');
    assert.match(gen.code, /@playwright\/test/, 'is a Playwright test');
    assert.match(gen.code, /expect\(/, 'contains an assertion');

    // Approve (any tenant user may approve).
    const approved = await h.asTenant(admin, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.approve(generatedTestId);
    });
    assert.equal(approved.reviewStatus, 'approved');
    assert.equal(approved.approvedBy, admin.actingUserId, 'approver recorded');
  });

  it('9. dashboard reads: admin tenant-wide, owner sees own, other qa denied', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');

    // Admin: detail read tenant-wide, with artifacts + generations.
    const adminDetail = await h.asTenant(admin, async (ctx) => {
      const dash = new DashboardService(ctx, h!.reader);
      return dash.getSession(sessionId);
    });
    assert.equal(adminDetail.session.id, sessionId);
    assert.equal(adminDetail.artifacts.length, 2, 'detail: two artifacts');
    assert.equal(adminDetail.generations.length, 1, 'detail: one generated test');

    // Admin: the session appears in the tenant-wide list.
    const adminList = await h.asTenant(admin, async (ctx) => {
      const dash = new DashboardService(ctx, h!.reader);
      return dash.listSessions({ limit: 50 });
    });
    assert.ok(adminList.items.some((s) => s.id === sessionId), 'admin list includes the session');

    // Owner qa-engineer: own-only scope still includes their session.
    const ownerDetail = await h.asTenant(qa, async (ctx) => {
      const dash = new DashboardService(ctx, h!.reader);
      return dash.getSession(sessionId);
    });
    assert.equal(ownerDetail.session.id, sessionId);

    // A different qa-engineer is denied (own-only scope -> 404).
    await assert.rejects(
      () =>
        h!.asTenant(otherQa, async (ctx) => {
          const dash = new DashboardService(ctx, h!.reader);
          return dash.getSession(sessionId);
        }),
      /not found/i,
      'a non-owner qa-engineer cannot read another tester recording',
    );

    // Inline DOM-replay reads back the decoded, concatenated rrweb events (5.2).
    const replay = await h.asTenant(admin, async (ctx) => {
      const dash = new DashboardService(ctx, h!.reader);
      return dash.getReplay(sessionId);
    });
    assert.equal(replay.chunkCount, 1);
    assert.equal(replay.events.length, DOM_EVENTS.length, 'replay events decoded from the chunk');
    assert.equal(replay.truncated, false);

    // Screenshot bytes read back through the artifact-read endpoint (5.2).
    const artifact = await h.asTenant(admin, async (ctx) => {
      const dash = new DashboardService(ctx, h!.reader);
      return dash.getArtifactBytes(sessionId, screenshotArtifactId);
    });
    assert.equal(artifact.contentType, 'image/webp');
    assert.equal(artifact.bytes.toString('utf8'), 'fake-webp-bytes');
  });

  it('10. duplicate project names are rejected within a tenant', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        h!.asTenant(admin, async (ctx) => {
          const projects = new ProjectsService(ctx, h!.secrets, jiraValidationFor(ctx, h!));
          return projects.createProject({
            name: 'Checkout app',
            baseUrl: 'https://duplicate.acme.test',
            screenshotDefault: true,
            maskingSelectors: [],
            inactivityTimeoutSeconds: 600,
          });
        }),
      /already exists/i,
    );
  });

  it('11. a missing project blocks session start', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        h!.asTenant(qa, async (ctx) => {
          const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
          return capture.startSession({
            projectId: newId(),
            description: 'This project does not exist',
          });
        }),
      /project not found|not accessible/i,
    );
  });

  it('12. an inactive project blocks session start', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    await h.asTenant(admin, async (ctx) => {
      const projects = new ProjectsService(ctx, h!.secrets, jiraValidationFor(ctx, h!));
      await projects.updateProject(projectId, { status: 'inactive' });
    });
    try {
      await assert.rejects(
        () =>
          h!.asTenant(qa, async (ctx) => {
            const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
            return capture.startSession({ projectId, description: 'Blocked while inactive' });
          }),
        /inactive/i,
      );
    } finally {
      await h.asTenant(admin, async (ctx) => {
        const projects = new ProjectsService(ctx, h!.secrets, jiraValidationFor(ctx, h!));
        await projects.updateProject(projectId, { status: 'active' });
      });
    }
  });

  it('13. a Jira ID without project Jira configuration is rejected', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        h!.asTenant(qa, async (ctx) => {
          const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
          return capture.startSession({ projectId, jiraId: 'QA-404' });
        }),
      /no active Jira configuration/i,
    );
  });

  it('14. a non-owner qa-engineer cannot generate for another recorder', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        h!.asTenant(otherQa, async (ctx) => {
          const codegen = new CodegenService(ctx, h!.dispatcher);
          return codegen.generate(sessionId, { kind: 'playwright_test' });
        }),
      /only the session recorder|forbidden/i,
    );
  });

  it('15. a non-owner qa-engineer cannot comment on another recording', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        h!.asTenant(otherQa, async (ctx) => {
          const codegen = new CodegenService(ctx, h!.dispatcher);
          return codegen.addComment(sessionId, { body: 'Should not be accepted' });
        }),
      /only the session recorder|forbidden/i,
    );
  });

  it('16. an unknown generated test cannot be read', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        h!.asTenant(admin, async (ctx) => {
          const codegen = new CodegenService(ctx, h!.dispatcher);
          return codegen.getGeneration(newId());
        }),
      /generated test not found/i,
    );
  });

  it('17. comments cannot target a generated test outside the session', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        h!.asTenant(qa, async (ctx) => {
          const codegen = new CodegenService(ctx, h!.dispatcher);
          return codegen.addComment(sessionId, {
            body: 'Target a missing generation',
            generatedTestId: newId(),
          });
        }),
      /target generated test not found/i,
    );
  });

  it('18. regeneration rejects a source comment outside the session', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        h!.asTenant(qa, async (ctx) => {
          const codegen = new CodegenService(ctx, h!.dispatcher);
          return codegen.regenerate(sessionId, {
            kind: 'playwright_test',
            sourceCommentId: newId(),
          });
        }),
      /comment not found for this session/i,
    );
  });

  it('19. an admin can generate code for a qa-engineer recording', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const job = await h.asTenant(admin, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.generate(sessionId, { kind: 'playwright_test' });
    });
    assert.ok(job.jobId);
    const generations = await h.asTenant(admin, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.listGenerations(sessionId);
    });
    assert.equal(generations.length, 2);
    assert.equal(generations[1]?.createdBy, admin.actingUserId);
    assert.equal(generations[1]?.modelTier, 'pro');
  });

  it('20. replay-script generation defaults to the Flash tier', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    await h.asTenant(qa, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      await codegen.generate(sessionId, { kind: 'replay_script' });
    });
    const generations = await h.asTenant(qa, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.listGenerations(sessionId);
    });
    assert.equal(generations[2]?.kind, 'replay_script');
    assert.equal(generations[2]?.modelTier, 'flash');
  });

  it('21. generated versions are returned in ascending version order', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const generations = await h.asTenant(admin, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.listGenerations(sessionId);
    });
    assert.deepEqual(
      generations.map((generation) => generation.version),
      [1, 2, 3],
    );
  });

  it('22. integration records the acting user and timestamp', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const integrated = await h.asTenant(qa, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.integrate(generatedTestId);
    });
    assert.equal(integrated.integrated, true);
    assert.equal(integrated.integratedBy, qa.actingUserId);
    assert.ok(integrated.integratedAt);
  });

  it('23. a targeted review comment records its generation and author', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const comment = await h.asTenant(qa, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.addComment(sessionId, {
        body: 'Assert the applied discount total.',
        generatedTestId,
      });
    });
    sourceCommentId = comment.id;
    assert.equal(comment.generatedTestId, generatedTestId);
    assert.equal(comment.createdBy, qa.actingUserId);
  });

  it('24. regeneration preserves the driving source-comment lineage', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    await h.asTenant(qa, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      await codegen.regenerate(sessionId, {
        kind: 'playwright_test',
        sourceCommentId,
      });
    });
    const generations = await h.asTenant(qa, async (ctx) => {
      const codegen = new CodegenService(ctx, h!.dispatcher);
      return codegen.listGenerations(sessionId);
    });
    assert.equal(generations[3]?.version, 4);
    assert.equal(generations[3]?.sourceCommentId, sourceCommentId);
  });

  it('25. stopping an already completed session is idempotent', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const first = await h.asTenant(qa, async (ctx) => {
      const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
      return capture.stopSession(sessionId);
    });
    const second = await h.asTenant(qa, async (ctx) => {
      const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
      return capture.stopSession(sessionId);
    });
    assert.equal(second.status, 'completed');
    assert.equal(second.endedAt, first.endedAt);
    assert.equal(second.closeReason, 'stopped');
  });

  it('26. capture writes are rejected after the session is completed', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    await assert.rejects(
      () =>
        h!.asTenant(qa, async (ctx) => {
          const capture = new CaptureService(ctx, jiraValidationFor(ctx, h!), h!.signer);
          return capture.createFlag(sessionId, { selector: '#late-write' });
        }),
      /capture writes are closed|not active/i,
    );
  });

  it('27. project knowledge updates persist through project reads', async (t) => {
    if (!reachable || !h) return t.skip('no Postgres');
    const updated = await h.asTenant(admin, async (ctx) => {
      const projects = new ProjectsService(ctx, h!.secrets, jiraValidationFor(ctx, h!));
      return projects.setKnowledge(projectId, {
        knowledgeMd: '# Checkout\n\nPrefer data-testid selectors.',
        defaultCredsSecretRef: null,
      });
    });
    assert.match(updated.knowledgeMd ?? '', /data-testid/);
    const read = await h.asTenant(qa, async (ctx) => {
      const projects = new ProjectsService(ctx, h!.secrets, jiraValidationFor(ctx, h!));
      return projects.getProject(projectId);
    });
    assert.equal(read.knowledgeMd, updated.knowledgeMd);
  });
});

/** Construct a real JiraValidationService for a request (unused on the description path). */
function jiraValidationFor(ctx: RequestContext, harness: Harness): JiraValidationService {
  return new JiraValidationService(ctx, harness.jira, harness.secrets);
}
