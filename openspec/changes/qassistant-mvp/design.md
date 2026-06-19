## Context

QAssistant is a greenfield, multi-tenant SaaS. It captures manual QA testing sessions on web apps as structured, replayable knowledge, then uses that knowledge to (a) generate Playwright automation and (b) give managers visibility into QA productivity. A tenant equals a client/account, and each tenant can own multiple projects. The platform must be sellable to multiple clients, run almost entirely on GCP managed services, and be deployable by Terraform from documented operator prerequisites.

Stakeholders: a platform-level `super-admin` (sells/operates the SaaS, creates tenants and their first admins), client admins (manage their own QA team), and QA engineers (do the testing). The product is security-sensitive: it verifies identity on every request, isolates tenant data, handles client credentials, and captures client application DOM/screenshots.

## Goals / Non-Goals

**Goals:**
- One Terraform-deployable stack on GCP managed services; operator input starts with a Google login + project ID, plus documented prerequisites that cannot be safely bootstrapped automatically.
- Email and password authentication with admin-created accounts, forced first-login password change, strict admin-controlled access, and no self-registration or domain assumptions.
- Faithful, queryable capture of manual sessions (DOM-replay first, screenshots secondary) bound to a selected project, verified user identity, and work context: validated Jira ticket when provided, otherwise tester-written description.
- Context-grounded code generation (Jira + knowledge hub + project markdown) producing Playwright scripts and real tests, with comment/regenerate.
- Role-scoped dashboards: admins see everything in their tenant, QA engineers see only their own work, and MVP includes a ranking view.

**Non-Goals:**
- Pixel-perfect video recording as the primary capture (DOM-replay is the source of truth; screenshots are the human-watchable artifact).
- Self-service signup (all access is admin-provisioned).
- Cross-tenant data sharing or a global user identity (each user belongs to exactly one tenant).
- Building a custom identity provider (we use GCP Identity Platform).
- MFA (TOTP authenticator app), federated SSO (SAML/OIDC per GCIP tenant), and a configurable password policy: supported by Identity Platform but deferred beyond MVP as the next hardening step.

## Challenge Review

These are the plan areas that need pressure before implementation:

- **Tenant/project split is now chosen, with tenant-wide project access.** A tenant owns multiple projects, and any active tenant user can access projects in that same tenant. This is simpler, but weaker than explicit project membership if a client has separate teams.
- **PostgreSQL/Cloud SQL is now chosen, but the schema contract is not.** The plan still needs tables, ownership rules, indexes, migration tooling, and backup/restore posture. PostgreSQL row-level security is now chosen as the tenant-isolation floor, with explicit `tenant_id` predicates in queries as defense in depth.
- **"Only Google login + GCP project ID" was too broad.** Real deployment likely also needs billing enabled, IAM permissions, Terraform state location, artifact/container registry setup, redirect domains, Jira credentials, Gemini API access, and DNS/custom domains. The plan should say "documented prerequisites" instead of implying zero setup.
- **Email and password auth needs admin-driven account handling.** Accounts are admin-created with an initial password handed over out of band; the plan still needs the concrete forced first-login password-change flow, the `mustChangePassword` marker lifecycle, and the admin-driven reset path, since there is no email sending or self-service recovery in MVP.
- **Jira is optional, but work context is mandatory.** A tester can start without a Jira ticket by providing a description. If a Jira ticket is provided, validation is per-project and API token/secret based; comments/attachments are readable for context, but write permissions are out of scope.
- **DOM and screenshot capture are privacy-heavy.** DOM masking is selected by default, but optional viewport-only screenshots can still expose visible sensitive data. The plan needs URL allow/deny lists, consent language, retention, deletion, and export.
- **Productivity ranking is in MVP and is sensitive/gameable.** The ranking direction, visibility, and messaging are chosen. MVP ranking uses visible metrics only, sorted by generated test count, raw wall-clock recording duration (no idle exclusion), then recording count, with no hidden weighted score. Because duration is raw wall-clock, the ranking is explicitly directional.
- **Code generation needs guardrails.** Jira text, captured DOM, and markdown context can contain secrets or prompt injection. Generated Playwright should be versioned, reviewed, and validated before being treated as useful automation.
- **Full MVP is selected as the first target.** This is higher scope and schedule risk than a vertical slice. The plan should still define internal checkpoints so implementation does not drift.

