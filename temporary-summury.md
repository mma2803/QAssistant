# QAssistant Specs Summary

This summarizes the OpenSpec requirements under `openspec/changes/qassistant-mvp/specs`.

## Identity And Tenancy

QAssistant is a multi-tenant SaaS where each client/account is isolated as a tenant in GCP Identity Platform. A tenant can own multiple projects, and each project is the unit for optional Jira configuration, app context, capture sessions, artifacts, and code generation.

Provisioning has three levels. A platform-level `super-admin` owns the whole platform: it creates tenants and creates each tenant's first admin. A tenant `admin` administers one tenant and all of its projects, including the tenant's user list, adding users manually from a dashboard screen; admins may assign either the `admin` or `qa-engineer` role to new users and may manage (disable, reset password) any user in their tenant including other admins. A `qa-engineer` cannot provision accounts. There is no self-registration: an account exists only if a `super-admin` or `admin` created it, so a non-provisioned email simply has no account to sign in with.

Within a tenant, users receive `admin` or `qa-engineer` role claims; `super-admin` is a platform-level role outside any tenant. Each user belongs to exactly one tenant and can access only the data of the tenant that invited them. Tenant and project resolution does not rely on email domains; it uses the user's single tenant binding established at invitation. Cross-tenant access is always denied.

## Authentication And Authorization

Authentication uses GCP Identity Platform with the email and password provider. Identity Platform multi-tenancy maps one GCIP tenant to one app tenant; tenant users live inside their GCIP tenant, and the `super-admin` is a project-level user that belongs to no tenant.

User management is done from the dashboard, not a separate console. The dashboard calls the Identity Platform Admin SDK from the backend to create users, set their initial password, assign roles, disable users, and reset passwords. There is no email sending in MVP: initial passwords are set by the creating admin and handed over out of band, and a forgotten password is reset by an admin rather than self-service. Email addresses are not verified, since accounts are admin-created and therefore trusted.

Because the admin who creates or resets a password knows that password, the user must change it before using the app. Identity Platform has no native first-login password-change flag, so this is enforced at the application level: creating or resetting a password sets a `mustChangePassword` marker (custom claim or metadata), and login routes the user to a forced set-new-password step before any app access is granted; completing it clears the marker. The same applies after any admin-driven reset.

Authorization is carried by custom claims baked into the verified ID token: tenant users carry `{ role, tenantId }`, and the `super-admin` carries `{ role: "super-admin" }` with no `tenantId`. The backend verifies the token on every request and enforces tenant and role before any data access; the client never asserts identity. Role and access changes take effect on the next token refresh (up to about one hour); immediate revocation is out of scope for MVP.

The first `super-admin` is bootstrapped by a seed script or Terraform, not through any UI.

MFA (TOTP authenticator app) and federated SSO (SAML/OIDC, per GCIP tenant) are supported by Identity Platform but deferred beyond MVP. The MVP authenticates with email and password plus forced password change only; a configurable password policy and TOTP MFA are the intended next hardening step.

Capture cannot start until the tester selects a project and provides work context. Work context is either a Jira ID validated against the selected project's optional Jira configuration, or a tester-written description. Projects without Jira are allowed and support description-based sessions only.

Valid Jira sessions require the ticket to exist, load metadata, and belong to the selected project's allowed Jira project key. Invalid Jira IDs, Jira outages, bad tokens, wrong Jira project keys, missing projects, and missing work context block capture. Project, Jira ID, and description are frozen once the session starts.

The extension records DOM-replay events as the source of truth and can optionally capture full screenshots. Screenshots have a project-level default (set by an admin) that the tester can override per session at session start. Sensitive DOM data is masked before upload, including password fields, common token/secret fields, and per-project configured selectors. Screenshots are treated as sensitive full-image artifacts and are not promised to be fully redacted. URL-level capture exclusions are deferred post-MVP.

A session ends when the tester presses the stop button or when an inactivity timeout elapses, whichever comes first. On session end, the system automatically generates a Flash-tier summary. A qa-engineer may soft-delete their own sessions; an admin may soft-delete any session in their tenant.

All events and artifacts are stamped server-side with verified `tenantId`, authorized `projectId`, `uid`, `sessionId`, and optional `jiraId`. The client never gets to assert tenant or user identity: identity is derived from the verified auth token, not from request fields. Artifacts are uploaded to GCS under tenant/project/session-namespaced paths, using a scoped write-only upload credential (the client can PUT only to its own session path and cannot read, list, or delete). Testers can use a hotkey to flag important selectors or states for code generation.

## Knowledge And Codegen

Each project has a knowledge hub, edited in the dashboard, with a markdown overview and an optional Secret Manager reference for default credentials (such as test account logins or tokens needed during testing), surfaced as labeled text context for code generation. The knowledge hub is optional: code generation proceeds even when it is empty, using recording and Jira or description context only.

Generation routes by model tier: Flash-tier models handle summaries, analytics, and quick replay scripts; Gemini 3 Pro handles real Playwright tests with assertions. Model identifiers are configurable.

Generated Playwright tests are generated from the recording's DOM-replay flow plus available Jira context, tester description, project knowledge, optional screenshots, and flagged states. Any tenant user may trigger code generation: qa-engineers on their own recordings, admins on any recording in their tenant. Outputs are stored as versioned draft tests with model tier, prompt-input summary, generation timestamp, and review status. Any tenant user may mark a generated test approved or `INTEGRATED`. Approval records the approving user and timestamp but does not claim the test has been executed. `INTEGRATED` is a manual flag indicating the test was added to the automated tests repo; it does not require proof of repository integration.

