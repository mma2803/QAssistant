import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type {
  GenerateRequest,
  RegenerateRequest,
  CreateCommentRequest,
  GenerateTaskPayload,
  JobResponse,
  GeneratedTest,
  GenerationComment,
} from '@qassistant/shared';
import type { ModelTier } from '@qassistant/shared/enums';
import { DEFAULT_TEST_FRAMEWORK, DEFAULT_TEST_LANGUAGE } from '@qassistant/shared/enums';
import { RequestContext } from '../auth/request-context.js';
import { AppException } from '../auth/errors.js';
import { generatedTests, generationComments, projects, sessions, tenants } from '../db/schema.js';
import { newId } from '../db/id.js';
import { toGeneratedTest, toGenerationComment } from './serializers.js';
import {
  CLOUD_TASKS_DISPATCHER,
  type CloudTasksDispatcher,
} from './cloud-tasks.service.js';

/**
 * Client-facing codegen operations (contract section 4.5). Mutations run in the
 * request-scoped tenant transaction (RLS + explicit tenant_id). Generation is
 * enqueued as a Cloud Task and executed by CodegenWorkerService; the inline
 * dispatcher runs it synchronously in dev so the row exists immediately.
 *
 * Authorization: generate/regenerate/comments are allowed for the session
 * recorder or an admin (contract role column "recorder, admin"). approve and
 * integrate are allowed for any tenant user (contract section 4.5).
 */
@Injectable()
export class CodegenService {
  constructor(
    private readonly ctx: RequestContext,
    @Inject(CLOUD_TASKS_DISPATCHER) private readonly tasks: CloudTasksDispatcher,
  ) {}

  private requireTenant(): string {
    const tenantId = this.ctx.tenantId;
    if (!tenantId) {
      throw new AppException('forbidden', 'Tenant scope required', HttpStatus.FORBIDDEN);
    }
    return tenantId;
  }

  private requireActingUser(): string {
    const id = this.ctx.actingUserId;
    if (!id) {
      throw new AppException('forbidden', 'Acting user could not be resolved', HttpStatus.FORBIDDEN);
    }
    return id;
  }

  /**
   * Default tier per kind (design D8): replay scripts -> Flash, Playwright tests
   * -> Pro. An explicit request.modelTier overrides.
   */
  private resolveTier(kind: GenerateRequest['kind'], requested?: ModelTier): ModelTier {
    if (requested) return requested;
    return kind === 'replay_script' ? 'flash' : 'pro';
  }

  /**
   * Resolve the codegen target per field, in priority order:
   *   per-generation override -> project default -> tenant default -> hard default.
   * The project default is NULL when it inherits the tenant. The result is
   * stamped on the task payload so the persisted version records exactly what was
   * generated.
   */
  private async resolveTarget(
    input: { framework?: string; language?: string },
    session: typeof sessions.$inferSelect,
  ): Promise<{ framework: string; language: string }> {
    const projRows = await this.ctx.dbTx
      .select({
        framework: projects.defaultTestFramework,
        language: projects.defaultTestLanguage,
      })
      .from(projects)
      .where(eq(projects.id, session.projectId))
      .limit(1);
    const proj = projRows[0];

    const tenRows = await this.ctx.dbTx
      .select({
        framework: tenants.defaultTestFramework,
        language: tenants.defaultTestLanguage,
      })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1);
    const ten = tenRows[0];

