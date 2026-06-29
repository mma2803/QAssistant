-- 0007: default project knowledge template (change: default-knowledge-template)
-- Backfills the per-project knowledge hub with a default, editable
-- test-generation guidance template for existing projects whose knowledge_md is
-- null or blank ONLY. Projects that already have knowledge content are left
-- untouched. New projects are seeded by the app layer (projects.service create).
-- The template is guidance surfaced as labeled input context; it never overrides
-- the generator's platform rules. Dollar-quoting ($tpl$) avoids escaping the
-- markdown's apostrophes. Kept generic (no project-specific business examples)
-- and renderer-safe (one bullet per line, no nested lists/blockquotes — the
-- dashboard uses a minimal markdown renderer).
--
-- No new grant/policy needed: app_user already has UPDATE on projects under the
-- tenant_isolation RLS policy.

UPDATE "projects"
  SET "knowledge_md" = $tpl$# Test generation guidelines

Default template — adapt it to this project. This text guides how QAssistant generates tests for this project; it is guidance only and never overrides the platform's generation rules.

## Environment
- Target the project's configured base URL (already provided to generation as `project.base_url`); never hard-code full URLs in tests.
- Read any login from environment variables; never hard-code credentials or secrets.

## Selectors (most robust first)
1. data-test / data-testid / data-cy attributes.
2. Accessible role + name, label, or visible text.
3. CSS class only as a last resort.
- Never use positional selectors (index / nth-child) or auto-generated/hashed class names.

## Assertions — state relations and invariants over hardcoded values
- Avoid non-deterministic values: do not assert exact values for dynamic, generated, or time-dependent data (IDs, timestamps, calculated metrics, random tokens).
- Directional invariant: compare state before and after an operation and assert it increases, decreases, or stays unchanged (e.g. after > before).
- Mathematical invariant: assert relationships with bounded tolerances or ratios rather than hard values (e.g. after equals before times a known factor, within a small margin).
- Contracts and formats when exact values are unpredictable: type correctness (array, object, boolean), structural format (regex, UUID, ISO date), and range boundaries (e.g. within 0 to 100, or string length greater than 0).
- Exact matches by exception only: assert exact values solely for strict business constants, configuration flags, or inputs explicitly mocked or controlled in the test.
- Eliminate noise: never assert on generic orchestrators, structural containers, or implicit lifecycle side-effects that do not directly prove the test case.

## Waiting
- Wait on a meaningful confirmation state, not fixed sleeps.

## Project-specific notes
- Add your conventions here: design system, custom test-id scheme, business rules, and anything app-specific.
$tpl$
  WHERE "knowledge_md" IS NULL OR btrim("knowledge_md") = '';

-- ---------------------------------------------------------------------------
-- ROLLBACK (manual; the runner is forward-only):
--   -- Blank only the rows still holding the seeded template verbatim, so any
--   -- hub edited after the backfill is preserved (compare against the $tpl$ text
--   -- above) and set them back to NULL.
-- ---------------------------------------------------------------------------
