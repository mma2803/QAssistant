## Context

The per-project knowledge hub (`projects.knowledge_md`, nullable text) is already
a labeled input to code generation (`apps/api/src/codegen/codegen-worker.service.ts`
pushes `project.knowledge_md`). It starts empty for new projects. We want a
generic default guidance template present in every project so the first
generations are biased toward robust tests, without changing the API contract.

## Goals / Non-Goals

**Goals:**
- Ship one generic, editable guidance template in every project.
- Seed it at project creation and backfill existing empty hubs.
- Keep it pure guidance — never a platform hard rule.

**Non-Goals:**
- Multiple template variants (per tenant/framework).
- Touching projects that already have knowledge content.
- Regenerating existing tests.

## Decisions

**Decision: canonical template as a shared constant `DEFAULT_PROJECT_KNOWLEDGE_MD`.**
Defined once in `packages/shared` so the API (seed) and, later, the dashboard
(placeholder/preview) reference the same text. The migration's backfill copies
the same content inline (migrations are point-in-time snapshots and must not
import app code).
- *Alternatives*: define it in the API only — rejected so the dashboard can reuse
  it; define it in the DB as a column default — rejected because a long markdown
  default in DDL is awkward and not shared with TS.

**Decision: seed at creation, backfill only null/blank hubs.**
`createProject` sets `knowledgeMd` to the template. The migration updates
`projects` where `knowledge_md IS NULL OR btrim(knowledge_md) = ''`, so any
project that already has content is left untouched.
- *Trade-off*: a project whose admin intentionally cleared the hub to empty will
  be re-seeded by the backfill; acceptable since an empty hub carries no signal,
  and the admin can clear it again.

**Decision: guidance, not a hard rule.**
The template lives in the knowledge hub, which the prompt treats as untrusted
labeled DATA. It cannot override the generator's platform rules; it only steers
style/robustness. This keeps the safety model unchanged.

## Migration Plan

1. Add `DEFAULT_PROJECT_KNOWLEDGE_MD` to `packages/shared` and export it.
2. `createProject` seeds `knowledgeMd` with the constant.
3. Migration `0007` backfills `projects.knowledge_md` where null/blank with the
   same template text (inline), with a ROLLBACK block.
- *Rollback*: revert the seed in app code; the backfill is non-destructive (it
  only filled previously-empty hubs) — a down-migration would blank only the rows
  that still match the template verbatim.

## Open Questions

- Should the dashboard "new project" form preview the template before creation?
  (Deferred; the API seeds it server-side regardless.)
