import { z } from 'zod';
import { uuid, isoTimestamp, paginationQuerySchema, paginated } from '../common.js';
import { SESSION_STATUSES } from '../enums.js';
import {
  sessionSchema,
  artifactSchema,
  flagSchema,
  generatedTestSchema,
  generationCommentSchema,
} from '../entities.js';

/** Lifecycle / dashboard read DTOs (contract sections 4.6, 4.7). */

/** DELETE /sessions/{sessionId} response: soft-deleted session. */
export const deleteSessionResponseSchema = sessionSchema;

/** POST /sessions/{sessionId}/restore response. */
export const restoreSessionResponseSchema = sessionSchema;

/**
 * GET /dashboard/sessions: cursor-paginated recording list (soft-deleted hidden).
 * Optional filters narrow the list; qa-engineer is always scoped to own work
 * server-side (the recorded_by filter is added by the backend, not the client).
 */
export const dashboardSessionsQuerySchema = paginationQuerySchema.extend({
  projectId: uuid.optional(),
  status: z.enum(SESSION_STATUSES).optional(),
});
export type DashboardSessionsQuery = z.infer<typeof dashboardSessionsQuerySchema>;

/**
 * A session list row enriched with the project name and recorder email so the
 * dashboard table renders without N+1 lookups.
 */
export const dashboardSessionListItemSchema = sessionSchema.extend({
  projectName: z.string(),
  recordedByEmail: z.string().email().nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
  generatedTestCount: z.number().int().nonnegative(),
});
export type DashboardSessionListItem = z.infer<typeof dashboardSessionListItemSchema>;

export const dashboardSessionsResponseSchema = paginated(dashboardSessionListItemSchema);
export type DashboardSessionsResponse = z.infer<typeof dashboardSessionsResponseSchema>;

/** GET /dashboard/sessions/{sessionId}: recording detail. */
export const sessionDetailResponseSchema = z.object({
  session: sessionSchema,
  projectName: z.string(),
  recordedByEmail: z.string().email().nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
  artifacts: z.array(artifactSchema),
  flags: z.array(flagSchema),
  generations: z.array(generatedTestSchema),
  comments: z.array(generationCommentSchema),
});
export type SessionDetailResponse = z.infer<typeof sessionDetailResponseSchema>;

/**
 * GET /dashboard/sessions/{sessionId}/replay: the session's DOM-replay event
 * stream, decoded and concatenated from the dom_chunk artifacts in seq order so
 * the dashboard can play it inline (spec 5.2). `events` is the rrweb event array
 * (opaque to the contract); `chunkCount` is how many chunks contributed and
 * `truncated` flags that a per-session chunk cap was hit. Empty `events` (no
 * chunks, or the bytes are not reachable) renders the player's placeholder.
 */
export const sessionReplayResponseSchema = z.object({
  events: z.array(z.unknown()),
  chunkCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type SessionReplayResponse = z.infer<typeof sessionReplayResponseSchema>;

/** GET /dashboard/metrics: per-user productivity metrics (contract section 6). */
export const userMetricSchema = z.object({
  userId: uuid,
  email: z.string().email(),
  generatedTestCount: z.number().int().nonnegative(),
  totalRecordingSeconds: z.number().nonnegative(),
  recordingCount: z.number().int().nonnegative(),
});
export type UserMetric = z.infer<typeof userMetricSchema>;

export const metricsResponseSchema = z.object({
  metrics: z.array(userMetricSchema),
});
export type MetricsResponse = z.infer<typeof metricsResponseSchema>;

/**
 * GET /dashboard/ranking: contribution ranking (admin only). Same metric shape,
 * ordered by generatedTestCount DESC, totalRecordingSeconds DESC, recordingCount DESC.
 */
export const rankingResponseSchema = z.object({
  // Directional ranking, raw wall-clock (contract section 6).
  ranking: z.array(userMetricSchema),
});
export type RankingResponse = z.infer<typeof rankingResponseSchema>;

/**
 * POST /internal/tasks/purge: permanent-deletion sweep of sessions whose
 * purge_at has elapsed (contract sections 3.10, 4.6). Not client-facing; OIDC-
 * or shared-token-gated. Optional `now` lets a test pin the clock.
 */
export const purgeSweepRequestSchema = z.object({
  now: isoTimestamp.optional(),
});
export type PurgeSweepRequest = z.infer<typeof purgeSweepRequestSchema>;

export const purgeSweepResponseSchema = z.object({
  purgedSessionIds: z.array(uuid),
});
export type PurgeSweepResponse = z.infer<typeof purgeSweepResponseSchema>;
