-- 0011: soft-delete for tenants (super-admin can delete a tenant, not just
-- deactivate it). A soft delete sets `deleted_at`: the tenant is hidden from the
-- provisioning list and its users can no longer sign in, but all data is
-- preserved and the action is reversible. No cascade, no data loss.
--
-- app_superadmin already has full DML on `tenants` (0001); app_user only SELECTs
-- its own row, so no extra grant is needed.

ALTER TABLE "tenants" ADD COLUMN "deleted_at" timestamp with time zone;
CREATE INDEX "tenants_deleted_at_idx" ON "tenants" ("deleted_at");
