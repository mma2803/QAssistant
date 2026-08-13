import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  StartSessionRequest,
  UploadUrlsRequest,
  UploadUrlsResponse,
  RegisterArtifactRequest,
  CreateFlagRequest,
  Session,
  Artifact,
  Flag,
} from '@qassistant/shared';
import { RequestContext } from '../auth/request-context.js';
import { AppException } from '../auth/errors.js';
import { artifacts, flags, projects, sessions } from '../db/schema.js';
import { newId } from '../db/id.js';
import { toSession, toArtifact, toFlag } from '../common/serializers.js';
import {
  GCS_SIGNER,
  artifactObjectPath,
  defaultContentType,
  type GcsSigner,
} from '../storage/gcs-signer.service.js';

/**
 * Extension capture backend (contract section 4.4; spec session-capture).
 *
 * - 3.3 session-start gate: authorize the project (tenant match + active) and
 *   require work context (a non-empty description). Freeze projectId /
 *   description on the row.
 * - 3.8 GCS upload: mint write-only V4 signed PUT URLs scoped to the session
 *   prefix, then register artifact metadata.
 * - 3.9 server-side stamping: tenantId / projectId / recordedBy / sessionId are
 *   always derived from the verified token + authorized project, never from the
 *   client. Stop finalizes; inactivity sweep is the auto-close backstop.
 */
