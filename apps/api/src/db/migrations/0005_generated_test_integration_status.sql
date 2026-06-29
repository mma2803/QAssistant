-- 0005: generated test integration status (change: mcp-integration)
-- Replaces the legacy boolean `integrated` flag on generated_tests with a
-- four-state lifecycle plus a repo reference and an error message:
--   not_ready -> ready_to_integrate -> integrated | failed_to_integrate
-- ready_to_integrate is reached automatically on approval (app layer); the
-- integrated/failed_to_integrate outcome is reported by an MCP client after it
-- pushes the code. QAssistant never pushes to Git and stores no Git credentials.
--
-- No new grant/policy needed: app_user already has UPDATE on generated_tests
-- under the tenant_isolation RLS policy.

ALTER TABLE "generated_tests"
  ADD COLUMN "integration_status" text NOT NULL DEFAULT 'not_ready',
  ADD COLUMN "integration_ref" text,
  ADD COLUMN "integration_error" text;

-- Backfill from the legacy boolean, preserving integrated_by / integrated_at.
UPDATE "generated_tests"
  SET "integration_status" = 'integrated'
  WHERE "integrated" = true;

ALTER TABLE "generated_tests"
  ADD CONSTRAINT "generated_tests_integration_status_check"
  CHECK ("integration_status" IN ('not_ready', 'ready_to_integrate', 'integrated', 'failed_to_integrate'));

-- Drop the legacy boolean now that the status column is backfilled.
ALTER TABLE "generated_tests" DROP COLUMN "integrated";

-- ---------------------------------------------------------------------------
-- ROLLBACK (manual; the runner is forward-only):
--   ALTER TABLE "generated_tests" ADD COLUMN "integrated" boolean NOT NULL DEFAULT false;
--   UPDATE "generated_tests" SET "integrated" = true WHERE "integration_status" = 'integrated';
--   ALTER TABLE "generated_tests" DROP CONSTRAINT "generated_tests_integration_status_check";
--   ALTER TABLE "generated_tests"
--     DROP COLUMN "integration_status",
--     DROP COLUMN "integration_ref",
--     DROP COLUMN "integration_error";
-- ---------------------------------------------------------------------------
