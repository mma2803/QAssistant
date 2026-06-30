# session-capture Specification

## Purpose
TBD - created by archiving change qassistant-mvp. Update Purpose after archive.
## Requirements
### Requirement: Work-context-gated session start
The system SHALL require a selected project and work context before any capture begins. Work context SHALL be either a Jira ID validated live against the selected project's optional Jira configuration, or a tester-written description of what is being tested. Projects without Jira are allowed and support description-based sessions.

#### Scenario: Valid project-matched Jira ID starts a session
- **WHEN** a tester enters a Jira ID that exists in Jira and clicks start
- **THEN** the system validates the ticket through the selected project's Jira configuration, confirms the ticket belongs to the selected project's allowed Jira project key, records its metadata, mints a session, and begins capture

#### Scenario: Description starts a non-Jira session
- **WHEN** a tester selects a project, leaves Jira ID empty, and provides a testing description
- **THEN** the system records the description, mints a session without a Jira ID, and begins capture

#### Scenario: Project without Jira starts a description session
- **WHEN** a tester selects a project with no Jira configuration and provides a testing description
- **THEN** the system records the description, mints a session without a Jira ID, and begins capture

#### Scenario: Jira ID on project without Jira blocks the session
- **WHEN** a tester selects a project with no Jira configuration and provides a Jira ID
- **THEN** the system blocks the Jira-based session start and allows the tester to remove the Jira ID and use a non-empty description instead

#### Scenario: Any non-empty description is accepted
- **WHEN** a tester starts a non-Jira session with any non-empty description
- **THEN** the system accepts the description without requiring a minimum length or structured fields

#### Scenario: No Jira and no description blocks the session
- **WHEN** a tester selects a project but provides neither a Jira ID nor a testing description
- **THEN** the system blocks the session start and no capture occurs

#### Scenario: Invalid Jira ID blocks the session
- **WHEN** a tester enters a Jira ID that does not exist
- **THEN** the system blocks the session start and reports the error, and no capture occurs

#### Scenario: Jira outage blocks Jira session
- **WHEN** a tester provides a Jira ID but Jira cannot be reached or the project Jira token fails
- **THEN** the system blocks the Jira-based session start and allows the tester to remove the Jira ID and use a non-empty description instead

#### Scenario: Jira token manually replaced
- **WHEN** a project admin replaces the Jira API token
- **THEN** the system overwrites the stored Secret Manager value used for future Jira validation

#### Scenario: Jira token uses read-only context permissions
- **WHEN** a project admin configures a Jira API token
- **THEN** the system expects read access to issue metadata, issue description, comments, and attachments, and does not require write, transition, or comment-posting permissions

#### Scenario: Wrong Jira project blocks the session
- **WHEN** a tester enters a Jira ID that exists but belongs to a different Jira project key than the selected project allows
- **THEN** the system blocks the session start and no capture occurs

#### Scenario: No project blocks the session
- **WHEN** a tester attempts to start capture without selecting a project
- **THEN** the system blocks the session start before Jira validation and no capture occurs

#### Scenario: Work context frozen for the session
- **WHEN** a session is in progress
- **THEN** the system does not allow the session's project, Jira ID, or testing description to be changed

#### Scenario: Tester explicitly stops a session
- **WHEN** a tester presses the stop button in the extension
- **THEN** the system finalizes the session, stores the end timestamp, and triggers session summary generation

#### Scenario: Session auto-closes on inactivity
- **WHEN** a session has been in progress and no new DOM-replay events have been recorded for the configured inactivity timeout period
- **THEN** the system automatically closes the session as if the tester had stopped it explicitly

#### Scenario: QA engineer soft-deletes own session
- **WHEN** a qa-engineer deletes a session they recorded
- **THEN** the system soft-deletes that session, hiding it from normal dashboards while keeping metadata and artifacts recoverable during the 30-day grace period

