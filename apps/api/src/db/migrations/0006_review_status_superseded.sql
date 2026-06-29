-- 0006: review_status `superseded` (change: mcp-integration)
-- Adds a third review state so a session has at most one approved version:
-- approving a version marks every other version of the same session
-- `superseded` (app layer, in the approval transaction). This migration only
-- widens the CHECK constraint to accept the new value; no data backfill is
-- needed (existing rows are draft/approved and stay valid).
--
-- No new grant/policy needed: app_user already has UPDATE on generated_tests
-- under the tenant_isolation RLS policy.

ALTER TABLE "generated_tests"
  DROP CONSTRAINT "generated_tests_review_status_check";

ALTER TABLE "generated_tests"
  ADD CONSTRAINT "generated_tests_review_status_check"
  CHECK ("review_status" IN ('draft', 'approved', 'superseded'));

-- ---------------------------------------------------------------------------
-- ROLLBACK (manual; the runner is forward-only):
--   -- Collapse superseded rows back to a value the old constraint allows.
--   UPDATE "generated_tests" SET "review_status" = 'draft'
--     WHERE "review_status" = 'superseded';
--   ALTER TABLE "generated_tests" DROP CONSTRAINT "generated_tests_review_status_check";
--   ALTER TABLE "generated_tests"
--     ADD CONSTRAINT "generated_tests_review_status_check"
--     CHECK ("review_status" IN ('draft', 'approved'));
-- ---------------------------------------------------------------------------
