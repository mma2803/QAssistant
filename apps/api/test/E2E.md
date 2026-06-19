# QAssistant end-to-end and isolation tests

These tests verify the privacy- and tenancy-critical behavior of the MVP against the
real PostgreSQL schema and the canonical row-level-security policies.

## What runs here

- `test/e2e-flow.test.ts` (task 6.2): the full MVP business sequence, end to end,
  driven through the **real NestJS service layer** (not inline SQL). It invokes
  `AdminService`, `UsersService`, `AuthRoutesService.completePasswordChange`,
  `ProjectsService`, `CaptureService`, `CodegenService` + the codegen worker, and
  `DashboardService`, each inside a real `DbService.withTenant` / `withSuperadmin`
  transaction. Only the external boundaries are faked (Identity Platform via an
  in-memory `FakeFirebase`, GCS via an in-memory reader, Gemini via the
  production offline `FakeGeminiClient`). The flow: provision a tenant + first
  admin; add a qa-engineer with the forced `must_change_password` marker; clear
  the marker via the real forced-password-change service and assert it is cleared
  on **both the GCIP claim and the DB mirror**; create a project; start a project-
  and work-context-gated session (and confirm the service gate rejects a session
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
npm run dev:infra            # docker-compose: postgres + firebase-auth + fake-gcs
npm run db:migrate           # optional; the tests also self-apply migrations
npm test -w @qassistant/api  # runs e2e-flow + rls-isolation
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

## HTTP + Firebase Auth emulator variant (transport layer)

The service-layer e2e covers everything downstream of identity, faking only the
true external boundaries. The one thing it cannot exercise offline is the live
network edges: real Identity Platform ID-token sign-in/verification, the
`must_change_password` HTTP gate as applied by the auth guard, and a real
signed-URL PUT to fake-gcs. Those need the Firebase Auth emulator and a running
Nest server. To run the same flow over HTTP against the emulators:

1. `npm run dev:infra` (starts the Firebase Auth emulator on `:9099` and
   fake-gcs on `:4443`), then `npm run db:migrate`.
2. `npm run seed:super-admin -w @qassistant/api` to create the first super-admin
   in the emulator.
3. Start the API: `npm run start:dev -w @qassistant/api` (env from `.env`:
   `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, `STORAGE_DRIVER=local`,
   `SECRETS_DRIVER=local`, `JIRA_DRIVER=local`).
4. Exercise the REST surface (contract section 4) in order:
   - `POST /api/v1/admin/tenants` (super-admin token) -> tenant + first admin.
   - sign in as the admin against the emulator, then `POST /api/v1/users` to add
     a qa-engineer.
   - sign in as the qa-engineer; the first call returns `must_change_password`;
     `POST /api/v1/auth/complete-password-change` clears it.
   - `POST /api/v1/projects`, then `POST /api/v1/sessions` (work-context gate),
     `GET /api/v1/sessions/{id}/upload-urls`, PUT the bytes to the signed URL,
     `POST /api/v1/sessions/{id}/artifacts`, `POST /api/v1/sessions/{id}/stop`.
   - `POST /api/v1/sessions/{id}/generate`, `POST /api/v1/generations/{id}/approve`.
   - `GET /api/v1/dashboard/sessions` as admin and as the qa-engineer.

The emulator-backed network sign-in / token verification and the real signed-URL
PUT are the only parts not automated here; all of the service logic downstream of
identity is covered by the service-layer e2e test.
