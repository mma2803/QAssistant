# qa-dashboards Specification

## Purpose
TBD - created by archiving change qassistant-mvp. Update Purpose after archive.
## Requirements
### Requirement: Role-scoped dashboard access
The system SHALL show an admin authorized data within their tenant and SHALL show a qa-engineer only their own contribution, scoping access by the role claim and tenant boundary.

#### Scenario: Admin sees the whole tenant
- **WHEN** an admin opens the dashboard
- **THEN** the system shows recordings, artifacts, and productivity for active projects in their tenant

#### Scenario: QA engineer sees only their own work
- **WHEN** a qa-engineer opens the dashboard
- **THEN** the system shows only that user's own recordings, artifacts, and contribution

### Requirement: Admin recording and artifact view
The system SHALL provide an admin view listing all recordings with their artifacts (screenshots and DOM-replay), selections, and summaries.

#### Scenario: Browse recordings and artifacts
- **WHEN** an admin opens a recording
- **THEN** the system displays its artifacts, selections, and a summary

### Requirement: Productivity metrics and ranking
The system SHALL compute and display per-user productivity metrics and an admin-only MVP "Contribution ranking" that is directional, metric-based, and sorted by generated test count (across all frameworks), then total recording duration (raw wall-clock, no idle exclusion in MVP), then recording count.

#### Scenario: View per-user productivity
- **WHEN** an admin opens the productivity view
- **THEN** the system displays each user's effort/output metrics and admin-only contribution ranking sorted by generated test count, then total recording duration (raw wall-clock), then recording count

#### Scenario: Ranking uses visible metrics
- **WHEN** an admin views the contribution ranking
- **THEN** the system shows the metrics used for ordering and does not use a hidden weighted score

### Requirement: Per-project context section
The system SHALL provide a per-project context section in the dashboard where the project's knowledge hub overview is viewable.

#### Scenario: View project context
- **WHEN** a user opens the project context section
- **THEN** the system displays the project's markdown overview

