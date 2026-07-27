## Why

QAssistant's specs and design lock the entire stack to GCP managed services (Cloud Run, Cloud SQL, GCS, Secret Manager, Identity Platform/Firebase Auth, Cloud Tasks, Workload Identity Federation). The operator wants to drop managed-cloud lock-in entirely and self-host on a VPS they control, with a plain email/password identity provider instead of a managed one, and a CI/CD pipeline that deploys automatically on every push to `main`. This was never actually deployed for real (no Dockerfiles, no applied Terraform state existed before this change), so this is a first real deployment, not a live-data cutover — there is no production data to migrate.

## What Changes

- **BREAKING**: Replace Firebase Auth/Identity Platform with self-hosted, Postgres-backed email/password auth: opaque, DB-backed bearer tokens (access 2h, refresh 30d, rotated with a grace window against benign concurrent-refresh races, reuse detection outside that window), argon2id password hashing, a new `super_admins` table (the super-admin previously lived only in Firebase), a `tenants.slug` login selector replacing the GCIP tenant id, and new `POST /auth/login|refresh|logout` endpoints. Role/tenant/forced-password-change/no-self-registration semantics are unchanged.
- **BREAKING**: Replace Google Cloud Storage with MinIO (S3-compatible), reusing the existing presigned-upload-URL abstraction via `@aws-sdk/client-s3`.
- **BREAKING**: Replace GCP Secret Manager with an envelope-encrypted (AES-256-GCM) Postgres column (`encrypted_secrets`), keyed by a `SECRETS_ENCRYPTION_KEY` that lives only in the server's persistent `.env` and never touches the database — a deliberate, explicitly-recorded reinterpretation of the current spec's literal "SHALL NOT store secrets in Postgres" wording (written for a plaintext-exposure threat model; see design.md).
- **BREAKING**: Replace Cloud Tasks with a Postgres-backed job table (`codegen_jobs`) plus an in-process polling worker — no separate worker container or Redis.
- Replace the Cloud SQL Connector driver with plain host/port Postgres connectivity (the app's own container in prod; already the "local" driver used in dev) — dev and prod now share the identical DB/auth code path.
- Replace `infra/terraform/*` (GCP-specific Terraform modules) and `scripts/bootstrap-gcp.sh` with Dockerfiles, a production `docker-compose.prod.yml`, a Caddy reverse proxy (automatic HTTPS via a `sslip.io` hostname), and VPS bootstrap/deploy/backup scripts under `infra/vps/`.
- Add GitHub Actions CI/CD: `ci.yml` (lint/typecheck/build/test/e2e against Postgres+MinIO) and `deploy.yml` (build+push images to GHCR, SSH-deploy to the VPS on push to `main`, with backup-before-migrate and health-gated rollout).
- Repoint the dashboard, Chrome extension, and MCP client from Firebase/Identity-Toolkit calls to the new `/auth/*` endpoints.
- Local dev `docker-compose.yml` drops the Firebase Auth emulator and `fake-gcs-server`, replacing the latter with MinIO — dev now exercises the same code paths as prod.

### Non-goals

- Multi-VPS high availability or horizontal scaling (single VPS, single instance of every service).
- A managed/hosted identity provider of any kind (explicit operator decision: plain email/password).
- Off-site backups (confirmed decision: local nightly `pg_dump` only, for now).
- Migrating live production data (none exists yet).

## Capabilities

### New Capabilities

_None — this change replaces the backing implementation of existing capabilities; it does not introduce new product behavior._

### Modified Capabilities

- `platform-infrastructure`: replace every GCP-managed-service requirement (Terraform/Cloud-Run/Cloud-SQL/GCS/Secret-Manager/workload-identity) with the self-hosted Docker-Compose/VPS/Postgres/MinIO/envelope-encrypted-Postgres-secrets equivalents.
- `identity-and-tenancy`: replace every Identity-Platform/GCIP/Admin-SDK requirement with the self-hosted password + opaque-bearer-token equivalent, preserving the role/tenant/provisioning/forced-password-change requirements' intent unchanged.

## Impact

- **DB** (`apps/api/src/db/schema.ts`, migration `0009_self_hosted_auth.sql`): drop `tenants.gcip_tenant_id` / `tenant_users.gcip_uid`; add `tenants.slug`, `tenant_users.password_hash`; new `super_admins`, `auth_tokens`, `codegen_jobs`, `encrypted_secrets` tables.
- **API** (`apps/api/src/auth`, `secrets`, `storage`, `codegen`, `db`): new `password.service.ts`, `token.service.ts`, `identity.service.ts` (replace `firebase.service.ts`); new S3 storage driver, Postgres secrets driver, Postgres codegen-job dispatcher + poller; `db/pool.ts` drops the Cloud SQL Connector branch.
- **Clients** (`apps/dashboard`, `apps/extension`, `apps/mcp`): auth clients repointed from Firebase/Identity-Toolkit to the backend's own `/auth/*` endpoints.
- **Infra**: `infra/terraform/*` and `scripts/bootstrap-gcp.sh` removed; `infra/docker/`, `infra/docker-compose.prod.yml`, `infra/vps/*.sh` added; `.github/workflows/{ci,deploy}.yml` added; local `docker-compose.yml` updated.
- **Dependencies**: removed `firebase-admin`, `firebase`, `@google-cloud/*`; added `@node-rs/argon2`, `@nestjs/throttler`, `cookie-parser`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.
- **Docs**: `README.md`, `TECHNICAL_CHOICES.md`, `openspec/config.yaml` context updated to describe the self-hosted architecture.
