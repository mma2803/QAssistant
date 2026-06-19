-- Initial schema. Mirrors src/db/schema.ts exactly (contract section 3).
-- This file is what `drizzle-kit generate` would emit for the first snapshot;
-- it is committed so the migration runner works without a live generate step.
-- Run as the migrator role (DDL owner).

-- 3.1 tenants
CREATE TABLE "tenants" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "gcip_tenant_id" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenants_status_check" CHECK (status IN ('active', 'inactive'))
);
CREATE UNIQUE INDEX "tenants_gcip_tenant_id_key" ON "tenants" ("gcip_tenant_id");

-- 3.2 tenant_users
CREATE TABLE "tenant_users" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "gcip_uid" text NOT NULL,
  "email" text NOT NULL,
  "role" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "must_change_password" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_users_role_check" CHECK (role IN ('admin', 'qa-engineer')),
  CONSTRAINT "tenant_users_status_check" CHECK (status IN ('active', 'disabled')),
  CONSTRAINT "tenant_users_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict
);
CREATE UNIQUE INDEX "tenant_users_gcip_uid_key" ON "tenant_users" ("gcip_uid");
CREATE UNIQUE INDEX "tenant_users_tenant_id_email_key" ON "tenant_users" ("tenant_id", "email");
CREATE INDEX "tenant_users_tenant_id_idx" ON "tenant_users" ("tenant_id");

-- 3.3 projects
CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "name" text NOT NULL,
  "base_url" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "screenshot_default" boolean DEFAULT false NOT NULL,
  "knowledge_md" text,
  "default_creds_secret_ref" text,
  "masking_selectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "inactivity_timeout_seconds" integer DEFAULT 900 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "projects_status_check" CHECK (status IN ('active', 'inactive')),
  CONSTRAINT "projects_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict
);
CREATE UNIQUE INDEX "projects_tenant_id_name_key" ON "projects" ("tenant_id", "name");
CREATE UNIQUE INDEX "projects_tenant_id_id_key" ON "projects" ("tenant_id", "id");
CREATE INDEX "projects_tenant_id_status_idx" ON "projects" ("tenant_id", "status");

-- 3.4 jira_configs
CREATE TABLE "jira_configs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "base_url" text NOT NULL,
  "project_key" text NOT NULL,
  "token_secret_ref" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "jira_configs_status_check" CHECK (status IN ('active', 'inactive')),
  CONSTRAINT "jira_configs_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE restrict,
  CONSTRAINT "jira_configs_tenant_project_fk"
    FOREIGN KEY ("tenant_id", "project_id") REFERENCES "projects"("tenant_id", "id") ON DELETE restrict
);
CREATE UNIQUE INDEX "jira_configs_project_id_key" ON "jira_configs" ("project_id");
CREATE INDEX "jira_configs_tenant_id_idx" ON "jira_configs" ("tenant_id");

-- 3.5 sessions
CREATE TABLE "sessions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "recorded_by" uuid NOT NULL,
  "jira_id" text,
  "jira_summary" text,
  "jira_status" text,
  "description" text,
  "screenshot_enabled" boolean NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "close_reason" text,
  "summary" text,
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "purge_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sessions_work_context_check" CHECK (jira_id IS NOT NULL OR description IS NOT NULL),
  CONSTRAINT "sessions_status_check" CHECK (status IN ('active', 'completed')),
  CONSTRAINT "sessions_close_reason_check"
    CHECK (close_reason IS NULL OR close_reason IN ('stopped', 'inactivity')),
  CONSTRAINT "sessions_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE restrict,
  CONSTRAINT "sessions_recorded_by_tenant_users_id_fk"
    FOREIGN KEY ("recorded_by") REFERENCES "tenant_users"("id") ON DELETE restrict,
  CONSTRAINT "sessions_tenant_project_fk"
    FOREIGN KEY ("tenant_id", "project_id") REFERENCES "projects"("tenant_id", "id") ON DELETE restrict
);
CREATE INDEX "sessions_tenant_id_project_id_idx" ON "sessions" ("tenant_id", "project_id");
CREATE INDEX "sessions_tenant_id_recorded_by_idx" ON "sessions" ("tenant_id", "recorded_by");
CREATE INDEX "sessions_purge_at_idx" ON "sessions" ("purge_at");
CREATE INDEX "sessions_tenant_id_deleted_at_idx" ON "sessions" ("tenant_id", "deleted_at");

