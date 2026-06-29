## Why

Generated tests are only as robust as the guidance the model receives. Today a
new project's knowledge hub starts empty, so the first generations fall back to
whatever the recorded DOM offers — typically exact-value assertions
(`have.text', '418'`), CSS-class selectors, hard-coded URLs, and trivial
assertions. Teams only discover the fragility after reviewing brittle output. A
default, editable test-generation guidance template shipped in every project
nudges generation toward robust patterns from the very first run, while staying
fully editable per project.

## What Changes

- **Default knowledge template**: a new shared constant
  `DEFAULT_PROJECT_KNOWLEDGE_MD` holds a generic, app-agnostic test-generation
  guidance template (selector strategy, relation-over-exact assertions, base URL
  via environment, no trivial assertions).
- **Seed on project creation**: creating a project initializes its
  `knowledge_md` with the default template instead of leaving it null. The admin
  can edit or clear it afterwards like any knowledge hub content.
- **Backfill empty hubs**: a migration fills the default template into existing
  projects whose `knowledge_md` is null or blank only, never touching a project
  that already has knowledge content.
- The template is **guidance, not a platform rule**: it is surfaced as labeled
  input context and never overrides the generator's hard rules.

## Capabilities

### Modified Capabilities
- `knowledge-and-codegen`: the per-project knowledge hub is initialized with a
  default, editable test-generation guidance template on project creation, and
  existing empty hubs are backfilled with the same template.

## Impact

- **Shared**: new `DEFAULT_PROJECT_KNOWLEDGE_MD` constant in `packages/shared`.
- **API**: `createProject` seeds `knowledge_md` with the template.
- **Migration**: backfill `projects.knowledge_md` where null/blank.
- **No API contract change**: the knowledge hub field, route, and DTOs are
  unchanged; only the default content differs.

## Non-Goals

- Per-tenant or per-framework template variants (one generic template for now;
  teams adapt it per project).
- Enforcing the guidance as hard generation rules (it stays editable guidance).
- Rewriting or regenerating existing generated tests (teams regenerate to pick
  up the guidance).
