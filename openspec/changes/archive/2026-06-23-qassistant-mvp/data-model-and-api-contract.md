# QAssistant: API & Data-Model Contract (task 0.10)

This document resolves the one remaining pre-implementation blocker tracked as task `0.10`
("Write API/data-model contracts before scaffolding backend, dashboard, extension, or
Terraform"). It is derived from the OpenSpec change `qassistant-mvp` (proposal, design,
specs) and the resolved decisions in `TECHNICAL_CHOICES.md`. It is the contract that backend,
dashboard, extension, and Terraform work build against.

It is a contract, not implementation. It pins schema (columns, types, keys, indexes, enums,
RLS policies), the migration approach, and the REST surface. It does not pin handler code.

## 0. Resolved conventions (this pass)

| Decision | Value | Source |
|----------|-------|--------|
| Deploy region | `europe-west1` (Belgium), configurable | this pass (EU/GDPR posture) |
| Primary keys | **UUID v7** (time-ordered), generated app-side | this pass |
| Enum representation | **`text` column + `CHECK` constraint** (not native PG enums) | this pass |
| Timestamps | `timestamptz`, UTC; `created_at`/`updated_at` on every table | convention |
| ORM / migrations | **Drizzle + Drizzle Kit**; RLS policies via hand-written SQL migration steps | TECHNICAL_CHOICES §2 |
| Tenant isolation | **RLS** keyed on `app.tenant_id`, set transaction-local via `set_config(..., true)` | TECHNICAL_CHOICES §3 |
| ID exposure | UUIDs are URL/GCS-path safe; no sequential IDs exposed cross-tenant | this pass |
| JSON casing | DB `snake_case`; API JSON `camelCase` | convention |

### Naming and shared rules

- Every tenant-scoped table carries a non-null `tenant_id uuid` column even when it is reachable
  through a parent FK. This is required for RLS and for the defense-in-depth explicit
  `WHERE tenant_id` predicate (design D10).
- Child tables (`artifacts`, `flags`, `generated_tests`, `generation_comments`) additionally
  carry `project_id` denormalized from their `session`, for the same reasons.
- `created_at timestamptz NOT NULL DEFAULT now()` and `updated_at timestamptz NOT NULL DEFAULT now()`
  on every table. `updated_at` is bumped by the app (or a trigger) on write.
- All FKs are `ON DELETE RESTRICT` by default; cascade behavior for session permanent-deletion is
  handled explicitly by the purge job (see §3.10), not by `ON DELETE CASCADE`, so artifact GCS
  objects are removed before the metadata row.

---

## 1. Roles, identity, and the tenant session variable

Authorization lives in the verified Identity Platform ID token (design D5, identity spec):

- Tenant user token claims: `{ role: "admin" | "qa-engineer", tenantId: <uuid> }`.
- Super-admin token claims: `{ role: "super-admin" }`, **no** `tenantId`.

Per-request flow in the backend (NestJS request-scoped interceptor around a per-request DB
transaction):

1. Verify the ID token with the Admin SDK (`verifyIdToken`).
2. Derive `role`, `tenantId` (tenant users), and `uid` (the GCIP `uid`) from claims. Never trust
   client-asserted identity.
