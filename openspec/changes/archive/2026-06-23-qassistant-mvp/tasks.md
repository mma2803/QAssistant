## 0. Planning decisions before implementation

- [x] 0.1 Decide metadata persistence: PostgreSQL/Cloud SQL for metadata; GCS for artifacts
- [x] 0.2 Decide domain model: one tenant can own multiple projects
- [x] 0.3 Decide implementation target: full MVP
- [x] 0.4 Decide Jira config ownership: each project may have zero or one active Jira configuration
- [x] 0.5 Decide Jira auth model: project-level base URL plus API token/secret for MVP
- [x] 0.6 Decide Jira token permissions: read issue metadata, description, comments, and attachments; no write permissions
- [x] 0.7 Decide first codegen output: asserted Playwright test
- [x] 0.8 Define codegen guardrails: known-secret redaction; prompt-injection uses source labeling and prompt-input summaries
- [x] 0.9 Decide productivity ranking ships in MVP
- [x] 0.10 Write API/data-model contracts before scaffolding backend, dashboard, extension, or Terraform (see `data-model-and-api-contract.md`)
- [x] 0.11 Decide project authorization model: all active tenant users can access all active projects in their tenant
- [x] 0.12 Decide project environment model: one base URL per project
- [x] 0.13 Decide capture privacy default: mask sensitive DOM data by default
- [x] 0.14 Decide screenshot policy: optional viewport-only screenshots; compress/downsample before LLM use if needed
- [x] 0.15 Decide artifact retention default: indefinite retention by default
- [x] 0.16 Define deletion/export behavior for captured artifacts and generated tests
- [x] 0.17 Define ranking formula (raw wall-clock duration, no idle exclusion) and dashboard messaging
- [x] 0.18 Define internal implementation checkpoints despite full-MVP target
- [x] 0.19 Decide non-Jira testing description requirement: any non-empty description

