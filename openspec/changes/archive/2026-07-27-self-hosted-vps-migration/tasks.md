## 1. Decision checkpoint

- [x] 1.1 Resolve the MVP decision questions in design.md: opaque DB-backed tokens over JWT (D1), refresh rotation with a grace window (D2), envelope-encrypted Postgres column for secrets over a separate encrypted file store (D3), Postgres-backed job queue over Redis/BullMQ (D4), `node:20-bookworm-slim` over Alpine (D5), plain shell over Ansible for VPS provisioning (D6), full-source runtime image over dist-only (D7). Recorded in design.md.

## 2. Database migration and self-hosted auth core

- [x] 2.1 Migration `0009_self_hosted_auth.sql`: drop `tenants.gcip_tenant_id` / `tenant_users.gcip_uid`; add `tenants.slug` (backfilled + unique), `tenant_users.password_hash`; create `super_admins`, `auth_tokens`, `codegen_jobs`, `encrypted_secrets`.
- [x] 2.2 `apps/api/src/auth/password.service.ts`: argon2id hashing with explicit OWASP-baseline params, plus a constant-time dummy-hash verify for login timing safety.
- [x] 2.3 `apps/api/src/auth/token.service.ts`: opaque token issuance/verification, refresh rotation with grace-window reuse handling, revoke-all-for-subject.
- [x] 2.4 `apps/api/src/auth/identity.service.ts`: replaces `firebase.service.ts` with the same method shapes minus the GCIP-tenant parameter.
- [x] 2.5 Update call sites: `auth.guard.ts`, `transaction.interceptor.ts` (the `gcipUid` → `id` lookup), `users.service.ts`, `admin.service.ts`, `auth-routes.service.ts`, `scripts/seed-super-admin.ts`; drop `gcipUid`/`gcipTenantId` from `common/serializers.ts` and `packages/shared/src/entities.ts`.
- [x] 2.6 New `POST /auth/login|refresh|logout` endpoints, rate-limited via `@nestjs/throttler`; refresh token delivered both as an httpOnly cookie (dashboard) and in the response body (extension/MCP).

## 3. Storage, secrets, async jobs, DB connectivity

- [x] 3.1 `S3GcsSigner`/`S3GcsReader`/`S3GcsDeleter` (MinIO via `@aws-sdk/client-s3` + presigner), replacing the `gcs` driver.
- [x] 3.2 `PostgresSecretManager` (AES-256-GCM, `encrypted_secrets` table), replacing `GcpSecretManager`.
- [x] 3.3 `PostgresCloudTasksDispatcher` + `CodegenPollerService` (`FOR UPDATE SKIP LOCKED`, exponential backoff, capped concurrency, Gemini call timeout), replacing `GoogleCloudTasksDispatcher`.
- [x] 3.4 `db/pool.ts` drops the Cloud SQL Connector branch; `config.service.ts` drops every GCP-flavored env var and adds the self-hosted equivalents.

## 4. Clients

- [x] 4.1 Dashboard: `lib/auth-client.ts` replaces `lib/firebase.ts`; `AuthContext.tsx` and `LoginPage.tsx` (tenant slug field) updated; `firebase` dependency removed.
- [x] 4.2 Extension: `background/auth.ts` calls the backend's own `/auth/*` endpoints instead of Identity Toolkit; `StoredTokens` carries role/tenantId/mustChangePassword directly (no more JWT decode); popup tenant field relabeled.
- [x] 4.3 MCP: `auth.ts`/`config.ts`/`server.ts` repointed to `/auth/login`, `tenantId` param renamed `tenantSlug`.

## 5. Containerization and VPS infra

- [x] 5.1 Local `docker-compose.yml`: drop `firebase-auth`, replace `fake-gcs` with `minio`.
- [x] 5.2 `infra/docker/api.Dockerfile`, `infra/docker/web.Dockerfile`, `infra/docker/Caddyfile`.
- [x] 5.3 `infra/docker-compose.prod.yml`: 4 services, memory limits, log rotation, healthchecks, Caddy data persistence.
- [x] 5.4 `infra/vps/bootstrap.sh`, `infra/vps/deploy.sh`, `infra/vps/backup.sh`; delete `infra/terraform/` and `scripts/bootstrap-gcp.sh`.
- [x] 5.5 `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`.

## 6. Documentation

- [x] 6.1 Update `README.md`, `TECHNICAL_CHOICES.md`, `openspec/config.yaml` context.
- [x] 6.2 Write this change's `proposal.md`, `design.md`, delta specs for `platform-infrastructure` and `identity-and-tenancy`.

## 7. Verification

- [ ] 7.1 Rewrite test fixtures that construct rows via `gcipUid`/`gcipTenantId`: `apps/api/test/{rls-isolation,configurable-test-type-e2e,e2e-flow,http-e2e}.test.ts`, `test/helpers/{app,db}.ts`, `e2e/fixtures.ts`, `e2e/browser-granularity.spec.ts`.
- [ ] 7.2 `npm run typecheck && npm run lint && npm run build && npm test` clean across all workspaces.
- [ ] 7.3 `npm run test:e2e` green against Postgres + MinIO (login → project → capture → codegen → dashboard end to end against the new auth).
- [ ] 7.4 Manual exercise: super-admin login → create tenant/first admin → admin login (forced password change) → create qa-engineer → disable a user and confirm their refresh token is immediately rejected → concurrent refresh does not spuriously log out.

## 8. Rollout

- [ ] 8.1 Bootstrap the VPS (`infra/vps/bootstrap.sh`), write the persistent `.env` with generated secrets, install the restricted deploy key, add GitHub Actions secrets.
- [ ] 8.2 Open the PR for human review (per global instructions, no self-merge).
- [ ] 8.3 After merge: confirm `deploy.yml` runs end to end and the site is live at the `sslip.io` hostname with a valid cert.
- [ ] 8.4 Archive this change (`openspec archive self-hosted-vps-migration`) once merged and verified live.
