import { z } from 'zod';
import { uuid, isoTimestamp, nonEmptyString } from '../common.js';
import { ARTIFACT_TYPES, COMPRESSIONS } from '../enums.js';
import { sessionSchema, artifactSchema, flagSchema } from '../entities.js';

/** Extension capture DTOs (contract section 4.4). */

/**
 * POST /sessions: start a session. The client supplies projectId and work
 * context (jiraId OR description). At least one of jiraId / description is
 * required; the backend freezes context after Jira validation. tenantId / uid
 * are always server-derived, never accepted from the client (design D5).
 */
export const startSessionRequestSchema = z
  .object({
    projectId: uuid,
    jiraId: nonEmptyString.optional(),
    description: nonEmptyString.optional(),
    // Optional per-session override of the project screenshot default.
    screenshotEnabled: z.boolean().optional(),
  })
  .refine((v) => v.jiraId !== undefined || v.description !== undefined, {
    message: 'A jiraId or a non-empty description is required',
  });
export type StartSessionRequest = z.infer<typeof startSessionRequestSchema>;

export const sessionResponseSchema = sessionSchema;

/**
 * GET /sessions/{sessionId}/upload-urls: request signed PUT URL(s) for the next
 * artifact(s). The client declares which artifact slots it wants to upload; the
 * backend returns write-only V4 signed URLs scoped to the session prefix.
 */
export const uploadUrlRequestItemSchema = z.object({
  type: z.enum(ARTIFACT_TYPES),
  // Coerced so the same schema validates both JSON bodies and querystring values
  // (GET /upload-urls carries items via the query, where numbers arrive as text).
  seq: z.coerce.number().int().nonnegative(),
});
export const uploadUrlsRequestSchema = z.object({
  items: z.array(uploadUrlRequestItemSchema).min(1).max(50),
});
export type UploadUrlsRequest = z.infer<typeof uploadUrlsRequestSchema>;

export const uploadUrlResponseItemSchema = z.object({
  type: z.enum(ARTIFACT_TYPES),
  seq: z.number().int().nonnegative(),
  gcsPath: z.string(),
  uploadUrl: z.string().url(),
  // Required headers the client must echo on the PUT (e.g. Content-Type).
  requiredHeaders: z.record(z.string()),
  expiresAt: isoTimestamp,
});
export const uploadUrlsResponseSchema = z.object({
  items: z.array(uploadUrlResponseItemSchema),
});
export type UploadUrlsResponse = z.infer<typeof uploadUrlsResponseSchema>;

/** POST /sessions/{sessionId}/artifacts: register uploaded artifact metadata. */
export const registerArtifactRequestSchema = z.object({
  type: z.enum(ARTIFACT_TYPES),
  seq: z.number().int().nonnegative(),
  gcsPath: nonEmptyString,
  contentType: nonEmptyString,
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().nullable().optional(),
  compression: z.enum(COMPRESSIONS).default('none'),
  capturedAt: isoTimestamp,
});
export type RegisterArtifactRequest = z.infer<typeof registerArtifactRequestSchema>;

export const artifactResponseSchema = artifactSchema;

/** POST /sessions/{sessionId}/flags: record a flagged selector/state. */
export const createFlagRequestSchema = z.object({
  selector: nonEmptyString,
  note: z.string().nullable().optional(),
  eventOffsetMs: z.number().int().nonnegative().nullable().optional(),
});
export type CreateFlagRequest = z.infer<typeof createFlagRequestSchema>;

export const flagResponseSchema = flagSchema;

/** POST /sessions/{sessionId}/stop: finalize the session. No body required. */
export const stopSessionResponseSchema = sessionSchema;

/**
 * POST /internal/tasks/inactivity-sweep: backstop worker that auto-closes active
 * sessions whose last DOM-replay artifact is older than the project's
 * inactivity_timeout_seconds (contract section 4.4). Not client-facing; OIDC- or
 * shared-token-gated. Optional `now` lets a test pin the clock.
 */
export const inactivitySweepRequestSchema = z.object({
  now: isoTimestamp.optional(),
});
export type InactivitySweepRequest = z.infer<typeof inactivitySweepRequestSchema>;

export const inactivitySweepResponseSchema = z.object({
  closedSessionIds: z.array(uuid),
});
export type InactivitySweepResponse = z.infer<typeof inactivitySweepResponseSchema>;
