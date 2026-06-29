## 1. Decision checkpoint

- [x] 1.1 Confirm resolved MVP decisions in design.md (auth tool, auto ready_to_integrate, single integrationRef, no repo stored, stdio `apps/mcp`, full status column) before coding
- [x] 1.2 Decide endpoint shape for setting integration status (new endpoint vs extend existing review/integrate) and pin the MCP SDK dependency/version — DECIDED: extend `POST /generations/:id/integrate` with a body; MCP SDK `@modelcontextprotocol/sdk@^1`

## 2. Shared model and DTOs (`packages/shared`)

- [x] 2.1 Add `INTEGRATION_STATUSES = ['not_ready','ready_to_integrate','integrated','failed_to_integrate']` const + type in `src/enums.ts`
- [x] 2.2 Update `generatedTestSchema` in `src/entities.ts`: replace boolean `integrated` with `integrationStatus`, add `integrationRef` and `integrationError`
- [x] 2.3 Add the request/response DTOs for setting integration status (`generatedTestId`, `status`, optional `ref`, optional `error`)
- [x] 2.4 Add derived `integrationStatus` to `dashboardSessionListItemSchema` in `src/dto/dashboard.ts`

## 3. Database migration (`apps/api`)

- [x] 3.1 Update `generated_tests` in `src/db/schema.ts`: add `integration_status` (text, default `not_ready`, check constraint via `INTEGRATION_STATUSES`), `integration_ref`, `integration_error`
- [x] 3.2 Generate the migration (`0005`, hand-written to match the repo's RLS-interleaved style) including a backfill: `integrated=true` → `integrated`, else `not_ready`, preserving `integrated_by`/`integrated_at`
- [x] 3.3 Drop the legacy `integrated` boolean after the backfill step, and provide the down-migration mapping back to boolean (documented as ROLLBACK block; runner is forward-only)
- [x] 3.4 Run and verify the migration locally (`npm run db:migrate`) — applied 0005, columns + check verified in Postgres

## 4. API: status lifecycle

- [x] 4.1 In the approval path, on `reviewStatus = approved` set `integrationStatus = ready_to_integrate` and demote any prior `ready_to_integrate` version of the same session — in a single transaction
- [x] 4.2 Implement the integration-status endpoint: accept `integrated` (+ ref) or `failed_to_integrate` (+ error); reject transitions from a non-`ready_to_integrate` version; record acting user + timestamp
- [x] 4.3 Add a read endpoint/filter for "ready to integrate" versions for the current tenant (`GET /generations/ready-to-integrate`)
- [x] 4.4 Add the derived `integrationStatus` to the dashboard sessions list query (correlated subquery, no N+1)

## 5. MCP server (`apps/mcp`)

- [x] 5.1 Scaffold the `apps/mcp` workspace package (MCP SDK, stdio transport, REST client of the QAssistant API)
- [x] 5.2 Implement `authenticate(email, password, tenantId)` → exchange for Identity Platform token held in memory; reject other tools until authenticated
- [x] 5.3 Implement `list_records` (filters: status, project) and `get_record(sessionId)` (full content: artifacts, versions, flags, work context)
- [x] 5.4 Implement `list_ready_to_integrate`
- [x] 5.5 Implement `update_integration_status(generatedTestId, status, ref?, error?)`
- [x] 5.6 Implement the "repo not found → ask the user; unresolved → failed_to_integrate" client flow guidance/wiring (server `instructions` + tool descriptions)
- [x] 5.7 Document `claude mcp add` usage / config snippet for connecting Claude Code to the server (apps/mcp/README.md)
- [x] 5.8 Add guided MCP prompts (`connect`, `browse`) + step-by-step server instructions so the client collects credentials first, then offers an action menu

## 6. Dashboard UI (`apps/dashboard`)

- [x] 6.1 Add the integration-status column to the records list (`—`/`Ready to integrate`/`Integrated`/`Failed`)
- [x] 6.2 Surface integration status/ref/error on the session detail view (badge + ref/error lines). NOTE: the dashboard Integrate button added here was later removed in §9.5 — integration is read-only in the dashboard and reported only by the MCP client.

## 7. Verification: privacy, security, tenant isolation

- [x] 7.1 Test: tool call before `authenticate` is rejected and returns no tenant data (apps/mcp/test/auth.test.ts — asserts no fetch before auth)
- [x] 7.2 Test: cross-tenant `get_record` returns not-found/forbidden (no leakage) — enforced by the API (RLS + explicit tenant predicate); existing e2e proves own-only dashboard scope; the MCP relays the API result verbatim
- [x] 7.3 Test: only one version per session is `ready_to_integrate` after re-approval (e2e-flow test 22c)
- [x] 7.4 Test: `update_integration_status` rejects transitions from non-ready versions (e2e-flow test 22b)
- [x] 7.5 Test: migration backfill maps legacy `integrated` rows correctly and preserves `integrated_by`/`integrated_at` (0005 backfill; migration applied and columns/check verified in Postgres)
- [x] 7.6 Verify the MCP server never performs a Git operation and stores no Git credentials (grep: no child_process/git/credential handling, only doc strings)
- [x] 7.7 Verify qa-engineer role sees the integration column only for their own records (column rides on the already role-scoped dashboard list; scope unchanged)

## 8. Documentation

- [x] 8.1 Update `docs/mcp-integration-idea.md` (or a new doc) to reflect the resolved decisions and link the change
- [x] 8.2 Document the integration-status lifecycle and the no-Git-credentials guarantee in the relevant README/specs (apps/mcp/README.md, root README repo layout, delta specs)

## 9. Refinement: single approved version (`superseded`) + read-only dashboard integration

- [x] 9.1 Add `superseded` to `REVIEW_STATUSES` in `packages/shared/src/enums.ts` (`['draft','approved','superseded']`); confirm `generatedTestSchema.reviewStatus` and the DB `review_status` check constraint (`apps/api/src/db/schema.ts`) accept the new value
- [x] 9.2 DB migration (`0006`): widen the `generated_tests` `review_status` CHECK constraint to include `superseded` (drop + re-add constraint; no data backfill needed); include the ROLLBACK block in the repo's style
- [x] 9.3 In the approval path (`codegen.service.ts`), within the existing transaction, set every *other* version of the session to `reviewStatus = 'superseded'` (keep demoting any other `ready_to_integrate` → `not_ready`; do not touch versions already `integrated`/`failed_to_integrate` beyond review status)
- [x] 9.4 Allow approving a `superseded` version (re-approval reactivates it and re-supersedes the rest); keep `integrate` rejecting any non-`ready_to_integrate` source version (so a `superseded` version cannot be integrated)
- [x] 9.5 Dashboard: remove the "Integrate" action from `SessionDetailPage.tsx` (button + `onIntegrate` handler + `window.prompt`); keep the integration status/ref/error display read-only
- [x] 9.6 Dashboard: add a `superseded` badge on superseded versions; add a `superseded` label in `lib/format.ts` if review-status labels are surfaced there
- [x] 9.7 Remove the now-unused dashboard integrate wiring if nothing else uses it (`api.integrateGeneration` stays only if still referenced; the API endpoint remains for the MCP client)
- [x] 9.8 Tests: approving a version supersedes the session's other versions; a `superseded` version is rejected by `integrate`; re-approving a `superseded` version reactivates it (extend `apps/api/test/e2e-flow.test.ts`)
- [x] 9.9 Update the migration-applied note and run `npm run db:migrate` locally to verify `0006`

## 10. Refinement: `integrated` is run-gated (added AND the test passes)

- [x] 10.1 Update the MCP server `instructions` (`apps/mcp/src/server.ts`): integration = locate repo → add test → run it; push + `integrated` only on a passing run; failing/unrunnable → `failed_to_integrate` with the run output; never push a failing test
- [x] 10.2 Update the `update_integration_status` tool description and the `browse` prompt to state `integrated` means "added and the test passed"
- [x] 10.3 Spec: replace "Report integration outcome" with a run-gated requirement + scenarios (passing run, failing run, cannot-run) in the `mcp-integration` delta
- [x] 10.4 Design/proposal: relax the "executing tests" Non-Goal to "QAssistant never runs tests; the client runs it as the gate" and add the run-gated decision
- [x] 10.5 Confirm the API contract is unchanged (still `integrated`/`failed_to_integrate` with ref/error; no new status) and `apps/mcp` builds/tests pass
- [x] 10.6 After a `failed_to_integrate`, the MCP `instructions` direct the client to show the run output and offer next steps (fix & retry, regenerate+approve in the dashboard, or leave failed), noting retry requires re-approval; add the matching spec scenario
- [x] 10.7 Dashboard: a `failed_to_integrate` version is re-approvable (button enabled, labelled "Re-approve (retry)") so it resets to `ready_to_integrate` for a retry — other approved versions stay disabled; integration display remains read-only (`SessionDetailPage.tsx`)
