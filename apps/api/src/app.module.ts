import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { AdminModule } from './admin/admin.module.js';
import { UsersModule } from './users/users.module.js';
import { AuthRoutesModule } from './auth-routes/auth-routes.module.js';
import { SecretsModule } from './secrets/secrets.module.js';
import { StorageModule } from './storage/storage.module.js';
import { JiraModule } from './jira/jira.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { CaptureModule } from './capture/capture.module.js';
import { CodegenModule } from './codegen/codegen.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { TenantSettingsModule } from './tenant-settings/tenant-settings.module.js';

/**
 * Root module.
 *
 * Foundational modules (owned by the foundation phase) are imported here:
 *   - ConfigModule  : validated env -> typed AppConfig (global).
 *   - DbModule      : pg pools + Drizzle + per-request transaction wrappers (global).
 *   - AuthModule    : token verification guard + tenant-transaction interceptor +
 *                     request-scoped RequestContext (global).
 *   - HealthModule  : public /health endpoint.
 *
 * ---------------------------------------------------------------------------
 * FEATURE MODULE REGISTRATION (later, sequential backend phase)
 * ---------------------------------------------------------------------------
 * Feature agents add their modules to the FEATURE_MODULES array below. Each
 * feature module relies on the global ConfigModule / DbModule / AuthModule, so
 * it can inject AppConfig (APP_CONFIG), DbService, RequestContext, and
 * FirebaseService without importing them again.
 *
 * Add imports like:
 *   import { AdminModule } from './admin/admin.module.js';
 *   import { ProjectsModule } from './projects/projects.module.js';
 *   ...and list them in FEATURE_MODULES.
 *
 * Do NOT register feature modules during the foundation phase.
 */
const FEATURE_MODULES: NonNullable<unknown>[] = [
  // Identity & tenancy (section 2): provisioning, user management, self auth.
  AdminModule,
  UsersModule,
  AuthRoutesModule,
  // Capture (section 3): support globals + project setup + extension capture.
  SecretsModule,
  StorageModule,
  JiraModule,
  ProjectsModule,
  CaptureModule,
  // Knowledge & codegen (section 4.5): Gemini routing, async generation, review.
  CodegenModule,
  // Tenant-wide codegen settings (change: configurable-test-framework).
  TenantSettingsModule,
  // Dashboards (section 5 / contract 4.6, 4.7, 6): reads, lifecycle, metrics.
  DashboardModule,
];

@Module({
  imports: [ConfigModule, DbModule, AuthModule, HealthModule, ...(FEATURE_MODULES as never[])],
})
export class AppModule {}
