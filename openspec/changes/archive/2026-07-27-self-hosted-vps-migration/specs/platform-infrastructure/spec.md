## MODIFIED Requirements

### Requirement: Terraform-provisioned managed-service stack
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

### Requirement: Serverless hosting on Cloud Run
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
- **WHEN** a project's default credentials or a Jira token are saved
- **THEN** the value is AES-256-GCM-encrypted and stored in the `encrypted_secrets` table, and only an opaque reference is kept on the owning row; the encryption key is never stored in Postgres

#### Scenario: Gemini API key stored as a platform secret
- **WHEN** the system needs the Gemini Developer API key to call the AI model
- **THEN** it reads the key from the server's persistent `.env` at runtime, and the key is never stored in PostgreSQL, embedded in code or configuration files, or passed through CI/CD

## REMOVED Requirements

### Requirement: Keyless service identity via workload identity
**Reason**: Workload Identity Federation is a GCP-specific mechanism for authenticating a Cloud Run service to other GCP services without a key file. It has no meaning outside GCP: on a single self-hosted VPS, the API, Postgres, and MinIO communicate over the private Docker Compose network, authenticated by credentials (DB password, S3 access key) injected from the server's persistent `.env` — the self-hosted equivalent trust boundary.
**Migration**: No action needed for a first deployment; if this requirement's intent (no long-lived key files committed to git or embedded in images) needs restating, it is now covered by the "Artifact and secret storage" requirement's `.env`-only secret injection.
