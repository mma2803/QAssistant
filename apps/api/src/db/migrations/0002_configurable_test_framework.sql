-- 0002: configurable test framework (change: configurable-test-framework)
-- Adds a tenant-wide default test framework/language and records the framework
-- and language used on each generated test version.
--
-- These columns are FREE-FORM text on purpose: the Generate selector allows a
-- custom framework/language entry, so there is NO CHECK constraint (unlike the
-- other text enums in this schema). Defaults backfill existing rows to the prior
-- hard-coded target (Playwright / TypeScript). Run as the migrator role.

-- Tenant-wide default (any tenant user may change it later via the API).
ALTER TABLE "tenants"
  ADD COLUMN "default_test_framework" text DEFAULT 'Playwright' NOT NULL,
  ADD COLUMN "default_test_language" text DEFAULT 'TypeScript' NOT NULL;

-- Framework/language actually used to produce each generated test version.
-- Existing rows predate the feature and were all Playwright/TypeScript.
ALTER TABLE "generated_tests"
  ADD COLUMN "framework" text DEFAULT 'Playwright' NOT NULL,
  ADD COLUMN "language" text DEFAULT 'TypeScript' NOT NULL;
