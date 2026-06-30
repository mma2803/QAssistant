/**
 * Enum value reference. Single source of truth for every `text` + `CHECK`
 * enum in the data-model contract (section 2). The API encodes these as
 * Postgres CHECK constraints; the dashboard and extension import the same
 * constant arrays. Each enum exposes:
 *   - a `const` tuple of allowed values (for zod `z.enum` and CHECK generation),
 *   - an inferred union type.
 */

export const ROLES = ['admin', 'qa-engineer'] as const;
export type Role = (typeof ROLES)[number];

/** All token roles including the project-level super-admin (not stored in tenant_users). */
export const TOKEN_ROLES = ['admin', 'qa-engineer', 'super-admin'] as const;
export type TokenRole = (typeof TOKEN_ROLES)[number];

export const TENANT_STATUSES = ['active', 'inactive'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PROJECT_STATUSES = ['active', 'inactive'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const JIRA_STATUSES = ['active', 'inactive'] as const;
export type JiraStatus = (typeof JIRA_STATUSES)[number];

export const SESSION_STATUSES = ['active', 'completed'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_CLOSE_REASONS = ['stopped', 'inactivity'] as const;
export type SessionCloseReason = (typeof SESSION_CLOSE_REASONS)[number];

export const ARTIFACT_TYPES = ['dom_chunk', 'screenshot', 'network_log'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const COMPRESSIONS = ['none', 'gzip'] as const;
export type Compression = (typeof COMPRESSIONS)[number];

export const GENERATED_TEST_KINDS = ['playwright_test', 'replay_script'] as const;
export type GeneratedTestKind = (typeof GENERATED_TEST_KINDS)[number];

/**
 * Test type a generation targets (change: configurable-test-type). Independent
 * from `kind` (a UI strategy) and from the framework/language axis:
 *   - `ui`      → a UI test driven by the recorded DOM-replay flow (the original behaviour),
 *   - `backend` → an API/HTTP test grounded in the session's captured network traffic.
 */
export const TEST_TYPES = ['ui', 'backend'] as const;
export type TestType = (typeof TEST_TYPES)[number];

/** Default test type when no override, project default, or tenant default is set. */
export const DEFAULT_TEST_TYPE: TestType = 'ui';

export const MODEL_TIERS = ['flash', 'pro'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/**
 * Review lifecycle of a generated test version. `superseded` marks a version
 * that is no longer the session's active candidate because a different version
 * was approved; at most one version per session is `approved` at a time.
 */
export const REVIEW_STATUSES = ['draft', 'approved', 'superseded'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * Integration lifecycle of a generated test version. Replaces the legacy boolean
 * `integrated` flag. A version starts `not_ready`, becomes `ready_to_integrate`
 * automatically on approval (one candidate per session), and is reported
 * `integrated` (with a repo ref) or `failed_to_integrate` (with an error message)
 * by an MCP client after it pushes the code. QAssistant never pushes to Git.
 */
export const INTEGRATION_STATUSES = [
  'not_ready',
  'ready_to_integrate',
  'integrated',
  'failed_to_integrate',
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/**
 * Predefined framework/language options offered in the dashboard's "Generate"
 * selector. NOTE: unlike the enums above, the `framework`/`language` columns are
 * NOT CHECK-constrained — the selector also accepts a free-form custom entry, so
 * any string is valid. This list only drives the dropdown presets.
 */
export const TEST_FRAMEWORK_PRESETS = [
  { framework: 'Playwright', language: 'TypeScript' },
  { framework: 'Playwright', language: 'Python' },
  { framework: 'Cypress', language: 'JavaScript' },
  { framework: 'Selenium', language: 'Python' },
  { framework: 'Selenium', language: 'Java' },
] as const;

/** Default target when a tenant has set nothing and no per-generation override is given. */
export const DEFAULT_TEST_FRAMEWORK = 'Playwright';
export const DEFAULT_TEST_LANGUAGE = 'TypeScript';

/** Standard error envelope codes used across the REST surface (contract section 4). */
export const ERROR_CODES = [
  'unauthenticated',
  'forbidden',
  'not_found',
  'validation_failed',
  'jira_validation_failed',
  'must_change_password',
  'conflict',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
