# Frontend Screen Coverage

| Surface | Screen/state | Browser evidence | OpenSpec trace |
|---|---|---|---|
| Dashboard | Sign in | `e2e/auth.spec.ts` | identity-and-tenancy: Tenant user signs in with email and password |
| Dashboard | Forced password change | `e2e/auth.spec.ts` | identity-and-tenancy: First login forces password change |
| Dashboard | Recordings | `e2e/dashboard.spec.ts` | qa-dashboards: Browse recordings and artifacts |
| Dashboard | Recording detail | `e2e/session-detail.spec.ts` | qa-dashboards: Admin recording and artifact view |
| Dashboard | Project context | `e2e/dashboard.spec.ts` | qa-dashboards: View project context |
| Dashboard | Productivity and ranking | `e2e/dashboard.spec.ts` | qa-dashboards: Productivity metrics and ranking |
| Dashboard | User management | `e2e/users.spec.ts` | identity-and-tenancy: In-dashboard user management via Admin SDK |
| Extension popup | Sign in | `e2e/extension-popup.spec.ts` | identity-and-tenancy: Tenant user signs in with email and password |
| Extension popup | Forced password change | `e2e/extension-popup.spec.ts` | identity-and-tenancy: First login forces password change |
| Extension popup | Session start | `e2e/extension-popup.spec.ts` | session-capture: Work-context-gated session start |
| Extension popup | Active recording | `e2e/extension-popup.spec.ts` | session-capture: Tester explicitly stops a session |
| Extension popup | Super-admin capture denial | `e2e/extension-popup.spec.ts` | identity-and-tenancy: Super-admin carries no tenant |

Coverage: **12/12 (100%)**.