-- 3.6 artifacts
CREATE TABLE "artifacts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "type" text NOT NULL,
  "seq" integer NOT NULL,
  "gcs_path" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "checksum" text,
  "compression" text DEFAULT 'none' NOT NULL,
  "captured_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "artifacts_type_check" CHECK (type IN ('dom_chunk', 'screenshot')),
  CONSTRAINT "artifacts_compression_check" CHECK (compression IN ('none', 'gzip')),
  CONSTRAINT "artifacts_session_id_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE restrict,
  CONSTRAINT "artifacts_tenant_project_fk"
    FOREIGN KEY ("tenant_id", "project_id") REFERENCES "projects"("tenant_id", "id") ON DELETE restrict
);
CREATE UNIQUE INDEX "artifacts_session_id_type_seq_key" ON "artifacts" ("session_id", "type", "seq");
CREATE INDEX "artifacts_tenant_id_idx" ON "artifacts" ("tenant_id");

-- 3.7 flags
CREATE TABLE "flags" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "selector" text NOT NULL,
  "note" text,
  "event_offset_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "flags_session_id_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE restrict,
  CONSTRAINT "flags_tenant_project_fk"
    FOREIGN KEY ("tenant_id", "project_id") REFERENCES "projects"("tenant_id", "id") ON DELETE restrict
);
CREATE INDEX "flags_session_id_idx" ON "flags" ("session_id");

-- 3.9 generation_comments (created before generated_tests to satisfy the
-- generated_tests.source_comment_id FK; generation_comments.generated_test_id
-- FK is added afterwards to break the cycle).
CREATE TABLE "generation_comments" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "generated_test_id" uuid,
  "body" text NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "generation_comments_session_id_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE restrict,
  CONSTRAINT "generation_comments_created_by_tenant_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "tenant_users"("id") ON DELETE restrict
);
CREATE INDEX "generation_comments_session_id_idx" ON "generation_comments" ("session_id");
CREATE INDEX "generation_comments_generated_test_id_idx" ON "generation_comments" ("generated_test_id");

-- 3.8 generated_tests
CREATE TABLE "generated_tests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "kind" text NOT NULL,
  "model_tier" text NOT NULL,
  "model_id" text NOT NULL,
  "code" text NOT NULL,
  "review_status" text DEFAULT 'draft' NOT NULL,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "integrated" boolean DEFAULT false NOT NULL,
  "integrated_by" uuid,
  "integrated_at" timestamp with time zone,
  "prompt_inputs_summary" jsonb NOT NULL,
  "source_comment_id" uuid,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "generated_tests_kind_check" CHECK (kind IN ('playwright_test', 'replay_script')),
  CONSTRAINT "generated_tests_model_tier_check" CHECK (model_tier IN ('flash', 'pro')),
  CONSTRAINT "generated_tests_review_status_check" CHECK (review_status IN ('draft', 'approved')),
  CONSTRAINT "generated_tests_session_id_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE restrict,
  CONSTRAINT "generated_tests_approved_by_tenant_users_id_fk"
    FOREIGN KEY ("approved_by") REFERENCES "tenant_users"("id") ON DELETE restrict,
  CONSTRAINT "generated_tests_integrated_by_tenant_users_id_fk"
    FOREIGN KEY ("integrated_by") REFERENCES "tenant_users"("id") ON DELETE restrict,
  CONSTRAINT "generated_tests_created_by_tenant_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "tenant_users"("id") ON DELETE restrict,
  CONSTRAINT "generated_tests_source_comment_fk"
    FOREIGN KEY ("source_comment_id") REFERENCES "generation_comments"("id") ON DELETE restrict,
  CONSTRAINT "generated_tests_tenant_project_fk"
    FOREIGN KEY ("tenant_id", "project_id") REFERENCES "projects"("tenant_id", "id") ON DELETE restrict
);
CREATE UNIQUE INDEX "generated_tests_session_id_version_key" ON "generated_tests" ("session_id", "version");
CREATE INDEX "generated_tests_tenant_id_project_id_idx" ON "generated_tests" ("tenant_id", "project_id");

-- Add the deferred generation_comments.generated_test_id FK now that
-- generated_tests exists (breaks the cyclic dependency).
ALTER TABLE "generation_comments"
  ADD CONSTRAINT "generation_comments_generated_test_id_generated_tests_id_fk"
  FOREIGN KEY ("generated_test_id") REFERENCES "generated_tests"("id") ON DELETE restrict;
