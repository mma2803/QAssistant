# API Endpoint Coverage

Every route below is inventoried from `apps/api/src/**/*.controller.ts`. The HTTP E2E test records all requests and fails if any inventoried route was not exercised.

| Method | Route | Evidence |
|---|---|---|
| GET | `/api/v1/admin/tenants` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/admin/tenants` | `apps/api/test/http-e2e.test.ts` |
| PATCH | `/api/v1/admin/tenants/:tenantId` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/auth/complete-password-change` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/auth/me` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/dashboard/metrics` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/dashboard/ranking` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/dashboard/sessions` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/dashboard/sessions/:sessionId` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/dashboard/sessions/:sessionId/artifacts/:artifactId` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/dashboard/sessions/:sessionId/replay` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/generations/:generatedTestId` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/generations/:generatedTestId/approve` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/generations/:generatedTestId/integrate` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/internal/tasks/generate` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/internal/tasks/inactivity-sweep` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/internal/tasks/purge` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/projects` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/projects` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/projects/:projectId` | `apps/api/test/http-e2e.test.ts` |
| PATCH | `/api/v1/projects/:projectId` | `apps/api/test/http-e2e.test.ts` |
| DELETE | `/api/v1/projects/:projectId/jira` | `apps/api/test/http-e2e.test.ts` |
| PUT | `/api/v1/projects/:projectId/jira` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/projects/:projectId/jira/test` | `apps/api/test/http-e2e.test.ts` |
| PUT | `/api/v1/projects/:projectId/knowledge` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/sessions` | `apps/api/test/http-e2e.test.ts` |
| DELETE | `/api/v1/sessions/:sessionId` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/sessions/:sessionId/artifacts` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/sessions/:sessionId/comments` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/sessions/:sessionId/export` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/sessions/:sessionId/flags` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/sessions/:sessionId/generate` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/sessions/:sessionId/generations` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/sessions/:sessionId/regenerate` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/sessions/:sessionId/restore` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/sessions/:sessionId/stop` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/sessions/:sessionId/upload-urls` | `apps/api/test/http-e2e.test.ts` |
| GET | `/api/v1/users` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/users` | `apps/api/test/http-e2e.test.ts` |
| PATCH | `/api/v1/users/:userId` | `apps/api/test/http-e2e.test.ts` |
| POST | `/api/v1/users/:userId/reset-password` | `apps/api/test/http-e2e.test.ts` |
| GET | `/health` | `apps/api/test/http-e2e.test.ts` |

Coverage: **42/42 (100%)**.