## Decisions

### D1: Identity Platform (multi-tenant) over self-hosted Keycloak
Use GCP Identity Platform with native multi-tenancy (one instance, many tenants; a tenant = a client/account). Chosen over Keycloak because it is fully managed, multi-tenancy is built in, and cost sits in the free MAU band for QA-team sizes. Trade-off: less built-in RBAC UI and GCP lock-in; acceptable since we build our own thin admin UI and are GCP-native anyway. Application metadata still lives in Cloud SQL PostgreSQL.

### D2: Email and password as the auth method
Use Identity Platform's email and password provider, with Identity Platform multi-tenancy mapping one GCIP tenant to one app tenant. Tenant users live inside their GCIP tenant; the `super-admin` is a project-level user that belongs to no tenant. There is no email sending in MVP and no self-registration: accounts are admin-created and trusted, so email addresses are not verified. Chosen over passwordless magic links and email-OTP codes because those require an email sender and redirect machinery; email and password keeps MVP sign-in self-contained. MFA (TOTP) and federated SSO are supported by Identity Platform but deferred, with a configurable password policy as the next hardening step. Application metadata still lives in Cloud SQL PostgreSQL.

### D3: Admin-created accounts with in-dashboard management and forced password change
User management is done from the dashboard, not a separate console. The dashboard calls the Identity Platform Admin SDK from the backend to create users, set their initial password, assign roles, disable users, and reset passwords. Because the admin who creates or resets a password knows it, the user must change it before app access: creating or resetting a password sets a `mustChangePassword` marker (custom claim or metadata), login routes the user to a forced set-new-password step before any app access, and completing it clears the marker. A forgotten password is reset by an admin, not by self-service. A non-provisioned email simply has no account to sign in with. The first `super-admin` is bootstrapped by a seed script or Terraform, not through any UI.

### D4: No domain assumptions; single-tenant binding
Because client users may be on Gmail or mixed domains, tenant membership cannot be derived from an email domain. Each user belongs to exactly one tenant, established by the admin at invitation, and can access only the data of that tenant. Tenant resolution uses this single tenant binding rather than onboarding links, a multi-tenant picker, or a project code. After sign-in, the user must select a project before starting capture.

### D5: Server-derived identity; client never asserts it
The extension's API calls carry the Identity Platform ID token. The backend verifies it and derives `tenantId`, `uid`, and `role` from the token claims. The client may supply the selected `projectId`, optional `jiraId`, and tester description, but the backend must verify that the project belongs to the token tenant and that the user may access it. Captured events/artifacts are stamped server-side with verified `tenantId`, authorized `projectId`, `uid`, `sessionId`, and optional `jiraId`, preventing forged attribution or cross-tenant/project writes.

### D6: DOM-replay (rrweb-style) as source of truth, screenshots secondary
Capture the DOM event stream as the primary record because it is small, queryable ("what was clicked / not tested"), and yields robust selectors for Playwright generation. Optional viewport-only screenshots provide a human-watchable artifact and before/after states for assertion inference. Full pixel video is excluded from MVP (large, opaque, privacy-heavy). An optional hotkey lets the tester flag a selector/state as important for codegen.

### D7: Session gate requires project plus work context
A session cannot start without a selected project and work context. Work context can be either (a) a Jira ID that the backend validates against that project's optional Jira configuration, or (b) a tester-written description of what is being tested. The `projectId`, optional `jiraId`, and description are frozen for the session. This produces the join `session -> user (uid) -> tenant -> project -> optional Jira ticket / description` and grounds code generation in the tester's intent.

### D8: Gemini model routing (Flash for volume, 3 Pro for tests)
Route cheap, high-volume work (session summaries, productivity narratives, quick replay scripts) to a Flash-tier model, and reserve Gemini 3 Pro for generating real Playwright tests where assertions must be reasoned from Jira context + knowledge hub + project markdown. Model IDs are configurable (not hard-coded) so the live Flash/Pro models in the project are used.

