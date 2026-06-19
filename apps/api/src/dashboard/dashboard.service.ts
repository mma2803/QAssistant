import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type {
  DashboardSessionsQuery,
  DashboardSessionsResponse,
  DashboardSessionListItem,
  SessionDetailResponse,
  SessionReplayResponse,
  MetricsResponse,
  RankingResponse,
  UserMetric,
} from '@qassistant/shared';
import { RequestContext } from '../auth/request-context.js';
import { AppException } from '../auth/errors.js';
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
import { toGeneratedTest, toGenerationComment } from '../codegen/serializers.js';
import { GCS_READER, decodeArtifactText, type GcsReader } from '../storage/gcs-reader.service.js';

/** Raw bytes of a single artifact, for the dashboard artifact-read endpoint. */
export interface ArtifactBytes {
  bytes: Buffer;
  contentType: string;
  filename: string;
}

/**
 * Dashboard reads (contract sections 4.7, 6). Every query runs in the
 * request-scoped tenant transaction (RLS-scoped) with an explicit tenant_id
 * predicate (defense in depth, D10).
 *
 * Role scoping (spec qa-dashboards): RLS enforces the tenant boundary; the
 * "qa-engineer sees only own work" rule is an application-layer AND
 * recorded_by = <self> predicate (contract section 4.7 note). Admin omits it.
 * Soft-deleted sessions (deleted_at IS NOT NULL) are always hidden from reads.
 */
@Injectable()
export class DashboardService {
  /**
   * Per-session cap on DOM chunks assembled for inline replay, mirroring the
   * codegen worker's bound. A recording past this many chunks replays its first
   * MAX_REPLAY_CHUNKS and flags `truncated`; the full stream stays in Export.
   */
  private static readonly MAX_REPLAY_CHUNKS = 2000;

