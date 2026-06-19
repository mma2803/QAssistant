import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { artifacts, projects, sessions } from '../db/schema.js';

/**
 * Inactivity auto-close backstop (contract section 4.4; spec "Session auto-closes
 * on inactivity"). The extension also tracks inactivity locally and calls /stop;
 * this server-side sweep guarantees a crashed extension still closes the session.
 *
 * A session is auto-closed when it is still active and the most recent
 * dom_chunk artifact (or, if none, the session start) is older than the
 * project's inactivity_timeout_seconds. Auto-closed sessions get
 * status=completed, close_reason=inactivity, ended_at=last-activity time.
 *
 * Runs on the privileged BYPASSRLS pool because it sweeps across all tenants
 * (it is an internal worker, not a tenant request), so RLS is intentionally
 * bypassed; tenant_id is carried on every row it writes.
 */
@Injectable()
export class InactivityService {
  constructor(private readonly db: DbService) {}

  async sweep(now: Date = new Date()): Promise<string[]> {
    return this.db.withSuperadmin(async ({ db }) => {
      // last_activity = max(dom_chunk.captured_at) or sessions.started_at.
      // cutoff = now - project.inactivity_timeout_seconds.
      const lastActivity = sql<Date>`GREATEST(
        ${sessions.startedAt},
        COALESCE(
          (
            SELECT MAX(${artifacts.capturedAt})
            FROM ${artifacts}
            WHERE ${artifacts.sessionId} = ${sessions.id}
              AND ${artifacts.type} = 'dom_chunk'
          ),
          ${sessions.startedAt}
        )
      )`;

      const stale = await db
        .select({
          id: sessions.id,
          tenantId: sessions.tenantId,
          lastActivity,
        })
        .from(sessions)
        .innerJoin(projects, eq(projects.id, sessions.projectId))
        .where(
          and(
            eq(sessions.status, 'active'),
            sql`${lastActivity} < (${now}::timestamptz - (${projects.inactivityTimeoutSeconds} * interval '1 second'))`,
          ),
        );

      const closedIds: string[] = [];
      for (const s of stale) {
        await db
          .update(sessions)
          .set({
            status: 'completed',
            closeReason: 'inactivity',
            endedAt: s.lastActivity,
            updatedAt: now,
          })
          .where(and(eq(sessions.id, s.id), eq(sessions.status, 'active')));
        closedIds.push(s.id);
      }
      return closedIds;
    });
  }
}