### D8a: Generated tests are reviewable drafts
Generated Playwright tests are stored as versioned drafts with review status. Users can mark a generated version reviewed/approved; approval records the approving user and timestamp but does not claim the test has been executed. A further status, `INTEGRATED`, indicates the recording's test was added to the automated tests repo; it is a manual flag set by a user and does not require proof of repository integration. MVP does not require automatic execution or syntax validation before showing generated tests.

### D8b: Prompt-injection handling by source labeling
Captured pages, Jira comments/attachments, tester descriptions, and project markdown are treated as untrusted context. The generation prompt keeps platform instructions separate from untrusted inputs, labels each input source, and stores a prompt-input summary with each generated test version. MVP does not require a full sanitizer pipeline.

### D8c: Known-secret redaction before model use
Before sending recording, Jira, tester-description, screenshot-derived, or project context to Gemini, the system redacts known secrets such as passwords, tokens, API keys, auth headers, and cookies. MVP does not require broad PII redaction or configurable custom redaction for code generation.

### D9: Cloud Run + GCS + Secret Manager, Terraform-provisioned, workload identity
Host the API and dashboards on Cloud Run or an equivalent managed runtime rather than self-managed compute. The MVP preference is a single Cloud Run app service for all app endpoints where practical. Store transactional metadata in Cloud SQL PostgreSQL; store artifacts (DOM-replay payloads, screenshots) in GCS; store project "default credentials" and secrets in Secret Manager, never PostgreSQL. Cloud Run services authenticate to GCP services via workload identity (no service-account keys). Everything is defined in Terraform with documented prerequisites, provisioning from the already-authenticated `gcloud` CLI and failing fast (aborting immediately, no interactive retry loop) if authentication is invalid.

### D10: Per-tenant data isolation with row-level security
All domain data (projects, sessions, events, artifacts metadata, users, project context, generated tests, comments) is keyed by `tenantId`, and project-scoped records also carry `projectId`. Tenant isolation in PostgreSQL is enforced by row-level security as the floor: every tenant-scoped table has an RLS policy keyed off a per-request session setting (for example `app.tenant_id`) that the backend sets from the verified token's `tenantId` claim at the start of each request or transaction. Application queries still pass `tenant_id` explicitly, so the explicit predicate and RLS are defense in depth: even if a query forgets its `WHERE tenant_id`, RLS prevents cross-tenant reads or writes. GCS object paths are namespaced by tenant/project/session. In MVP, every active tenant user can access every active project in that same tenant. Admin queries are scoped to their tenant only; the `super-admin`, having no tenant, uses a separate privileged path rather than the tenant session setting, and is the only cross-tenant role and only for provisioning.

### D11: PostgreSQL/Cloud SQL for metadata
Use PostgreSQL on Cloud SQL as the source-of-truth datastore for application metadata: tenants, projects, users, Jira config references, sessions, artifact metadata, generated test versions, comments, and dashboard metrics. GCS remains the store for large DOM-replay and screenshot artifacts.

### D12: Tenant-owned projects
Model tenants as client/accounts and projects as the unit of app context, optional Jira configuration, credentials, capture, and code generation. Every session belongs to exactly one project. Projects without Jira are allowed and support description-based sessions.

### D13: Tenant-wide project access for MVP
For MVP, any active user in a tenant may access projects in that same tenant. Cross-tenant project access remains denied. Explicit per-project membership is deferred unless a client needs team-level separation.

### D14: One base URL per project
Each project has one base URL in MVP. Multiple environments such as staging/QA/prod are deferred.

### D15: Optional viewport-only screenshots
Screenshots are optional. When enabled, the extension captures viewport-only screenshots (via `chrome.tabs.captureVisibleTab`) as human-review artifacts. DOM masking still applies to DOM capture, but screenshots are not guaranteed to be redacted. Screenshots may be compressed or downsampled before being sent to the LLM when needed.

### D16: Indefinite artifact retention by default
MVP keeps DOM-replay payloads and screenshots indefinitely by default. There is no automatic time-based artifact expiry in MVP; explicit session deletion remains the deletion mechanism.

