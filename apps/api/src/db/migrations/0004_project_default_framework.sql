-- 0004: per-project default test framework/language (change: configurable-test-framework)
-- The default codegen target can now be set per PROJECT. These columns are
-- NULLABLE on purpose: NULL means "inherit the tenant default". Resolution order
-- at generation time is:
--   per-generation override -> project default -> tenant default -> Playwright/TypeScript.
-- No backfill: existing projects stay NULL and keep inheriting the tenant value.
--
-- No new grant/policy needed: app_user already has UPDATE on projects under the
-- tenant_isolation RLS policy; the editing route is opened to any tenant user at
-- the controller layer.
ALTER TABLE "projects"
  ADD COLUMN "default_test_framework" text,
  ADD COLUMN "default_test_language" text;
