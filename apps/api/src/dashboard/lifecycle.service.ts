import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';
import type { Session } from '@qassistant/shared';
import { RequestContext } from '../auth/request-context.js';
import { AppException } from '../auth/errors.js';
import { DbService, type Database } from '../db/db.service.js';
import {
  artifacts,
  flags,
  generatedTests,
  generationComments,
  projects,
  sessions,
  tenantUsers,
} from '../db/schema.js';
import { toSession, toArtifact, toFlag } from '../common/serializers.js';
import { toGeneratedTest } from '../codegen/serializers.js';
import { GCS_READER, decodeArtifactText, type GcsReader } from '../storage/gcs-reader.service.js';
import { GCS_DELETER, type GcsDeleter } from './gcs-deleter.service.js';
import { ZipBuilder } from './zip.js';

/** 30-day soft-delete grace period before permanent purge (contract 3.5 / 4.6). */
const PURGE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export interface ExportResult {
  filename: string;
  buffer: Buffer;
}

export interface PurgeResult {
  purgedSessionIds: string[];
}

/**
 * Session lifecycle and admin operations (contract section 4.6):
 *   - DELETE /sessions/{id}        soft delete (deleted_at, purge_at = +30d)
 *   - POST   /sessions/{id}/restore  clear deleted_at/purge_at in the grace window
 *   - GET    /sessions/{id}/export   stream a ZIP of metadata + artifacts + tests
 *   - POST   /internal/tasks/purge   sweep purge_at <= now() (section 3.10)
 *
 * Tenant-scoped operations run in the request transaction (RLS + explicit
 * tenant_id). The purge sweep is an internal job with no tenant context: it runs
 * on the BYPASSRLS pool and scopes each delete by the session row it loaded.
 */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly ctx: RequestContext,
    private readonly db: DbService,
    @Inject(GCS_READER) private readonly reader: GcsReader,
    @Inject(GCS_DELETER) private readonly deleter: GcsDeleter,
  ) {}

  private requireTenant(): string {
    const tenantId = this.ctx.tenantId;
    if (!tenantId) {
      throw new AppException('forbidden', 'Tenant scope required', HttpStatus.FORBIDDEN);
    }
    return tenantId;
  }

  /**
   * DELETE /sessions/{id}: soft delete. Admin may delete any session in the
   * tenant; qa-engineer may delete only their own (contract 4.6 role column).
   * Idempotent: an already soft-deleted session keeps its original purge_at.
   */
  async softDelete(sessionId: string): Promise<Session> {
    const tenantId = this.requireTenant();
    const session = await this.loadForMutation(sessionId, /* ownOnlyForQa */ true);
    if (session.deletedAt) {
      return toSession(session);
    }
    const now = new Date();
    const purgeAt = new Date(now.getTime() + PURGE_GRACE_MS);
    const [row] = await this.ctx.dbTx
      .update(sessions)
      .set({ deletedAt: now, purgeAt, updatedAt: now })
      .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, tenantId)))
      .returning();
    return toSession(row!);
  }

  /**
   * POST /sessions/{id}/restore: clear deleted_at/purge_at during the grace
   * period. Admin only (contract 4.6). A session past its purge_at may have
   * already been swept; if the row is gone the load returns 404.
   */
  async restore(sessionId: string): Promise<Session> {
    const tenantId = this.requireTenant();
    if (this.ctx.role !== 'admin') {
      throw new AppException('forbidden', 'Only an admin may restore a session', HttpStatus.FORBIDDEN);
    }
    const session = await this.loadForMutation(sessionId, /* ownOnlyForQa */ false);
    if (!session.deletedAt) {
      return toSession(session);
    }
    const [row] = await this.ctx.dbTx
      .update(sessions)
      .set({ deletedAt: null, purgeAt: null, updatedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, tenantId)))
      .returning();
    return toSession(row!);
  }

  /**
   * GET /sessions/{id}/export: build a ZIP with a metadata JSON, the DOM-replay
   * chunks, screenshots, and generated tests. Admin or any qa-engineer in the
   * tenant may export (contract 4.6). Soft-deleted sessions are exportable
   * (useful before purge); the row must still exist.
   */
  async export(sessionId: string): Promise<ExportResult> {
    const tenantId = this.requireTenant();

    const rows = await this.ctx.dbTx
      .select({
        session: sessions,
        projectName: projects.name,
        recordedByEmail: tenantUsers.email,
      })
      .from(sessions)
      .innerJoin(projects, eq(projects.id, sessions.projectId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, sessions.recordedBy))
      .where(and(eq(sessions.tenantId, tenantId), eq(sessions.id, sessionId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new AppException('not_found', 'Session not found', HttpStatus.NOT_FOUND);
    }

    // These share the request transaction's single pg client, so execute them
    // sequentially (pg 9 rejects overlapping queries on one client).
    const artifactRows = await this.ctx.dbTx
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.tenantId, tenantId), eq(artifacts.sessionId, sessionId)))
      .orderBy(asc(artifacts.type), asc(artifacts.seq));
    const flagRows = await this.ctx.dbTx
      .select()
      .from(flags)
      .where(and(eq(flags.tenantId, tenantId), eq(flags.sessionId, sessionId)));
    const generationRows = await this.ctx.dbTx
      .select()
      .from(generatedTests)
      .where(and(eq(generatedTests.tenantId, tenantId), eq(generatedTests.sessionId, sessionId)))
      .orderBy(asc(generatedTests.version));

    const zip = new ZipBuilder();

    const metadata = {
      session: toSession(row.session),
      project: { id: row.session.projectId, name: row.projectName },
      recordedByEmail: row.recordedByEmail ?? null,
      artifacts: artifactRows.map(toArtifact),
      flags: flagRows.map(toFlag),
      generations: generationRows.map((g) => ({
        ...toGeneratedTest(g),
        // code is also emitted as a separate file below for convenience.
      })),
      exportedAt: new Date().toISOString(),
    };
    zip.addFile('metadata.json', JSON.stringify(metadata, null, 2));

    // DOM-replay chunks and screenshots: pull bytes from GCS. Missing objects
    // (offline sink) are noted but never fail the export.
    for (const a of artifactRows) {
      const bytes = await this.reader.download(a.gcsPath);
      if (!bytes) continue;
      if (a.type === 'dom_chunk') {
        // Store the decoded JSON so the archive is directly replayable.
        const text = decodeArtifactText(bytes, a.compression as 'none' | 'gzip');
        zip.addFile(`dom/${a.seq}.json`, text);
      } else if (a.type === 'network_log') {
        // Captured HTTP traffic is JSON; store it decoded under net/.
        const text = decodeArtifactText(bytes, a.compression as 'none' | 'gzip');
        zip.addFile(`net/${a.seq}.json`, text);
      } else {
        zip.addFile(`shots/${a.seq}.webp`, bytes);
      }
    }

    // Generated tests as standalone .ts files.
    for (const g of generationRows) {
      const ext = g.kind === 'replay_script' ? 'replay' : 'spec';
      zip.addFile(`generated/v${g.version}.${ext}.ts`, g.code);
    }

    return {
      filename: `session-${sessionId}.zip`,
      buffer: zip.build(),
    };
  }

  /**
   * POST /internal/tasks/purge: sweep sessions whose purge_at has elapsed.
   * Per session, in order (contract 3.10): delete GCS objects under the session
   * prefix, then comments, generated_tests, flags, artifacts, then the session
   * row. Runs on the BYPASSRLS pool (no tenant context for an internal job) and
   * scopes every delete to the loaded session id.
   */
  async purgeSweep(now: Date): Promise<PurgeResult> {
    const purgedSessionIds: string[] = [];

    const due = await this.db.superadmin
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(isNotNull(sessions.purgeAt), lte(sessions.purgeAt, now)))
      .orderBy(asc(sessions.purgeAt));

    for (const { id } of due) {
      await this.purgeOne(id);
      purgedSessionIds.push(id);
    }
    return { purgedSessionIds };
  }

  /** Permanently delete one session and all of its dependents (GCS then rows). */
  private async purgeOne(sessionId: string): Promise<void> {
    // 1) Delete GCS objects first so a crash mid-purge never orphans bytes
    // behind deleted metadata.
    const artifactRows = await this.db.superadmin
      .select({ gcsPath: artifacts.gcsPath })
      .from(artifacts)
      .where(eq(artifacts.sessionId, sessionId));
    for (const a of artifactRows) {
      await this.deleter.delete(a.gcsPath);
    }

    // 2) Delete metadata rows in FK-safe order inside one transaction.
    await this.db.withSuperadmin(async ({ db }) => {
      await this.deleteChildren(db, sessionId);
      await db.delete(sessions).where(eq(sessions.id, sessionId));
    });
  }

  private async deleteChildren(db: Database, sessionId: string): Promise<void> {
    // Regeneration links generated_tests.source_comment_id back to comments,
    // while comments may also target a generated test. Break the cycle before
    // deleting either side of the relationship.
    await db
      .update(generatedTests)
      .set({ sourceCommentId: null })
      .where(eq(generatedTests.sessionId, sessionId));
    await db.delete(generationComments).where(eq(generationComments.sessionId, sessionId));
    await db.delete(generatedTests).where(eq(generatedTests.sessionId, sessionId));
    await db.delete(flags).where(eq(flags.sessionId, sessionId));
    await db.delete(artifacts).where(eq(artifacts.sessionId, sessionId));
  }

  /**
   * Load a session in the acting tenant for a lifecycle mutation. For a
   * qa-engineer, when ownOnly is set, restrict to sessions they recorded
   * (contract: DELETE allows admin tenant-wide, qa-engineer own only).
   */
  private async loadForMutation(
    sessionId: string,
    ownOnlyForQa: boolean,
  ): Promise<typeof sessions.$inferSelect> {
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
    if (
      ownOnlyForQa &&
      this.ctx.role === 'qa-engineer' &&
      row.recordedBy !== this.ctx.actingUserId
    ) {
      throw new AppException(
        'forbidden',
        'A qa-engineer may only delete their own recordings',
        HttpStatus.FORBIDDEN,
      );
    }
    return row;
  }
}
