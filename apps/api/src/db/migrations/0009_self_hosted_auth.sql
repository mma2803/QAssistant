-- 0009: self-hosted auth (change: self-hosted-vps-migration)
-- Replaces GCP Identity Platform/Firebase Auth, Secret Manager, and Cloud
-- Tasks with self-hosted equivalents: password-based auth with opaque
-- DB-backed bearer tokens, an envelope-encrypted Postgres column for secrets,
-- and a Postgres-backed async job queue. Confirmed with the operator that no
-- live production data exists yet, so this is a clean cut (drop the old GCIP
-- columns outright) rather than a two-phase migration. Run as the migrator
-- role.

-- ---------------------------------------------------------------------------
-- tenants: GCIP tenant id -> human-readable slug (the login-time tenant
-- selector). Backfill existing rows (e.g. local dev seed data) from name
-- before enforcing NOT NULL/UNIQUE.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "tenants_gcip_tenant_id_key";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "gcip_tenant_id";

ALTER TABLE "tenants" ADD COLUMN "slug" text;
UPDATE "tenants"
  SET "slug" = lower(regexp_replace(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
    || '-' || substr("id"::text, 1, 8)
  WHERE "slug" IS NULL;
ALTER TABLE "tenants" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" ("slug");

-- ---------------------------------------------------------------------------
-- tenant_users: GCIP uid -> Postgres becomes the sole identity store. The
-- token's `uid` claim is now the tenant_users.id primary key directly (no
-- more indirection through a separate provider uid).
--
-- Existing rows (if any) backfill to an unusable placeholder hash: no known
-- plaintext password exists to hash, so those accounts simply need an admin
-- password reset before they can sign in again (acceptable: no live data).
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "tenant_users_gcip_uid_key";
ALTER TABLE "tenant_users" DROP COLUMN IF EXISTS "gcip_uid";

ALTER TABLE "tenant_users"
  ADD COLUMN "password_hash" text DEFAULT '' NOT NULL;
ALTER TABLE "tenant_users" ALTER COLUMN "password_hash" DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- super_admins: the super-admin previously lived only in Firebase at project
-- level; it needs a real Postgres row now. No RLS (platform-level table,
-- accessed only via the BYPASSRLS/superadmin pool from IdentityService).
-- ---------------------------------------------------------------------------
CREATE TABLE "super_admins" (
  "id" uuid PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  -- Unlike a tenant user's admin-set password, the super-admin's password is
  -- operator-chosen (seed script env vars) -- nothing to force a change from.
  "must_change_password" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "super_admins_email_key" ON "super_admins" ("email");
ALTER TABLE "super_admins"
  ADD CONSTRAINT "super_admins_status_check" CHECK ("status" IN ('active', 'disabled'));

-- ---------------------------------------------------------------------------
-- auth_tokens: opaque bearer tokens (access + refresh) for both tenant_users
-- and super_admins. Only the SHA-256 hash of a token is ever stored.
-- ---------------------------------------------------------------------------
CREATE TABLE "auth_tokens" (
  "id" uuid PRIMARY KEY NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "token_hash" text NOT NULL,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "replaced_by" uuid
);
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens" ("token_hash");
CREATE INDEX "auth_tokens_subject_idx" ON "auth_tokens" ("subject_type", "subject_id", "kind");
ALTER TABLE "auth_tokens"
  ADD CONSTRAINT "auth_tokens_subject_type_check" CHECK ("subject_type" IN ('tenant_user', 'super_admin'));
ALTER TABLE "auth_tokens"
  ADD CONSTRAINT "auth_tokens_kind_check" CHECK ("kind" IN ('access', 'refresh'));

-- ---------------------------------------------------------------------------
-- codegen_jobs: replaces Cloud Tasks. Enqueued by generate/regenerate,
-- claimed by the in-process poller via FOR UPDATE SKIP LOCKED.
-- ---------------------------------------------------------------------------
CREATE TABLE "codegen_jobs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "run_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "codegen_jobs"
  ADD CONSTRAINT "codegen_jobs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT;
CREATE INDEX "codegen_jobs_status_run_at_idx" ON "codegen_jobs" ("status", "run_at");
ALTER TABLE "codegen_jobs"
  ADD CONSTRAINT "codegen_jobs_status_check" CHECK ("status" IN ('pending', 'processing', 'done', 'failed'));

-- ---------------------------------------------------------------------------
-- encrypted_secrets: replaces Secret Manager. `value` is an opaque base64
-- blob (iv + authTag + ciphertext) produced/consumed only by
-- PostgresSecretManager using SECRETS_ENCRYPTION_KEY, which lives in the
-- server .env and is never itself stored here. Deliberate reinterpretation of
-- the "SHALL NOT store secrets in Postgres" wording written for a
-- plaintext-exposure threat model (see openspec change design.md) — a stolen
-- pg_dump alone is useless without the key.
-- ---------------------------------------------------------------------------
CREATE TABLE "encrypted_secrets" (
  "ref" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------------------
-- Grants: the four new tables are platform/plumbing tables, touched only by
-- internal service code on the app_superadmin (BYPASSRLS) pool. No RLS is
-- enabled on them (nothing here is queried by request-time tenant context).
-- ALTER DEFAULT PRIVILEGES from 0001 already granted app_user/app_superadmin
-- DML on tables created after it, but that only applies to tables created by
-- the role that ran ALTER DEFAULT PRIVILEGES; grant explicitly to be safe.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "super_admins", "auth_tokens", "codegen_jobs", "encrypted_secrets"
TO app_user, app_superadmin;
