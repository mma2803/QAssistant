# QAssistant Dashboard (apps/dashboard)

Role-scoped admin / qa-engineer SPA. React + Vite + TypeScript. Consumes the
shared zod DTO types in `@qassistant/shared` and the backend `/api/v1` surface.

## Run

```bash
cp .env.example .env        # fill in Identity Platform web config / emulator host
npm run dev --workspace @qassistant/dashboard
```

The dev server proxies `/api` to the backend (`VITE_API_PROXY_TARGET`, default
`http://127.0.0.1:8080`), so the browser talks same-origin and the verified ID
token flows through unchanged.

## Structure

- `src/lib/firebase.ts` Identity Platform email/password sign-in, forced
  password-change, ID-token retrieval, emulator support.
- `src/lib/api.ts` typed REST client (bearer token attached automatically).
- `src/auth/AuthContext.tsx` bootstraps `/auth/me`, exposes role + the
  mustChangePassword gate.
- `src/App.tsx` role-scoped routing: login -> forced password change ->
  role-scoped shell. Admin-only routes (productivity, users) are absent from the
  route table for qa-engineers, not merely hidden.
- `src/pages/` SessionsPage, SessionDetailPage (inline rrweb replay, screenshots,
  flags, summary, generations with approve/integrate + comment/regenerate),
  MetricsPage (productivity + directional Contribution ranking), ProjectsPage
  (knowledge-hub markdown), UsersPage (Admin SDK-backed user management).
- `src/components/ReplayPlayer.tsx` rrweb player; `src/components/AuthImage.tsx`
  renders a screenshot by fetching its bytes over the authenticated API and
  wrapping them in an object URL.

## Notes

- Capture upload credentials stay write-only (signed PUT URLs); artifact *reads*
  are server-side and role-scoped. The dashboard plays DOM-replay inline via
  `GET /api/v1/dashboard/sessions/{id}/replay` (decoded, concatenated rrweb
  events) and shows screenshots via
  `GET /api/v1/dashboard/sessions/{id}/artifacts/{artifactId}` (raw bytes).
  `AuthImage` fetches those bytes with the bearer token (a plain `<img src>`
  cannot). The Export ZIP remains available for the full, downloadable stream.
- Role scoping is enforced by the backend (RLS for tenant; `recorded_by = self`
  for qa-engineers, applied to these read endpoints too). The route gating here
  is defense in depth.
