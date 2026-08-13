## MODIFIED Requirements

### Requirement: Read records and generated code
The MCP server SHALL provide a `list_records` tool returning the authenticated
tenant's sessions (with optional filters such as status and project) and a
`get_record(sessionId)` tool returning a single session with its full content:
DOM-replay reference, screenshots, generated code versions, flags, and
description context.

#### Scenario: List records for the tenant
- **WHEN** an authenticated client calls `list_records`
- **THEN** the server returns the tenant's sessions, optionally narrowed by the provided status or project filter

#### Scenario: Fetch a full record
- **WHEN** an authenticated client calls `get_record` with a session id in its tenant
- **THEN** the server returns the session metadata, artifacts, generated code versions, flags, and work context

#### Scenario: Fetch an unknown record
- **WHEN** an authenticated client calls `get_record` with a session id that does not exist in its tenant
- **THEN** the server returns a not-found result without leaking whether the id exists in another tenant