### D17: Ranking in MVP
The dashboard includes an admin-only "Contribution ranking" in MVP. The ranking is directional, not an absolute performance judgment, and uses visible metrics rather than a hidden weighted score. Sort order is: generated Playwright test count, then total recording duration (raw wall-clock, with no idle exclusion in MVP), then recording count. Because duration is raw wall-clock, the ranking is explicitly directional and not a precise productivity measure. MVP has no minimum session duration for ranking.

### D18: Two-step deletion and tenant export
Deleting a session uses a two-step flow: soft delete first, then permanent delete after a 30-day grace period. Permanent session deletion removes associated GCS artifacts, session metadata, and generated tests. Tenant admins and QA engineers can export a session package of metadata, DOM-replay artifacts, screenshots when present, and generated tests; QA engineers may export any session in their tenant, not only their own. Audit logging is out of scope for MVP.

### D19: Full-MVP internal checkpoints
The external implementation target is full MVP, but implementation should be checkpointed internally: first capture review, then asserted codegen, then dashboards/ranking. These checkpoints are delivery controls, not scope reductions.

### D20: Backend on TypeScript/Node.js with NestJS
The backend is TypeScript on Node.js, using NestJS as the HTTP framework. NestJS is chosen for its structured dependency injection and module system, which lets token verification and the per-request RLS session-variable set be paired as a request-scoped interceptor/middleware wrapping a per-request transaction. TypeScript is used across API, dashboard, extension, and shared packages so types and validation schemas are reused.

### D21: Token verification and custom claims via Firebase Admin SDK
The backend verifies Identity Platform ID tokens with the Firebase Admin SDK `verifyIdToken`, deriving `role` and `tenantId` from the verified claims (consistent with D5). The same Admin SDK sets custom claims via `setCustomUserClaims`, including `{ role, tenantId }` for tenant users and `{ role: "super-admin" }` for the platform operator. Revocation takes effect only on the next token refresh (about one hour), accepted for MVP.

### D22: Drizzle ORM with Drizzle Kit migrations
Data access uses Drizzle ORM with Drizzle Kit for generated SQL migrations. Drizzle is chosen over Prisma because per-transaction session variables for RLS are awkward in Prisma, while Drizzle gives direct control over the request transaction. The backend uses an in-process connection pool and sets the tenant scope transaction-locally with `set_config('app.tenant_id', ..., true)` (never plain `SET`), so a pooled connection cannot leak one tenant's scope into another tenant's request. No external pooler in MVP; cap pool size against Cloud SQL `max_connections` divided by max instances. Validation schemas are shared Zod schemas in `packages/shared` and reused by API, dashboard, and extension.

### D23: Cloud SQL connectivity via the Node connector
The backend connects to Cloud SQL using `@google-cloud/cloud-sql-connector` (the Node connector), which is keyless via workload identity and needs no Auth Proxy sidecar. This keeps the single Cloud Run service self-contained and consistent with the no-service-account-key rule (D9).

### D24: Super-admin uses a BYPASSRLS database role
The cross-tenant `super-admin` path (D10) connects with a dedicated `BYPASSRLS` PostgreSQL role rather than setting the `app.tenant_id` session variable. This resolves the previously open question of how the privileged path bypasses RLS and keeps the super-admin path explicitly separate from the tenant path. It is used only for provisioning.

### D25: Gemini Developer API with an API key on the paid tier
AI calls use the Gemini Developer API with an API key on the paid tier (not Vertex AI), via the `@google/genai` SDK. The paid tier is required because the free tier may use submitted data to improve products, which is unacceptable for client DOM/screenshots. The API key is the one standing secret in the stack: it is stored in Secret Manager and injected at runtime (it is not a service-account key file, so it does not violate the workload-identity rule of D9). Tradeoff: the Developer API gives weaker EU data-residency control than Vertex, accepted for MVP; revisit Vertex only if EU data-residency becomes a hard requirement.

### D26: Async codegen via Cloud Tasks
Code generation runs asynchronously through Cloud Tasks so that long Gemini calls do not block latency-sensitive endpoints in the single Cloud Run service (D9). `POST /generate` enqueues a Cloud Task, a worker endpoint runs Gemini and writes the `generated_tests` row, and the client polls for completion. This keeps the one-service preference without coupling codegen latency to request endpoints.

