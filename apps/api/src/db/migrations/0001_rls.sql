-- Hand-written RLS + roles + grants migration (contract sections 1 & 8).
-- RLS is not expressible in the Drizzle schema, so this step follows the table
-- creation. Idempotent: safe to run on a database where docker-compose already
-- bootstrapped the roles.
-- Run as the migrator role (table owner) so ALTER TABLE / CREATE POLICY apply.

-- ---------------------------------------------------------------------------
-- Database roles (contract section 8). NOLOGIN-by-default would block the
-- runtime connection, so app_user / app_superadmin are LOGIN roles. Passwords
-- are set out of band (or by the local bootstrap); here we only ensure the role
-- exists with the right RLS posture.
-- ---------------------------------------------------------------------------
-- Granting or altering BYPASSRLS always requires the SESSION USER to be
-- superuser, even to re-assert an attribute a role already has. This
-- migration runs as app_migrator (not superuser), so it must only touch
-- BYPASSRLS when the role doesn't already have it — the bootstrap step
-- (docker-entrypoint-initdb.d/01-roles.sql locally; the same script mounted
-- into the prod Postgres container) already creates app_superadmin with
-- BYPASSRLS as the actual superuser, so this is normally a no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_superadmin') THEN
    CREATE ROLE app_superadmin LOGIN BYPASSRLS;
  ELSIF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_superadmin' AND rolbypassrls) THEN
    ALTER ROLE app_superadmin BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator LOGIN CREATEDB;
  END IF;
END
$$;

-- app_user must never bypass RLS and must not own tables. Same superuser
-- restriction as above: only touch the attribute if it isn't already correct
-- (a freshly-created LOGIN role already defaults to NOBYPASSRLS).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user' AND rolbypassrls) THEN
    ALTER ROLE app_user NOBYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Schema / sequence usage grants.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO app_user, app_superadmin;

-- ---------------------------------------------------------------------------
-- Table grants.
--   app_user: DML on tenant-scoped tables + SELECT on tenants (own row via RLS).
--   app_superadmin: full DML (BYPASSRLS) for the provisioning path.
-- ---------------------------------------------------------------------------

-- tenants: app_user reads its own row (policy below); app_superadmin manages all.
GRANT SELECT ON TABLE "tenants" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenants" TO app_superadmin;

-- tenant-scoped tables: app_user gets DML; app_superadmin gets DML for provisioning.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "tenant_users", "projects", "jira_configs", "sessions",
  "artifacts", "flags", "generated_tests", "generation_comments"
TO app_user, app_superadmin;

-- ---------------------------------------------------------------------------
-- Enable + FORCE row level security on every tenant-scoped table, plus the
-- read-own-row policy on tenants. FORCE so the table owner is also subject to
-- policy; the only bypass is the BYPASSRLS app_superadmin role.
-- ---------------------------------------------------------------------------

-- tenants: tenant users may read only their own tenant row.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_self_read" ON "tenants"
  FOR SELECT
  USING (id = current_setting('app.tenant_id', true)::uuid);

-- Canonical tenant_isolation policy on every tenant-scoped table.
-- USING + WITH CHECK both keyed on app.tenant_id; current_setting(..., true)
-- returns NULL when unset, making the predicate false (deny-all default).

ALTER TABLE "tenant_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tenant_users"
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "projects"
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "jira_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "jira_configs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "jira_configs"
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "sessions"
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "artifacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "artifacts"
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flags" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "flags"
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "generated_tests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "generated_tests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "generated_tests"
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "generation_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "generation_comments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "generation_comments"
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Default privileges so future tables/sequences created by the migrator are
-- usable by the runtime roles without an explicit grant per object.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user, app_superadmin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user, app_superadmin;
