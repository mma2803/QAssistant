# knowledge-and-codegen Specification

## Purpose
TBD - created by archiving change qassistant-mvp. Update Purpose after archive.
## Requirements
### Requirement: Per-project knowledge hub
The system SHALL let an admin maintain a per-project knowledge hub, edited in the dashboard, containing a markdown overview of how the app works and an optional reference to default credentials (such as test account logins or API tokens needed during testing), stored in Secret Manager and surfaced as labeled text context during code generation. The knowledge hub is optional: code generation MAY proceed when the hub is empty, using only recording and Jira or description context.

#### Scenario: Admin edits project context
- **WHEN** an admin saves the project's markdown overview and default-credentials reference in the dashboard
- **THEN** the system stores the markdown and a Secret Manager reference for the credentials, and makes the context available to code generation

#### Scenario: Code generation proceeds with empty knowledge hub
- **WHEN** a user requests code generation for a session in a project whose knowledge hub has no markdown and no credentials reference
- **THEN** the system generates using recording, Jira context (when present), and tester description only, without blocking on the missing hub content

### Requirement: Gemini model routing
The system SHALL route generation tasks by tier: a Flash-tier model for summaries, analytics, and quick replay scripts, and Gemini 3 Pro for real Playwright tests, with model identifiers configurable rather than hard-coded.

#### Scenario: Quick script uses Flash tier
- **WHEN** a quick replay script is generated for a recording
- **THEN** the system uses the configured Flash-tier model

#### Scenario: Real test uses Pro tier
- **WHEN** a real Playwright test with assertions is generated
- **THEN** the system uses the configured Gemini 3 Pro model

### Requirement: Context-grounded Playwright generation
The system SHALL generate asserted Playwright tests from a recording's DOM-replay flow, inferring assertions from the linked Jira ticket when present, Jira comments/attachments when available, the tester-written description, the project knowledge hub, the project markdown, optional screenshots, and any tester-flagged states.

#### Scenario: Generate code from a recording
- **WHEN** a user requests code generation for a recording
- **THEN** the system produces a versioned Playwright test generated from the recording's DOM-replay flow plus the available Jira ticket/comments/attachments or tester description and project context

#### Scenario: QA engineer triggers generation for own recording
- **WHEN** a qa-engineer requests code generation for a recording they own
- **THEN** the system permits the request and generates the test

#### Scenario: Admin triggers generation for any recording
- **WHEN** an admin requests code generation for any recording in their tenant
- **THEN** the system permits the request and generates the test

#### Scenario: Assertions reflect flagged states
- **WHEN** a recording contains tester-flagged selectors/states
- **THEN** the generated test includes assertions reflecting those flagged states

#### Scenario: Optional screenshots used as compressed context
- **WHEN** screenshots are available and useful for assertion inference
- **THEN** the generation pipeline may use compressed/downsampled screenshot context rather than raw viewport screenshots

### Requirement: Codegen safety and review
The system SHALL treat captured DOM, screenshots, Jira text/comments/attachments, user comments, and project markdown as untrusted input for generation and SHALL store generated Playwright tests as reviewable draft versions rather than automatically trusted code.

#### Scenario: Generated test requires review
- **WHEN** the system generates a Playwright test
- **THEN** it stores the output as a versioned draft with its source session, model tier, prompt inputs summary, generation timestamp, and review status

#### Scenario: User marks generated test reviewed
- **WHEN** any tenant user (admin or qa-engineer) reviews a generated test version and marks it approved
- **THEN** the system records the approving user and timestamp without claiming the test has been automatically executed

#### Scenario: User marks a generated test integrated
- **WHEN** any tenant user flags a generated test as `INTEGRATED`
- **THEN** the system records that the recording's test was added to the automated tests repo as a manual flag, without requiring proof of repository integration

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

### Requirement: Comment and regenerate
The system SHALL allow a user to add comments on generated code and to regenerate it, taking the comments into account.

#### Scenario: Regenerate with a comment
- **WHEN** a user adds a comment on generated code and requests regeneration
- **THEN** the system produces a new version of the code that takes the comment into account