  constructor(
    private readonly ctx: RequestContext,
    @Inject(GCS_READER) private readonly reader: GcsReader,
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
   * The application-layer role-scoping predicate for a dashboard read. Admin:
   * tenant-wide. qa-engineer: AND recorded_by = self. Always hides soft-deleted.
   */
  private scopePredicate(tenantId: string): SQL {
    const base = and(eq(sessions.tenantId, tenantId), isNull(sessions.deletedAt))!;
    if (this.ctx.role === 'qa-engineer') {
      return and(base, eq(sessions.recordedBy, this.requireActingUser()))!;
    }
    return base;
  }

  /**
   * GET /dashboard/sessions: cursor-paginated recording list, soft-deleted
   * hidden, newest first. Cursor is the created_at|id of the last item so
   * pagination is stable under inserts.
   */
  async listSessions(query: DashboardSessionsQuery): Promise<DashboardSessionsResponse> {
    const tenantId = this.requireTenant();

    const conditions: SQL[] = [this.scopePredicate(tenantId)];
    if (query.projectId) {
      conditions.push(eq(sessions.projectId, query.projectId));
    }
    if (query.status) {
      conditions.push(eq(sessions.status, query.status));
    }
    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      // Keyset pagination on (created_at DESC, id DESC).
      conditions.push(
        sql`(${sessions.createdAt}, ${sessions.id}) < (${cursor.createdAt}, ${cursor.id})`,
      );
    }

    const rows = await this.ctx.dbTx
      .select({
        session: sessions,
        projectName: projects.name,
        recordedByEmail: tenantUsers.email,
        generatedTestCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${generatedTests} gt
          WHERE gt.session_id = ${sessions.id}
            AND gt.kind = 'playwright_test'
        )`,
      })
      .from(sessions)
      .innerJoin(projects, eq(projects.id, sessions.projectId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, sessions.recordedBy))
      .where(and(...conditions))
      .orderBy(desc(sessions.createdAt), desc(sessions.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const items: DashboardSessionListItem[] = page.map((r) => ({
      ...toSession(r.session),
      projectName: r.projectName,
      recordedByEmail: r.recordedByEmail ?? null,
      durationSeconds: durationSeconds(r.session.startedAt, r.session.endedAt),
      generatedTestCount: r.generatedTestCount ?? 0,
    }));

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(last.session.createdAt, last.session.id) : null;

    return { items, nextCursor };
  }

  /**
   * GET /dashboard/sessions/{id}: recording detail (artifacts, flags, summary,
   * generations, comments). 404 if not found, hidden by role scope, or
   * soft-deleted (qa-engineer cannot peek into another tester's recording).
   */
  async getSession(sessionId: string): Promise<SessionDetailResponse> {
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
      .where(and(this.scopePredicate(tenantId), eq(sessions.id, sessionId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new AppException('not_found', 'Session not found', HttpStatus.NOT_FOUND);
    }

    // A request transaction owns one pg client. Keep its queries sequential;
    // concurrent client.query calls are deprecated in pg 8 and rejected in pg 9.
    const artifactRows = await this.ctx.dbTx
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.tenantId, tenantId), eq(artifacts.sessionId, sessionId)))
      .orderBy(asc(artifacts.type), asc(artifacts.seq));
    const flagRows = await this.ctx.dbTx
      .select()
      .from(flags)
      .where(and(eq(flags.tenantId, tenantId), eq(flags.sessionId, sessionId)))
      .orderBy(asc(flags.eventOffsetMs));
    const generationRows = await this.ctx.dbTx
      .select()
      .from(generatedTests)
      .where(and(eq(generatedTests.tenantId, tenantId), eq(generatedTests.sessionId, sessionId)))
      .orderBy(asc(generatedTests.version));
    const commentRows = await this.ctx.dbTx
      .select()
      .from(generationComments)
      .where(
        and(eq(generationComments.tenantId, tenantId), eq(generationComments.sessionId, sessionId)),
      )
      .orderBy(asc(generationComments.createdAt));

    return {
      session: toSession(row.session),
      projectName: row.projectName,
      recordedByEmail: row.recordedByEmail ?? null,
      durationSeconds: durationSeconds(row.session.startedAt, row.session.endedAt),
      artifacts: artifactRows.map(toArtifact),
      flags: flagRows.map(toFlag),
      generations: generationRows.map(toGeneratedTest),
      comments: commentRows.map(toGenerationComment),
    };
  }

  /**
   * Assert the acting user may read this session, returning its id. Reuses the
   * exact role/RLS/soft-delete scope as the detail read (a qa-engineer cannot
   * peek into another tester's recording, and soft-deleted sessions 404). 404
   * when not found or hidden by scope.
   */
  private async assertSessionAccess(sessionId: string): Promise<string> {
    const tenantId = this.requireTenant();
    const rows = await this.ctx.dbTx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(this.scopePredicate(tenantId), eq(sessions.id, sessionId)))
      .limit(1);
    if (!rows[0]) {
      throw new AppException('not_found', 'Session not found', HttpStatus.NOT_FOUND);
    }
    return tenantId;
  }

  /**
   * GET /dashboard/sessions/{id}/replay: decode and concatenate the session's
   * dom_chunk artifacts (seq order) into a single rrweb event array the
   * dashboard plays inline (spec 5.2). Server-side read on the same GcsReader
   * the export/codegen use; the client never gets a read credential (contract 7,
   * D-upload-write-only). Unreachable bytes (offline sink) are skipped so the
   * endpoint degrades to a placeholder rather than failing.
   */
  async getReplay(sessionId: string): Promise<SessionReplayResponse> {
    const tenantId = await this.assertSessionAccess(sessionId);

    const chunkRows = await this.ctx.dbTx
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.tenantId, tenantId),
          eq(artifacts.sessionId, sessionId),
          eq(artifacts.type, 'dom_chunk'),
        ),
      )
      .orderBy(asc(artifacts.seq))
      .limit(DashboardService.MAX_REPLAY_CHUNKS + 1);

    const truncated = chunkRows.length > DashboardService.MAX_REPLAY_CHUNKS;
    const chunks = truncated ? chunkRows.slice(0, DashboardService.MAX_REPLAY_CHUNKS) : chunkRows;

    const events: unknown[] = [];
    let chunkCount = 0;
    for (const row of chunks) {
      const bytes = await this.reader.download(row.gcsPath);
      if (!bytes) continue;
      try {
        const text = decodeArtifactText(bytes, row.compression as 'none' | 'gzip');
        const parsed = JSON.parse(text);
        // Each chunk is a JSON array of rrweb events (extension flush format).
        if (Array.isArray(parsed)) {
          events.push(...parsed);
          chunkCount += 1;
        }
      } catch {
        // Skip an undecodable/corrupt chunk rather than failing the whole replay.
      }
    }

    return { events, chunkCount, truncated };
  }

  /**
   * GET /dashboard/sessions/{id}/artifacts/{artifactId}: stream one artifact's
   * raw bytes (a screenshot, or a single dom chunk) for inline viewing. Scoped
   * by the same session-access rule, then by artifact id within the session.
   * Returns the bytes with their stored content type; the controller sets the
   * response headers. 404 if the artifact row or its bytes are missing.
   */
  async getArtifactBytes(sessionId: string, artifactId: string): Promise<ArtifactBytes> {
    const tenantId = await this.assertSessionAccess(sessionId);

    const rows = await this.ctx.dbTx
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.tenantId, tenantId),
          eq(artifacts.sessionId, sessionId),
          eq(artifacts.id, artifactId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new AppException('not_found', 'Artifact not found', HttpStatus.NOT_FOUND);
    }

    const bytes = await this.reader.download(row.gcsPath);
    if (!bytes) {
      throw new AppException(
        'not_found',
        'Artifact bytes are not available',
        HttpStatus.NOT_FOUND,
      );
    }

    const filename = row.gcsPath.split('/').pop() ?? `${row.type}-${row.seq}`;
    return { bytes, contentType: row.contentType, filename };
  }

  /**
   * GET /dashboard/metrics: per-active-user productivity metrics (contract 6).
   * Admin only (controller-enforced). Over non-soft-deleted sessions:
   *   generatedTestCount = playwright_test generations for the user's sessions
   *   totalRecordingSeconds = SUM(ended_at - started_at), raw wall-clock
   *   recordingCount = completed sessions
   */
  async metrics(): Promise<MetricsResponse> {
    return { metrics: await this.computeMetrics() };
  }

  /**
   * GET /dashboard/ranking: same metrics, ordered by generatedTestCount DESC,
   * totalRecordingSeconds DESC, recordingCount DESC (contract 6). No hidden
   * weighted score; the three ordering metrics are returned as-is. Admin only.
   */
  async ranking(): Promise<RankingResponse> {
    const metrics = await this.computeMetrics();
    const ranking = [...metrics].sort(
      (a, b) =>
        b.generatedTestCount - a.generatedTestCount ||
        b.totalRecordingSeconds - a.totalRecordingSeconds ||
        b.recordingCount - a.recordingCount,
    );
    return { ranking };
  }

  /**
   * Shared metric computation, one row per active tenant user. Recording
   * aggregates use raw wall-clock duration (no idle exclusion in MVP) over
   * completed, non-soft-deleted sessions. generatedTestCount counts
   * playwright_test versions on those sessions.
   */
  private async computeMetrics(): Promise<UserMetric[]> {
    const tenantId = this.requireTenant();
    // Drizzle intentionally renders a column interpolated inside raw SQL as an
    // unqualified identifier. These correlated subqueries also contain tables
    // with an `id` column, so qualify the outer user id explicitly.
    const metricUserId = sql.raw('"tenant_users"."id"');

    const rows = await this.ctx.dbTx
      .select({
        userId: tenantUsers.id,
        email: tenantUsers.email,
        totalRecordingSeconds: sql<number>`COALESCE((
          SELECT SUM(EXTRACT(EPOCH FROM (s.ended_at - s.started_at)))
          FROM ${sessions} s
          WHERE s.recorded_by = ${metricUserId}
            AND s.tenant_id = ${tenantId}
            AND s.deleted_at IS NULL
            AND s.status = 'completed'
            AND s.ended_at IS NOT NULL
        ), 0)::float8`,
        recordingCount: sql<number>`COALESCE((
          SELECT COUNT(*) FROM ${sessions} s
          WHERE s.recorded_by = ${metricUserId}
            AND s.tenant_id = ${tenantId}
            AND s.deleted_at IS NULL
            AND s.status = 'completed'
        ), 0)::int`,
        generatedTestCount: sql<number>`COALESCE((
          SELECT COUNT(*) FROM ${generatedTests} gt
          JOIN ${sessions} s ON s.id = gt.session_id
          WHERE s.recorded_by = ${metricUserId}
            AND s.tenant_id = ${tenantId}
            AND s.deleted_at IS NULL
            AND gt.kind = 'playwright_test'
        ), 0)::int`,
      })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.status, 'active')))
      .orderBy(asc(tenantUsers.email));

    return rows.map((r) => ({
      userId: r.userId,
      email: r.email,
      generatedTestCount: r.generatedTestCount ?? 0,
      totalRecordingSeconds: Math.round((r.totalRecordingSeconds ?? 0) * 1000) / 1000,
      recordingCount: r.recordingCount ?? 0,
    }));
  }
}

/** Raw wall-clock duration in seconds (no idle exclusion in MVP), or null while active. */
function durationSeconds(startedAt: Date, endedAt: Date | null): number | null {
  if (!endedAt) return null;
  return Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 1000);
}

interface Cursor {
  createdAt: string;
  id: string;
}

/** Encode a keyset cursor (createdAt ISO + id) to an opaque base64url string. */
function encodeCursor(createdAt: Date, id: string): string {
  const raw = JSON.stringify({ c: createdAt.toISOString(), i: id });
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string): Cursor | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as { c?: unknown; i?: unknown };
    if (typeof parsed.c !== 'string' || typeof parsed.i !== 'string') return null;
    return { createdAt: parsed.c, id: parsed.i };
  } catch {
    return null;
  }
}