Current owner decisions:
- Persistence: PostgreSQL on Cloud SQL for metadata; GCS for artifacts.
- Tenant isolation: PostgreSQL row-level security as the enforcement floor (per-request session setting from the verified `tenantId` claim), with explicit `tenant_id` predicates as defense in depth.
- Backend stack: TypeScript on Node.js with NestJS; Drizzle as the DB access layer with Drizzle Kit migrations; `@google-cloud/cloud-sql-connector` Node connector (keyless via workload identity, no proxy sidecar); in-process pool with a transaction-local `set_config('app.tenant_id', ..., true)` per request; shared Zod validation schemas in `packages/shared`.
- Super-admin path: a privileged `BYPASSRLS` DB role (no tenant session var).
- AI access: Gemini Developer API plus an API key on the paid tier (not Vertex AI), SDK `@google/genai`, key stored in Secret Manager.
- Codegen orchestration: async via Cloud Tasks (`POST /generate` enqueues a task, a worker endpoint runs Gemini and writes the result, the client polls).
- Capture tech: rrweb for DOM-replay plus rrweb-player for dashboard replay; viewport-only screenshots via `chrome.tabs.captureVisibleTab`; MV3 popup sign-in with tokens in `chrome.storage.local`; uploads via GCS V4 signed URLs (PUT-only, session-scoped path, ~15min TTL).
- Delivery: GitHub Actions with Artifact Registry and Workload Identity Federation (GitHub OIDC to GCP, no SA key files); full local emulators via docker-compose (Postgres + Firebase Auth emulator + fake-gcs-server).
- Domain model: one tenant can have multiple projects.
- Roles: platform-level `super-admin` creates tenants and first admins; tenant-scoped `admin` and `qa-engineer`. Each user belongs to exactly one tenant.
- Authentication: Identity Platform email and password provider, one GCIP tenant per app tenant; super-admin is a project-level user with no tenant. No self-registration, no email sending, email not verified.
- User management: in-dashboard via Admin SDK (create user, set initial password, assign role, disable, admin-driven reset). Forced password change on first login and after any admin reset via a `mustChangePassword` marker. First super-admin seeded via script/Terraform.
- Authorization: custom claims `{ role, tenantId }` in the verified ID token, enforced server-side per request; revocation takes effect on next token refresh (no immediate revocation in MVP).
- Tenant resolution: single tenant binding established at invitation; no domain assumptions, picker, onboarding link, or project code.
- Jira model: each project may have zero or one active Jira configuration; projects without Jira are allowed.
- Project authorization: all active tenant users can access all active projects in their tenant.
- Jira auth: project-level base URL plus API token/secret for MVP.
- Jira token rotation: manual replacement overwrites the stored Secret Manager value in MVP.
- Jira token permissions: read issue metadata, description, comments, and attachments; no write/transition/comment-posting permissions.
- Project environment: one base URL per project.
- Capture privacy: mask sensitive DOM data by default.
- Capture artifacts: DOM-replay plus optional viewport-only screenshots.
- Screenshot handling: screenshots are not strongly redacted; compress/downsample before LLM use if needed.
- Retention: artifacts are kept indefinitely by default in MVP; explicit session deletion remains the deletion mechanism.
- Codegen output: asserted Playwright test.
- Codegen review: generated tests are saved as draft versions with review/approval status; approval records the approving user/timestamp without claiming execution; a manual `INTEGRATED` status flags that the recording's test was added to the automated tests repo (no proof of integration required). No automatic execution or validation required in MVP.
- Prompt-injection handling: label captured/Jira/description/project inputs as untrusted context, keep platform instructions separate, and store prompt-input summaries.
- Codegen redaction: redact known secrets before model use, including passwords, tokens, API keys, auth headers, and cookies.
- Ranking: included in MVP.
- Ranking formula: admin-only "Contribution ranking" sorted by generated Playwright test count, then total recording duration (raw wall-clock, no idle exclusion in MVP), then recording count; no hidden weighted score. Because duration is raw wall-clock, the ranking is explicitly directional.
- Deletion: two-step session deletion; soft delete first, permanent delete after 30-day grace period.
- Export: tenant admins and QA engineers can export metadata, DOM-replay, screenshots, and generated tests; QA engineers may export any session in their tenant.
- Generated test deletion: generated tests are deleted when their session is permanently deleted.
- Implementation target: full MVP.
- Internal checkpoints: capture review, then asserted codegen, then dashboards/ranking.
- Out of MVP scope: audit logging and coverage analytics.
- Non-Jira description: any non-empty description is accepted.
- Jira outage behavior: block Jira-based session; tester may remove Jira ID and use description instead.

Resolved this pass (see `data-model-and-api-contract.md`):
- API/data-model contracts written: tables, columns, indexes, FKs, enums (text + CHECK), RLS policies, migration/RLS strategy, and the REST surface by boundary.
- Contract conventions pinned: deploy region `europe-west1`; UUID v7 primary keys; enum-as-text-plus-CHECK.

## 1. Infrastructure foundation (Terraform)

- [x] 1.1 Scaffold the Terraform root module and remote state, parameterized by GCP project ID
- [x] 1.2 Enable required GCP APIs (Cloud Run, Cloud SQL, Identity Platform, Secret Manager, GCS, IAM)
- [x] 1.3 Define GCS buckets for artifacts with tenant/project/session-namespaced layout and no automatic time-based artifact expiry by default
- [x] 1.4 Define Secret Manager and IAM, and configure workload identity for Cloud Run services (no key files)
- [x] 1.5 Define Cloud Run service topology for the backend API and dashboard web app, preferring one app service where practical
- [x] 1.6 Enable Identity Platform with multi-tenancy (one GCIP tenant per app tenant) and the email/password provider
- [x] 1.7 Enable PostgreSQL row-level security on tenant-scoped tables, keyed off a per-request session setting from the verified `tenantId` claim
- [x] 1.8 Verify a fresh apply from documented operator prerequisites provisions the full stack idempotently, failing fast if the `gcloud` CLI authentication is invalid

## 2. Identity and tenancy

