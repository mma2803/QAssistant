## 1. Shared constant

- [x] 1.1 Add `DEFAULT_PROJECT_KNOWLEDGE_MD` (generic, app-agnostic guidance template) to `packages/shared/src` and export it from `index.ts`
- [x] 1.2 Build `@qassistant/shared`

## 2. API: seed on creation

- [x] 2.1 In `createProject` (`apps/api/src/projects/projects.service.ts`), set `knowledgeMd: DEFAULT_PROJECT_KNOWLEDGE_MD` on insert
- [x] 2.2 Confirm `setKnowledge` still lets an admin edit or clear it (null/empty allowed) — no change expected

## 3. Migration: backfill empty hubs

- [x] 3.1 Add migration `0007` backfilling `projects.knowledge_md` with the template where `knowledge_md IS NULL OR btrim(knowledge_md) = ''` (template text inline), with a ROLLBACK block in the repo style
- [x] 3.2 Run `npm run db:migrate` locally and verify the backfill (empty hubs filled, non-empty untouched)

## 4. Tests

- [x] 4.1 Test: a newly created project has `knowledgeMd` equal to the default template
- [x] 4.2 Test: `setKnowledge` can still clear the hub to null/empty after seeding

## 5. Verification

- [x] 5.1 Typecheck API + dashboard; build shared
- [x] 5.2 Confirm no API contract change (knowledge route/DTOs unchanged) and that the template is delivered as labeled input, not a platform rule
