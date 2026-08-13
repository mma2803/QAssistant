-- 0010: reusable tenant signup links (change: tenant-signup-links).
--
-- The super-admin issues an expiring, reusable link; a recipient redeems it on
-- the public /signup path to self-provision a tenant + first admin. Like
-- auth_tokens, only the SHA-256 hash of the token is ever stored; the plaintext
-- exists only in the issue response. No RLS: this is a platform/plumbing table
-- touched only by internal service code on the app_superadmin (BYPASSRLS) pool
-- (issue/list/revoke) and by the public redeem, which also runs withSuperadmin.

CREATE TABLE "tenant_invitations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "created_by" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "tenant_invitations_token_hash_key" ON "tenant_invitations" ("token_hash");
ALTER TABLE "tenant_invitations"
  ADD CONSTRAINT "tenant_invitations_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "super_admins"("id") ON DELETE RESTRICT;

-- Which signup link (if any) provisioned a tenant. NULL for tenants created
-- directly by the super-admin (plan B). ON DELETE SET NULL so revoking history
-- never blocks; links are long-lived anyway.
ALTER TABLE "tenants" ADD COLUMN "created_via_invitation_id" uuid;
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_created_via_invitation_id_fkey"
  FOREIGN KEY ("created_via_invitation_id") REFERENCES "tenant_invitations"("id") ON DELETE SET NULL;
CREATE INDEX "tenants_created_via_invitation_id_idx" ON "tenants" ("created_via_invitation_id");

-- Grants: platform/plumbing table, same posture as the 0009 tables. Grant DML
-- to both app roles explicitly (ALTER DEFAULT PRIVILEGES only covers tables
-- created by the role that ran it).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_invitations"
  TO app_user, app_superadmin;