### D27: Capture, extension auth, and upload mechanics
DOM-replay capture uses rrweb as the source of truth (D6), with rrweb-player for replay in the dashboard. Viewport-only screenshots are captured via `chrome.tabs.captureVisibleTab` (D15). The MV3 popup handles sign-in; ID and refresh tokens live in `chrome.storage.local`, which is per-extension isolated, and the service worker reads and refreshes them. The stored auth token is the user's identity (not a write-only credential), so a leak allows reading the user's data and tenant-wide session export up to about one hour after disable (the revocation-on-refresh gap of D21); mitigate with a short ID-token TTL and guarding the refresh token, with the one-hour gap documented as accepted MVP risk. Artifact uploads use GCS V4 signed URLs that are PUT-only, scoped to the session's own object path, and short-lived (about 15 minutes), minted by the backend after it authorizes the session.

### D28: Delivery via GitHub Actions with Workload Identity Federation
CI/CD uses GitHub Actions to build and push images to Artifact Registry and deploy Cloud Run, authenticating with Workload Identity Federation (GitHub OIDC to GCP) so no service-account key is stored in GitHub (consistent with D9). Local development uses full emulators via docker-compose: Postgres, the Firebase Auth emulator, and `fake-gcs-server`, with SDKs pointed at emulator endpoints; the real non-prod GCP project is reserved for integration tests.

## MVP Decision Questions

These are owner choices that should be answered before implementation starts:

### Persistence

**Decision:** Use PostgreSQL on Cloud SQL as the source-of-truth datastore for application metadata. GCS remains the artifact store for DOM-replay payloads and screenshots.

**Question:** What is the source-of-truth datastore for application metadata?

- **PostgreSQL / Cloud SQL:** Best if you want relational constraints, SQL analytics, joins across users/sessions/artifacts/comments, and clearer migrations. Trade-off: more ops than Firestore and not scale-to-zero in the same way.
- **Firestore:** Best if you want serverless document storage and simple per-tenant document paths. Trade-off: weaker relational querying and more care needed for analytics/reporting.
- **Hybrid:** PostgreSQL for transactional metadata, GCS for artifacts, BigQuery later for analytics. Trade-off: more moving parts, but cleaner long-term separation.

### Tenant And Project Model

**Decision:** A tenant can own multiple projects. The domain model is `tenant -> projects`, not `tenant = project`.

**Question:** Is a tenant the same thing as a project, or can one tenant own many projects?

- **Tenant = project:** Simpler MVP, fewer tables and UI concepts. Trade-off: awkward for clients with multiple apps or Jira projects.
- **Tenant -> projects:** More realistic SaaS model. Trade-off: more scoping rules, project picker, and per-project integrations.

### Jira Integration

**Decision:** Each project may have zero or one active Jira configuration. Projects without Jira are allowed.

**Question:** How should Jira be connected?

- **Per-tenant Jira config:** Simpler if each client has one Jira site. Trade-off: weak if the client has multiple Jira projects with different permissions.
- **Per-project Jira config:** Better isolation and clearer ticket validation. Trade-off: more setup steps for admins.
- **No Jira config:** Allowed for projects that rely on tester-written descriptions instead of Jira tickets. Trade-off: less ticket context for code generation.

### Capture Privacy

**Decision:** Mask sensitive DOM data by default before upload. Viewport-only screenshots remain optional and are not guaranteed to be redacted.

**Question:** When the extension records a page, should sensitive fields be hidden automatically before upload?

- **Mask by default:** Hide password fields, tokens, credit cards, emails/PII-like fields, and admin-configured CSS selectors before upload. Trade-off: codegen may lose some useful context, but this is safer for clients.
- **Capture by default with exclusions:** Capture most page content unless an admin explicitly excludes fields/selectors. Trade-off: better replay fidelity, but much higher privacy/compliance risk.
- **Challenge:** For a SaaS that records client apps, defaulting to masking is the safer baseline. Screenshots make this even more important because screenshots can expose data that DOM masking misses.

