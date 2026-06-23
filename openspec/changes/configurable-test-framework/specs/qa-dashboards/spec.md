## MODIFIED Requirements

### Requirement: Productivity metrics and ranking
The system SHALL compute and display per-user productivity metrics and an admin-only MVP "Contribution ranking" that is directional, metric-based, and sorted by generated test count (across all frameworks), then total recording duration (raw wall-clock, no idle exclusion in MVP), then recording count.

#### Scenario: View per-user productivity
- **WHEN** an admin opens the productivity view
- **THEN** the system displays each user's effort/output metrics and admin-only contribution ranking sorted by generated test count, then total recording duration (raw wall-clock), then recording count

#### Scenario: Ranking uses visible metrics
- **WHEN** an admin views the contribution ranking
- **THEN** the system shows the metrics used for ordering and does not use a hidden weighted score
