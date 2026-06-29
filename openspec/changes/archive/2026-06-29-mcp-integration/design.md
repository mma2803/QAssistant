## Context

QAssistant captures manual QA sessions and generates reviewable test code, but
the last mile — getting an approved test into the team's automated-test repo —
is manual and untracked. The existing model already has `generated_tests` with
`reviewStatus` (`draft` → `approved`) and a boolean `integrated` flag plus
`integratedBy`/`integratedAt` (`apps/api/src/db/schema.ts`). Sessions have
status `active` | `completed` only.

We are adding an MCP server so an MCP client (Claude Code) can read approved
code, push it to Git with its own credentials, and report the outcome. The
client owns the Git push; QAssistant owns the data and the status of record.
The project is spec-driven and multi-tenant with row-level security and Identity
Platform auth; this design must preserve tenant isolation and store no Git
credentials.

## Goals / Non-Goals

**Goals:**
- Expose read + status-report tools over MCP, scoped to one tenant/user.
- Replace the boolean `integrated` flag with a four-state integration status
  carrying a repo reference and an error message.
- Make `ready_to_integrate` automatic on approval, with one candidate per session.
- Surface a derived integration status column in the records list.
- Keep QAssistant free of Git credentials and Git operations.

**Non-Goals:**
- QAssistant pushing to Git or managing PRs.
- Storing a per-project target-repo reference (the client locates it / asks).
- QAssistant executing generated tests itself or proving CI success. (The MCP
  *client* runs the test locally as the integration gate — see the run-gated
  decision below — but QAssistant never runs tests and asserts no CI outcome.)
- A hosted HTTP MCP transport (MVP is local stdio).

## Decisions

**Decision: New `apps/mcp` package, stdio transport, REST client of the API.**
The MCP server is a thin Node process using the MCP SDK over stdio. It calls the
existing QAssistant REST API rather than touching the database directly, so it
inherits auth, RLS, and validation for free.
- *Alternatives*: (a) Embed MCP inside `apps/api` over HTTP — rejected for MVP
  because it couples transport/hosting/auth to the API and the push must run on
  the client's machine anyway; HTTP can be added later without changing the tool
  contract. (b) Direct DB access from the MCP server — rejected: bypasses RLS
  and the API contract.

**Decision: Explicit `authenticate(email, password, tenantId)` tool.**
The client opens a session by calling `authenticate`; the server exchanges
credentials for an Identity Platform token held in memory for the process
lifetime. Tool calls before authentication are rejected.
- *Alternatives*: credentials via env vars — simpler for a single local user but
  less explicit and awkward for multiple tenants in one client; deferred.
- *Trade-off*: credentials transit the MCP conversation; acceptable for local
  stdio MVP, revisit for hosted transport.

**Decision: `integrationStatus` enum replaces the boolean `integrated`.**
Values `not_ready` | `ready_to_integrate` | `integrated` | `failed_to_integrate`,
added as a new `INTEGRATION_STATUSES` const in `packages/shared` with a DB check
constraint, mirroring how `REVIEW_STATUSES` / `SESSION_STATUSES` are modeled. Add
`integration_ref` (text, commit/PR URL) and `integration_error` (text); keep
`integrated_by` / `integrated_at`.
- *Alternatives*: separate commit/PR/branch columns — rejected as over-modeled
  for MVP; one free-text ref is enough.

**Decision: `ready_to_integrate` is automatic on approval, one per session.**
Approving a version (`reviewStatus = approved`) sets its `integrationStatus` to
`ready_to_integrate` and demotes any previously-ready version of the same session
back to `not_ready`, enforced in the approval service path (single transaction).
- *Alternatives*: a separate explicit "mark ready" action — rejected as an extra
  step with no MVP benefit.

**Decision: one approved version per session via a `superseded` review status.**
A new `superseded` value is added to `REVIEW_STATUSES`
(`['draft', 'approved', 'superseded']`). In the same approval transaction, every
*other* version of the session is set to `reviewStatus = superseded`; any other
version still `ready_to_integrate` is demoted to `not_ready`, while versions
already `integrated` / `failed_to_integrate` keep their integration record (the
`superseded` review status simply marks them as no longer the active candidate).
A `superseded` version cannot be set to an integration status (the integrate
endpoint still requires the source version to be `ready_to_integrate`). Approval
is reversible: approving any version — including a `superseded` one — makes it the
active candidate and re-supersedes the rest, so a wrong approval is never a
dead-end.
- *Alternatives*: (a) revert the other versions to `draft` — rejected: `draft`
  implies "still editable / awaiting review" and hides *why* the version is
  inactive. (b) make `superseded` terminal (never re-approvable) — rejected:
  approving the wrong version would strand the session.
- *Trade-off*: a third review state touches the enum, the DB check constraint,
  and the dashboard badges, but it is the clearest model for "only the latest
  approved version is live."

