# platform-infrastructure Specification

## Purpose
TBD - created by archiving change qassistant-mvp. Update Purpose after archive.
## Requirements
### Requirement: Terraform-provisioned managed-service stack
The system SHALL define all cloud infrastructure as Terraform, using GCP managed services (Cloud Run, Cloud SQL PostgreSQL, GCS, Secret Manager, Identity Platform), such that the entire stack can be provisioned from documented operator prerequisites, a valid Google login, and a GCP project ID without undocumented manual console steps. Provisioning SHALL rely on the already-authenticated `gcloud` CLI and SHALL fail fast (abort immediately, no interactive retry loop) if authentication is invalid. The MVP preference is one Cloud Run app service for all application endpoints where practical.

#### Scenario: Fresh deployment from documented prerequisites
- **WHEN** an operator runs the Terraform with documented prerequisites satisfied, a valid Google login, and a GCP project ID
- **THEN** the system provisions the Cloud Run app service topology, Cloud SQL PostgreSQL, GCS buckets, Secret Manager, Identity Platform, and required IAM without undocumented manual cloud-console steps

#### Scenario: Invalid authentication fails fast
- **WHEN** provisioning runs and the `gcloud` CLI is not validly authenticated
- **THEN** the system aborts immediately without entering an interactive retry loop

#### Scenario: Repeatable and idempotent apply
- **WHEN** the operator re-runs Terraform against an already-provisioned project with no config changes
- **THEN** the system reports no changes and leaves existing resources intact

### Requirement: Serverless hosting on Cloud Run
The system SHALL host the backend API and dashboard web app on Cloud Run or an equivalent managed runtime rather than self-managed compute.

#### Scenario: App endpoints served from Cloud Run
- **WHEN** a client calls the backend API or loads a dashboard
- **THEN** the request is served by Cloud Run or an equivalent managed runtime

### Requirement: Artifact and secret storage
The system SHALL store application metadata in Cloud SQL PostgreSQL, captured artifacts in GCS, and project credentials/secrets in Secret Manager, and SHALL NOT store secrets in PostgreSQL. Platform-level secrets, including the Gemini Developer API key used to call the AI model, SHALL also be stored in Secret Manager and injected into the service at runtime rather than embedded in code, configuration files, or PostgreSQL.

#### Scenario: Metadata persisted to PostgreSQL
- **WHEN** the system creates tenants, projects, users, sessions, artifact metadata, generated test versions, or comments
- **THEN** it stores the metadata in Cloud SQL PostgreSQL with tenant and project identifiers as applicable

#### Scenario: Artifact persisted to GCS
- **WHEN** the capture pipeline uploads a DOM-replay payload or screenshot
- **THEN** the artifact is written to a GCS bucket under a tenant/project/session-namespaced path

#### Scenario: Project credentials kept out of the database
- **WHEN** a project's default credentials are saved
- **THEN** they are stored in Secret Manager and only a reference is kept in PostgreSQL

#### Scenario: Gemini API key stored as a platform secret
- **WHEN** the system needs the Gemini Developer API key to call the AI model
- **THEN** it reads the key from Secret Manager at runtime, and the key is never stored in PostgreSQL or embedded in code or configuration files

### Requirement: Row-level-security tenant isolation
The system SHALL enforce tenant isolation in PostgreSQL using row-level security as the floor: every tenant-scoped table SHALL have an RLS policy keyed off a per-request session setting (for example `app.tenant_id`) that the backend sets from the verified token's `tenantId` claim at the start of each request or transaction. Application queries SHALL still pass `tenant_id` explicitly, so the explicit predicate and RLS are defense in depth. The `super-admin`, having no tenant, SHALL use a separate privileged path rather than the tenant session setting.

#### Scenario: Session setting drives RLS
- **WHEN** the backend begins a request or transaction for a tenant user
- **THEN** it sets the per-request session setting from the verified `tenantId` claim and RLS restricts all tenant-scoped reads and writes to that tenant

#### Scenario: Missing explicit predicate still isolated
- **WHEN** a query forgets its explicit `WHERE tenant_id` predicate
- **THEN** RLS still prevents cross-tenant reads or writes

#### Scenario: Super-admin uses a privileged path
- **WHEN** the `super-admin` accesses data
- **THEN** the system uses a separate privileged path rather than relying on the tenant session setting

### Requirement: Indefinite artifact retention by default
The system SHALL keep DOM-replay payloads and screenshots indefinitely by default in MVP, with explicit session deletion as the deletion mechanism.

#### Scenario: Default artifact retention
- **WHEN** a session has not been explicitly deleted
- **THEN** the system keeps that session's DOM-replay payloads and screenshots until explicit session deletion

#### Scenario: No automatic artifact expiry
- **WHEN** a DOM-replay payload or screenshot reaches any age threshold
- **THEN** the system does not delete it automatically unless the associated session has entered permanent deletion

### Requirement: Session deletion lifecycle
The system SHALL support two-step session deletion: soft delete first, then permanent deletion after a 30-day grace period.

#### Scenario: Session soft deleted
- **WHEN** an admin deletes a session
- **THEN** the system hides the session from normal dashboards but keeps metadata and artifacts recoverable during the 30-day grace period

#### Scenario: Session permanently deleted
- **WHEN** the 30-day deletion grace period expires
- **THEN** the system permanently deletes the session metadata, associated GCS artifacts, and generated tests tied to that session

### Requirement: Tenant session export
The system SHALL allow tenant admins and QA engineers to export a session package as a ZIP archive containing session metadata as JSON, DOM-replay artifact files, screenshot files when present, and generated test files. QA engineers MAY export any session in their tenant, not only their own.

#### Scenario: Admin exports session package
- **WHEN** a tenant admin exports a session
- **THEN** the system produces a ZIP archive containing session metadata as JSON, DOM-replay artifacts, screenshots when present, and generated tests, scoped to the admin's tenant

#### Scenario: QA engineer exports any tenant session
- **WHEN** a qa-engineer exports a session that another user in the same tenant recorded
- **THEN** the system produces the ZIP export, since QA engineers may export any session in their tenant

### Requirement: Project activation lifecycle
The system SHALL allow a tenant admin to toggle a project between active and inactive states. Deactivating a project preserves all existing sessions and artifacts and keeps them visible to admins, but prevents new sessions from being started against that project.

#### Scenario: Admin deactivates a project
- **WHEN** a tenant admin deactivates a project
- **THEN** the project's existing sessions, artifacts, and generated tests remain intact and visible to admins and the project's sessions remain exportable, but no new sessions can be started for that project

#### Scenario: Tester cannot start a session in an inactive project
- **WHEN** a tester selects an inactive project and attempts to start a session
- **THEN** the system blocks the session start

#### Scenario: Admin reactivates a project
- **WHEN** a tenant admin reactivates an inactive project
- **THEN** new sessions can be started for that project again

### Requirement: Keyless service identity via workload identity
The system SHALL authenticate Cloud Run services to other GCP services using workload identity and SHALL NOT use long-lived service-account key files.

#### Scenario: Service accesses GCS without a key file
- **WHEN** a Cloud Run service reads or writes GCS or Secret Manager
- **THEN** it authenticates via workload identity and no service-account key file is deployed

