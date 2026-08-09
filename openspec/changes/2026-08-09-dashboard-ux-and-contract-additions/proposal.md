## Why

The dashboard was rebuilt on shadcn/ui + Tailwind to look production-grade for
commercialization. The visual reskin is pure implementation and needs no spec.
But the same effort added real, user-visible **capabilities** and two additive
**API-contract** fields that go beyond presentation, and the specs are the
source of truth. This change records those behavioral additions so the specs
stay aligned with what the system now does. It also fills the `qa-dashboards`
`Purpose: TBD` left by the MVP archive.

Explicitly out of scope (implementation detail, no requirement): the shadcn
migration, theme (light/dark) toggle, Inter font, brand logo, collapsible
sidebar, and page layout.

## What Changes

- **Overview landing view**: a new at-a-glance dashboard (headline counts,
  a recordings trend, recent recordings, test-type / integration breakdown),
  role-scoped, and the default view after sign-in for admins and qa-engineers.
- **Full-format artifact viewing**: a session screenshot can be opened at full
  size from the recording detail, reusing the already-authenticated image bytes
  (resolves the gap noted in BUG-003).
- **Records list controls**: search, filter (project, session status,
  integration status, and recorder for admins), sort, "load more" pagination,
  and multi-select **bulk export / soft-delete**, all within the existing role
  scope.
- **Generated test type in the records list**: each recording shows the distinct
  generated test type(s) — UI and/or back-end — surfaced via a new
  `testTypes` field on the records list response.
- **Productivity time window + coverage**: the admin productivity view MAY be
  scoped to a time window (last 24h / 48h / 7d / 30d or a custom range), and it
  adds coverage indicators (recordings that produced a test, candidates
  integrated, projects with activity).
- **Authenticated self-service password change**: a signed-in user can change
  their own password from the dashboard, distinct from admin-driven forgotten
  password recovery.
- **Identity bootstrap exposes email**: `GET /auth/me` returns the signed-in
  account's `email` for display (the `uid` is an opaque internal id).

## Capabilities

### Modified Capabilities
- `qa-dashboards`: adds an overview landing view, full-format artifact viewing,
  records list filtering/sorting/pagination/bulk actions, the generated
  test-type column, and productivity time-window scoping plus coverage metrics.
- `identity-and-tenancy`: authenticated self-service password change, and the
  identity bootstrap exposing the account email for display.

## Impact

- **Shared**: additive DTO fields — `testTypes` on the dashboard session list
  item, `email` on the auth `me` response. No breaking contract change.
- **API**: `GET /dashboard/sessions` aggregates distinct test types per session;
  `GET /auth/me` resolves the account email.
- **Dashboard**: new Overview page; reworked Recordings, Productivity, Projects,
  Users, Tenants, Session detail; sidebar profile block with change-password.
- **No data-model migration**: only read-side additions and client behavior.

## Non-Goals

- Server-side windowed/aggregated productivity endpoints (the time window and
  coverage are computed client-side from recent recordings for now; a dedicated
  aggregation endpoint is a future change if exact all-history figures are
  required).
- Any change to capture, rrweb replay, or code generation behavior.
- Real-time features or collaboration (e.g. tenant chat).