**Decision: integration is read-only in the dashboard; only the MCP client writes it.**
The dashboard drops the "Integrate" action entirely and renders integration
status / ref / error (and the `superseded` badge) as read-only. Setting an
integration outcome happens solely through the MCP client, which owns the Git
push; the `POST /generations/:id/integrate` API endpoint stays (the MCP client
calls it) but is no longer wired to any dashboard button.
- *Alternatives*: keep a dashboard integrate button that prompts for a
  commit/PR URL — rejected: it lets the dashboard record an integration that no
  Git push backs, contradicting "the client owns the push" and confusing who is
  the source of truth.

**Decision: derived integration status on the records list, computed server-side.**
`dashboardSessionListItemSchema` gains an `integrationStatus` derived field
(`—`/`ready_to_integrate`/`integrated`/`failed_to_integrate`) computed from the
session's candidate version, joined in the dashboard query to avoid N+1.
- *Alternatives*: compute in the dashboard client — rejected; the row already
  aggregates `generatedTestCount` server-side, keep it consistent.

**Decision: target repo located by the client; unresolved → `failed_to_integrate`.**
QAssistant stores nothing about the repo. The client looks in the working
directory, asks the user when it cannot find the repo, and reports
`failed_to_integrate` with a "target repo not found" message if unresolved.

**Decision: `integrated` means "added AND the test passes" (run-gated by the client).**
The MCP client adds the test to the repo, runs that spec, and only on a passing
run pushes with its own Git credentials and reports `integrated` (with the
commit/PR ref). A failing run is reported `failed_to_integrate` with the run
output, and the failing test is not pushed to the main branch; a test that
cannot be run at all (missing toolchain/browsers/env) is also reported
`failed_to_integrate` rather than claimed integrated. This is expressed purely in
the MCP server `instructions` + tool descriptions — the API contract is
unchanged (still `integrated` / `failed_to_integrate` with ref/error), and
QAssistant still never runs tests or pushes.
- *Alternatives*: (a) `integrated` = "pushed", no run — rejected: it only proves
  a file landed in the repo, not that the test works. (b) Add a separate
  "verified/passing" status distinct from `integrated` — rejected as over-modeled
  for MVP; folding the run into the integrate gate keeps one clear success state.
- *Trade-off*: running has real friction (deps, browsers, flakiness) the client
  cannot always satisfy; the "cannot run → failed_to_integrate" fallback keeps
  the status honest instead of optimistic.

## Risks / Trade-offs

- [Boolean→enum migration on existing rows] → Backfill in the same migration:
  `integrated = true` → `integrated`, else `not_ready`; preserve
  `integrated_by`/`integrated_at`. Reversible by mapping back to boolean.
- [Credentials in the MCP conversation] → Limit to local stdio MVP; token kept
  in memory only, never persisted; document for the future hosted transport.
- [Approval flow now has a side effect (demoting prior candidate)] → Do it in one
  transaction with the approval; cover with a negative test asserting only one
  `ready_to_integrate` per session.
- [Client could report a bogus integration ref] → Ref is informational, supplied
  by the client; QAssistant does not assert repository truth (consistent with the
  existing "manual flag, no proof required" stance).
- [New workspace package increases build/CI surface] → Keep `apps/mcp` minimal
  (tools + REST client), reuse `packages/shared` DTOs.

## Migration Plan

1. Add `INTEGRATION_STATUSES` + DTO fields in `packages/shared`.
2. Drizzle migration on `generated_tests`: add `integration_status`
   (default `not_ready`, check constraint), `integration_ref`,
   `integration_error`; backfill from `integrated`; drop `integrated` after
   backfill verified.
3. Wire `ready_to_integrate` into the approval service (transactional demote).
4. Add/extend the API endpoint for setting integration status from a client.
5. Add the derived `integrationStatus` to dashboard list query + DTO + UI column.
6. Build `apps/mcp` (auth, read tools, ready list, status report).
- *Rollback*: revert app code; a down-migration re-adds `integrated` boolean from
  `integration_status IN ('integrated')`.

## MVP Decision Questions

All resolved with the owner during scoping:
- Auth mechanism → explicit `authenticate(email, password, tenantId)` tool. **Resolved.**
- `ready_to_integrate` timing → automatic on approval. **Resolved.**
- Push reference shape → single free-text `integrationRef` (commit or PR URL). **Resolved.**
- Target repo location → not stored by QAssistant; client asks the user. **Resolved.**
- Unresolved repo outcome → `failed_to_integrate` + message. **Resolved.**
- Server form → `apps/mcp`, stdio transport. **Resolved.**
- Records list column → full status (`—`/`ready`/`integrated`/`failed`). **Resolved.**

## Open Questions

- Should the integration-status write be a new dedicated endpoint or an extension
  of the existing review/integrate endpoint? (Implementation detail; resolve in
  tasks/code review.)
- Exact npm dependency for the MCP server SDK and its version pinning.
