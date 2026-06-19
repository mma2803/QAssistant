/**
 * Drizzle schema for every table in the data-model contract (section 3).
 *
 * Conventions (contract section 0):
 *  - UUID v7 PKs generated app-side (see db/id.ts), stored as `uuid`.
 *  - Enums = `text` + CHECK constraint (the CHECKs are declared here so
 *    drizzle-kit emits them; values come from @qassistant/shared/enums).
 *  - `timestamptz` everywhere; created_at/updated_at on every table.
 *  - Every tenant-scoped table carries a non-null tenant_id; child tables also
 *    carry project_id, supporting RLS and the defense-in-depth WHERE predicate.
 *  - RLS itself is NOT expressible here; it is applied by the hand-written
 *    migration step in db/migrations (contract section 8).
 */
import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  uuid,
  boolean,
  integer,
  bigint,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
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
} from '@qassistant/shared/enums';

/** Build a SQL `col IN ('a','b')` CHECK predicate from an allowed-values tuple. */
function inList(column: string, values: readonly string[]) {
  const list = values.map((v) => `'${v}'`).join(', ');
  return sql.raw(`${column} IN (${list})`);
}

const createdAt = timestamp('created_at', { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true })
  .notNull()
  .defaultNow();

// ---------------------------------------------------------------------------
// 3.1 tenants
// ---------------------------------------------------------------------------
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    gcipTenantId: text('gcip_tenant_id').notNull(),
    status: text('status').notNull().default('active'),
    createdAt,
    updatedAt,
  },
  (t) => ({
    gcipTenantIdUnique: uniqueIndex('tenants_gcip_tenant_id_key').on(t.gcipTenantId),
    statusCheck: check('tenants_status_check', inList('status', TENANT_STATUSES)),
  }),
);

// ---------------------------------------------------------------------------
// 3.2 tenant_users
// ---------------------------------------------------------------------------
export const tenantUsers = pgTable(
  'tenant_users',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    gcipUid: text('gcip_uid').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => ({
    gcipUidUnique: uniqueIndex('tenant_users_gcip_uid_key').on(t.gcipUid),
    tenantEmailUnique: uniqueIndex('tenant_users_tenant_id_email_key').on(t.tenantId, t.email),
    tenantIdIdx: index('tenant_users_tenant_id_idx').on(t.tenantId),
    roleCheck: check('tenant_users_role_check', inList('role', ROLES)),
    statusCheck: check('tenant_users_status_check', inList('status', USER_STATUSES)),
  }),
);

// ---------------------------------------------------------------------------
// 3.3 projects
// ---------------------------------------------------------------------------
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    status: text('status').notNull().default('active'),
    screenshotDefault: boolean('screenshot_default').notNull().default(false),
    knowledgeMd: text('knowledge_md'),
    defaultCredsSecretRef: text('default_creds_secret_ref'),
    maskingSelectors: jsonb('masking_selectors').notNull().default(sql`'[]'::jsonb`),
    inactivityTimeoutSeconds: integer('inactivity_timeout_seconds').notNull().default(900),
    createdAt,
    updatedAt,
  },
  (t) => ({
    tenantNameUnique: uniqueIndex('projects_tenant_id_name_key').on(t.tenantId, t.name),
    // Supports the composite FKs from child tables: (tenant_id, id) unique.
    tenantIdUnique: uniqueIndex('projects_tenant_id_id_key').on(t.tenantId, t.id),
    tenantStatusIdx: index('projects_tenant_id_status_idx').on(t.tenantId, t.status),
    statusCheck: check('projects_status_check', inList('status', PROJECT_STATUSES)),
  }),
);

// ---------------------------------------------------------------------------
// 3.4 jira_configs
// ---------------------------------------------------------------------------
export const jiraConfigs = pgTable(
  'jira_configs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    baseUrl: text('base_url').notNull(),
    projectKey: text('project_key').notNull(),
    tokenSecretRef: text('token_secret_ref').notNull(),
    status: text('status').notNull().default('active'),
    createdAt,
    updatedAt,
  },
  (t) => ({
    projectUnique: uniqueIndex('jira_configs_project_id_key').on(t.projectId),
    tenantIdIdx: index('jira_configs_tenant_id_idx').on(t.tenantId),
    tenantProjectFk: foreignKey({
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: 'jira_configs_tenant_project_fk',
    }).onDelete('restrict'),
    statusCheck: check('jira_configs_status_check', inList('status', JIRA_STATUSES)),
  }),
);

// ---------------------------------------------------------------------------
// 3.5 sessions
// ---------------------------------------------------------------------------
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => tenantUsers.id, { onDelete: 'restrict' }),
    jiraId: text('jira_id'),
    jiraSummary: text('jira_summary'),
    jiraStatus: text('jira_status'),
    description: text('description'),
    screenshotEnabled: boolean('screenshot_enabled').notNull(),
    status: text('status').notNull().default('active'),
    closeReason: text('close_reason'),
    summary: text('summary'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAt: timestamp('purge_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => ({
    tenantProjectIdx: index('sessions_tenant_id_project_id_idx').on(t.tenantId, t.projectId),
    tenantRecordedByIdx: index('sessions_tenant_id_recorded_by_idx').on(t.tenantId, t.recordedBy),
    purgeAtIdx: index('sessions_purge_at_idx').on(t.purgeAt),
    tenantDeletedAtIdx: index('sessions_tenant_id_deleted_at_idx').on(t.tenantId, t.deletedAt),
    tenantProjectFk: foreignKey({
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: 'sessions_tenant_project_fk',
    }).onDelete('restrict'),
    workContextCheck: check(
      'sessions_work_context_check',
      sql`jira_id IS NOT NULL OR description IS NOT NULL`,
    ),
    statusCheck: check('sessions_status_check', inList('status', SESSION_STATUSES)),
    closeReasonCheck: check(
      'sessions_close_reason_check',
      sql.raw(
        `close_reason IS NULL OR close_reason IN (${SESSION_CLOSE_REASONS.map((v) => `'${v}'`).join(', ')})`,
      ),
    ),
  }),
);

