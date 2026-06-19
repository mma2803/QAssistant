import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  createTenantRequestSchema,
  updateTenantRequestSchema,
  type CreateTenantRequest,
  type CreateTenantResponse,
  type Tenant,
  type UpdateTenantRequest,
} from '@qassistant/shared';
import { SuperAdminOnly } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminService } from './admin.service.js';

/**
 * Super-admin provisioning endpoints (contract section 4.1). Guarded by
 * @SuperAdminOnly() so only the project-level super-admin token reaches them;
 * the TransactionInterceptor routes these onto the BYPASSRLS path automatically
 * (super-admin sets no app.tenant_id).
 */
@Controller('admin/tenants')
@SuperAdminOnly()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post()
  createTenant(
    @Body(new ZodValidationPipe(createTenantRequestSchema)) body: CreateTenantRequest,
  ): Promise<CreateTenantResponse> {
    return this.adminService.createTenant(body);
  }

  @Get()
  listTenants(): Promise<Tenant[]> {
    return this.adminService.listTenants();
  }

  @Patch(':tenantId')
  updateTenant(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(updateTenantRequestSchema)) body: UpdateTenantRequest,
  ): Promise<Tenant> {
    return this.adminService.updateTenantStatus(tenantId, body);
  }
}
