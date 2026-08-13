import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  createInvitationRequestSchema,
  createTenantRequestSchema,
  updateTenantRequestSchema,
  type CreateInvitationRequest,
  type CreateInvitationResponse,
  type CreateTenantRequest,
  type CreateTenantResponse,
  type Invitation,
  type Tenant,
  type UpdateTenantRequest,
} from '@qassistant/shared';
import { SuperAdminOnly } from '../auth/decorators.js';
import { RequestContext } from '../auth/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminService } from './admin.service.js';
import { InvitationsService } from './invitations.service.js';

/**
 * Super-admin provisioning endpoints (contract section 4.1). Guarded by
 * @SuperAdminOnly() so only the project-level super-admin token reaches them;
 * the TransactionInterceptor routes these onto the BYPASSRLS path automatically
 * (super-admin sets no app.tenant_id).
 */
@Controller('admin/tenants')
@SuperAdminOnly()
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly invitations: InvitationsService,
    private readonly ctx: RequestContext,
  ) {}

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

  // Reusable signup links (change: tenant-signup-links). Declared before the
  // `:tenantId` PATCH so the literal path segments never get shadowed.
  @Post('invitations')
  createInvitation(
    @Body(new ZodValidationPipe(createInvitationRequestSchema)) body: CreateInvitationRequest,
  ): Promise<CreateInvitationResponse> {
    return this.invitations.issue(this.ctx.uid, body);
  }

  @Get('invitations')
  listInvitations(): Promise<Invitation[]> {
    return this.invitations.list();
  }

  @Delete('invitations/:invitationId')
  @HttpCode(204)
  revokeInvitation(@Param('invitationId') invitationId: string): Promise<void> {
    return this.invitations.revoke(invitationId);
  }

  @Patch(':tenantId')
  updateTenant(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(updateTenantRequestSchema)) body: UpdateTenantRequest,
  ): Promise<Tenant> {
    return this.adminService.updateTenantStatus(tenantId, body);
  }

  @Delete(':tenantId')
  @HttpCode(204)
  deleteTenant(@Param('tenantId') tenantId: string): Promise<void> {
    return this.adminService.deleteTenant(tenantId);
  }
}