### Screenshot Policy

**Decision:** Screenshots are optional. When enabled, capture the viewport-only screenshot via `chrome.tabs.captureVisibleTab` and compress/downsample before sending to the LLM if needed.

**Question:** Are screenshots required for MVP?

- **DOM-replay only first:** Lower storage/privacy risk and faster MVP. Trade-off: less human-friendly review.
- **DOM-replay plus optional viewport-only screenshots:** Better review and assertion inference when enabled. Trade-off: heavier privacy, retention, and storage requirements.

### Codegen Output

**Decision:** Generate asserted Playwright tests, not only draft replay scripts.

**Question:** What should the first generated output be?

- **Draft Playwright script:** Easier to ship and honest about reliability. Trade-off: less valuable than asserted tests.
- **Asserted Playwright test:** Higher value. Trade-off: needs stronger context, review workflow, and failure validation.

### Analytics And Ranking

**Decision:** Include metric-based ranking in MVP.

**Question:** Should the MVP include a leaderboard/ranking of QA engineers?

- **Defer ranking:** Show neutral metrics only: sessions recorded, Jira tickets touched, time in active sessions, generated tests, and reviewed outputs. Trade-off: less "manager scoreboard" value, but lower risk.
- **Include metric-based ranking:** Sort QA engineers by generated Playwright test count, then total recording duration (raw wall-clock, no idle exclusion in MVP), then recording count. Trade-off: you must communicate that this is directional and not an absolute performance judgment.
- **Challenge:** Ranking is now in scope, so keep it explainable and avoid hidden weights.

### Deployment Footprint

**Question:** What does "operator provides only Google login + project ID" really allow?

- **Strict minimal input:** Ambitious and clean. Must prove billing, IAM, APIs, Terraform state, image registry, auth redirects, and secrets can be bootstrapped.
- **Documented prerequisites:** More realistic. Operator still runs Terraform, but prerequisites are explicit.

### First Vertical Slice

**Decision:** Target the full MVP, not a reduced first vertical slice.

**Question:** What is the first build milestone that proves the product works?

- **Admin-only capture review:** Tenant, project, user, work-context validation, DOM/screenshot upload, and admin artifact viewer. Proves capture and visibility, but not AI value.
- **Capture plus asserted codegen:** Everything above, plus one generated asserted Playwright test from the recording. Proves the core product promise.
- **Full MVP:** Adds user dashboard, productivity, ranking, regenerate, and full Terraform verification. Highest scope and highest delay risk.
- **Challenge:** Because full MVP is selected, define internal checkpoints anyway: capture review, asserted codegen, then dashboard analytics/ranking.

## Recorded Choices And Precision Needed

These choices are now recorded, and the technology stack is decided (see D20 through D28). The concrete API/data-model contract that was previously the remaining blocker (task 0.10) is now written: see `data-model-and-api-contract.md` in this change folder for schema fields, indexes, migrations, lifecycle behavior, and access-control enforcement.

### Project Authorization

**Decision:** All active tenant users can access all active projects in their tenant. Cross-tenant project access remains denied.

**Question:** When a QA user belongs to a tenant, can they access every project in that tenant?

- **All tenant users can access all tenant projects:** Simpler admin flow and easier MVP. Trade-off: weak separation if one client has different teams/apps.
- **Users are assigned to specific projects:** Better security and clearer dashboards. Trade-off: more admin UI and membership tables.
- **Challenge:** This is simpler but weaker for clients with separate teams. Keep the data model open to adding project memberships later.

### Jira Authentication

**Decision:** Use project-level Jira base URL plus API token/secret for MVP. Store the secret in Secret Manager and store only a reference in PostgreSQL.

**Decision:** Jira is optional at both the project and session level. A project may have no Jira configuration. If a Jira ticket is provided, the project must have an active Jira configuration and validation is project-matched: the ticket must exist, title/status must load, and the ticket must belong to the selected project's allowed Jira project key. If no Jira ticket is provided, the tester must provide a description of what they are testing.

**Decision:** Non-Jira sessions require only a non-empty tester description. No minimum length or structured fields are required in MVP.

