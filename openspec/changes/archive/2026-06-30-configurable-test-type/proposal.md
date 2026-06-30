## Why

Today the generation pipeline only ever produces **UI tests** (Playwright-style flows driven by the recorded DOM). Teams whose work is API/back-end oriented get no value from a generated UI test. Testers should be able to choose, per generation, whether they want a **UI test** or a **back-end / API test** — and a back-end test must be grounded in real evidence, i.e. the HTTP traffic that happened during the session. That network traffic is not captured anywhere today, so the change must add it.

## What Changes

- Introduce a **test type** dimension on generation: `ui` (current behaviour) or `backend` (API/HTTP test). It is independent from the existing `kind` (`playwright_test` / `replay_script`, a UI strategy) and from the framework/language axis.
- **Capture network traffic** during a recording session: the extension intercepts the HTTP requests/responses (method, URL, status, headers, bodies — masked/redacted) made by the page and uploads them as a new artifact type.
- Add a new artifact type `network_log` to the data model, ingestion endpoint, and GCS upload layout, alongside `dom_chunk` and `screenshot`.
- Feed captured network traffic into codegen as a new input source, and add **back-end-specific prompt rules** so the model emits an API test (request/assert on status, headers, body) instead of a UI flow.
- Make the test type **configurable by default** at tenant and project level (cascade: per-generation override → project default → tenant default → hard default `ui`), mirroring the existing configurable-test-framework design.
- Surface the choice in the **dashboard** (UI vs Back-end selector on the generate action) and in the **`POST /sessions/{id}/generate`** request body.
- Record the resolved test type on the generated test row and in the prompt-inputs summary for audit.
- Privacy: network request/response bodies and sensitive headers (e.g. `Authorization`, `Cookie`, `Set-Cookie`) are masked/redacted before upload and before model use, consistent with existing DOM masking and secret redaction.

### Non-goals

- No new capture of WebSocket / gRPC / server-sent-events traffic (HTTP request/response only for this change).
- No automatic discovery or import of an OpenAPI/Swagger spec (network traffic is the sole back-end source for now).
- No back-end-specific framework presets beyond reusing the existing framework/language selector; API framework presets can come later.
- No change to the integration/approval lifecycle.

### MVP vs later

- **MVP**: network capture (HTTP req/resp, masked) → `network_log` artifact → backend test type selectable per generation and as tenant/project default → backend prompt rules → dashboard selector.
- **Later**: WebSocket capture, OpenAPI import, API-specific framework presets, replay of captured calls.

## Capabilities

### New Capabilities

_None — both affected behaviours extend existing capabilities._

### Modified Capabilities

- `session-capture`: add a requirement for **network-traffic capture** (HTTP request/response interception, masking of sensitive headers/bodies, upload as a `network_log` artifact).
- `knowledge-and-codegen`: add a **selectable test type** requirement (ui | backend, tenant/project/per-generation cascade) and extend context-grounded generation so a back-end test is generated from captured network traffic with API-appropriate assertions.

## Impact

- **Shared** (`packages/shared`): new `TEST_TYPES` enum (`ui` | `backend`), `network_log` added to `ARTIFACT_TYPES`, `generateRequestSchema` + `generateTaskPayloadSchema` gain `testType`, new network-log entry schema, default test type constant.
- **DB** (`apps/api/src/db/schema.ts`): `tenants.defaultTestType`, `projects.defaultTestType` (nullable = inherit), `generatedTests.testType`; migration. `network_log` rows reuse the `artifacts` table (new `type` value).
- **API** (`apps/api/src/codegen`, `tenant-settings`, `projects`, ingestion controller): resolve test-type cascade, accept `network_log` uploads, gather network sources, branch prompt building on test type, new back-end platform rules in `prompt-builder.ts`.
- **Extension** (`apps/extension`): network interception (fetch/XHR or `chrome.webRequest`) in the recorder, masking, batching, and upload of network logs.
- **Dashboard** (`apps/dashboard`): UI/Back-end selector on the generate action; tenant/project default test-type settings.
- **Privacy/security**: sensitive-header and body redaction for network logs; reuse `redactSecrets()` before model use.
- **Specs**: delta updates to `session-capture` and `knowledge-and-codegen`.
