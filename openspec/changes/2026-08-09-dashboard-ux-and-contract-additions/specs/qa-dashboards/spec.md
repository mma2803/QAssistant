## ADDED Requirements

### Requirement: Recording overview landing
The system SHALL provide an at-a-glance overview as the default landing view for admins and qa-engineers, summarizing recent QA activity within the caller's role scope (an admin sees the tenant; a qa-engineer sees only their own work). The overview SHALL surface headline counts (recordings, active sessions, generated tests, integrated), a recordings-over-time trend, a recent-recordings list linking to detail, and a breakdown of generated test types and integration status. The super-admin, which has no tenant binding, is not shown this view.

#### Scenario: Admin opens the overview
- **WHEN** an admin signs in and lands on the dashboard
- **THEN** the system shows tenant-scoped headline counts, a recordings trend, recent recordings, and a test-type / integration breakdown

#### Scenario: QA engineer overview is self-scoped
- **WHEN** a qa-engineer opens the overview
- **THEN** the summary reflects only that user's own recordings and generated tests

### Requirement: Full-format artifact viewing
The system SHALL let a user open a session screenshot at full size from the recording detail view. The full-size view SHALL reuse the already-authenticated image bytes loaded by the dashboard (not a direct artifact URL, which a browser navigation cannot open because the endpoint requires a bearer token).

#### Scenario: Open a screenshot at full size
- **WHEN** a user clicks a screenshot thumbnail on the recording detail
- **THEN** the system displays the screenshot at full size using the already-loaded, authenticated image, without a failed direct-URL navigation

### Requirement: Records list filtering, sorting, pagination, and bulk actions
The system SHALL let a user narrow and act on the recordings list within the existing role scope: search across recording fields; filter by project, session status, and integration status (and by recorder for admins); sort the list; page through results via the cursor; and select multiple recordings to export or soft-delete in bulk. A qa-engineer's controls SHALL only ever operate over their own recordings.

#### Scenario: Filter and sort the records list
- **WHEN** a user applies a project, status, integration, or recorder filter, a search term, or a column sort
- **THEN** the records list reflects the selection within the user's role scope

#### Scenario: Bulk export or delete
- **WHEN** a user selects multiple recordings and chooses export or delete
- **THEN** the system exports each selection or soft-deletes them (restorable within the retention window), refreshing the list

### Requirement: Generated test type in the records list
The system SHALL show, per recording in the records list, the distinct generated test type(s) produced for that session — `ui`, `backend`, or both — or an explicit none when no test has been generated. A qa-engineer sees this only for their own recordings.

#### Scenario: Session with a UI test generated
- **WHEN** a session has one or more generated UI tests and no back-end test
- **THEN** the records list shows a UI type indicator for that session

#### Scenario: Session with no generated test
- **WHEN** a session has no generated test
- **THEN** the records list shows an explicit none for the type

### Requirement: Test coverage indicators
The system SHALL display, in the admin-only productivity view and scoped to the selected time window, coverage indicators derived from recordings: the share of recordings that produced at least one generated test, the share of integration candidates that were integrated, and the share of active projects that have recordings in the window. Each indicator SHALL show its underlying fraction, not only a percentage.

#### Scenario: Coverage reflects the selected window
- **WHEN** an admin views productivity for a given time window
- **THEN** each coverage indicator shows the fraction and percentage computed over recordings in that window

## MODIFIED Requirements

### Requirement: Productivity metrics and ranking
The system SHALL compute and display per-user productivity metrics and an admin-only MVP "Contribution ranking" that is directional, metric-based, and sorted by generated test count (across all frameworks), then total recording duration (raw wall-clock, no idle exclusion in MVP), then recording count. The admin MAY scope these metrics and the ranking to a time window — last 24 hours, 48 hours, 7 days, 30 days, or a custom date range — with the active window shown; when no window applies, figures are cumulative.

#### Scenario: View per-user productivity
- **WHEN** an admin opens the productivity view
- **THEN** the system displays each user's effort/output metrics and admin-only contribution ranking sorted by generated test count, then total recording duration (raw wall-clock), then recording count

#### Scenario: Ranking uses visible metrics
- **WHEN** an admin views the contribution ranking
- **THEN** the system shows the metrics used for ordering and does not use a hidden weighted score

#### Scenario: Scope productivity to a time window
- **WHEN** an admin selects a time window (24h/48h/7d/30d or a custom range)
- **THEN** the metrics, ranking, and coverage indicators reflect only recordings within that window, and the active window is shown