// ---------------------------------------------------------------------------
// 3.6 artifacts
// ---------------------------------------------------------------------------
export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    seq: integer('seq').notNull(),
    gcsPath: text('gcs_path').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksum: text('checksum'),
    compression: text('compression').notNull().default('none'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    createdAt,
    updatedAt,
  },
  (t) => ({
    sessionTypeSeqUnique: uniqueIndex('artifacts_session_id_type_seq_key').on(
      t.sessionId,
      t.type,
      t.seq,
    ),
    tenantIdIdx: index('artifacts_tenant_id_idx').on(t.tenantId),
    tenantProjectFk: foreignKey({
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: 'artifacts_tenant_project_fk',
    }).onDelete('restrict'),
    typeCheck: check('artifacts_type_check', inList('type', ARTIFACT_TYPES)),
    compressionCheck: check('artifacts_compression_check', inList('compression', COMPRESSIONS)),
  }),
);

// ---------------------------------------------------------------------------
// 3.7 flags
// ---------------------------------------------------------------------------
export const flags = pgTable(
  'flags',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'restrict' }),
    selector: text('selector').notNull(),
    note: text('note'),
    eventOffsetMs: integer('event_offset_ms'),
    createdAt,
    updatedAt,
  },
  (t) => ({
    sessionIdIdx: index('flags_session_id_idx').on(t.sessionId),
    tenantProjectFk: foreignKey({
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: 'flags_tenant_project_fk',
    }).onDelete('restrict'),
  }),
);

// ---------------------------------------------------------------------------
// 3.8 generated_tests
// ---------------------------------------------------------------------------
export const generatedTests = pgTable(
  'generated_tests',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    kind: text('kind').notNull(),
    modelTier: text('model_tier').notNull(),
    modelId: text('model_id').notNull(),
    code: text('code').notNull(),
    reviewStatus: text('review_status').notNull().default('draft'),
    approvedBy: uuid('approved_by').references(() => tenantUsers.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    integrated: boolean('integrated').notNull().default(false),
    integratedBy: uuid('integrated_by').references(() => tenantUsers.id, { onDelete: 'restrict' }),
    integratedAt: timestamp('integrated_at', { withTimezone: true }),
    promptInputsSummary: jsonb('prompt_inputs_summary').notNull(),
    // source_comment_id references generation_comments(id). The FK constraint is
    // created in the hand-written migration (0000_init.sql), not declared here,
    // to avoid a cyclic type reference between this table and generation_comments.
    sourceCommentId: uuid('source_comment_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => tenantUsers.id, { onDelete: 'restrict' }),
    createdAt,
    updatedAt,
  },
  (t) => ({
    sessionVersionUnique: uniqueIndex('generated_tests_session_id_version_key').on(
      t.sessionId,
      t.version,
    ),
    tenantProjectIdx: index('generated_tests_tenant_id_project_id_idx').on(t.tenantId, t.projectId),
    tenantProjectFk: foreignKey({
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: 'generated_tests_tenant_project_fk',
    }).onDelete('restrict'),
    kindCheck: check('generated_tests_kind_check', inList('kind', GENERATED_TEST_KINDS)),
    modelTierCheck: check('generated_tests_model_tier_check', inList('model_tier', MODEL_TIERS)),
    reviewStatusCheck: check(
      'generated_tests_review_status_check',
      inList('review_status', REVIEW_STATUSES),
    ),
  }),
);

// ---------------------------------------------------------------------------
// 3.9 generation_comments
// ---------------------------------------------------------------------------
export const generationComments = pgTable(
  'generation_comments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'restrict' }),
    generatedTestId: uuid('generated_test_id').references(() => generatedTests.id, {
      onDelete: 'restrict',
    }),
    body: text('body').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => tenantUsers.id, { onDelete: 'restrict' }),
    createdAt,
    updatedAt,
  },
  (t) => ({
    sessionIdIdx: index('generation_comments_session_id_idx').on(t.sessionId),
    generatedTestIdIdx: index('generation_comments_generated_test_id_idx').on(t.generatedTestId),
  }),
);

/** All tenant-scoped tables that receive the canonical RLS policy (contract section 1). */
export const TENANT_SCOPED_TABLES = [
  'tenant_users',
  'projects',
  'jira_configs',
  'sessions',
  'artifacts',
  'flags',
  'generated_tests',
  'generation_comments',
] as const;

export const schema = {
  tenants,
  tenantUsers,
  projects,
  jiraConfigs,
  sessions,
  artifacts,
  flags,
  generatedTests,
  generationComments,
};
export type DbSchema = typeof schema;
