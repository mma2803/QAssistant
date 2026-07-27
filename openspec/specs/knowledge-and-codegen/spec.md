# knowledge-and-codegen Specification

## Purpose
TBD - created by archiving change qassistant-mvp. Update Purpose after archive.
## Requirements
### Requirement: Per-project knowledge hub
The system SHALL let an admin maintain a per-project knowledge hub, edited in the dashboard, containing a markdown overview of how the app works and an optional reference to default credentials (such as test account logins or API tokens needed during testing), stored in the encrypted secrets store and surfaced as labeled text context during code generation. The knowledge hub is optional: code generation MAY proceed when the hub is empty, using only recording and Jira or description context. A newly created project SHALL have its knowledge hub markdown initialized with a default, editable test-generation guidance template, and existing projects whose knowledge hub markdown is null or blank SHALL be backfilled with the same template. The template is guidance surfaced as labeled input context and SHALL NOT override the generator's platform rules; an admin MAY edit or clear it like any knowledge hub content.

#### Scenario: Admin edits project context
- **WHEN** an admin saves the project's markdown overview and default-credentials reference in the dashboard
- **THEN** the system stores the markdown and an encrypted-secrets-store reference for the credentials, and makes the context available to code generation

#### Scenario: Code generation proceeds with empty knowledge hub
- **WHEN** a user requests code generation for a session in a project whose knowledge hub has no markdown and no credentials reference
- **THEN** the system generates using recording, Jira context (when present), and tester description only, without blocking on the missing hub content

#### Scenario: New project seeded with the default template
- **WHEN** a project is created
- **THEN** its knowledge hub markdown is initialized with the default test-generation guidance template, which the admin can edit or clear afterwards

#### Scenario: Existing empty knowledge hub backfilled
- **WHEN** the default-template change is applied and a project's knowledge hub markdown is null or blank
- **THEN** the system fills it with the default template, and a project whose knowledge hub already has content is left unchanged

#### Scenario: Default template is guidance only
- **WHEN** code generation runs for a project carrying the default template
- **THEN** the template is supplied as labeled input context and does not override the generator's platform rules

### Requirement: Gemini model routing
The system SHALL route generation tasks by tier: a Flash-tier model for summaries, analytics, and quick replay scripts, and Gemini 3 Pro for real generated tests, with model identifiers configurable rather than hard-coded.

#### Scenario: Quick script uses Flash tier
- **WHEN** a quick replay script is generated for a recording
- **THEN** the system uses the configured Flash-tier model

#### Scenario: Real test uses Pro tier
- **WHEN** a real test with assertions is generated
- **THEN** the system uses the configured Gemini 3 Pro model

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

### Requirement: Comment and regenerate
The system SHALL allow a user to add comments on generated code and to regenerate it, taking the comments into account.

#### Scenario: Regenerate with a comment
- **WHEN** a user adds a comment on generated code and requests regeneration
- **THEN** the system produces a new version of the code that takes the comment into account

### Requirement: Context-grounded test generation
The system SHALL generate asserted tests in the recording's selected test framework and language (Playwright with TypeScript by default) from the available session context, branching on the resolved test type. For a `ui` test it SHALL generate from the recording's DOM-replay flow; for a `backend` test it SHALL generate from the session's captured network traffic (the recorded HTTP request/response calls), emitting an API test that issues requests and asserts on response status, headers, and body rather than a UI flow. In both cases it SHALL infer assertions from the linked Jira ticket when present, Jira comments/attachments when available, the tester-written description, the project knowledge hub, the project markdown, optional screenshots (UI), and any tester-flagged states. The generated test SHALL follow robustness defaults: (1) after an action that changes an observable state (such as a quantity, total, count, selection, or a response field), it SHALL assert that resulting state — exact when the value is controlled by the test, and relative/directional, range, or format otherwise; (2) for UI tests it SHALL use resilient selectors in priority order test-id/data attributes, then accessible role with name/label/visible text, then CSS class as a last resort, and SHALL NOT use positional selectors (index, `nth-child`, `nth-of-type`) or auto-generated/hashed class selectors; (3) it SHALL target the project's base URL rather than hard-coding a full origin; (4) it SHALL prefer state relations and invariants over exact values for dynamic, generated, or time-dependent data; and (5) it SHALL NOT emit trivial assertions on structural containers, generic orchestrators, or on response fields that do not prove the test case. A tester-flagged state with an explicit expected value SHALL still be asserted exactly; the robustness defaults apply to everything the tester did not pin.

#### Scenario: Generate code from a recording
- **WHEN** a user requests code generation for a recording
- **THEN** the system produces a versioned test in the selected framework and language, generated from the recording's DOM-replay flow (UI) or captured network traffic (backend) plus the available Jira ticket/comments/attachments or tester description and project context

#### Scenario: Backend test generated from captured network traffic
- **WHEN** a user requests generation with the test type resolved to `backend`
- **THEN** the system generates an API/HTTP test from the session's captured network traffic that issues requests and asserts on response status, headers, and body

#### Scenario: UI test generated from the DOM flow
- **WHEN** a user requests generation with the test type resolved to `ui`
- **THEN** the system generates a UI test from the recording's DOM-replay flow as before

#### Scenario: QA engineer triggers generation for own recording
- **WHEN** a qa-engineer requests code generation for a recording they own
- **THEN** the system permits the request and generates the test

#### Scenario: Admin triggers generation for any recording
- **WHEN** an admin requests code generation for any recording in their tenant
- **THEN** the system permits the request and generates the test

#### Scenario: Assertions reflect flagged states
- **WHEN** a recording contains tester-flagged selectors/states
- **THEN** the generated test includes assertions reflecting those flagged states

