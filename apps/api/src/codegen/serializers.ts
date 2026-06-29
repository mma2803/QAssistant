import type { GeneratedTest, GenerationComment, PromptInputsSummary } from '@qassistant/shared';
import type {
  GeneratedTestKind,
  ModelTier,
  ReviewStatus,
  IntegrationStatus,
} from '@qassistant/shared/enums';
import type { generatedTests, generationComments } from '../db/schema.js';

/**
 * Codegen-local row -> API entity serializers (camelCase JSON; ISO timestamps).
 * Kept in this module to avoid touching the shared common/serializers.ts owned by
 * other phases.
 */

type GeneratedTestRow = typeof generatedTests.$inferSelect;
type GenerationCommentRow = typeof generationComments.$inferSelect;

function iso(value: Date): string {
  return value.toISOString();
}
function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toGeneratedTest(row: GeneratedTestRow): GeneratedTest {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    sessionId: row.sessionId,
    version: row.version,
    kind: row.kind as GeneratedTestKind,
    modelTier: row.modelTier as ModelTier,
    modelId: row.modelId,
    code: row.code,
    framework: row.framework,
    language: row.language,
    reviewStatus: row.reviewStatus as ReviewStatus,
    approvedBy: row.approvedBy,
    approvedAt: isoOrNull(row.approvedAt),
    integrationStatus: row.integrationStatus as IntegrationStatus,
    integrationRef: row.integrationRef,
    integrationError: row.integrationError,
    integratedBy: row.integratedBy,
    integratedAt: isoOrNull(row.integratedAt),
    promptInputsSummary: row.promptInputsSummary as PromptInputsSummary,
    sourceCommentId: row.sourceCommentId,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toGenerationComment(row: GenerationCommentRow): GenerationComment {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    sessionId: row.sessionId,
    generatedTestId: row.generatedTestId,
    body: row.body,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
