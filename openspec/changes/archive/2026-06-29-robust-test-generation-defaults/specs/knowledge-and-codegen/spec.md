## MODIFIED Requirements

### Requirement: Context-grounded test generation
The system SHALL generate asserted tests in the recording's selected test framework and language (Playwright with TypeScript by default) from a recording's DOM-replay flow, inferring assertions from the linked Jira ticket when present, Jira comments/attachments when available, the tester-written description, the project knowledge hub, the project markdown, optional screenshots, and any tester-flagged states. The generated test SHALL follow robustness defaults: (1) after an action that changes an observable state (such as a quantity, total, count, or selection), it SHALL assert that resulting state — exact when the value is controlled by the test, and relative/directional, range, or format otherwise; (2) it SHALL use resilient selectors in priority order test-id/data attributes, then accessible role with name/label/visible text, then CSS class as a last resort, and SHALL NOT use positional selectors (index, `nth-child`, `nth-of-type`) or auto-generated/hashed class selectors; (3) it SHALL target the project's base URL rather than hard-coding a full origin; (4) it SHALL prefer state relations and invariants over exact values for dynamic, generated, or time-dependent data; and (5) it SHALL NOT emit trivial assertions on structural containers or generic orchestrators that do not prove the test case. A tester-flagged state with an explicit expected value SHALL still be asserted exactly; the robustness defaults apply to everything the tester did not pin.

#### Scenario: Generate code from a recording
- **WHEN** a user requests code generation for a recording
- **THEN** the system produces a versioned test in the selected framework and language, generated from the recording's DOM-replay flow plus the available Jira ticket/comments/attachments or tester description and project context

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
- **WHEN** the recorded flow performs an action that changes an observable state (e.g. incrementing a quantity or applying a discount)
- **THEN** the generated test asserts the resulting state — an exact value when the test controls it (e.g. the quantity after a known number of increments) or a relative/directional, range, or format assertion otherwise (e.g. the total after a discount is lower than before)

#### Scenario: No positional selectors
- **WHEN** the generated test selects elements
- **THEN** it uses test-id/role/label/text selectors (CSS class only as a last resort) and does not use index, `nth-child`, `nth-of-type`, or auto-generated/hashed class selectors

#### Scenario: Base URL is not hard-coded
- **WHEN** the generated test navigates to the application
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
