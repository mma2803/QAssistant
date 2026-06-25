import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  updateTenantSettingsRequestSchema,
  type TenantSettingsResponse,
  type UpdateTenantSettingsRequest,
} from '@qassistant/shared';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TenantSettingsService } from './tenant-settings.service.js';

/**
 * Tenant-wide codegen settings (change: configurable-test-framework). Both
 * routes are open to any tenant user (admin or qa-engineer) — the default
 * framework/language is a team preference, not a super-admin provisioning action
 * (contrast with the super-admin-only /admin/tenants routes).
 */
@Controller('tenant/settings')
export class TenantSettingsController {
  constructor(private readonly settings: TenantSettingsService) {}

  @Get()
  @Roles('admin', 'qa-engineer')
  get(): Promise<TenantSettingsResponse> {
    return this.settings.get();
  }

  @Put()
  @Roles('admin', 'qa-engineer')
  update(
    @Body(new ZodValidationPipe(updateTenantSettingsRequestSchema)) body: UpdateTenantSettingsRequest,
  ): Promise<TenantSettingsResponse> {
    return this.settings.update(body);
  }
}
