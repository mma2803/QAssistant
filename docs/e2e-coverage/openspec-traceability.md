# OpenSpec Traceability

| Spec | Requirement | E2E evidence |
|---|---|---|
| identity-and-tenancy | Multi-tenant identity model | `apps/api/test/rls-isolation.test.ts`, `apps/api/test/http-e2e.test.ts` |
| identity-and-tenancy | Three-level provisioning | `apps/api/test/http-e2e.test.ts`, `e2e/users.spec.ts` |
| identity-and-tenancy | Email and password authentication | `apps/api/test/http-e2e.test.ts`, `e2e/auth.spec.ts`, `e2e/extension-popup.spec.ts` |
| identity-and-tenancy | Forced password change on first login and after reset | `apps/api/test/http-e2e.test.ts`, `e2e/auth.spec.ts`, `e2e/extension-popup.spec.ts` |
| identity-and-tenancy | Custom-claim authorization enforced server-side | `apps/api/test/http-e2e.test.ts` |
| session-capture | Work-context-gated session start | `apps/api/test/http-e2e.test.ts`, `e2e/extension-popup.spec.ts` |
| session-capture | DOM-replay capture with optional viewport-only screenshots | `apps/api/test/http-e2e.test.ts`, `apps/api/test/e2e-flow.test.ts` |
| session-capture | Server-derived identity stamping | `apps/api/test/http-e2e.test.ts`, `apps/api/test/e2e-flow.test.ts` |
| session-capture | Hotkey to flag important state | `apps/api/test/http-e2e.test.ts`, `e2e/extension-popup.spec.ts` |
| session-capture | Artifact upload to GCS | `apps/api/test/http-e2e.test.ts` |
| knowledge-and-codegen | Per-project knowledge hub | `apps/api/test/http-e2e.test.ts`, `e2e/dashboard.spec.ts` |
| knowledge-and-codegen | Gemini model routing | `apps/api/test/http-e2e.test.ts`, `apps/api/test/e2e-flow.test.ts` |
| knowledge-and-codegen | Context-grounded Playwright generation | `apps/api/test/http-e2e.test.ts`, `apps/api/test/e2e-flow.test.ts`, `e2e/session-detail.spec.ts` |
| knowledge-and-codegen | Codegen safety and review | `apps/api/test/http-e2e.test.ts`, `e2e/session-detail.spec.ts` |
| knowledge-and-codegen | Comment and regenerate | `apps/api/test/http-e2e.test.ts`, `e2e/session-detail.spec.ts` |
| qa-dashboards | Role-scoped dashboard access | `apps/api/test/http-e2e.test.ts`, `e2e/dashboard.spec.ts` |
| qa-dashboards | Admin recording and artifact view | `apps/api/test/http-e2e.test.ts`, `e2e/session-detail.spec.ts` |
| qa-dashboards | Productivity metrics and ranking | `apps/api/test/http-e2e.test.ts`, `e2e/dashboard.spec.ts` |
| qa-dashboards | Per-project context section | `apps/api/test/http-e2e.test.ts`, `e2e/dashboard.spec.ts` |

This matrix focuses on application behavior reachable through the dashboard, extension, and REST API. Infrastructure provisioning scenarios remain verified by Terraform validation and deployment checks rather than browser E2E.