@Injectable()
export class CaptureService {
  constructor(
    private readonly ctx: RequestContext,
    @Inject(GCS_SIGNER) private readonly signer: GcsSigner,
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
   * POST /sessions: start a session. Blocks every spec scenario before any
   * capture: no project, inactive/foreign project, no work context (empty
   * description).
   */
  async startSession(input: StartSessionRequest): Promise<Session> {
    const tenantId = this.requireTenant();
    const recordedBy = this.requireActingUser();

    // Authorize the project: it must exist in this tenant and be active. A
    // missing/foreign project is "no project" from the tester's perspective and
    // blocks the session (spec "No project blocks the session").
    const projectRows = await this.ctx.dbTx
      .select()
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    const project = projectRows[0];
    if (!project) {
      throw new AppException(
        'not_found',
        'Project not found or not accessible',
        HttpStatus.NOT_FOUND,
      );
    }
    if (project.status !== 'active') {
      throw new AppException(
        'forbidden',
        'Project is inactive; sessions cannot be started',
        HttpStatus.FORBIDDEN,
      );
    }

    // Work context: a non-empty description is required. Zod already guarantees
    // it is present and non-empty; we trim again defensively (and guard against
    // a client bypassing the DTO refinement).
    const description = input.description?.trim() || '';
    if (!description) {
      throw new AppException(
        'validation_failed',
        'A non-empty description is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Effective screenshot setting: per-session override or the project default.
    const screenshotEnabled =
      input.screenshotEnabled !== undefined ? input.screenshotEnabled : project.screenshotDefault;

    const [row] = await this.ctx.dbTx
      .insert(sessions)
      .values({
        id: newId(),
        tenantId,
        projectId: input.projectId,
        recordedBy,
        description,
        screenshotEnabled,
        status: 'active',
        startedAt: new Date(),
      })
      .returning();
    return toSession(row!);
  }

  /**
   * GET /sessions/{id}/upload-urls: mint write-only V4 signed PUT URLs for the
   * requested artifact slots, scoped to the session prefix. The session must be
   * active and owned by the acting user; the client cannot read/list/delete.
   */
  async mintUploadUrls(sessionId: string, input: UploadUrlsRequest): Promise<UploadUrlsResponse> {
    const session = await this.loadOwnActiveSession(sessionId);
    const items = await Promise.all(
      input.items.map(async (item) => {
        const gcsPath = artifactObjectPath({
          tenantId: session.tenantId,
          projectId: session.projectId,
          sessionId: session.id,
          type: item.type,
          seq: item.seq,
        });
        const signed = await this.signer.signUpload({
          gcsPath,
          contentType: defaultContentType(item.type),
        });
        return {
          type: item.type,
          seq: item.seq,
          gcsPath: signed.gcsPath,
          uploadUrl: signed.uploadUrl,
          requiredHeaders: signed.requiredHeaders,
          expiresAt: signed.expiresAt,
        };
      }),
    );
    return { items };
  }

  /**
   * POST /sessions/{id}/artifacts: register uploaded artifact metadata. Stamps
   * tenantId / projectId / sessionId server-side; rejects a gcsPath that is not
   * under this session's prefix (defense in depth against a tampered client).
   */
  async registerArtifact(sessionId: string, input: RegisterArtifactRequest): Promise<Artifact> {
    const session = await this.loadOwnActiveSession(sessionId);

    const expectedPath = artifactObjectPath({
      tenantId: session.tenantId,
      projectId: session.projectId,
      sessionId: session.id,
      type: input.type,
      seq: input.seq,
    });
    if (input.gcsPath !== expectedPath) {
      throw new AppException(
        'validation_failed',
        'Artifact path does not match the session prefix',
        HttpStatus.BAD_REQUEST,
        { expected: expectedPath, actual: input.gcsPath },
      );
    }

    const [row] = await this.ctx.dbTx
      .insert(artifacts)
      .values({
        id: newId(),
        tenantId: session.tenantId,
        projectId: session.projectId,
        sessionId: session.id,
        type: input.type,
        seq: input.seq,
        gcsPath: expectedPath,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        checksum: input.checksum ?? null,
        compression: input.compression,
        capturedAt: new Date(input.capturedAt),
      })
      .returning();
    return toArtifact(row!);
  }

  /** POST /sessions/{id}/flags: record a flagged selector/state (server-stamped). */
  async createFlag(sessionId: string, input: CreateFlagRequest): Promise<Flag> {
    const session = await this.loadOwnActiveSession(sessionId);
    const [row] = await this.ctx.dbTx
      .insert(flags)
      .values({
        id: newId(),
        tenantId: session.tenantId,
        projectId: session.projectId,
        sessionId: session.id,
        selector: input.selector,
        note: input.note ?? null,
        eventOffsetMs: input.eventOffsetMs ?? null,
      })
      .returning();
    return toFlag(row!);
  }

  /**
   * POST /sessions/{id}/stop: finalize. Sets ended_at, status=completed,
   * close_reason=stopped, and triggers the summary hook. Idempotent: a session
   * that is already completed is returned unchanged.
   */
  async stopSession(sessionId: string): Promise<Session> {
    const session = await this.loadOwnSession(sessionId);
    if (session.status === 'completed') {
      return toSession(session);
    }
    const [row] = await this.ctx.dbTx
      .update(sessions)
      .set({
        status: 'completed',
        closeReason: 'stopped',
        endedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, session.tenantId)))
      .returning();
    this.triggerSummary(row!.id);
    return toSession(row!);
  }

  /**
   * Summary-generation hook (spec: stop "triggers session summary generation").
   * The codegen agent owns the Flash summary worker; this leaves a single,
   * clearly-named seam so wiring it in is additive and does not change the stop
   * contract. No-op in this build beyond the seam.
   */
  private triggerSummary(_sessionId: string): void {
    // Intentionally a seam: enqueue summary generation once the codegen worker
    // exists. Kept synchronous-safe (no throw) so stop never fails on it.
  }

  /** Load a session owned by the acting user (or admin) in this tenant, or 404. */
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
    // Recorder owns capture writes; an admin may also act (contract: stop allows
    // recorder, admin). Other roles writing to a session they do not own are
    // rejected.
    if (row.recordedBy !== this.ctx.actingUserId && this.ctx.role !== 'admin') {
      throw new AppException('forbidden', 'Not the session recorder', HttpStatus.FORBIDDEN);
    }
    return row;
  }

  /** Like loadOwnSession but also requires the session to still be active. */
  private async loadOwnActiveSession(sessionId: string): Promise<typeof sessions.$inferSelect> {
    const row = await this.loadOwnSession(sessionId);
    if (row.status !== 'active') {
      throw new AppException(
        'conflict',
        'Session is not active; capture writes are closed',
        HttpStatus.CONFLICT,
      );
    }
    return row;
  }
}
