## Why

Manual QA testers exercise web apps every day (the clicks, flows, and features they verify), but that knowledge evaporates the moment the session ends: nothing is captured, nothing is reusable, and nobody can see who tested what. QAssistant captures each manual testing session as structured, replayable knowledge so it can be turned into automated Playwright tests and into visibility over how the QA team actually works. It is built multi-tenant from day one so the same platform can be sold to multiple clients.

## What Changes

- Introduce a multi-tenant SaaS where a tenant = a client/account and each tenant can own multiple projects. Provisioning has three levels: a platform-level `super-admin` creates a tenant and its first admin; a tenant `admin` adds users manually from a dashboard screen by any email (including Gmail); `qa-engineer` accounts self-provision nothing. There is no self-registration: an account exists only if a super-admin or admin created it.
- Email and password authentication via Identity Platform's email/password provider, with one GCIP tenant per app tenant. There is no email sending in MVP and email addresses are not verified: accounts are admin-created and trusted. User management is done in the dashboard via the Admin SDK (create user, set initial password, assign role, disable, reset password). Because the admin who sets a password knows it, a `mustChangePassword` marker forces a set-new-password step on first login and after any admin reset. Custom claims `{ role, tenantId }` (and `{ role: "super-admin" }` with no tenant) are verified server-side on every request; revocation takes effect on the next token refresh.
- Tenant resolution without domain assumptions: each user belongs to exactly one tenant, resolved from the single tenant binding established at invitation, and can access only that tenant's data.
- A Chrome MV3 extension captures sessions as DOM-replay (rrweb-style) source of truth plus optional viewport-only screenshots. A session cannot start without a selected project and work context: either a Jira ID validated live against that project's optional Jira configuration, or a tester-written description of what is being tested. Projects without Jira are allowed and support description-based sessions only. Every event and artifact is stamped with `tenantId` + `projectId` + `uid` (derived from the verified token, never client-supplied) + `sessionId` + optional `jiraId`. A hotkey lets the tester flag an important selector/state as a hint for code generation.
- A per-project knowledge hub (markdown overview + default credentials context) provides grounding for code generation. Gemini model routing uses a Flash tier for summaries/analytics/quick replay scripts and Gemini 3 Pro for real Playwright tests whose assertions are inferred from the Jira ticket when present, the tester description, knowledge hub, and project markdown. Generated code can be commented on and regenerated per recording.
- Two dashboards: an admin view (tenant/project recordings, artifacts, screenshots, selections, summaries, productivity metrics, metric-based ranking, per-project context) and a user view (own contribution only). Tenant isolation in PostgreSQL is enforced by row-level security keyed off the verified `tenantId` claim, with explicit `tenant_id` predicates as defense in depth.
- All infrastructure is deployed via Terraform using managed services (Cloud Run, Cloud SQL for PostgreSQL, GCS, Secret Manager, Identity Platform), with workload identity. The operator provides a Google login and a GCP project ID, plus any documented prerequisites that cannot be created safely by Terraform; provisioning relies on the already-authenticated `gcloud` CLI and fails fast if authentication is invalid.

## Capabilities

### New Capabilities
- `platform-infrastructure`: Terraform-defined GCP stack on managed services (Cloud Run services, Cloud SQL PostgreSQL, GCS buckets, Secret Manager, Identity Platform enablement, workload identity, networking/IAM) provisioned from documented operator prerequisites.
- `identity-and-tenancy`: multi-tenant identity model, tenant-owned projects, three-level provisioning (super-admin/admin/qa-engineer), email-and-password sign-in with admin-created accounts and forced password change, in-dashboard user management via the Admin SDK, custom-claim authorization, and single-tenant resolution.
- `session-capture`: Chrome MV3 extension that records DOM-replay + optional viewport-only screenshots, gates sessions behind a selected project and either a validated Jira ID or tester-written description, and stamps + uploads every event/artifact with verified identity to GCS.
- `knowledge-and-codegen`: per-project knowledge hub and the Gemini-routed pipeline that turns recordings into Playwright scripts/tests, with comment and regenerate.
- `qa-dashboards`: admin and user dashboards covering recordings, artifacts, productivity metrics, ranking, and per-project context, scoped by role and tenant authorization.

### Modified Capabilities
<!-- None (greenfield project, no existing specs). -->

## Impact

- New greenfield codebase: a Chrome MV3 extension, a Cloud Run backend API (ingestion, auth verification, provisioning, codegen orchestration), web dashboards, and a Terraform module set.
- External dependencies/integrations: GCP Identity Platform (multi-tenant, email/password provider, Admin SDK for user management), Cloud SQL PostgreSQL, GCS, Secret Manager, Cloud Run, Gemini Developer API (API key, paid tier) (Flash + 3 Pro), and Jira when a session uses a Jira ticket.
- Security-sensitive surface: identity verification on every request, per-tenant data isolation, secret handling via Secret Manager, and capture of client application data (DOM/screenshots) that requires a documented privacy posture.
- Operator footprint is intentionally minimal: Google login + GCP project ID in, full stack out via Terraform.