Captured DOM, screenshots, Jira text, user comments, and project markdown are treated as untrusted context. Prompt input sources are labeled, platform instructions remain separate, and known secrets such as passwords, tokens, API keys, auth headers, and cookies are redacted before model use. Users can comment on generated code and regenerate a new version.

## QA Dashboards

Dashboard access is role-scoped and tenant-scoped. Admins see authorized recordings, artifacts, and productivity across active projects in their tenant. QA engineers see only their own recordings, artifacts, and contribution.

Admins can browse recordings with screenshots, DOM-replay artifacts, selections, and summaries. The dashboard also exposes per-project context by showing the project knowledge hub overview.

Productivity includes an admin-only "Contribution ranking" that is directional and metric-based. Ranking sorts by generated Playwright test count, then total recording duration (raw wall-clock, no idle exclusion in MVP), then recording count. The dashboard must show the metrics used for ordering and avoid hidden weighted scores. Because duration is raw wall-clock, the ranking is explicitly directional and not a precise productivity measure.

## Platform Infrastructure

Infrastructure is Terraform-defined on GCP managed services: Cloud Run, Cloud SQL PostgreSQL, GCS, Secret Manager, and Identity Platform. Terraform should provision from documented operator prerequisites, a valid Google login, and a GCP project ID without undocumented manual console steps. Provisioning relies on the already-authenticated `gcloud` CLI and must fail fast (abort immediately, no interactive retry loop) if authentication is invalid.

The backend API and dashboard run on Cloud Run or an equivalent managed runtime, with a preference for one Cloud Run app service where practical. Services use workload identity to access GCS and Secret Manager; long-lived service account key files are not allowed.

Application metadata is stored in Cloud SQL PostgreSQL. Captured DOM-replay payloads and screenshots are stored in GCS under tenant/project/session paths. Project credentials and secrets are stored in Secret Manager, with only references stored in PostgreSQL.

Tenant isolation in PostgreSQL is enforced by row-level security as the floor: every tenant-scoped table has an RLS policy keyed off a per-request session setting (for example `app.tenant_id`) that the backend sets from the verified token's `tenantId` claim at the start of each request or transaction. Application queries still pass `tenant_id` explicitly as normal, so the explicit predicate and RLS are defense in depth: even if a query forgets its `WHERE tenant_id`, RLS prevents cross-tenant reads or writes. The `super-admin`, having no tenant, uses a separate privileged path rather than relying on the tenant session setting.

Artifacts are retained indefinitely by default in MVP. There is no automatic time-based artifact expiry. Explicit session deletion is the deletion mechanism: soft delete hides a session but keeps metadata and artifacts recoverable for 30 days, then permanent deletion removes session metadata, associated GCS artifacts, and generated tests tied to the session. Disabling a user does not affect their sessions or artifacts; all their data remains visible to tenant admins.

Tenant admins and QA engineers can export a session package as a ZIP archive containing metadata as JSON, DOM-replay artifacts, screenshot files when present, and generated test files. QA engineers may export any session in their tenant, not only their own. Audit logging is out of scope for the MVP.

Admins can toggle a project between active and inactive. Deactivating a project preserves all existing sessions and artifacts and keeps them visible to admins, but blocks new sessions from being started.

## Cross-Cutting Decisions

- Metadata datastore: Cloud SQL PostgreSQL.
- Tenant isolation: PostgreSQL row-level security as the enforcement floor (session setting from the verified `tenantId` claim), with explicit `tenant_id` predicates in queries as defense in depth.
- Artifact store: GCS with tenant/project/session namespacing.
- Secret store: Secret Manager; secrets are not stored in PostgreSQL.
- Identity: GCP Identity Platform multi-tenancy, email and password provider, one GCIP tenant per app tenant. No self-registration, no email sending; admin-created accounts only.
- Authorization: custom claims `{ role, tenantId }` in the verified ID token, enforced server-side per request. Revocation takes effect on next token refresh (no immediate revocation in MVP).
- User management: in-dashboard via Admin SDK (create, set password, assign role, disable, admin-driven password reset). Forced password change on first login and after any admin reset, enforced at the app level via a `mustChangePassword` marker. First super-admin seeded via script/Terraform.
- Roles: platform-level `super-admin`, tenant-scoped `admin` and `qa-engineer`. Each user belongs to exactly one tenant.
- Project access: active tenant users can access active projects in their tenant according to role.
- Jira: optional per project and optional per session.
- Retention: indefinite by default, except explicit session deletion.
- Ranking: visible metric sort (test count, raw recording duration, recording count), directional, not a hidden weighted score.
- Codegen safety: untrusted context labeling plus known-secret redaction.
- Codegen lifecycle: draft, approved, and a manual `INTEGRATED` status.
- Export: admins and QA engineers can export any session in their tenant as a ZIP archive (metadata JSON, DOM-replay files, screenshots, generated tests).
- Session end: explicit stop button or inactivity timeout; summary auto-generated on stop.
- Session deletion: qa-engineers can soft-delete own sessions; admins can soft-delete any session in their tenant.
- Screenshot toggle: project-level default set by admin, overridable per session by the tester at session start.
- Codegen access: any tenant user can trigger generation (qa-engineers on own recordings, admins on any).
- Test approval: any tenant user can mark approved or INTEGRATED.
- Knowledge hub: optional; generation proceeds without it.
- Default credentials: general text context for codegen, stored in Secret Manager, not auto-injected into generated code.
- URL capture exclusions: deferred post-MVP.
- Project lifecycle: admins can deactivate a project; existing data preserved, new sessions blocked.
- Disabled users: data fully preserved and visible to admins.
- Admin role assignment: tenant admins can assign either admin or qa-engineer role; peer admin management is permitted.
- Out of MVP scope: audit logging, coverage analytics, and URL-level capture exclusions.
