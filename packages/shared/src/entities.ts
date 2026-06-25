import { z } from 'zod';
import { uuid, isoTimestamp } from './common.js';
import {
  ROLES,
  TENANT_STATUSES,
  USER_STATUSES,
  PROJECT_STATUSES,
  JIRA_STATUSES,
  SESSION_STATUSES,
  SESSION_CLOSE_REASONS,
  ARTIFACT_TYPES,
  COMPRESSIONS,
  GENERATED_TEST_KINDS,
  MODEL_TIERS,
  REVIEW_STATUSES,
} from './enums.js';

/**
 * API-facing entity shapes. DB columns are snake_case; these are the camelCase
 * JSON representations returned by the REST surface (contract section 3 + the
 * JSON-casing convention in section 0).
 */

export const tenantSchema = z.object({
  id: uuid,
  name: z.string(),
  gcipTenantId: z.string(),
  status: z.enum(TENANT_STATUSES),
  defaultTestFramework: z.string(),
  defaultTestLanguage: z.string(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type Tenant = z.infer<typeof tenantSchema>;

export const tenantUserSchema = z.object({
  id: uuid,
  tenantId: uuid,
  gcipUid: z.string(),
  email: z.string().email(),
  role: z.enum(ROLES),
  status: z.enum(USER_STATUSES),
  mustChangePassword: z.boolean(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type TenantUser = z.infer<typeof tenantUserSchema>;

export const projectSchema = z.object({
  id: uuid,
  tenantId: uuid,
  name: z.string(),
  baseUrl: z.string().url(),
  status: z.enum(PROJECT_STATUSES),
  screenshotDefault: z.boolean(),
  knowledgeMd: z.string().nullable(),
  defaultCredsSecretRef: z.string().nullable(),
  // Per-project codegen default; null = inherit the tenant default.
  defaultTestFramework: z.string().nullable(),
  defaultTestLanguage: z.string().nullable(),
  maskingSelectors: z.array(z.string()),
  inactivityTimeoutSeconds: z.number().int().positive(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type Project = z.infer<typeof projectSchema>;

export const jiraConfigSchema = z.object({
  id: uuid,
  tenantId: uuid,
  projectId: uuid,
  baseUrl: z.string().url(),
  projectKey: z.string(),
  // tokenSecretRef intentionally omitted from API reads; tokens never leave Secret Manager.
  status: z.enum(JIRA_STATUSES),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type JiraConfig = z.infer<typeof jiraConfigSchema>;

export const sessionSchema = z.object({
  id: uuid,
  tenantId: uuid,
  projectId: uuid,
  recordedBy: uuid,
  jiraId: z.string().nullable(),
  jiraSummary: z.string().nullable(),
  jiraStatus: z.string().nullable(),
  description: z.string().nullable(),
  screenshotEnabled: z.boolean(),
  status: z.enum(SESSION_STATUSES),
  closeReason: z.enum(SESSION_CLOSE_REASONS).nullable(),
  summary: z.string().nullable(),
  startedAt: isoTimestamp,
  endedAt: isoTimestamp.nullable(),
  deletedAt: isoTimestamp.nullable(),
  purgeAt: isoTimestamp.nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type Session = z.infer<typeof sessionSchema>;

export const artifactSchema = z.object({
  id: uuid,
  tenantId: uuid,
  projectId: uuid,
  sessionId: uuid,
  type: z.enum(ARTIFACT_TYPES),
  seq: z.number().int().nonnegative(),
  gcsPath: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().nullable(),
  compression: z.enum(COMPRESSIONS),
  capturedAt: isoTimestamp,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type Artifact = z.infer<typeof artifactSchema>;

export const flagSchema = z.object({
  id: uuid,
  tenantId: uuid,
  projectId: uuid,
  sessionId: uuid,
  selector: z.string(),
  note: z.string().nullable(),
  eventOffsetMs: z.number().int().nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type Flag = z.infer<typeof flagSchema>;

export const promptInputsSummarySchema = z.object({
  // Target the test was generated for (configurable-test-framework). Optional so
  // versions generated before the feature still validate.
  framework: z.string().optional(),
  language: z.string().optional(),
  sources: z.array(
    z.object({
      label: z.string(),
      kind: z.string(),
      note: z.string().optional(),
    }),
  ),
});
export type PromptInputsSummary = z.infer<typeof promptInputsSummarySchema>;

export const generatedTestSchema = z.object({
  id: uuid,
  tenantId: uuid,
  projectId: uuid,
  sessionId: uuid,
  version: z.number().int().positive(),
  kind: z.enum(GENERATED_TEST_KINDS),
  modelTier: z.enum(MODEL_TIERS),
  modelId: z.string(),
  code: z.string(),
  framework: z.string(),
  language: z.string(),
  reviewStatus: z.enum(REVIEW_STATUSES),
  approvedBy: uuid.nullable(),
  approvedAt: isoTimestamp.nullable(),
  integrated: z.boolean(),
  integratedBy: uuid.nullable(),
  integratedAt: isoTimestamp.nullable(),
  promptInputsSummary: promptInputsSummarySchema,
  sourceCommentId: uuid.nullable(),
  createdBy: uuid,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type GeneratedTest = z.infer<typeof generatedTestSchema>;

export const generationCommentSchema = z.object({
  id: uuid,
  tenantId: uuid,
  projectId: uuid,
  sessionId: uuid,
  generatedTestId: uuid.nullable(),
  body: z.string(),
  createdBy: uuid,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type GenerationComment = z.infer<typeof generationCommentSchema>;
