import type {
  Tenant,
  TenantUser,
  Project,
  JiraConfig,
  Session,
  Artifact,
  Flag,
} from '@qassistant/shared';
import type {
  Role,
  TenantStatus,
  UserStatus,
  JiraStatus,
  SessionStatus,
  SessionCloseReason,
  ArtifactType,
  Compression,
} from '@qassistant/shared/enums';
import type {
  tenants,
  tenantUsers,
  projects,
  jiraConfigs,
  sessions,
  artifacts,
  flags,
} from '../db/schema.js';

/**
 * Map snake_case Drizzle rows to the camelCase API entity shapes
 * (contract section 0 JSON-casing convention). Timestamps are serialized to
 * ISO-8601 strings to match the shared zod entity schemas.
 */

type TenantRow = typeof tenants.$inferSelect;
type TenantUserRow = typeof tenantUsers.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type JiraConfigRow = typeof jiraConfigs.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type ArtifactRow = typeof artifacts.$inferSelect;
type FlagRow = typeof flags.$inferSelect;

function iso(value: Date): string {
  return value.toISOString();
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    gcipTenantId: row.gcipTenantId,
    status: row.status as TenantStatus,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toTenantUser(row: TenantUserRow): TenantUser {
  return {
    id: row.id,
    tenantId: row.tenantId,
    gcipUid: row.gcipUid,
    email: row.email,
    role: row.role as Role,
    status: row.status as UserStatus,
    mustChangePassword: row.mustChangePassword,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    baseUrl: row.baseUrl,
    status: row.status as Project['status'],
    screenshotDefault: row.screenshotDefault,
    knowledgeMd: row.knowledgeMd,
    defaultCredsSecretRef: row.defaultCredsSecretRef,
    maskingSelectors: (row.maskingSelectors as string[] | null) ?? [],
    inactivityTimeoutSeconds: row.inactivityTimeoutSeconds,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** tokenSecretRef is intentionally never serialized (tokens stay in Secret Manager). */
export function toJiraConfig(row: JiraConfigRow): JiraConfig {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    baseUrl: row.baseUrl,
    projectKey: row.projectKey,
    status: row.status as JiraStatus,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    recordedBy: row.recordedBy,
    jiraId: row.jiraId,
    jiraSummary: row.jiraSummary,
    jiraStatus: row.jiraStatus,
    description: row.description,
    screenshotEnabled: row.screenshotEnabled,
    status: row.status as SessionStatus,
    closeReason: (row.closeReason as SessionCloseReason | null) ?? null,
    summary: row.summary,
    startedAt: iso(row.startedAt),
    endedAt: isoOrNull(row.endedAt),
    deletedAt: isoOrNull(row.deletedAt),
    purgeAt: isoOrNull(row.purgeAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    sessionId: row.sessionId,
    type: row.type as ArtifactType,
    seq: row.seq,
    gcsPath: row.gcsPath,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
    compression: row.compression as Compression,
    capturedAt: iso(row.capturedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toFlag(row: FlagRow): Flag {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    sessionId: row.sessionId,
    selector: row.selector,
    note: row.note,
    eventOffsetMs: row.eventOffsetMs,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
