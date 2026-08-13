## 1. Shared contract

- [x] 1.1 Remove Jira DTOs (project Jira config, Jira-validation request/response) from `@qassistant/shared`
- [x] 1.2 Remove the Jira driver enum and any `jiraId` field from session/work-context DTOs
- [x] 1.3 Make session-start `description` a required non-empty string
- [x] 1.4 Drop the `jira_validation_failed` error code
- [x] 1.5 Build `@qassistant/shared`

## 2. Database

- [x] 2.1 Write destructive migration `0012_remove_jira` (drop `jira_configs` table, drop `sessions.jira_*` columns)
- [x] 2.2 Update `db/schema.ts` to remove the `jira_configs` table and `sessions.jira_*` columns

## 3. API

- [x] 3.1 Delete the Jira module (controller, service, driver) and the `/projects/:id/jira` endpoints
- [x] 3.2 Remove the `JIRA_DRIVER` provider and its config/env
- [x] 3.3 Remove Jira validation from session start; require a non-empty description
- [x] 3.4 Drop Jira id stamping from session/event/artifact persistence

## 4. Extension

- [x] 4.1 Remove the Jira-ID field from session start; collect only the required description

## 5. Dashboard

- [x] 5.1 Remove the project Jira-config screen and any Jira id display/column

## 6. Tests

- [x] 6.1 Remove Jira tests; update session-start tests to the required-description model

## 7. Specs & docs

- [x] 7.1 Scrub Jira from `apps/api/README.md` and `apps/extension/README.md`
- [ ] 7.2 Archive this change on deploy (updates `session-capture` spec)
