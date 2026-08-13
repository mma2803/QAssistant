## MODIFIED Requirements

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