**Decision:** If a tester provides a Jira ID and Jira validation fails because Jira is down, the token fails, or the ticket cannot be validated, the Jira-based session is blocked. The tester may remove the Jira ID and start a non-Jira session with a description instead.

**Decision:** Jira token rotation is manual replacement in MVP. A project admin replaces the token; the stored Secret Manager value is overwritten. No versioned rollback is required for MVP.

**Decision:** Jira tokens require read access to issue metadata, issue description, comments, and attachments. They must not require write, transition, or comment-posting permissions in MVP.

**Question:** How does each project connect to Jira?

- **Admin stores Jira base URL + API token/secret:** Fastest MVP. Store the secret in Secret Manager and only a reference in PostgreSQL. Trade-off: token replacement is manual.
- **OAuth/app-based Jira connection:** Better SaaS posture and revocation. Trade-off: more setup, callback URLs, consent flow, and Atlassian app configuration.
- **Challenge:** Design the Jira config table so OAuth/app-based connection can replace API tokens later.

### Project Environment Model

**Decision:** One base URL per project in MVP.

**Question:** What URL does a project test against?

- **One base URL per project:** Simple. Trade-off: weak if clients have staging, QA, and production.
- **Multiple environments per project:** More realistic: `staging`, `qa`, `prod`, each with a base URL and optional credentials reference. Trade-off: more setup before recording.
- **Challenge:** One URL is simpler, but most real QA teams have staging/QA/prod. Keep the schema extensible enough for multiple environments later.

### Capture Privacy Default

**Decision:** Mask sensitive DOM data by default and support per-project excluded URL patterns.

**Question:** What is the default privacy posture for DOM and screenshots?

- **Mask by default:** Hide sensitive inputs and configured selectors before upload; block capture on excluded URLs. Trade-off: some codegen context is lost.
- **Capture by default:** Record everything unless excluded. Trade-off: high privacy risk and harder sales conversations.
- **Challenge:** DOM masking does not guarantee screenshot privacy. If screenshots are enabled, visible data may be captured.

### Screenshot Redaction Limit

**Decision:** No strong screenshot redaction guarantee. Screenshots are optional viewport-only screenshots; compress/downsample before LLM use when needed.

**Question:** What do we promise about screenshots?

- **Best-effort screenshot redaction:** Try to hide known sensitive fields/regions but document limitations. Trade-off: honest and realistic.
- **Strong screenshot redaction guarantee:** Claim sensitive data will never appear. Trade-off: risky because screenshots can contain rendered secrets outside normal fields.
- **Challenge:** Because screenshots capture visible pixels, they should be treated as sensitive artifacts even when DOM masking is enabled.

### Retention

**Decision:** Artifacts are retained indefinitely by default in MVP.

**Question:** How long are DOM-replay payloads and screenshots kept?

- **Indefinite MVP retention:** Keep artifacts until explicit session deletion. Trade-off: simpler lifecycle, but higher storage and privacy burden.
- **Fixed time-based retention:** Example: 30, 90, 180, or 365 days. Trade-off: lower storage/privacy burden, but needs lifecycle implementation and client communication.
- **Per-tenant retention policy:** Admins choose retention within platform limits. Trade-off: more UI and lifecycle logic.

### Ranking

**Decision:** Ranking is included in MVP as a metric-based admin view.

**Question:** Should ranking be built now?

- **No ranking in MVP:** Show neutral metrics only. Trade-off: less competitive dashboard.
- **Metric-based ranking in MVP:** Sort by generated Playwright test count, then total recording duration (raw wall-clock, no idle exclusion in MVP), then recording count. Trade-off: simple and explainable, but still sensitive as a productivity view.
- **Weighted ranking in MVP:** Requires an approved formula, idle detection, anti-gaming, and internal messaging.

### First Vertical Slice

**Decision:** Full MVP is the implementation target.

**Question:** What first milestone should implementation target?

- **Admin capture review:** Fastest proof of capture and dashboard.
- **Capture plus asserted codegen:** Proves the core value: manual QA becomes an asserted Playwright test.
- **Full MVP:** Too broad for first build.
- **Challenge:** Full MVP as first target increases delivery risk. Use internal checkpoints even if the external target is full MVP.

