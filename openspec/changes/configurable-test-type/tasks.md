## 1. Decision checkpoint

- [x] 1.1 Resolve the MVP Decision Questions in design.md: network capture follows the screenshot model (project default + per-session override); fixed redaction denylist (`Authorization`/`Proxy-Authorization`/`Cookie`/`Set-Cookie`/`X-Api-Key`/`X-Auth-Token` + `redactSecrets()` on bodies); caps 32 KB/body, 500 entries, 5 MB/session with truncation marker. Recorded in design.md.

## 2. Shared types and schemas

- [x] 2.1 Add `TEST_TYPES = ['ui', 'backend']` and `DEFAULT_TEST_TYPE = 'ui'` to `packages/shared/src/enums.ts`; export a `testTypeSchema`.
- [x] 2.2 Add `'network_log'` to `ARTIFACT_TYPES` in `packages/shared/src/enums.ts`.
- [x] 2.3 Add `networkLogEntrySchema` (method, url, status, request/response headers, request/response bodies, timing) to `packages/shared/src/entities.ts`.
- [x] 2.4 Add `testType` to `generateRequestSchema` and `generateTaskPayloadSchema`; add `testType` to `promptInputsSummarySchema`.
- [x] 2.5 Add `defaultTestType` to the tenant-settings and project-settings DTOs.

## 3. Data model and migration

- [x] 3.1 Add `tenants.defaultTestType` (NOT NULL default `'ui'`), `projects.defaultTestType` (nullable), `generatedTests.testType` (NOT NULL default `'ui'`) in `apps/api/src/db/schema.ts`.
- [x] 3.2 Generate and apply the migration; verify existing rows backfill to `ui`.
- [x] 3.3 Confirm column-scoped GRANT / RLS allow tenant users to read/update the new default columns, matching the framework columns.

## 4. Network capture in the extension

- [x] 4.1 Add `fetch`/XHR interception in the recorder (`apps/extension/src/content/`) capturing method, URL, status, headers, bodies, timing.
- [x] 4.2 Mask sensitive headers (`Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, `X-Auth-Token`, case-insensitive) and run `redactSecrets()` on request/response bodies before the entry leaves the page.
- [x] 4.3 Batch + gzip network entries and upload them as `network_log` artifacts via the existing scoped upload path (`.../net/<seq>.json.gz`); enforce caps (32 KB per body, 500 entries, 5 MB total per session) and record a truncation marker when exceeded.
- [x] 4.4 MVP: capture network whenever a session is recording (no dedicated toggle). The screenshot-style project/session gating + popup checkbox is deferred to a later change (see design.md MVP decision 1).

## 5. Ingestion / artifact API

- [x] 5.1 Accept `network_log` in the artifact ingestion/registration endpoint with the same tenant/project/session stamping and authorization as `dom_chunk`.
- [x] 5.2 Ensure `network_log` artifacts are removed on session soft-delete alongside other artifacts.

## 6. Test-type resolution and codegen

- [x] 6.1 Add `resolveTestType()` in `codegen.service.ts` (override → project → tenant → `'ui'`) and stamp it into `GenerateTaskPayload`.
- [x] 6.2 In `codegen-worker.service.ts` `gatherSources()`, load and redact (`redactSecrets()`) the session's `network_log` entries as a labeled untrusted source used only when `testType === 'backend'`.
- [x] 6.3 Add `platformRulesBackend(framework, language)` in `prompt-builder.ts` and branch prompt assembly on `testType` (UI path unchanged).
- [x] 6.4 Persist resolved `testType` on the `generatedTests` row and in `promptInputsSummary`.
- [x] 6.5 Handle the no-network-traffic case for a backend request: fall back to Jira/description context and label the test as weakly grounded.

## 7. Settings APIs

- [x] 7.1 Extend `PUT /tenant/settings` to accept and persist `defaultTestType`.
- [x] 7.2 Extend the project settings endpoint to accept and persist `defaultTestType` (clearing = inherit tenant).

## 8. Dashboard

- [x] 8.1 Add a UI / Back-end test-type selector next to the Generate action; send `testType` as a per-generation override that does not change defaults.
- [x] 8.2 Show the effective resolved default (project → tenant → `ui`) next to the selector.
- [x] 8.3 Add tenant and project default-test-type settings controls.

## 9. Tests and verification

- [x] 9.1 Unit-test `resolveTestType()` cascade (override, project, tenant, hard default). (`test/configurable-test-type.test.ts`)
- [x] 9.2 Test that a backend generation uses network traffic and produces request/status/body assertions, and that a UI generation is unchanged. (prompt-builder unit test + DB-backed worker e2e in `test/configurable-test-type-e2e.test.ts`)
- [x] 9.3 Network-log masking: capture-side (`maskHeaders`/`redactBody` in the extension, tested in `apps/extension/test/redact.test.ts`) and model-side (`redactSecrets()`, tested in the prompt-builder test).
- [x] 9.4 Test tenant isolation/RLS for the new default columns and for `network_log` artifacts. (tenant-settings round-trip under RLS + cross-tenant denial in the e2e)
- [x] 9.5 Test that resolved `testType` is recorded on the row and in the prompt-input summary.

## 10. Documentation

- [x] 10.1 Document network capture, the `network_log` artifact, and its privacy/masking posture (`docs/configurable-test-type.md` + `TECHNICAL_CHOICES.md`).
- [x] 10.2 Document the test-type setting (tenant/project defaults + per-generation override) for users. (`docs/configurable-test-type.md`)