#### Scenario: Admin soft-deletes any session in tenant
- **WHEN** a tenant admin deletes any session in their tenant
- **THEN** the system soft-deletes that session regardless of which user recorded it

### Requirement: DOM-replay capture with optional viewport-only screenshots
The system SHALL capture the session as a DOM-replay event stream as the source of truth and SHALL support optional viewport-only screenshots as a human-watchable artifact. Screenshots have a project-level default (set by an admin) and a per-session override that the tester can change at session start.

#### Scenario: Actions captured as DOM events
- **WHEN** a tester clicks, types, or navigates during a session
- **THEN** the system records the corresponding DOM-replay events with selectors

#### Scenario: Screenshots captured when enabled
- **WHEN** a session is being recorded and screenshots are enabled (either by the project default or the tester's per-session override)
- **THEN** the system captures periodic screenshots associated with the session

#### Scenario: Screenshots omitted when disabled
- **WHEN** a session is being recorded and screenshots are disabled (either by the project default or the tester's per-session override)
- **THEN** the system records DOM-replay events without capturing screenshots

#### Scenario: Tester overrides screenshot setting at session start
- **WHEN** a tester starts a session and changes the screenshot setting from the project default
- **THEN** the system records that session with the tester-chosen screenshot setting, and the project default is not affected

### Requirement: Default DOM masking
The system SHALL mask sensitive DOM data by default before upload, including password fields, common token/secret fields, and per-project configured selectors.

#### Scenario: Sensitive DOM field masked
- **WHEN** a recorded page contains a password or per-project configured sensitive selector
- **THEN** the DOM-replay payload excludes or masks the sensitive value before upload

#### Scenario: Screenshot privacy limitation
- **WHEN** screenshots are enabled
- **THEN** the system treats screenshots as sensitive full-image artifacts and does not claim they are fully redacted

### Requirement: Server-derived identity stamping
The system SHALL stamp every captured event and artifact with `tenantId`, `projectId`, `uid`, `sessionId`, and optional `jiraId`, deriving `tenantId` and `uid` from the verified ID token and authorizing `projectId` server-side before persistence.

#### Scenario: Identity derived from token
- **WHEN** the extension submits captured events with a client-asserted tenant or user value
- **THEN** the system ignores the client-asserted identity and stamps the records using the verified token claims

#### Scenario: Project authorized server-side
- **WHEN** the extension submits captured events for a project
- **THEN** the backend verifies that the project belongs to the token tenant and that the user can access it before storing the events

#### Scenario: Complete stamping
- **WHEN** an event or artifact is persisted
- **THEN** it carries `tenantId`, `projectId`, `uid`, `sessionId`, and `jiraId` when the session has one

### Requirement: Hotkey to flag important state
The system SHALL let the tester use a hotkey during capture to flag a selector or state as important, recording the flag for use by code generation.

#### Scenario: Tester flags a selector
- **WHEN** the tester presses the flag hotkey while interacting with an element
- **THEN** the system records a marker on that selector/state within the session

### Requirement: Artifact upload to GCS
The system SHALL upload captured DOM-replay payloads and screenshots to GCS under a tenant/project/session-namespaced path, using a scoped write-only upload credential so the client can PUT only to its own session path and cannot read, list, or delete.

#### Scenario: Session artifacts uploaded
- **WHEN** a session produces DOM-replay payloads and screenshots
- **THEN** the system uploads them to GCS under a path namespaced by tenant, project, and session

#### Scenario: Upload credential is write-only and session-scoped
- **WHEN** the client receives a credential to upload session artifacts
- **THEN** that credential allows PUT only to the session's own path and does not permit reading, listing, or deleting objects

### Requirement: Screenshot compression for LLM use
The system SHALL compress or downsample screenshots before sending them to an LLM when needed for model context limits or cost control.

#### Scenario: Screenshot prepared for model context
- **WHEN** code generation uses screenshots as context and the raw screenshots are too large or too costly
- **THEN** the system sends a compressed or downsampled representation to the LLM rather than the raw full artifact

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

