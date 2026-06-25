import { Module } from '@nestjs/common';
import { TenantSettingsController } from './tenant-settings.controller.js';
import { TenantSettingsService } from './tenant-settings.service.js';

/**
 * Tenant-wide codegen settings (change: configurable-test-framework). Relies on
 * the global Db / Auth modules for the request-scoped transaction and tenant
 * context, like the other tenant-scoped feature modules.
 */
@Module({
  controllers: [TenantSettingsController],
  providers: [TenantSettingsService],
})
export class TenantSettingsModule {}
