## Why

The Jira integration was built during the MVP but was never used in practice and
was never exercised by real testers or covered by end-to-end tests. It carries
ongoing weight: a whole backend module, an encrypted-secrets-backed config, a
live-validation network dependency, extra DB tables and columns, and a branching
"Jira ID or description" work-context model in both the extension and the specs.
Removing it simplifies the product surface and the data model. Work context
collapses to a single, always-present concept: a tester-written description of
what is being tested.

## What Changes

- Remove the backend **Jira module** (controller, service, driver) and the
  `JIRA_DRIVER` provider plus its config/env.
- Drop the **`jira_configs` table** and the **`sessions.jira_*` columns**
  (Jira id and any cached Jira metadata) via a destructive migration.
- Remove all Jira **DTOs and enums** from `@qassistant/shared` (project Jira
  config DTOs, Jira-validation request/response, the Jira driver enum).
- Session **work context becomes a required tester-written description**. There
  is no Jira-ID path; a session cannot start with an empty description.
- Remove the **`jira_validation_failed`** error code and the
  **`/projects/:id/jira`** endpoints (Jira config read/write and live
  validation).
- Extension session-start UI drops the Jira-ID field; it collects only the
  required description. Dashboard drops any Jira id display/column and the
  project Jira-config screen.

## Impact

- **Data model (destructive)**: migration `0012_remove_jira` drops the
  `jira_configs` table and the `sessions.jira_*` columns. Existing Jira ids and
  cached metadata are discarded; this is intentional and not recoverable.
- **Contract**: session start now **requires** a non-empty `description`;
  requests that previously relied on a Jira id are rejected. The
  `jira_validation_failed` error code and the `/projects/:id/jira` endpoints are
  gone.
- **Clients**: extension and dashboard no longer reference Jira.

## Non-Goals

- No new work-context capabilities (no ticket linking to any other tracker, no
  description templates or required-fields validation) — description stays
  free-form and non-empty.
- No change to capture, artifact, screenshot, network-log, code-generation, or
  dashboard behavior beyond the removal of Jira fields.
- No data migration/export of existing Jira ids — they are dropped.
