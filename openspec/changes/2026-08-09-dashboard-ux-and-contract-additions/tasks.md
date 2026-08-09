## 1. Shared contract (additive)

- [x] 1.1 Add `testTypes: TestType[]` to `dashboardSessionListItemSchema` (`packages/shared/src/dto/dashboard.ts`)
- [x] 1.2 Add `email: string | null` to `authMeResponseSchema` (`packages/shared/src/dto/auth.ts`)
- [x] 1.3 Build `@qassistant/shared`

## 2. API (read-side)

- [x] 2.1 `GET /dashboard/sessions`: aggregate distinct `test_type` per session (`array_agg`) into `testTypes`
- [x] 2.2 `GET /auth/me`: resolve the account email from `tenant_users` / `super_admins` and return it

## 3. Dashboard — Overview

- [x] 3.1 New `/overview` route + nav entry; default landing for admin and qa-engineer
- [x] 3.2 Stat cards, 14-day recordings trend, recent recordings, test-type / integration breakdown (role-scoped, from `GET /dashboard/sessions`)

## 4. Dashboard — Recordings

- [x] 4.1 Search + filters (project, session status, integration status, recorder for admins)
- [x] 4.2 Sortable columns and "load more" cursor pagination
- [x] 4.3 Multi-select bulk export / soft-delete
- [x] 4.4 Generated test-type column (from `testTypes`); integration-status row tint

## 5. Dashboard — Productivity

- [x] 5.1 Time-window filter (24h/48h/7d/30d/custom)
- [x] 5.2 Coverage tiles (recordings→test, candidates integrated, projects with activity)
- [x] 5.3 Top-testers + project-activity charts, ranking leaderboard (spec order preserved)

## 6. Dashboard — artifacts & identity

- [x] 6.1 Full-format screenshot lightbox reusing the authenticated blob (BUG-003)
- [x] 6.2 Sidebar profile block with self-service change-password dialog (reuses `/auth/complete-password-change`)
- [x] 6.3 Display the account email (from `/auth/me`, with a signed-in fallback)

## 7. Spec & docs

- [ ] 7.1 Update `qa-dashboards` and `identity-and-tenancy` specs on archive of this change
- [ ] 7.2 Fill the `qa-dashboards` `Purpose` (currently `TBD`)

## 8. Tests

- [ ] 8.1 E2E: overview renders role-scoped summary
- [ ] 8.2 E2E: records filters/sort/pagination and bulk actions
- [ ] 8.3 E2E: screenshot lightbox opens full-format
- [ ] 8.4 API: `GET /dashboard/sessions` returns `testTypes`; `GET /auth/me` returns `email`
