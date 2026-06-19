# Feature module folders (placeholders)

These directories are created by the foundation phase as a home for feature
agents. They are empty on purpose. Each feature module should:

- live in its own folder (`admin/`, `users/`, `projects/`, `capture/`,
  `codegen/`, `dashboard/`, plus support folders `jira/`, `storage/`);
- inject the global foundational providers rather than re-creating them:
  - `APP_CONFIG` token (`config/config.module.ts`) for typed `AppConfig`;
  - `DbService` (`db/db.service.ts`) for the per-request transaction
    (`ctx.dbTx`) and the `withTenant` / `withSuperadmin` wrappers;
  - `RequestContext` (`auth/request-context.ts`) for the verified actor
    (`uid`, `role`, `tenantId`, `actingUserId`) and `dbTx`;
  - `FirebaseService` (`auth/firebase.service.ts`) for Admin SDK calls
    (user management, custom claims);
- annotate routes with the auth decorators (`auth/decorators.ts`):
  - `@SuperAdminOnly()` for `/admin/*` provisioning;
  - `@Roles('admin')` / `@Roles('admin','qa-engineer')` for tenant routes;
  - `@AllowDuringPasswordChange()` for `/auth/complete-password-change` and
    `/auth/me`;
  - `@Public()` for Cloud Tasks OIDC worker endpoints (which verify their own
    OIDC token) and health;
- throw `AppException(code, message, status)` (`auth/errors.ts`) to emit the
  contract error envelope;
- register itself in `app.module.ts` `FEATURE_MODULES` ONLY during the
  sequential backend phase.

The DB transaction is already open and tenant-scoped by the time a handler
runs, so feature code just uses `ctx.dbTx` (or `requestContext.dbTx`) for all
queries; RLS plus the explicit `WHERE tenant_id` predicate are defense in depth.
