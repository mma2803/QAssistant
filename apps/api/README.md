# @qassistant/api

QAssistant backend: NestJS + Drizzle ORM, Postgres row-level-security tenant
isolation, Identity Platform token verification. Mirrors
`openspec/changes/qassistant-mvp/data-model-and-api-contract.md`.

## Request lifecycle

Every request to `/api/v1/*` flows through a fixed pipeline. The two halves
(verify identity, then open the tenant-scoped transaction) are split across a
guard and an interceptor that share one request-scoped `RequestContext`.

1. **AuthGuard** (`auth/auth.guard.ts`, registered as `APP_GUARD`)
   - `@Public()` routes (health, Cloud Tasks OIDC worker endpoints) skip
     verification.
   - Otherwise it extracts the `Authorization: Bearer <ID token>`, verifies it
     with `firebase-admin` `verifyIdToken(token, true)` (the local Auth emulator
     is used automatically when `FIREBASE_AUTH_EMULATOR_HOST` is set), and reads
     `role`, `tenantId`, `mustChangePassword` from the verified claims. The
     client never asserts identity (design D5).
   - It populates `RequestContext` with `{ uid, role, tenantId, mustChangePassword }`.
   - It enforces gates: the `must_change_password` allowlist (only
     `@AllowDuringPasswordChange()` routes pass), `@SuperAdminOnly()`, and
     `@Roles(...)`. A super-admin token is rejected on tenant routes and vice
     versa.

2. **TransactionInterceptor** (`auth/transaction.interceptor.ts`, registered as
   `APP_INTERCEPTOR`)
   - **Tenant user:** opens a transaction on the RLS-enforced `app_user` pool
     and runs `set_config('app.tenant_id', tenantId, true)` (transaction-local,
     never plain `SET`, so a pooled connection cannot leak tenant scope, design
     D22). It then resolves the acting `tenant_users` row by `gcip_uid`
     (`RequestContext.actingUserId`) for authorship stamping and rejects
     disabled users. The whole handler runs inside this transaction; it commits
     on success and rolls back on error.
   - **Super-admin:** opens a transaction on the privileged `app_superadmin`
     (`BYPASSRLS`) pool with **no** tenant variable (design D24). Used only by
     the provisioning path.
   - The open transaction is exposed as `RequestContext.dbTx`; feature handlers
     run all queries through it.

3. **Handler** runs with `RequestContext.dbTx` already tenant-scoped. RLS is the
   isolation floor; handlers still pass explicit `WHERE tenant_id` predicates as
   defense in depth (design D10).

4. **HttpExceptionFilter** (`auth/http-exception.filter.ts`) renders every error
   as the contract envelope `{ error: { code, message, details? } }`.

## Database roles (contract section 8)

| Role | RLS | Use |
|------|-----|-----|
| `app_user` | enforced (`NOBYPASSRLS`, not owner) | all tenant-scoped requests |
| `app_superadmin` | `BYPASSRLS` | super-admin provisioning only |
| `app_migrator` | owner / DDL | migrations only, not runtime |

Two in-process pg pools are opened at startup (`db/pool.ts`): one as `app_user`,
one as `app_superadmin`. Connectivity is `local` (host/port) or `cloud-sql`
(`@google-cloud/cloud-sql-connector`, keyless via workload identity) per
`DB_DRIVER`.

## Migrations

- Table DDL lives in `src/db/migrations/0000_init.sql` (mirrors `db/schema.ts`,
  the shape `drizzle-kit generate` produces).
- RLS, roles, and grants are hand-written in `src/db/migrations/0001_rls.sql`
  (RLS is not expressible in the Drizzle schema, contract section 8).
- `npm run db:migrate` applies unapplied `*.sql` files in order as the migrator
  role, tracking them in `__migrations`.
- `npm run db:generate` runs `drizzle-kit generate` to emit new migration SQL
  when the schema changes (follow each new table with a hand-written RLS step).

## Local development

```
cp .env.example .env        # repo root
npm install
npm run dev:infra           # docker compose: postgres + firebase auth + fake-gcs

# Export the env into the shell BEFORE the steps below. The app reads
# process.env directly and does NOT auto-load .env (no dotenv), so the emulator
# hosts (FIREBASE_AUTH_EMULATOR_HOST, STORAGE_EMULATOR_HOST) must be set or
# firebase-admin falls back to real GCP credentials and fails locally.
set -a; . ./.env; set +a    # or run each command with `node --env-file=.env`

npm run db:migrate -w apps/api
npm run seed:super-admin -w apps/api   # first super-admin (no UI path); emulator-backed
npm run start:dev -w apps/api          # API on :8080 (routes under /api/v1)
```

Re-run `set -a; . ./.env; set +a` in any new terminal (it only affects the
current shell). `GET /health` returns `{ status: "ok", db: "up" | "down" }`.

## What lives where

- `config/`  validated env -> typed `AppConfig` (`APP_CONFIG` token).
- `db/`      Drizzle schema, pools, `DbService` transaction wrappers, migrations.
- `auth/`    Firebase verification, request context, guard, interceptor,
             decorators, error envelope.
- `health/`  public health endpoint.
- feature folders (`admin/`, `users/`, `projects/`, `capture/`, `codegen/`,
  `dashboard/`, `jira/`, `storage/`) are placeholders for feature agents; see
  `src/FEATURE_MODULES.md`.
