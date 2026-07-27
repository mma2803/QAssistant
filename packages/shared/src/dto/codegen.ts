import { z } from 'zod';
import {
  uuid,
  nonEmptyString,
  testFrameworkSchema,
  testLanguageSchema,
  testTypeSchema,
} from '../common.js';
import { GENERATED_TEST_KINDS, MODEL_TIERS, TEST_TYPES } from '../enums.js';
import { generatedTestSchema, generationCommentSchema } from '../entities.js';

/** Codegen DTOs (contract section 4.5). Async via a Postgres-backed job queue. */

/**
 * POST /sessions/{sessionId}/generate: enqueue a codegen job. `framework` and
 * `language` are an optional per-generation override (the selector next to the
 * Generate button); when omitted, the service falls back to the tenant default.
 */
export const generateRequestSchema = z.object({
  kind: z.enum(GENERATED_TEST_KINDS).default('playwright_test'),
  modelTier: z.enum(MODEL_TIERS).optional(),
  framework: testFrameworkSchema.optional(),
  language: testLanguageSchema.optional(),
  // Per-generation test-type override (UI/Back-end selector). When omitted the
  // service falls back to project then tenant default (change: configurable-test-type).
  testType: testTypeSchema.optional(),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

/** Async enqueue response: { jobId }. */
export const jobResponseSchema = z.object({
  jobId: uuid,
});
export type JobResponse = z.infer<typeof jobResponseSchema>;

export const generatedTestResponseSchema = generatedTestSchema;

/** GET /sessions/{sessionId}/generations: list generated versions for the session. */
export const generationsListResponseSchema = z.object({
  items: z.array(generatedTestSchema),
});
export type GenerationsListResponse = z.infer<typeof generationsListResponseSchema>;

/** POST /generations/{id}/approve and /integrate responses: the updated version. */
export const generationResponseSchema = generatedTestSchema;

/**
 * POST /generations/{id}/integrate body: an MCP client reports the outcome of
 * pushing a `ready_to_integrate` version to the team's repo. `integrated`
 * requires a repo reference (commit or PR URL); `failed_to_integrate` requires
 * an error message (e.g. "target repository not found"). QAssistant stores the
 * report; it never performs the Git push itself.
 */
export const updateIntegrationStatusRequestSchema = z
  .object({
    status: z.enum(['integrated', 'failed_to_integrate']),
    ref: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
  })
  .refine((v) => v.status !== 'integrated' || !!v.ref, {
    message: 'ref (commit or PR URL) is required when status is integrated',
    path: ['ref'],
  })
  .refine((v) => v.status !== 'failed_to_integrate' || !!v.error, {
    message: 'error message is required when status is failed_to_integrate',
    path: ['error'],
  });
export type UpdateIntegrationStatusRequest = z.infer<typeof updateIntegrationStatusRequestSchema>;

/** POST /sessions/{sessionId}/comments */
export const createCommentRequestSchema = z.object({
  body: nonEmptyString,
  generatedTestId: uuid.optional(),
});
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;

export const commentResponseSchema = generationCommentSchema;

/** POST /sessions/{sessionId}/regenerate: enqueue regeneration incorporating comments. */
export const regenerateRequestSchema = z.object({
  kind: z.enum(GENERATED_TEST_KINDS).default('playwright_test'),
  modelTier: z.enum(MODEL_TIERS).optional(),
  framework: testFrameworkSchema.optional(),
  language: testLanguageSchema.optional(),
  testType: testTypeSchema.optional(),
  // The comment that drives this regeneration; stamped as source_comment_id.
  sourceCommentId: uuid.optional(),
});
export type RegenerateRequest = z.infer<typeof regenerateRequestSchema>;

/**
 * POST /internal/tasks/generate: internal worker payload (token-gated, not
 * client-facing). Carries everything the worker needs to run Gemini and write a
 * generated_tests row under the right tenant. In prod this is invoked by the
 * in-process codegen job poller, not called over HTTP.
 */
export const generateTaskPayloadSchema = z.object({
  jobId: uuid,
  tenantId: uuid,
  projectId: uuid,
  sessionId: uuid,
  createdBy: uuid,
  kind: z.enum(GENERATED_TEST_KINDS),
  modelTier: z.enum(MODEL_TIERS),
  // Resolved target (override or tenant default) the worker persists on the row.
  framework: z.string(),
  language: z.string(),
  // Resolved test type the worker generates for and persists (change:
  // configurable-test-type). Defaults to 'ui' so payloads predating the feature
  // still validate and behave as before.
  testType: z.enum(TEST_TYPES).default('ui'),
  sourceCommentId: uuid.optional(),
});
export type GenerateTaskPayload = z.infer<typeof generateTaskPayloadSchema>;
