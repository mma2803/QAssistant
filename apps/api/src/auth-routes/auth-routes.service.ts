import { HttpStatus, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { AuthMeResponse, CompletePasswordChangeRequest } from '@qassistant/shared';
import type { Role } from '@qassistant/shared/enums';
import { RequestContext } from '../auth/request-context.js';
import { FirebaseService } from '../auth/firebase.service.js';
import { projects, tenants, tenantUsers } from '../db/schema.js';
import { AppException } from '../auth/errors.js';
import { toProject, toTenant } from '../common/serializers.js';

/**
 * Self-service auth routes (contract section 4.2):
 *  - POST /auth/complete-password-change: the ONLY mutating call allowed while
 *    the mustChangePassword marker is set. Sets the new password and clears the
 *    marker (GCIP claim + tenant_users mirror), task 2.3.
 *  - GET /auth/me: resolved identity + tenant/projects bootstrap. Allowed during
 *    password change so the dashboard can render the forced-change screen.
 *
 * Both rely on the request transaction (RLS-scoped) and the verified identity in
 * RequestContext. The marker's authoritative source is the GCIP custom claim;
 * the tenant_users column is the display mirror (kept in sync here).
 */
@Injectable()
export class AuthRoutesService {
  constructor(
    private readonly ctx: RequestContext,
    private readonly firebase: FirebaseService,
  ) {}

  /** POST /auth/complete-password-change: set new password, clear the marker. */
  async completePasswordChange(input: CompletePasswordChangeRequest): Promise<{ mustChangePassword: false }> {
    const tenantId = this.ctx.tenantId;
    const actingUserId = this.ctx.actingUserId;
    if (!tenantId || !actingUserId) {
      throw new AppException('forbidden', 'Tenant user required', HttpStatus.FORBIDDEN);
    }

    // Load self + the GCIP tenant id (RLS-scoped, explicit predicate).
    const rows = await this.ctx.dbTx
      .select({
        role: tenantUsers.role,
        gcipUid: tenantUsers.gcipUid,
        gcipTenantId: tenants.gcipTenantId,
      })
      .from(tenantUsers)
      .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
      .where(and(eq(tenantUsers.id, actingUserId), eq(tenantUsers.tenantId, tenantId)))
      .limit(1);
    const self = rows[0];
    if (!self) {
      throw new AppException('not_found', 'User not found', HttpStatus.NOT_FOUND);
    }

    // Set the new password in GCIP, then clear the marker claim.
    await this.firebase.setTenantUserPassword(self.gcipTenantId, self.gcipUid, input.newPassword);
    await this.firebase.clearMustChangePassword(
      self.gcipTenantId,
      self.gcipUid,
      tenantId,
      self.role as Role,
    );

    // Mirror the cleared marker in the read model.
    await this.ctx.dbTx
      .update(tenantUsers)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(and(eq(tenantUsers.id, actingUserId), eq(tenantUsers.tenantId, tenantId)));

    return { mustChangePassword: false };
  }

  /** GET /auth/me: resolved identity + tenant/active-projects bootstrap. */
  async me(): Promise<AuthMeResponse> {
    const base = {
      uid: this.ctx.uid,
      role: this.ctx.role,
      tenantId: this.ctx.tenantId,
      mustChangePassword: this.ctx.mustChangePassword,
    } as const;

    // Super-admin: project-level, no tenant binding (D10). No bootstrap data.
    if (this.ctx.isSuperAdmin() || !this.ctx.tenantId) {
      return { ...base, tenant: null, projects: [] };
    }

    const tenantId = this.ctx.tenantId;

    const tenantRows = await this.ctx.dbTx
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    // Active projects in the tenant (extension/dashboard bootstrap; D4 "select a
    // project before capture"). qa-engineer and admin both see all active
    // projects in their tenant (D12 tenant-wide access).
    const projectRows = await this.ctx.dbTx
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.status, 'active')));

    return {
      ...base,
      tenant: tenantRows[0] ? toTenant(tenantRows[0]) : null,
      projects: projectRows.map(toProject),
    };
  }
}
