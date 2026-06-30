## ADDED Requirements

### Requirement: Network-traffic capture with sensitive-data masking
The system SHALL capture the HTTP request/response traffic the recorded page makes during a session (XHR and `fetch`), recording for each call the method, URL, status code, request and response headers, request and response bodies, and timing, and SHALL upload it as a `network_log` artifact alongside the DOM-replay stream. Sensitive data SHALL be masked before upload: authorization and cookie headers (such as `Authorization`, `Cookie`, `Set-Cookie`) and known token/secret fields in bodies SHALL be redacted, consistent with default DOM masking. Network capture follows the same tenant/project/session stamping, scoped write-only upload, and soft-delete lifecycle as other artifacts.

#### Scenario: Network calls captured during a session
- **WHEN** the recorded page issues XHR or `fetch` HTTP requests during a session
- **THEN** the system records each call's method, URL, status, headers, bodies, and timing and uploads them as a `network_log` artifact for that session

#### Scenario: Sensitive headers and secrets masked before upload
- **WHEN** a captured request or response contains an authorization/cookie header or a known token/secret field
- **THEN** the network-log payload redacts those values before upload

#### Scenario: Network logs stamped and namespaced like other artifacts
- **WHEN** a `network_log` artifact is persisted
- **THEN** it carries `tenantId`, `projectId`, `uid`, `sessionId` (and `jiraId` when present) and is uploaded under the session's tenant/project/session-namespaced GCS path using the scoped write-only credential

#### Scenario: Network logs deleted with the session
- **WHEN** a session is soft-deleted
- **THEN** its `network_log` artifacts are removed on the same lifecycle as its DOM-replay and screenshot artifacts
