# Configurable test type (UI vs back-end)

Change: `configurable-test-type`. Adds a **test type** dimension to code
generation — `ui` (a UI test from the recorded DOM flow, the original behaviour)
or `backend` (an API/HTTP test grounded in the session's captured network
traffic) — plus the network capture needed to ground backend tests.

It is orthogonal to the existing axes:

| Axis | Values | Meaning |
| --- | --- | --- |
| `testType` | `ui` \| `backend` | UI test vs API test (this change) |
| `kind` | `playwright_test` \| `replay_script` | asserted test vs quick replay (UI strategy) |
| `framework` / `language` | free-form (Playwright/TS default) | target tooling |

## Choosing the test type

Resolved per generation in priority order:

```
per-generation override  →  project default  →  tenant default  →  'ui'
```

- **Per generation**: the dashboard offers a **UI / Back-end** choice next to the
  Generate action, sent as `testType` on `POST /sessions/{id}/generate`. It applies
  to that single generation only and changes no stored default.
- **Project default**: `PUT /projects/{id}/test-framework` accepts `defaultTestType`
  (`null` = inherit the tenant default). Open to any tenant user.
- **Tenant default**: `PUT /tenant/settings` accepts `defaultTestType`. Open to any
  tenant user. Backfilled to `ui` for existing tenants (migration `0008`).

The resolved value is stored on the `generated_tests.test_type` column and in the
version's `promptInputsSummary.testType` for audit.

## Network capture (`network_log` artifact)

Backend tests are grounded in the HTTP traffic the page made during the session.

- **What is captured**: per HTTP call (XHR / `fetch`) — method, URL, status,
  request/response headers, request/response bodies, and timing — stored as a new
  `network_log` artifact (`ARTIFACT_TYPES` now `dom_chunk | screenshot | network_log`).
- **Where**: gzipped JSON under the session prefix at
  `<tenant>/<project>/<session>/net/<seq>.json.gz`, uploaded with the same
  write-only scoped credential, tenant/project/session stamping, and soft-delete
  lifecycle as DOM chunks. No new table — it reuses `artifacts`.
- **MVP gating**: network capture is ON whenever a session records. A project/session
  toggle (mirroring the screenshot setting) is deferred to a later change.

### Privacy / masking

Sensitive data is masked **at capture time** (in the extension, before upload) and
again **before model use** (`redactSecrets()` in the codegen worker — defense in
depth):

- **Headers redacted** (case-insensitive): `Authorization`, `Proxy-Authorization`,
  `Cookie`, `Set-Cookie`, `X-Api-Key`, `X-Auth-Token`.
- **Bodies**: run through the same `redactSecrets()` denylist as DOM/Jira text
  (passwords, tokens, API keys, bearer/JWT shapes).
- Bodies are **best-effort masked, not guaranteed** — same posture as screenshots.

### Caps (per session)

To bound volume on chatty pages, with a logged truncation marker (never a silent drop):

- 32 KB per request body and 32 KB per response body (truncated past that),
- 500 captured calls max,
- 5 MB total network-log size.

## Generation behaviour

- `ui` → unchanged: generated from the DOM-replay flow with the existing UI rules
  (resilient selectors, assert-effect, base URL, invariants, flagged states).
- `backend` → generated from the `recording.network` source with API rules: reproduce
  the recorded calls, assert on response status/headers/body, prefer invariants over
  volatile values, build URLs from the project base URL, never hard-code secrets.
- **No traffic captured** for a backend request → the worker labels the gap and falls
  back to Jira/description/knowledge context; the test is flagged as weakly grounded.