3. For a tenant user: open a transaction and run
   `SELECT set_config('app.tenant_id', $tenantId, true);` (transaction-local; the `true` third
   arg scopes it to the transaction so a pooled connection can never leak tenant A's setting into
   tenant B's request).
4. Resolve the acting `tenant_users` row by `gcip_uid = uid` (for `recorded_by` / authorship
   stamping and for `status = 'active'` enforcement).
5. For the super-admin: do **not** set `app.tenant_id`. Use the separate privileged DB role
   (`app_superadmin`, `BYPASSRLS`) and only for provisioning endpoints (§4.1).

### Database roles

| Role | RLS | Use |
|------|-----|-----|
| `app_user` | enforced (no `BYPASSRLS`, not table owner) | all tenant-scoped requests |
| `app_superadmin` | `BYPASSRLS` | super-admin provisioning path only |
| `app_migrator` | owner / DDL | migrations only, not used at runtime |

All tenant-scoped tables use `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **and**
`FORCE ROW LEVEL SECURITY` so even the table owner is subject to policy.

### Canonical RLS policy (applied to every tenant-scoped table)

```sql
-- example for sessions; identical shape on every tenant-scoped table
CREATE POLICY tenant_isolation ON sessions
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

`current_setting('app.tenant_id', true)` returns NULL when unset (the `true` = missing_ok),
which makes the predicate false and denies all rows: a request that forgot to set the variable
sees nothing rather than everything.

Role scoping (qa-engineer sees only own work) is **not** an RLS concern: RLS enforces the
tenant boundary; the `recorded_by = <self>` / `created_by = <self>` filter for qa-engineers is
applied in the application query layer (see §6 dashboards).

---

## 2. Enum value reference (all `text` + `CHECK`)

| Column | Table(s) | Allowed values |
|--------|----------|----------------|
| `role` | `tenant_users` | `admin`, `qa-engineer` |
| `status` (tenant) | `tenants` | `active`, `inactive` |
| `status` (user) | `tenant_users` | `active`, `disabled` |
| `status` (project) | `projects` | `active`, `inactive` |
| `status` (jira) | `jira_configs` | `active`, `inactive` |
| `status` (session) | `sessions` | `active`, `completed` |
| `close_reason` | `sessions` | `stopped`, `inactivity` (NULL while active) |
| `type` | `artifacts` | `dom_chunk`, `screenshot` |
| `compression` | `artifacts` | `none`, `gzip` |
| `kind` | `generated_tests` | `playwright_test`, `replay_script` |
| `model_tier` | `generated_tests` | `flash`, `pro` |
| `review_status` | `generated_tests` | `draft`, `approved` |

---

## 3. Tables

Notation: `PK` primary key, `FK` foreign key, `U` unique, `IX` index. All `id` are `uuid` (v7).
RLS = "tenant-scoped, canonical policy applies" unless stated otherwise.

### 3.1 `tenants`
Client/account boundary. **Not** tenant-scoped via `app.tenant_id` in the usual way (it *is* the
tenant); created only through the super-admin privileged path. Tenant users may read their own
tenant row via an RLS policy `id = app.tenant_id`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text NOT NULL | display name |
| `gcip_tenant_id` | text NOT NULL U | Identity Platform tenant ID (one GCIP tenant per app tenant) |
| `status` | text NOT NULL DEFAULT `'active'` | `active`/`inactive` |
| `created_at` / `updated_at` | timestamptz | |

RLS: `USING (id = current_setting('app.tenant_id', true)::uuid)` for `app_user` (read own tenant);
all writes via `app_superadmin`.

### 3.2 `tenant_users`
Tenant-scoped users. Each user belongs to exactly one tenant (D4). Super-admins are **not** stored
here (they are project-level GCIP users with no tenant, identified solely by the `super-admin`
claim). `must_change_password` authoritative source is the GCIP custom claim/metadata; the column
below is an optional read-model mirror for dashboard display.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | app-side user id |
| `tenant_id` | uuid NOT NULL FK→`tenants(id)` | |
| `gcip_uid` | text NOT NULL U | the token `uid`; the join key from verified tokens |
| `email` | text NOT NULL | not verified (admin-created, trusted); unique per tenant |
| `role` | text NOT NULL | `admin`/`qa-engineer` |
| `status` | text NOT NULL DEFAULT `'active'` | `active`/`disabled` |
| `must_change_password` | boolean NOT NULL DEFAULT true | mirror of GCIP marker (display only) |
| `created_at` / `updated_at` | timestamptz | |

- U `(gcip_uid)`, U `(tenant_id, email)`, IX `(tenant_id)`. RLS applies.

### 3.3 `projects`
Tenant-owned unit of context, capture, and codegen (D12). One base URL (D14). Knowledge hub
markdown stored inline; default-creds kept only as a Secret Manager reference (never the secret).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL FK→`tenants(id)` | |
| `name` | text NOT NULL | |
| `base_url` | text NOT NULL | single environment for MVP |
| `status` | text NOT NULL DEFAULT `'active'` | `active`/`inactive` (project lifecycle) |
| `screenshot_default` | boolean NOT NULL DEFAULT false | project-level default; per-session override allowed |
| `knowledge_md` | text NULL | knowledge-hub markdown overview (optional) |
| `default_creds_secret_ref` | text NULL | Secret Manager resource name (optional) |
| `masking_selectors` | jsonb NOT NULL DEFAULT `'[]'` | array of CSS selectors masked in DOM capture |
| `inactivity_timeout_seconds` | int NOT NULL DEFAULT 900 | session auto-close threshold |
| `created_at` / `updated_at` | timestamptz | |

- U `(tenant_id, name)`, U `(tenant_id, id)` *(supports composite FKs below)*, IX `(tenant_id, status)`. RLS applies.

### 3.4 `jira_configs`
Zero or one active Jira configuration per project (D-Jira). Token lives only in Secret Manager.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | |
| `project_id` | uuid NOT NULL FK→`projects(id)` | |
| `base_url` | text NOT NULL | Jira site URL |
| `project_key` | text NOT NULL | allowed Jira project key for ticket matching |
| `token_secret_ref` | text NOT NULL | Secret Manager resource name (read-only token) |
| `status` | text NOT NULL DEFAULT `'active'` | `active`/`inactive` |
| `created_at` / `updated_at` | timestamptz | |

- U `(project_id)` *(at most one config per project for MVP)*, IX `(tenant_id)`.
- Composite FK `(tenant_id, project_id)` → `projects(tenant_id, id)` enforces tenant consistency. RLS applies.
- Rotation = overwrite the Secret Manager value; row unchanged. No versioning (MVP).

### 3.5 `sessions`
A capture session, frozen to one project + work context (D7). Work context is a validated Jira
ticket **or** a non-empty description (at least one required, enforced by CHECK).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | also the `sessionId` stamped on artifacts |
| `tenant_id` | uuid NOT NULL | |
| `project_id` | uuid NOT NULL FK→`projects(id)` | |
| `recorded_by` | uuid NOT NULL FK→`tenant_users(id)` | the capturing user (server-derived) |
| `jira_id` | text NULL | frozen ticket key |
| `jira_summary` | text NULL | title snapshot at validation time |
| `jira_status` | text NULL | status snapshot at validation time |
| `description` | text NULL | tester description (frozen) |
| `screenshot_enabled` | boolean NOT NULL | effective per-session setting |
| `status` | text NOT NULL DEFAULT `'active'` | `active`/`completed` |
| `close_reason` | text NULL | `stopped`/`inactivity` (set when completed) |
| `summary` | text NULL | auto-generated on stop (Flash) |
| `started_at` | timestamptz NOT NULL | |
| `ended_at` | timestamptz NULL | duration = `ended_at - started_at` (raw wall-clock) |
| `deleted_at` | timestamptz NULL | soft-delete timestamp |
| `purge_at` | timestamptz NULL | `deleted_at + 30 days`; purge job target |
| `created_at` / `updated_at` | timestamptz | |

- `CHECK (jira_id IS NOT NULL OR description IS NOT NULL)` (work context mandatory).
- IX `(tenant_id, project_id)`, IX `(tenant_id, recorded_by)`, IX `(purge_at)` *(purge sweep)*,
  IX `(tenant_id, deleted_at)` *(hide soft-deleted from dashboards)*.
- Composite FK `(tenant_id, project_id)` → `projects(tenant_id, id)`. RLS applies.
- Duration for ranking is computed `EXTRACT(EPOCH FROM (ended_at - started_at))`; not stored.

### 3.6 `artifacts`
Metadata for DOM-replay chunks and screenshots; bytes live in GCS (§7).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | |
| `project_id` | uuid NOT NULL | |
| `session_id` | uuid NOT NULL FK→`sessions(id)` | |
| `type` | text NOT NULL | `dom_chunk`/`screenshot` |
| `seq` | int NOT NULL | ordering within (session, type) |
| `gcs_path` | text NOT NULL | object path under tenant/project/session/ (§7) |
| `content_type` | text NOT NULL | |
| `size_bytes` | bigint NOT NULL | |
| `checksum` | text NULL | crc32c/md5 of the uploaded object |
| `compression` | text NOT NULL DEFAULT `'none'` | `none`/`gzip` (dom chunks default gzip) |
| `captured_at` | timestamptz NOT NULL | client event time |
| `created_at` / `updated_at` | timestamptz | |

- U `(session_id, type, seq)`, IX `(tenant_id)`. Composite FK `(tenant_id, project_id)` → `projects(tenant_id, id)`. RLS applies.

### 3.7 `flags`
Tester-flagged selectors/states (hotkey) used as codegen hints.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | |
| `project_id` | uuid NOT NULL | |
| `session_id` | uuid NOT NULL FK→`sessions(id)` | |
| `selector` | text NOT NULL | flagged CSS/role selector |
| `note` | text NULL | optional tester note |
| `event_offset_ms` | int NULL | offset into the replay timeline |
| `created_at` / `updated_at` | timestamptz | |

- IX `(session_id)`. Composite FK `(tenant_id, project_id)` → `projects(tenant_id, id)`. RLS applies.

### 3.8 `generated_tests`
Versioned codegen outputs (D8a). Asserted Playwright tests are the primary `kind`; quick replay
scripts (Flash) may also be stored with `kind = 'replay_script'`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | |
| `project_id` | uuid NOT NULL | |
| `session_id` | uuid NOT NULL FK→`sessions(id)` | |
| `version` | int NOT NULL | per-session incrementing |
| `kind` | text NOT NULL | `playwright_test`/`replay_script` |
| `model_tier` | text NOT NULL | `flash`/`pro` |
| `model_id` | text NOT NULL | resolved configured model id used |
| `code` | text NOT NULL | generated TypeScript |
| `review_status` | text NOT NULL DEFAULT `'draft'` | `draft`/`approved` |
| `approved_by` | uuid NULL FK→`tenant_users(id)` | |
| `approved_at` | timestamptz NULL | |
| `integrated` | boolean NOT NULL DEFAULT false | manual `INTEGRATED` flag |
| `integrated_by` | uuid NULL FK→`tenant_users(id)` | |
| `integrated_at` | timestamptz NULL | |
| `prompt_inputs_summary` | jsonb NOT NULL | labeled source list used for this version |
| `source_comment_id` | uuid NULL FK→`generation_comments(id)` | comment that drove this regeneration |
| `created_by` | uuid NOT NULL FK→`tenant_users(id)` | |
| `created_at` / `updated_at` | timestamptz | |

- U `(session_id, version)`, IX `(tenant_id, project_id)`. Composite FK `(tenant_id, project_id)` → `projects(tenant_id, id)`. RLS applies.
- Approval / integration may be set by any tenant user (admin or qa-engineer), per spec.

### 3.9 `generation_comments`
User comments feeding regeneration (D regenerate).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | |
| `project_id` | uuid NOT NULL | |
| `session_id` | uuid NOT NULL FK→`sessions(id)` | |
| `generated_test_id` | uuid NULL FK→`generated_tests(id)` | version the comment targets |
| `body` | text NOT NULL | |
| `created_by` | uuid NOT NULL FK→`tenant_users(id)` | |
| `created_at` / `updated_at` | timestamptz | |

- IX `(session_id)`, IX `(generated_test_id)`. RLS applies.

### 3.10 Deferred / not in this contract
- `project_memberships` (D13): deferred; tenant-wide project access for MVP. The schema is already
  membership-ready (sessions carry `recorded_by`; nothing assumes all-access), so adding a
  membership table later is additive.
- Multiple environments per project (D14): `projects.base_url` is single for MVP; a later
  `project_environments` table is additive.

### Permanent-deletion lifecycle (purge job)
A scheduled worker (Cloud Tasks / Cloud Scheduler) sweeps `sessions WHERE purge_at <= now()` and,
per session, in order: (1) delete GCS objects under the session prefix, (2) delete
`generation_comments`, `generated_tests`, `flags`, `artifacts` rows, (3) delete the `sessions` row.
This realizes spec "permanent deletion removes session metadata, GCS artifacts, and generated tests".

---

## 4. REST API surface

Conventions:
- Base path `/api/v1`. JSON request/response, `camelCase`.
- Every request carries `Authorization: Bearer <Identity Platform ID token>`; the backend verifies
  it and derives identity (§1). The client never asserts `tenantId`/`uid`.
- Standard error envelope: `{ "error": { "code": string, "message": string, "details"?: object } }`
  with codes such as `unauthenticated`, `forbidden`, `not_found`, `validation_failed`,
  `jira_validation_failed`, `must_change_password`, `conflict`.
- List endpoints: cursor pagination `?limit=&cursor=`, returning `{ items, nextCursor }`.
- Input validation via shared Zod schemas in `packages/shared`.
- Role column below: who may call. `super-admin` endpoints use the privileged path; all others are
  tenant-scoped and RLS-enforced.

### 4.1 Super-admin provisioning (privileged path, no tenant session var)
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/admin/tenants` | super-admin | Create tenant (creates GCIP tenant + `tenants` row) + first admin user |
| GET | `/admin/tenants` | super-admin | List tenants |
| PATCH | `/admin/tenants/{tenantId}` | super-admin | Set tenant `status` (active/inactive) |

### 4.2 Tenant user management (Admin SDK-backed)
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/users` | admin | Create user by any email; set initial password; assign `admin`/`qa-engineer`; sets `mustChangePassword` |
| GET | `/users` | admin | List tenant users |
| PATCH | `/users/{userId}` | admin | Change role / disable / enable |
| POST | `/users/{userId}/reset-password` | admin | Set new password; sets `mustChangePassword` |
| POST | `/auth/complete-password-change` | admin, qa-engineer | Self: clear `mustChangePassword` after setting a new password (the only call allowed while marker is set) |
| GET | `/auth/me` | any tenant user | Resolved `{ uid, role, tenantId, mustChangePassword }` + tenant/projects bootstrap |

While `mustChangePassword` is set, the backend rejects all endpoints except
`/auth/complete-password-change` and `/auth/me` with `must_change_password`.

### 4.3 Project setup
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/projects` | admin | Create project (name, baseUrl, screenshotDefault, maskingSelectors, inactivityTimeoutSeconds) |
| GET | `/projects` | any tenant user | List active projects in tenant (extension + dashboard) |
| GET | `/projects/{projectId}` | any tenant user | Project detail incl. knowledge-hub markdown |
| PATCH | `/projects/{projectId}` | admin | Update settings; toggle `status` active/inactive |
| PUT | `/projects/{projectId}/knowledge` | admin | Set `knowledge_md` + `default_creds_secret_ref` |
| PUT | `/projects/{projectId}/jira` | admin | Create/replace Jira config (baseUrl, projectKey, token→Secret Manager) |
| DELETE | `/projects/{projectId}/jira` | admin | Remove Jira config |
| POST | `/projects/{projectId}/jira/test` | admin | Validate the stored token (read-only check) |

### 4.4 Extension capture
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/sessions` | qa-engineer, admin | Start session: `{ projectId, jiraId?, description? }`. Backend authorizes project (tenant match), validates Jira live when `jiraId` present (else requires non-empty description), freezes context, mints session. Blocks per session-capture spec scenarios. |
| GET | `/sessions/{sessionId}/upload-urls` | recorder | Mint V4 signed PUT URL(s) for the next artifact(s); write-only, ~15min TTL, scoped to session prefix |
| POST | `/sessions/{sessionId}/artifacts` | recorder | Register uploaded artifact metadata (`type, seq, gcsPath, contentType, sizeBytes, checksum, compression, capturedAt`) |
| POST | `/sessions/{sessionId}/flags` | recorder | Record a flagged selector/state |
| POST | `/sessions/{sessionId}/stop` | recorder, admin | Finalize: set `ended_at`, `status=completed`, `close_reason=stopped`, trigger summary |

Inactivity auto-close: enforced server-side. A worker (or the stop path) marks a session
`completed` with `close_reason=inactivity` when no `dom_chunk` artifact has been registered within
`projects.inactivity_timeout_seconds`. (The extension also tracks inactivity locally and calls
`/stop`; the server timer is the backstop so a crashed extension still closes the session.)

### 4.5 Codegen (async via Cloud Tasks)
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/sessions/{sessionId}/generate` | recorder, admin | Enqueue a Cloud Task; returns `{ jobId }`. Worker runs Gemini, writes a `generated_tests` row, returns. |
| GET | `/sessions/{sessionId}/generations` | recorder, admin | List generated versions for the session |
| GET | `/generations/{generatedTestId}` | recorder, admin | Get one version incl. `code`, `promptInputsSummary` |
| POST | `/generations/{generatedTestId}/approve` | any tenant user | Mark `review_status=approved`; record `approved_by/at` |
| POST | `/generations/{generatedTestId}/integrate` | any tenant user | Set `integrated=true`; record `integrated_by/at` |
| POST | `/sessions/{sessionId}/comments` | recorder, admin | Add a comment (optionally targeting a version) |
| POST | `/sessions/{sessionId}/regenerate` | recorder, admin | Enqueue regeneration incorporating comments; new version |
| POST | `/internal/tasks/generate` | Cloud Tasks (OIDC) | Worker endpoint; not client-facing |

### 4.6 Lifecycle / admin operations
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| DELETE | `/sessions/{sessionId}` | admin (any in tenant); qa-engineer (own only) | Soft delete: set `deleted_at`, `purge_at=deleted_at+30d` |
| POST | `/sessions/{sessionId}/restore` | admin | Clear `deleted_at`/`purge_at` during grace period |
| GET | `/sessions/{sessionId}/export` | admin, any qa-engineer in tenant | Stream ZIP: metadata JSON + DOM-replay + screenshots + generated tests |
| POST | `/internal/tasks/purge` | Cloud Scheduler/Tasks (OIDC) | Purge sweep of `purge_at <= now()` (§3.10) |

### 4.7 Dashboard reads
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/dashboard/sessions` | admin (tenant-wide); qa-engineer (own only) | Recording list, soft-deleted hidden |
| GET | `/dashboard/sessions/{sessionId}` | admin; qa-engineer if owner | Recording detail: artifacts, flags, summary, generations |
| GET | `/dashboard/metrics` | admin | Per-user productivity metrics |
| GET | `/dashboard/ranking` | admin only | Contribution ranking (see §6) |

Role scoping note: for qa-engineer, the backend adds `AND recorded_by = <self>` to dashboard
queries; RLS already constrains to tenant. Admin omits the `recorded_by` filter.

---

## 5. Jira validation contract (session start)

When `POST /sessions` includes `jiraId`:
1. The project must have an `active` `jira_configs` row, else block (`jira_validation_failed`,
   "project has no Jira configuration").
2. Read the token from Secret Manager (`token_secret_ref`); call Jira REST read-only:
   issue exists, load title/status, and confirm the issue's project key equals
   `jira_configs.project_key`.
3. On success: snapshot `jira_id`, `jira_summary`, `jira_status` onto the session (frozen).
4. On any failure (not found, wrong project key, token failure, Jira unreachable): block the
   session and return `jira_validation_failed`; the client may resubmit without `jiraId` and a
   non-empty `description`.

Token scope is read-only (issue metadata, description, comments, attachments); no write/transition.
Jira REST version and client library (v2/v3, raw fetch vs `jira.js`) remain an implementation
choice and do not affect this contract.

---

## 6. Productivity metrics & ranking query (D17)

Per active user in the tenant, over non-soft-deleted sessions:
- `generatedTestCount` = count of `generated_tests WHERE kind='playwright_test'` for the user's sessions.
- `totalRecordingSeconds` = `SUM(EXTRACT(EPOCH FROM (ended_at - started_at)))`, raw wall-clock, no idle exclusion.
- `recordingCount` = count of completed sessions.

Ranking (admin only) `ORDER BY generatedTestCount DESC, totalRecordingSeconds DESC, recordingCount DESC`.
No hidden weighted score; the three metrics are shown. The dashboard labels it "Contribution
ranking" and states it is directional (raw wall-clock duration).

---

## 7. GCS object layout & upload credential

- Bucket layout (path namespacing): `gs://<artifacts-bucket>/<tenantId>/<projectId>/<sessionId>/<type>/<seq>.<ext>`
  - `dom_chunk` → `.../dom/<seq>.json.gz` (gzip default)
  - `screenshot` → `.../shots/<seq>.webp` (viewport-only capture per TECHNICAL_CHOICES §4)
- Upload credential: per-object **V4 signed URL**, `PUT` only, ~15 min TTL, minted by
  `GET /sessions/{sessionId}/upload-urls` after the backend authorizes the session. The client
  cannot read, list, or delete. Backend records metadata via `POST .../artifacts`.

---

## 8. Migration & RLS application strategy

- Drizzle schema defines tables/columns/indexes/FKs/CHECKs; `drizzle-kit generate` emits SQL.
- RLS is **not** expressible in Drizzle schema, so each migration that introduces a tenant-scoped
  table is followed by a hand-written SQL step in the same migration:
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY; ALTER TABLE ... FORCE ROW LEVEL SECURITY;`
  plus the canonical `CREATE POLICY tenant_isolation ...` (§1).
- Database roles (`app_user`, `app_superadmin` with `BYPASSRLS`, `app_migrator`) are created in an
  initial migration. Runtime connects as `app_user`; provisioning path connects as `app_superadmin`.
- `GRANT`s: `app_user` gets DML on all tenant-scoped tables but is never the owner and lacks
  `BYPASSRLS`, so `FORCE ROW LEVEL SECURITY` binds it.

---

## 9. Open items intentionally left to implementation (not contract-blocking)

These were Open in `TECHNICAL_CHOICES.md` and do not change the schema/API contract above:
- Default Gemini model IDs (verify live availability in `europe-west1`); stored as config, recorded
  per generation in `generated_tests.model_id`.
- DOM-replay chunk size/cadence and batching (artifact `seq`/`compression` columns already absorb it).
- MV3 build tooling, dashboard framework, workspace/package manager (no schema impact).
- Jira REST version / client library (§5 is version-agnostic).
- Exact `inactivity_timeout_seconds` default (set to 900 here; configurable per project).
