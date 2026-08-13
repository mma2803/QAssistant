import { z } from 'zod';
import { nonEmptyString, testFrameworkSchema, testLanguageSchema, testTypeSchema } from '../common.js';
import { PROJECT_STATUSES } from '../enums.js';
import { projectSchema } from '../entities.js';

/** Project setup DTOs (contract section 4.3). */

const maskingSelectorsSchema = z.array(nonEmptyString);
const inactivityTimeoutSchema = z.number().int().min(30).max(86_400);

/** POST /projects */
export const createProjectRequestSchema = z.object({
  name: nonEmptyString,
  baseUrl: z.string().url(),
  screenshotDefault: z.boolean().default(false),
  maskingSelectors: maskingSelectorsSchema.default([]),
  inactivityTimeoutSeconds: inactivityTimeoutSchema.default(900),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

/** PATCH /projects/{projectId}: update settings; toggle status. */
export const updateProjectRequestSchema = z
  .object({
    name: nonEmptyString.optional(),
    baseUrl: z.string().url().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    screenshotDefault: z.boolean().optional(),
    maskingSelectors: maskingSelectorsSchema.optional(),
    inactivityTimeoutSeconds: inactivityTimeoutSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

/** PUT /projects/{projectId}/knowledge */
export const setKnowledgeRequestSchema = z.object({
  knowledgeMd: z.string().nullable(),
  defaultCredsSecretRef: z.string().nullable(),
});
export type SetKnowledgeRequest = z.infer<typeof setKnowledgeRequestSchema>;

/**
 * PUT /projects/{projectId}/test-framework: per-project default codegen target
 * (change: configurable-test-framework / configurable-test-type). Open to any
 * tenant user. null on any field = inherit the tenant default for that field.
 */
export const setProjectTestFrameworkRequestSchema = z.object({
  defaultTestFramework: testFrameworkSchema.nullable(),
  defaultTestLanguage: testLanguageSchema.nullable(),
  // Per-project default test type. Optional so existing clients keep working;
  // when present, null = inherit the tenant default, a value = set the override.
  defaultTestType: testTypeSchema.nullable().optional(),
});
export type SetProjectTestFrameworkRequest = z.infer<typeof setProjectTestFrameworkRequestSchema>;

export const projectResponseSchema = projectSchema;
