## Context

Generation today is UI-only: `CodegenWorkerService.gatherSources()` feeds the model the DOM-replay chunks, flagged states, Jira context, description, knowledge hub, base URL, and screenshots, and `prompt-builder.ts` templates UI rules (`platformRulesPro` / `platformRulesFlash`). The configurable-test-framework feature already established the pattern we mirror here: a resolution cascade (per-generation override → project default → tenant default → hard default), tenant/project columns, a `generatedTests` column, a request-body field, and a dashboard selector.

Two things are missing for back-end tests: (1) the capture pipeline records only `dom_chunk` and `screenshot` artifacts — no network traffic exists anywhere today; (2) the prompt has no API-test rules. This change adds both, in one vertical slice, plus the `testType` configurability axis.

This is independent of the existing `kind` (`playwright_test` | `replay_script`, a UI strategy) and of framework/language. `testType` is a new orthogonal dimension.

## Goals / Non-Goals

**Goals:**
- A `testType` dimension (`ui` | `backend`) resolved by the same cascade as framework, configurable at tenant and project level and overridable per generation, surfaced in the dashboard and `POST /sessions/{id}/generate`.
- Capture HTTP request/response traffic during a session and persist it as a new `network_log` artifact, with sensitive headers/bodies masked.
- Back-end generation grounded in captured network traffic, with API-specific prompt rules, while UI generation is unchanged.
- Resolved `testType` recorded on the generated test row and prompt-input summary.

**Non-Goals:**
- WebSocket / gRPC / SSE capture (HTTP req/resp only).
- OpenAPI/Swagger import.
- API-specific framework presets (reuse the existing framework/language selector).
- Changes to the approval/integration lifecycle.

## Decisions

### D1 — Network interception in the extension: `fetch`/XHR monkey-patch in the page context (not `chrome.webRequest`)
`chrome.webRequest` cannot read response bodies in MV3 and is being deprecated for blocking use. The recorder already runs in the page/content context (rrweb), so we wrap `window.fetch` and `XMLHttpRequest` to record method, URL, status, headers, and bodies. This gives us bodies (needed for API assertions) and aligns with the existing in-page capture model.
- *Alternative considered*: `chrome.devtools.network` / HAR — requires devtools open, not viable for background capture. Rejected.
- *Trade-off*: monkey-patching can miss traffic from other contexts (service workers, `sendBeacon`); acceptable for MVP, logged as a known gap.

### D2 — `network_log` reuses the `artifacts` table
Add `'network_log'` to `ARTIFACT_TYPES`; store batched network entries as gzipped JSON under `<tenant>/<project>/<session>/net/<seq>.json.gz`, mirroring `dom_chunk`. No new table — same RLS, stamping, scoped-upload credential, and soft-delete apply automatically. A shared `networkLogEntrySchema` (zod) defines an entry.
- *Alternative*: dedicated `network_logs` table — more columns/migration surface for no benefit at MVP. Rejected.

### D3 — `testType` cascade mirrors framework exactly
Add `tenants.defaultTestType` (NOT NULL default `'ui'`), `projects.defaultTestType` (nullable = inherit), `generatedTests.testType` (NOT NULL default `'ui'`). New `resolveTestType()` alongside `resolveTarget()` in `codegen.service.ts`; resolved value stamped into `GenerateTaskPayload`. Reuse the existing tenant/project settings endpoints (extend their DTOs) rather than new endpoints.
- *Alternative*: fold test type into `kind` — conflates an independent axis (UI strategy) with UI-vs-backend and breaks existing `kind` semantics. Rejected.

### D4 — Prompt branches on `testType` in `prompt-builder.ts`
Add `platformRulesBackend(framework, language)` emphasising: issue the recorded HTTP calls, assert on status/headers/body, prefer invariants over volatile values, target the project base URL, never hard-code secrets. `gatherSources()` gains a network-traffic source used only when `testType === 'backend'`; DOM chunks are used for `ui`. The back-end branch passes redacted network entries (via `redactSecrets()`) as a labeled untrusted input block.

### D5 — Masking at capture time AND model time
Sensitive headers (`Authorization`, `Cookie`, `Set-Cookie`, configurable) and known token/secret body fields are redacted in the extension before upload (defense at source), and the existing `redactSecrets()` runs again before model use (defense in depth), consistent with DOM masking.

## Risks / Trade-offs

- **Sensitive data leaks via network bodies** → Mask sensitive headers/secret fields at capture and re-redact before model use; document that bodies are best-effort masked, not guaranteed (same posture as screenshots).
- **Capture volume / payload size from chatty pages** → Batch and gzip like DOM chunks; cap entries/size per session and log truncation (no silent drop).
- **Back-end test quality when traffic is sparse or auth-heavy** → If a session has no `network_log`, surface that the backend test is weakly grounded; fall back to Jira/description context and label it.
- **Monkey-patch misses some traffic (service workers, beacons)** → Documented known gap for MVP; revisit if it materially hurts test quality.
- **Migration on existing rows** → New columns have defaults (`'ui'`); existing tenants/projects/tests backfill to `ui`, preserving current behaviour.

## Migration Plan

1. Ship shared enums/schemas (`TEST_TYPES`, `network_log`, `networkLogEntrySchema`, DTO fields) — additive, no behaviour change.
2. DB migration adds the three columns with defaults; existing rows become `ui`.
3. API: accept `network_log` uploads, resolve/stamp `testType`, branch prompt. Default `ui` keeps current output identical.
4. Extension: ship network capture (can be feature-flagged at project level if needed).
5. Dashboard: add UI/Back-end selector and tenant/project default settings.
- **Rollback**: columns default to `ui` and the backend branch is inert without network logs, so reverting the extension/dashboard leaves the system behaving exactly as today.

## MVP Decision Questions (resolved)

1. **Network-capture default — RESOLVED (revised at implementation).** MVP: network capture is ON whenever a session is recording — no dedicated project/session toggle yet. The screenshot-style gating (a `projects.networkCaptureDefault` + `sessions.networkCaptureEnabled` toggle with a popup checkbox) is deferred to a later change to keep this slice smaller. (Originally planned as the screenshot model; simplified to unblock the vertical slice.)
2. **Redaction list — RESOLVED.** Fixed default denylist at MVP, no per-project network masking config (deferred to "Later"):
   - Headers redacted (case-insensitive): `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, `X-Auth-Token`.
   - Request and response bodies: reuse the existing `redactSecrets()` patterns (same engine as DOM masking) — no new redaction mechanism.
3. **Per-session caps — RESOLVED.** Conservative caps with logged truncation (never a silent drop):
   - Per-entry body cap: truncate at **32 KB** for the request body and **32 KB** for the response body independently.
   - Max **500** network entries per session.
   - Max **5 MB** total network-log size per session.
   - On exceeding any cap, truncate and record a truncation marker in the artifact.