#### Scenario: Action effect is asserted
- **WHEN** the recorded flow performs an action that changes an observable state (e.g. incrementing a quantity or applying a discount), or a captured response reflects such a change
- **THEN** the generated test asserts the resulting state — an exact value when the test controls it (e.g. the quantity after a known number of increments) or a relative/directional, range, or format assertion otherwise (e.g. the total after a discount is lower than before)

#### Scenario: No positional selectors
- **WHEN** a UI test selects elements
- **THEN** it uses test-id/role/label/text selectors (CSS class only as a last resort) and does not use index, `nth-child`, `nth-of-type`, or auto-generated/hashed class selectors

#### Scenario: Base URL is not hard-coded
- **WHEN** the generated test navigates to the application or calls its API
- **THEN** it targets the project's base URL rather than embedding a full hard-coded origin

#### Scenario: Invariants over hardcoded volatile values
- **WHEN** an observed value is dynamic, generated, or time-dependent and was not flagged by the tester
- **THEN** the generated test asserts an invariant, range, or format rather than the exact observed value

#### Scenario: Flagged exact value takes precedence
- **WHEN** a tester flags a state with an explicit expected value
- **THEN** the generated test asserts that exact value, overriding the invariant-over-exact default for that state

#### Scenario: Optional screenshots used as compressed context
- **WHEN** screenshots are available and useful for assertion inference
- **THEN** the generation pipeline may use compressed/downsampled screenshot context rather than raw viewport screenshots

### Requirement: Selectable test framework
The system SHALL let code generation target a selectable test framework and language instead of a fixed one. The target SHALL be resolved per field in priority order: a per-generation override, then the project default, then the tenant default, then Playwright with TypeScript. Each project MAY have a default framework and language (unset = inherit the tenant default), and each tenant SHALL have a tenant-wide default; any tenant user (admin or qa-engineer) MAY change either default. The dashboard SHALL present, next to the Generate action, a selector offering five predefined framework/language options plus a free-form custom entry for an arbitrary framework and language; a choice made there SHALL apply only to that single generation as an override and SHALL NOT change any stored default.

#### Scenario: Resolved default applies when no override is chosen
- **WHEN** a user requests generation without choosing a framework in the Generate selector
- **THEN** the system generates in the project's default framework and language, falling back to the tenant default, then to Playwright with TypeScript

#### Scenario: Project default overrides the tenant default
- **WHEN** a project has its own default framework and language set, differing from the tenant default
- **THEN** generations for sessions of that project use the project default rather than the tenant default

#### Scenario: Cleared project default inherits the tenant default
- **WHEN** a project's default framework and language are unset
- **THEN** generations for that project use the tenant default

#### Scenario: Per-generation override does not change any default
- **WHEN** a user picks one of the offered framework/language options next to the Generate action and runs that generation
- **THEN** that single generation targets the chosen framework and language, and the project and tenant defaults remain unchanged for subsequent generations

#### Scenario: Any tenant user changes a default
- **WHEN** any tenant user, whether admin or qa-engineer, sets the project's or the tenant's default framework and language
- **THEN** the system records the new default and applies it to subsequent generations that do not specify an override

#### Scenario: Custom free-form framework is accepted as untrusted text
- **WHEN** a user enters a custom framework and language in the free-form field
- **THEN** the system records that choice and generates in it, treating the free-form value as labeled untrusted input and making no guarantee that the model fully supports it

#### Scenario: Selector offers predefined options plus a free-form entry
- **WHEN** a user opens the framework selector next to the Generate action
- **THEN** the system offers five predefined framework/language options and a free-form custom entry for an arbitrary framework and language

### Requirement: Selectable test type
The system SHALL let code generation target a selectable test type: `ui` (a UI test driven by the recorded DOM flow, the existing behaviour) or `backend` (an API/HTTP test grounded in the session's captured network traffic). The test type SHALL be resolved in priority order: a per-generation override, then the project default, then the tenant default, then `ui`. Each project MAY have a default test type (unset = inherit the tenant default), and each tenant SHALL have a tenant-wide default; any tenant user (admin or qa-engineer) MAY change either default. The dashboard SHALL present, next to the Generate action, a choice between UI and Back-end test; a choice made there SHALL apply only to that single generation as an override and SHALL NOT change any stored default. The resolved test type SHALL be recorded on the generated test and in its prompt-input summary. The test type is independent from the framework/language selection and from the `playwright_test`/`replay_script` kind.

#### Scenario: Resolved default applies when no override is chosen
- **WHEN** a user requests generation without choosing a test type in the Generate selector
- **THEN** the system uses the project's default test type, falling back to the tenant default, then to `ui`

#### Scenario: Project default overrides the tenant default
- **WHEN** a project has its own default test type set, differing from the tenant default
- **THEN** generations for sessions of that project use the project default rather than the tenant default

#### Scenario: Cleared project default inherits the tenant default
- **WHEN** a project's default test type is unset
- **THEN** generations for that project use the tenant default

#### Scenario: Per-generation override does not change any default
- **WHEN** a user picks UI or Back-end next to the Generate action and runs that generation
- **THEN** that single generation uses the chosen test type, and the project and tenant defaults remain unchanged for subsequent generations

#### Scenario: Any tenant user changes a default
- **WHEN** any tenant user, whether admin or qa-engineer, sets the project's or the tenant's default test type
- **THEN** the system records the new default and applies it to subsequent generations that do not specify an override

#### Scenario: Resolved test type recorded for audit
- **WHEN** a generation completes
- **THEN** the generated test row and its prompt-input summary record the resolved test type used

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