    return {
      framework:
        input.framework ?? proj?.framework ?? ten?.framework ?? DEFAULT_TEST_FRAMEWORK,
      language: input.language ?? proj?.language ?? ten?.language ?? DEFAULT_TEST_LANGUAGE,
    };
  }

  /** POST /sessions/{id}/generate: enqueue a codegen job; returns { jobId }. */
  async generate(sessionId: string, input: GenerateRequest): Promise<JobResponse> {
    const session = await this.loadOwnSession(sessionId);
    const target = await this.resolveTarget(input, session);
    return this.enqueue(session, input.kind, this.resolveTier(input.kind, input.modelTier), target);
  }

  /**
   * POST /sessions/{id}/regenerate: enqueue a new version that incorporates the
   * session's comments (the worker loads them). Stamps source_comment_id when a
   * specific comment drove the regeneration.
   */
  async regenerate(sessionId: string, input: RegenerateRequest): Promise<JobResponse> {
    const session = await this.loadOwnSession(sessionId);

    if (input.sourceCommentId) {
      // Validate the comment belongs to this session/tenant.
      const rows = await this.ctx.dbTx
        .select({ id: generationComments.id })
        .from(generationComments)
        .where(
          and(
            eq(generationComments.id, input.sourceCommentId),
            eq(generationComments.tenantId, session.tenantId),
            eq(generationComments.sessionId, sessionId),
          ),
        )
        .limit(1);
      if (!rows[0]) {
        throw new AppException('not_found', 'Comment not found for this session', HttpStatus.NOT_FOUND);
      }
    }

    const target = await this.resolveTarget(input, session);
    return this.enqueue(
      session,
      input.kind,
      this.resolveTier(input.kind, input.modelTier),
      target,
      input.sourceCommentId,
    );
  }

  private async enqueue(
    session: typeof sessions.$inferSelect,
    kind: GenerateRequest['kind'],
    tier: ModelTier,
    target: { framework: string; language: string },
    sourceCommentId?: string,
  ): Promise<JobResponse> {
    const createdBy = this.requireActingUser();
    const payload: GenerateTaskPayload = {
      jobId: newId(),
      tenantId: session.tenantId,
      projectId: session.projectId,
      sessionId: session.id,
      createdBy,
      kind,
      modelTier: tier,
      framework: target.framework,
      language: target.language,
      ...(sourceCommentId ? { sourceCommentId } : {}),
    };
    await this.tasks.enqueueGenerate(payload);
    return { jobId: payload.jobId };
  }

  /** POST /sessions/{id}/comments: add a comment, optionally targeting a version. */
  async addComment(sessionId: string, input: CreateCommentRequest): Promise<GenerationComment> {
    const session = await this.loadOwnSession(sessionId);
    const createdBy = this.requireActingUser();

    if (input.generatedTestId) {
      const rows = await this.ctx.dbTx
        .select({ id: generatedTests.id })
        .from(generatedTests)
        .where(
          and(
            eq(generatedTests.id, input.generatedTestId),
            eq(generatedTests.tenantId, session.tenantId),
            eq(generatedTests.sessionId, sessionId),
          ),
        )
        .limit(1);
      if (!rows[0]) {
        throw new AppException(
          'not_found',
          'Target generated test not found for this session',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const [row] = await this.ctx.dbTx
      .insert(generationComments)
      .values({
        id: newId(),
        tenantId: session.tenantId,
        projectId: session.projectId,
        sessionId,
        generatedTestId: input.generatedTestId ?? null,
        body: input.body,
        createdBy,
      })
      .returning();
    return toGenerationComment(row!);
  }

  /** GET /sessions/{id}/generations: list versions for the session. */
  async listGenerations(sessionId: string): Promise<GeneratedTest[]> {
    const session = await this.loadOwnSession(sessionId);
    const rows = await this.ctx.dbTx
      .select()
      .from(generatedTests)
      .where(
        and(
          eq(generatedTests.tenantId, session.tenantId),
          eq(generatedTests.sessionId, sessionId),
        ),
      )
      .orderBy(asc(generatedTests.version));
    return rows.map(toGeneratedTest);
  }

  /** GET /generations/{id}: one version incl. code + promptInputsSummary. */
  async getGeneration(generatedTestId: string): Promise<GeneratedTest> {
    return toGeneratedTest(await this.loadGenerationRow(generatedTestId));
  }

  /**
   * POST /generations/{id}/approve: mark review_status=approved; record
   * approved_by/at. Any tenant user may approve (contract 4.5).
   */
  async approve(generatedTestId: string): Promise<GeneratedTest> {
    const tenantId = this.requireTenant();
    const approver = this.requireActingUser();
    await this.loadGenerationRow(generatedTestId);
    const [row] = await this.ctx.dbTx
      .update(generatedTests)
      .set({
        reviewStatus: 'approved',
        approvedBy: approver,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(generatedTests.id, generatedTestId), eq(generatedTests.tenantId, tenantId)))
      .returning();
    return toGeneratedTest(row!);
  }

  /**
   * POST /generations/{id}/integrate: set integrated=true; record
   * integrated_by/at. A manual flag (D8a): no proof of repo integration required.
   */
  async integrate(generatedTestId: string): Promise<GeneratedTest> {
    const tenantId = this.requireTenant();
    const actor = this.requireActingUser();
    await this.loadGenerationRow(generatedTestId);
    const [row] = await this.ctx.dbTx
      .update(generatedTests)
      .set({
        integrated: true,
        integratedBy: actor,
        integratedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(generatedTests.id, generatedTestId), eq(generatedTests.tenantId, tenantId)))
      .returning();
    return toGeneratedTest(row!);
  }

  /**
   * Load a session in this tenant that the actor may codegen for: the recorder,
   * or any admin (contract: generate/regenerate/comments = "recorder, admin").
   */
  private async loadOwnSession(sessionId: string): Promise<typeof sessions.$inferSelect> {
    const tenantId = this.requireTenant();
    const rows = await this.ctx.dbTx
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, tenantId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new AppException('not_found', 'Session not found', HttpStatus.NOT_FOUND);
    }
    if (row.recordedBy !== this.ctx.actingUserId && this.ctx.role !== 'admin') {
      throw new AppException(
        'forbidden',
        'Only the session recorder or an admin may generate code',
        HttpStatus.FORBIDDEN,
      );
    }
    return row;
  }

  /** Load a generated_tests row in this tenant or 404 (RLS + explicit predicate). */
  private async loadGenerationRow(
    generatedTestId: string,
  ): Promise<typeof generatedTests.$inferSelect> {
    const tenantId = this.requireTenant();
    const rows = await this.ctx.dbTx
      .select()
      .from(generatedTests)
      .where(and(eq(generatedTests.id, generatedTestId), eq(generatedTests.tenantId, tenantId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new AppException('not_found', 'Generated test not found', HttpStatus.NOT_FOUND);
    }
    return row;
  }
}
