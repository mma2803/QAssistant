## MODIFIED Requirements

### Requirement: Per-project knowledge hub
The system SHALL let an admin maintain a per-project knowledge hub, edited in the dashboard, containing a markdown overview of how the app works and an optional reference to default credentials (such as test account logins or API tokens needed during testing), stored in Secret Manager and surfaced as labeled text context during code generation. The knowledge hub is optional: code generation MAY proceed when the hub is empty, using only recording and Jira or description context. A newly created project SHALL have its knowledge hub markdown initialized with a default, editable test-generation guidance template, and existing projects whose knowledge hub markdown is null or blank SHALL be backfilled with the same template. The template is guidance surfaced as labeled input context and SHALL NOT override the generator's platform rules; an admin MAY edit or clear it like any knowledge hub content.

#### Scenario: Admin edits project context
- **WHEN** an admin saves the project's markdown overview and default-credentials reference in the dashboard
- **THEN** the system stores the markdown and a Secret Manager reference for the credentials, and makes the context available to code generation

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
