## ADDED Requirements

### Requirement: Integration status column in the records list
The system SHALL show, in the records (sessions) list, a derived integration
status for each session computed from its integration candidate (the approved
version that is `ready_to_integrate`, or the most recent integrated/failed
version). The displayed value SHALL be one of `—` (none), `ready_to_integrate`,
`integrated`, or `failed_to_integrate`. The column SHALL respect existing
role-scoped access: a qa-engineer sees this status only for their own records.

#### Scenario: Session with an approved candidate shows ready
- **WHEN** a session has a version whose integration status is `ready_to_integrate`
- **THEN** the records list shows `ready_to_integrate` for that session

#### Scenario: Session with no approved version shows none
- **WHEN** a session has no version that is ready, integrated, or failed
- **THEN** the records list shows `—` for that session

#### Scenario: Session reflects integrated or failed outcome
- **WHEN** a session's candidate version has been marked `integrated` or `failed_to_integrate`
- **THEN** the records list shows that outcome for the session

#### Scenario: QA engineer scope respected
- **WHEN** a qa-engineer views the records list
- **THEN** the integration status column is shown only for sessions they recorded, consistent with role-scoped access

### Requirement: Integration is read-only in the dashboard
The dashboard SHALL display the integration status, reference, and error of a
generated test version as read-only and SHALL NOT provide any action to set or
change a version's integration status. Setting an integration outcome
(`integrated` / `failed_to_integrate`) SHALL be performed only by the MCP client
that owns the Git push. The dashboard SHALL also show a `superseded` badge on
versions that have been superseded by a later approval.

#### Scenario: No integrate action in the dashboard
- **WHEN** a user views a generated test version in the session detail view
- **THEN** the dashboard shows the version's integration status, reference, and error without offering any button or control to mark it integrated or failed

#### Scenario: Superseded version is shown as superseded
- **WHEN** a session has a version whose review status is `superseded`
- **THEN** the session detail view displays a `superseded` badge on that version and offers no integrate action for it

#### Scenario: Failed version can be re-approved to retry
- **WHEN** a version's integration status is `failed_to_integrate`
- **THEN** the session detail view keeps the integration display read-only but enables re-approving that version, which resets it to `ready_to_integrate` so the integration can be retried by the MCP client
