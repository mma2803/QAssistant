-- 0008: configurable test type (change: configurable-test-type)
-- Adds the UI-vs-backend test-type dimension as a tenant-wide default, an
-- optional per-project override, and the resolved value recorded on each
-- generated test. Also registers the new `network_log` artifact type used to
-- ground backend tests in captured HTTP traffic.
--
-- Resolution order at generation time:
--   per-generation override -> project default -> tenant default -> 'ui'.
-- Defaults backfill existing rows to 'ui', preserving today's UI-only behaviour.
-- Run as the migrator role.

-- Tenant-wide default test type (any tenant user may change it via the API).
ALTER TABLE "tenants"
  ADD COLUMN "default_test_type" text DEFAULT 'ui' NOT NULL;
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_default_test_type_check"
  CHECK ("default_test_type" IN ('ui', 'backend'));

-- Per-project override; NULL = inherit the tenant default. No backfill: existing
-- projects stay NULL and keep inheriting. NULL passes the CHECK (NULL IN (...)
-- evaluates to NULL, not FALSE).
ALTER TABLE "projects"
  ADD COLUMN "default_test_type" text;
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_default_test_type_check"
  CHECK ("default_test_type" IN ('ui', 'backend'));

-- Test type actually used to produce each generated test version. Existing rows
-- predate the feature and were all UI tests.
ALTER TABLE "generated_tests"
  ADD COLUMN "test_type" text DEFAULT 'ui' NOT NULL;
ALTER TABLE "generated_tests"
  ADD CONSTRAINT "generated_tests_test_type_check"
  CHECK ("test_type" IN ('ui', 'backend'));

-- Widen the artifact type CHECK to allow captured network logs alongside
-- dom_chunk/screenshot (change: configurable-test-type).
ALTER TABLE "artifacts"
  DROP CONSTRAINT IF EXISTS "artifacts_type_check";
ALTER TABLE "artifacts"
  ADD CONSTRAINT "artifacts_type_check"
  CHECK ("type" IN ('dom_chunk', 'screenshot', 'network_log'));

-- Let any tenant user edit the tenant-wide default test type. The base RLS setup
-- (0003) granted app_user a COLUMN-level UPDATE on exactly the default_* columns;
-- extend that grant to the new column. The tenant_self_update_defaults policy
-- from 0003 already scopes the UPDATE to the caller's own tenant row.
GRANT UPDATE ("default_test_type") ON TABLE "tenants" TO app_user;

-- No new grant/policy for projects: app_user already has UPDATE on projects under
-- the tenant_isolation RLS policy; the editing route is opened to any tenant user
-- at the controller layer (same as the per-project framework default in 0004).
