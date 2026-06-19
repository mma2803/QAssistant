import { z } from 'zod';
import { uuid, nonEmptyString } from '../common.js';
import { GENERATED_TEST_KINDS, MODEL_TIERS } from '../enums.js';
import { generatedTestSchema, generationCommentSchema } from '../entities.js';

/** Codegen DTOs (contract section 4.5). Async via Cloud Tasks. */

/** POST /sessions/{sessionId}/generate: enqueue a codegen job. */
export const generateRequestSchema = z.object({
  kind: z.enum(GENERATED_TEST_KINDS).default('playwright_test'),
  modelTier: z.enum(MODEL_TIERS).optional(),
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
  // The comment that drives this regeneration; stamped as source_comment_id.
  sourceCommentId: uuid.optional(),
});
export type RegenerateRequest = z.infer<typeof regenerateRequestSchema>;

/**
 * POST /internal/tasks/generate: Cloud Tasks worker payload (OIDC-gated, not
 * client-facing). Carries everything the worker needs to run Gemini and write a
 * generated_tests row under the right tenant.
 */
export const generateTaskPayloadSchema = z.object({
  jobId: uuid,
  tenantId: uuid,
  projectId: uuid,
  sessionId: uuid,
  createdBy: uuid,
  kind: z.enum(GENERATED_TEST_KINDS),
  modelTier: z.enum(MODEL_TIERS),
  sourceCommentId: uuid.optional(),
});
export type GenerateTaskPayload = z.infer<typeof generateTaskPayloadSchema>;
