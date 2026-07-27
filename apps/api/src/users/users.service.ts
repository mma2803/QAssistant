import { HttpStatus, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type {
  CreateUserRequest,
  ResetPasswordRequest,
  TenantUser,
  UpdateUserRequest,
} from '@qassistant/shared';
import { RequestContext } from '../auth/request-context.js';
import { IdentityService } from '../auth/identity.service.js';
import { tenantUsers } from '../db/schema.js';
import { AppException } from '../auth/errors.js';
import { toTenantUser } from '../common/serializers.js';

/**
 * Tenant user management (contract section 4.2). All routes are admin-only
 * (enforced by the controller role guard); qa-engineer cannot reach them.
 * Every query runs inside the request transaction (ctx.dbTx) which is already
 * RLS-scoped to the acting admin's tenant, and we additionally pass an
 * explicit tenant_id predicate (defense in depth, D10, task 2.8). Password
 * hashing, must-change-password, and token revocation live in IdentityService.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly ctx: RequestContext,
    private readonly identity: IdentityService,
  ) {}

  private requireTenant(): string {
    const tenantId = this.ctx.tenantId;
    if (!tenantId) {
      throw new AppException('forbidden', 'Tenant scope required', HttpStatus.FORBIDDEN);
    }
    return tenantId;
  }

  /** POST /users: create user by any email, set initial password, assign role. */
  async createUser(input: CreateUserRequest): Promise<TenantUser> {
    const tenantId = this.requireTenant();

    // Reject a duplicate email within the tenant first.
    const existing = await this.ctx.dbTx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.email, input.email)))
      .limit(1);
    if (existing.length > 0) {
      throw new AppException('conflict', 'A user with this email already exists', HttpStatus.CONFLICT);
    }

    const userId = await this.identity.createTenantUser(this.ctx.dbTx, {
      tenantId,
      email: input.email,
      password: input.password,
      role: input.role,
    });
    const row = await this.identity.requireTenantUserRow(this.ctx.dbTx, userId);
    return toTenantUser(row);
  }

  /** GET /users: list users in the acting admin's tenant. */
  async listUsers(): Promise<TenantUser[]> {
    const tenantId = this.requireTenant();
    const rows = await this.ctx.dbTx
      .select()
      .from(tenantUsers)
      .where(eq(tenantUsers.tenantId, tenantId))
      .orderBy(desc(tenantUsers.createdAt));
    return rows.map(toTenantUser);
  }

  /** PATCH /users/{id}: change role and/or enable/disable. */
  async updateUser(userId: string, input: UpdateUserRequest): Promise<TenantUser> {
    const tenantId = this.requireTenant();
    const target = await this.loadUser(userId);

    if (input.role && input.role !== target.role) {
      await this.identity.setTenantUserRole(this.ctx.dbTx, userId, input.role);
    }
    if (input.status && input.status !== target.status) {
      await this.identity.setTenantUserDisabled(this.ctx.dbTx, userId, input.status === 'disabled');
    }

    const rows = await this.ctx.dbTx
      .select()
      .from(tenantUsers)
      .where(and(eq(tenantUsers.id, userId), eq(tenantUsers.tenantId, tenantId)))
      .limit(1);
    return toTenantUser(rows[0]!);
  }

  /** POST /users/{id}/reset-password: set new password, re-arm mustChangePassword. */
  async resetPassword(userId: string, input: ResetPasswordRequest): Promise<TenantUser> {
    const tenantId = this.requireTenant();
    await this.loadUser(userId);

    await this.identity.resetTenantUserPassword(this.ctx.dbTx, userId, input.password);

    const rows = await this.ctx.dbTx
      .select()
      .from(tenantUsers)
      .where(and(eq(tenantUsers.id, userId), eq(tenantUsers.tenantId, tenantId)))
      .limit(1);
    return toTenantUser(rows[0]!);
  }

  /** Load a user inside the acting tenant or 404 (RLS + explicit predicate). */
  private async loadUser(userId: string): Promise<typeof tenantUsers.$inferSelect> {
    const tenantId = this.requireTenant();
    const rows = await this.ctx.dbTx
      .select()
      .from(tenantUsers)
      .where(and(eq(tenantUsers.id, userId), eq(tenantUsers.tenantId, tenantId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new AppException('not_found', 'User not found', HttpStatus.NOT_FOUND);
    }
    return row;
  }
}
