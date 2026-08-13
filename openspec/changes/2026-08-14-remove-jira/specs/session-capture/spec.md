## MODIFIED Requirements

### Requirement: Work-context-gated session start
The system SHALL require a selected project and work context before any capture
begins. Work context SHALL be a required tester-written description of what is
being tested. A session SHALL NOT start with an empty description. There is no
Jira integration and no ticket-based work context.

#### Scenario: Description starts a session
- **WHEN** a tester selects a project and provides a non-empty testing description and clicks start
- **THEN** the system records the description, mints a session, and begins capture

#### Scenario: Any non-empty description is accepted
- **WHEN** a tester starts a session with any non-empty description
- **THEN** the system accepts the description without requiring a minimum length or structured fields

#### Scenario: Empty description blocks the session
- **WHEN** a tester selects a project but provides no testing description (empty or whitespace-only)
- **THEN** the system blocks the session start and no capture occurs

#### Scenario: No project blocks the session
- **WHEN** a tester attempts to start capture without selecting a project
- **THEN** the system blocks the session start and no capture occurs

#### Scenario: Work context frozen for the session
- **WHEN** a session is in progress
- **THEN** the system does not allow the session's project or testing description to be changed

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

### Requirement: Server-derived identity stamping
The system SHALL stamp every captured event and artifact with `tenantId`, `projectId`, `uid`, and `sessionId`, deriving `tenantId` and `uid` from the verified ID token and authorizing `projectId` server-side before persistence.

#### Scenario: Identity derived from token
- **WHEN** the extension submits captured events with a client-asserted tenant or user value
- **THEN** the system ignores the client-asserted identity and stamps the records using the verified token claims

#### Scenario: Project authorized server-side
- **WHEN** the extension submits captured events for a project
- **THEN** the backend verifies that the project belongs to the token tenant and that the user can access it before storing the events

#### Scenario: Complete stamping
- **WHEN** an event or artifact is persisted
- **THEN** it carries `tenantId`, `projectId`, `uid`, and `sessionId`
