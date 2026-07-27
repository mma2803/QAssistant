# QAssistant end-to-end and isolation tests

These tests verify the privacy- and tenancy-critical behavior of the MVP against the
real PostgreSQL schema and the canonical row-level-security policies.

## What runs here

- `test/e2e-flow.test.ts` (task 6.2): the full MVP business sequence, end to end,
  driven through the **real NestJS service layer** (not inline SQL). It invokes
  `AdminService`, `UsersService`, `AuthRoutesService.completePasswordChange`,
  `ProjectsService`, `CaptureService`, `CodegenService` + the codegen worker, and
  `DashboardService`, each inside a real `DbService.withTenant` / `withSuperadmin`
  transaction. Auth (password hashing, token issuance) is self-hosted and backed
  by the same Postgres these tests already use, so the real
  `PasswordService`/`TokenService`/`IdentityService` are wired in directly — only
  GCS-equivalent reads (an in-memory reader) and Gemini (the production offline
  `FakeGeminiClient`) are faked. The flow: provision a tenant + first admin; add
  a qa-engineer with the forced `must_change_password` marker; clear the marker
  via the real forced-password-change service and assert it is cleared **and**
  the new password hash verifies; create a project; start a project- and
  work-context-gated session (and confirm the service gate rejects a session
  with no work context); register DOM-replay + screenshot artifacts (and confirm a
  gcsPath outside the session prefix is rejected); stop the session; generate and
  approve an asserted Playwright test (Pro tier); then read it back through the
  admin (tenant-wide) and qa-engineer (own-only) dashboard services, deny a second
  qa-engineer, and read the DOM-replay events + screenshot bytes back through the
  artifact-read endpoints.
- `test/rls-isolation.test.ts` (task 6.3): cross-tenant isolation. A tenant-A
  session var cannot read or write tenant-B rows; a missing `app.tenant_id` sees
  zero rows and cannot insert (deny-by-default); the `tenants` read-own-row
  policy exposes only the caller's tenant; a non-provisioned identity resolves to
  no acting user.

The runner is Node's built-in `node:test` (no extra dependency), executed through
`tsx`. The suites bootstrap the three DB roles and apply both migration files
(`0000_init.sql` + `0001_rls.sql`) themselves, so they are self-contained.

## How to run

Bring up the local emulators (or any reachable Postgres) and run the workspace
test script:

```bash
npm run dev:infra            # docker-compose: postgres + minio
npm run db:migrate           # optional; the tests also self-apply migrations
npm test -w @qassistant/api  # runs e2e-flow + rls-isolation + http-e2e
```

Connection defaults match `.env.example` / docker-compose
(`127.0.0.1:5432`, db `qassistant`, bootstrap `postgres/postgres`, roles
`app_user` / `app_superadmin` / `app_migrator`). Override per run with
`TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_NAME`, `TEST_DB_BOOTSTRAP_USER`,
`TEST_DB_BOOTSTRAP_PASSWORD`.

If no Postgres is reachable, both suites skip cleanly (they do not fail), so
`npm test` is safe to run offline.

## Why these run at the database layer

The tenant boundary the MVP depends on is enforced by PostgreSQL RLS, not by
application code, so these tests exercise it directly against the real policy:
the same `set_config('app.tenant_id', ..., true)` transaction the runtime
`DbService.withTenant` opens, the same `app_user` (NOBYPASSRLS) runtime role, and
the same migrations that ship to production. The e2e flow runs the real services
through that exact path, so the service logic and every data invariant it relies
on are verified end to end.

## HTTP transport variant (`test/http-e2e.test.ts`)

The service-layer e2e covers everything downstream of identity, but it never
starts a real Nest server or goes over HTTP. `http-e2e.test.ts` closes that
gap: it starts the real Nest app on an ephemeral port, seeds a super-admin
directly via `IdentityService` (mirroring `src/scripts/seed-super-admin.ts`),
and drives the entire REST surface (contract section 4) through real HTTP
calls and real `/auth/login`-minted access tokens — no emulator of any kind is
needed, since auth is self-hosted. It exercises, in order: `POST
/api/v1/admin/tenants` -> tenant + first admin; admin sign-in and `POST
/api/v1/users` to add a qa-engineer; qa-engineer sign-in returning
`mustChangePassword`, cleared via `POST /api/v1/auth/complete-password-change`;
`POST /api/v1/projects`; `POST /api/v1/sessions` (work-context gate); `GET
/api/v1/sessions/{id}/upload-urls` and a real presigned PUT to MinIO; `POST
/api/v1/sessions/{id}/artifacts`; `POST /api/v1/sessions/{id}/stop`; `POST
/api/v1/sessions/{id}/generate`; `POST /api/v1/generations/{id}/approve`; and
`GET /api/v1/dashboard/sessions` as both admin and qa-engineer. It also
verifies every declared controller route was exercised by at least one test.

This test needs a real MinIO reachable at `127.0.0.1:9000` (`npm run
dev:infra`) in addition to Postgres; it is part of the same `npm test`
run as the other suites and skips cleanly (or fails, under
`REQUIRE_E2E_INFRA=true`) if either is unreachable.
