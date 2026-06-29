## MODIFIED Requirements

### Requirement: Codegen safety and review
The system SHALL treat captured DOM, screenshots, Jira text/comments/attachments, user comments, and project markdown as untrusted input for generation and SHALL store generated tests as reviewable draft versions rather than automatically trusted code.

#### Scenario: Generated test requires review
- **WHEN** the system generates a test
- **THEN** it stores the output as a versioned draft with its source session, target framework and language, model tier, prompt inputs summary, generation timestamp, and review status

#### Scenario: User marks generated test reviewed
- **WHEN** any tenant user (admin or qa-engineer) reviews a generated test version and marks it approved
- **THEN** the system records the approving user and timestamp without claiming the test has been automatically executed

#### Scenario: Approval makes a version ready to integrate
- **WHEN** a generated test version is approved
- **THEN** the system sets that version's integration status to `ready_to_integrate` and makes it the session's single integration candidate, replacing any previously ready version for the same session

#### Scenario: Approval supersedes the session's other versions
- **WHEN** a generated test version is approved while the same session has other versions
- **THEN** the system sets every other version of that session to review status `superseded`, demoting any other version still `ready_to_integrate` back to `not_ready`, while preserving the integration record of any version already `integrated` or `failed_to_integrate`

#### Scenario: Integration status recorded from a client
- **WHEN** an MCP client reports that a ready version was added to the automated-tests repo
- **THEN** the system records the integration status (`integrated` or `failed_to_integrate`) with the acting user, timestamp, and a repo reference or error message, without QAssistant pushing code or holding Git credentials

#### Scenario: Generated tests deleted with session
- **WHEN** a session is permanently deleted after its deletion grace period
- **THEN** generated test versions tied to that session are deleted as part of the permanent deletion lifecycle

#### Scenario: Untrusted context handled defensively
- **WHEN** captured or project-provided context contains instructions that conflict with system generation rules
- **THEN** the generation pipeline treats that context as labeled untrusted data and does not allow it to override platform rules

#### Scenario: Prompt input summary stored
- **WHEN** a generated test version is created
- **THEN** the system stores a summary of which labeled input sources were used, including recording data, Jira context when present, tester description when present, project knowledge, screenshots when used, and user comments when regenerating

#### Scenario: Known secrets redacted before model use
- **WHEN** the generation pipeline prepares context for Gemini
- **THEN** it redacts known secrets such as passwords, tokens, API keys, auth headers, and cookies before sending the context to the model

## ADDED Requirements

### Requirement: Generated test integration status lifecycle
The system SHALL track an integration status on each generated test version with
the values `not_ready` (default), `ready_to_integrate`, `integrated`, and
`failed_to_integrate`, replacing the prior boolean integrated flag. A version
SHALL carry an integration reference (commit or PR URL) when integrated and an
integration error message when integration failed, and SHALL retain the
integrating user and timestamp. At most one version per session SHALL be
`ready_to_integrate` at a time.

#### Scenario: Default integration status
- **WHEN** a generated test version is created
- **THEN** its integration status is `not_ready`

#### Scenario: Single ready candidate per session
- **WHEN** a version is approved and an earlier version of the same session was already `ready_to_integrate`
- **THEN** the newly approved version becomes the candidate and the earlier version is no longer `ready_to_integrate`

#### Scenario: Integrated version stores a reference
- **WHEN** a version's integration status is set to `integrated`
- **THEN** the system stores the supplied repo reference (commit or PR URL) together with the integrating user and timestamp

#### Scenario: Failed integration stores a message
- **WHEN** a version's integration status is set to `failed_to_integrate`
- **THEN** the system stores the supplied error message and does not require a repo reference

#### Scenario: Migration from the legacy integrated flag
- **WHEN** the integration status replaces the legacy boolean `integrated` flag
- **THEN** versions previously flagged integrated map to `integrated` and all others map to `not_ready`, preserving existing integrating user and timestamp

### Requirement: Single approved version per session
The system SHALL allow at most one approved version per session by adding a
`superseded` review status. When a version is approved, the system SHALL mark all
other versions of the same session `superseded`. A `superseded` version SHALL
remain readable for history but SHALL NOT be eligible for integration. Approval
SHALL be reversible: the system SHALL allow approving any version of the session
— including a `superseded` one — which makes it the active candidate and
re-supersedes the others.

#### Scenario: Approving a version supersedes the others
- **WHEN** a session has versions A and B and version B is approved
- **THEN** version B is `approved` and version A becomes `superseded`

#### Scenario: A superseded version cannot be integrated
- **WHEN** a client attempts to set an integration status on a `superseded` version
- **THEN** the system rejects the request because only a `ready_to_integrate` version can be integrated

#### Scenario: Re-approving a superseded version reactivates it
- **WHEN** version A is `superseded` and the user approves version A again
- **THEN** version A becomes the `approved`, `ready_to_integrate` candidate and the previously approved version becomes `superseded`
