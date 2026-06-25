-- 0003: let any tenant user change the tenant-wide codegen default
-- (change: configurable-test-framework). Split from 0002 because 0002 was
-- already applied as columns-only; applied migrations are immutable.
--
-- The base RLS setup (0001) only lets app_user SELECT its own tenant row. The
-- default framework/language is a team preference any tenant user (admin OR
-- qa-engineer) may edit, so widen app_user to a COLUMN-level UPDATE on exactly
-- the two default_* columns (+ updated_at) — name/status/gcip stay super-admin
-- only — plus an UPDATE policy scoped to the caller's own tenant row.
GRANT UPDATE ("default_test_framework", "default_test_language", "updated_at")
  ON TABLE "tenants" TO app_user;

CREATE POLICY "tenant_self_update_defaults" ON "tenants"
  FOR UPDATE
  USING      (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);