- [x] 2.1 Bootstrap the first `super-admin` via seed script or Terraform, and implement tenant creation and first-admin bootstrap by the super-admin
- [x] 2.2 Implement in-dashboard user management via the Admin SDK (create user by any email, set initial password, assign role, disable, admin-driven reset)
- [x] 2.3 Implement the `mustChangePassword` marker and forced set-new-password step on first login and after any admin reset, blocking app access until completed
- [x] 2.4 Ensure no self-registration: a non-provisioned email has no account to sign in with
- [x] 2.5 Set custom claims (`{ role, tenantId }` for tenant users, `{ role: "super-admin" }` for the super-admin) and enforce them server-side, with changes taking effect on next token refresh
- [x] 2.6 Implement tenant resolution from the user's single tenant binding and project selection before capture
- [x] 2.7 Implement backend token verification deriving tenantId/uid/role from claims
- [x] 2.8 Enforce per-tenant data isolation across all reads/writes via row-level security plus explicit `tenant_id` predicates, with a separate privileged path for the super-admin

## 3. Capture extension

- [x] 3.1 Scaffold the Chrome MV3 extension (service worker, popup, content scripts)
- [x] 3.2 Implement email-and-password sign-in with forced first-login password change, including token storage/refresh
- [x] 3.3 Implement the session-start gate requiring a selected project and either a validated Jira ID or tester-written description
- [x] 3.4 Validate Jira ID live against the selected project's Jira config when provided; otherwise record the tester description; freeze projectId/jiraId/description for the session
- [x] 3.5 Implement DOM-replay capture (rrweb-style) of clicks/inputs/navigation with selectors
- [x] 3.6 Implement optional periodic viewport-only screenshot capture (chrome.tabs.captureVisibleTab) tied to the session
- [x] 3.7 Implement the hotkey to flag important selectors/states
- [x] 3.8 Upload DOM-replay payloads and optional screenshots to GCS using a scoped write-only upload credential (PUT only to the session's own path; no read/list/delete)
- [x] 3.9 Stamp every event/artifact server-side with tenantId/projectId/uid/sessionId and optional jiraId from the verified token and authorized project

## 4. Knowledge and code generation

- [x] 4.1 Implement per-project knowledge hub (markdown overview + default-creds reference in Secret Manager)
- [x] 4.2 Implement Gemini client with configurable Flash and 3 Pro model IDs and tier routing
- [x] 4.3 Implement Playwright script generation from a recording (Flash tier)
- [x] 4.4 Implement context-grounded Playwright test generation with assertions (Pro tier) using Jira when present, tester description, knowledge hub, and flagged states
- [x] 4.5 Implement comment-and-regenerate flow that incorporates user comments

## 5. Dashboards and monitoring

- [x] 5.1 Scaffold the dashboard web app with role-scoped routing
- [x] 5.2 Implement admin recording/artifact browser (screenshots, DOM-replay, selections, summaries)
- [x] 5.3 Implement user view restricted to own contribution
- [x] 5.4 Implement productivity metrics and ranking sorted by generated Playwright test count, total recording duration (raw wall-clock, no idle exclusion), and recording count, with explanatory dashboard messaging that the ranking is directional
- [x] 5.5 Implement the per-project context section

## 6. Cross-cutting and verification

- [x] 6.1 Document the privacy/capture posture (what is captured and why; field masking)
- [x] 6.2 Add end-to-end test: provision tenant/project, add user, email-and-password sign-in with forced password change, capture project/work-context-gated session, generate asserted test, view in both dashboards
- [x] 6.3 Verify cross-tenant isolation (including row-level security) and that non-provisioned emails cannot sign in
- [x] 6.4 Add Playwright E2E coverage for at least 80% of dashboard and extension frontend screens/states
- [x] 6.5 Exercise at least 80% of REST endpoints through the production-compiled Nest HTTP stack, Firebase Auth emulator, PostgreSQL RLS, and fake GCS
- [x] 6.6 Generate OpenSpec-linked Markdown coverage reports after successful E2E runs
