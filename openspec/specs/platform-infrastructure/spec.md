# platform-infrastructure Specification

## Purpose
TBD - created by archiving change qassistant-mvp. Update Purpose after archive.
## Requirements
### Requirement: Docker-Compose-provisioned self-hosted stack
The system SHALL define all infrastructure as a Docker Compose stack (`infra/docker-compose.prod.yml`) running on a single self-hosted VPS, such that the entire stack can be provisioned from documented operator prerequisites (a blank VPS with SSH access) without a managed cloud provider. A one-time OS-level bootstrap script (`infra/vps/bootstrap.sh`) installs Docker, configures the firewall, and creates a dedicated non-root deploy user; `infra/vps/deploy.sh` (invoked by CI/CD on every push to `main`) syncs the reviewed compose/Caddy config from git, backs up the database, applies migrations, and rolls out new container images.

#### Scenario: Fresh provisioning from a blank VPS
- **WHEN** an operator runs `infra/vps/bootstrap.sh` on a blank VPS with documented prerequisites satisfied
- **THEN** the system installs Docker, configures the firewall to allow only SSH/HTTP/HTTPS, and creates the deploy user and application directory layout, without undocumented manual steps

#### Scenario: Automatic deploy on push to main
- **WHEN** a reviewed change is merged to `main`
- **THEN** CI/CD builds and pushes new container images and triggers `infra/vps/deploy.sh` over SSH, which backs up the database, applies migrations, and rolls out the new images

#### Scenario: Repeatable and idempotent bootstrap
- **WHEN** the operator re-runs `infra/vps/bootstrap.sh` against an already-bootstrapped VPS
- **THEN** the system detects existing installation state and makes no destructive changes

### Requirement: Containerized hosting behind a reverse proxy
The system SHALL host the backend API and dashboard web app as containers in a single Docker Compose stack on one VPS, fronted by a Caddy reverse proxy that terminates TLS (automatic HTTPS) and serves the dashboard's static assets, reverse-proxying `/api/v1/*` and `/health` to the API container.

#### Scenario: App endpoints served through the reverse proxy
- **WHEN** a client calls the backend API or loads the dashboard
- **THEN** the request is served by the Caddy reverse proxy over HTTPS, which routes it to the api or web container as appropriate

#### Scenario: Health-gated rollout
- **WHEN** a new API container is starting during a deploy
- **THEN** the reverse proxy's active health check withholds live traffic from that container until it reports healthy

### Requirement: Artifact and secret storage
The system SHALL store application metadata in a self-hosted PostgreSQL instance, captured artifacts in MinIO (S3-compatible object storage), and project credentials/secrets envelope-encrypted (AES-256-GCM) in a dedicated Postgres table, keyed by an encryption key that lives only in the server's persistent `.env` file and is never itself stored in the database. Platform-level secrets, including the Gemini Developer API key used to call the AI model, SHALL also be injected into the service at runtime from that `.env` file rather than embedded in code, configuration files, or committed to git.

This is a deliberate reinterpretation of the prior "SHALL NOT store secrets in Postgres" wording, which was written for a plaintext-exposure threat model: an AES-256-GCM-encrypted value whose key never touches the database is not meaningfully weaker than a separate encrypted file store, and it avoids provisioning and separately backing up a second persistent volume on a single VPS.

#### Scenario: Metadata persisted to PostgreSQL
- **WHEN** the system creates tenants, projects, users, sessions, artifact metadata, generated test versions, or comments
- **THEN** it stores the metadata in the self-hosted PostgreSQL instance with tenant and project identifiers as applicable

#### Scenario: Artifact persisted to MinIO
- **WHEN** the capture pipeline uploads a DOM-replay payload or screenshot
- **THEN** the artifact is written to MinIO under a tenant/project/session-namespaced path via a presigned upload URL

#### Scenario: Project credentials encrypted at rest
- **WHEN** a project's default credentials are saved
- **THEN** the value is AES-256-GCM-encrypted and stored in the `encrypted_secrets` table, and only an opaque reference is kept on the owning row; the encryption key is never stored in Postgres

#### Scenario: Gemini API key stored as a platform secret
- **WHEN** the system needs the Gemini Developer API key to call the AI model
- **THEN** it reads the key from the server's persistent `.env` at runtime, and the key is never stored in PostgreSQL, embedded in code or configuration files, or passed through CI/CD

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

