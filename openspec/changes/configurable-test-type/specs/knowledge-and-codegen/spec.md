## ADDED Requirements

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

## MODIFIED Requirements

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