## Minimum Contracts Before Implementation

These are not implementation details yet; they are the contracts the plan must define before backend, dashboard, extension, or Terraform work starts.

### Minimum PostgreSQL Entities

The initial schema should at least account for:

- `tenants`: client/account boundary.
- `tenant_users`: tenant-scoped users, role, and status (each user belongs to exactly one tenant).
- `projects`: project belongs to one tenant and owns optional Jira config, knowledge hub, environments, sessions, and generated tests.
- `project_memberships`: deferred for MVP; add later if users must be assigned to specific projects.
- `jira_configs`: zero or one active Jira configuration per project, with secrets stored in Secret Manager.
- `sessions`: tenant, project, user, optional Jira ticket, tester description, status, start/end timestamps.
- `artifacts`: metadata for DOM-replay chunks, screenshots, storage paths, checksums, and deletion state.
- `flags`: tester-marked selectors/states for code generation.
- `generated_tests`: versioned asserted Playwright outputs with model metadata, review status, and a manual `INTEGRATED` flag.
- `generation_comments`: user comments that feed regeneration.

Every tenant-scoped table carries `tenant_id` and is protected by a row-level-security policy keyed off a per-request session setting set from the verified `tenantId` claim.

### Minimum API Boundaries

The initial API contract should separate:

- **Super-admin/admin provisioning:** super-admin creates a tenant and its first admin; tenant admins add and manage users via the Admin SDK (create, set password, assign role, disable, reset password) and create projects.
- **Project setup:** optionally configure Jira, one project base URL, knowledge hub, masking/exclusion rules, screenshot setting.
- **Extension capture:** resolve tenant/project, validate Jira when provided, require tester description when Jira is absent, create session, upload DOM-replay chunks, upload screenshots, flag selectors, stop session.
- **Codegen:** request generation, store generated test version, comment, regenerate, mark reviewed/approved, mark `INTEGRATED`.
- **Lifecycle/admin operations:** soft delete session, permanently delete after grace period, export session package.
- **Dashboard reads:** role/tenant-scoped session list, artifacts, generated tests, productivity metrics, and ranking.

### Contract Challenge

Do not let the extension choose identity. The extension may request a project and submit optional Jira/description context, but the backend must derive `tenantId` and `uid` from the token and must authorize `projectId` before creating a session or accepting artifacts.

## Risks / Trade-offs

- **Admin-set passwords are known to the admin** → Force a password change on first login and after any admin reset via the `mustChangePassword` marker; hand initial passwords over out of band; defer a configurable password policy and TOTP MFA as the next hardening step.
- **Generated assertions may be weak or false** → Ground assertions in Jira when present, tester description, knowledge hub, screenshots, and project markdown; let the tester flag important states with a hotkey; store generated tests as reviewable versions, not automatically trusted automation.
- **Capturing client DOM/screenshots is privacy-sensitive (EU/GDPR, employee monitoring)** → Document a clear "what is captured and why" posture, keep capture per-tenant isolated, support field masking in DOM-replay, and store secrets only in Secret Manager.
- **Cross-tenant data leakage** → Each user belongs to exactly one tenant resolved from their single tenant binding (D4); PostgreSQL row-level security keyed off the verified `tenantId` claim is the isolation floor, with explicit `tenant_id` predicates as defense in depth (D10).
- **Brittle selectors from recordings** → Prefer stable selector strategies in DOM-replay (role/text/test-id) and let the LLM rewrite to resilient Playwright locators.
- **GCP lock-in** → Accepted; the product is GCP-native by design and the managed-services mandate makes portability a non-goal.

## Open Questions

- API/data-model contracts (schema fields, indexes, migrations, access-control enforcement) are now written in `data-model-and-api-contract.md` (task 0.10). Backup/restore posture is the remaining piece to confirm.
- Items left open in TECHNICAL_CHOICES.md and not yet decided: the dashboard framework (TypeScript only), MV3 build/bundling tooling, package/workspace tooling, target GCP region (likely EU given GDPR sensitivity), concrete default Gemini model IDs, and the Jira REST API version (v2 vs v3).
