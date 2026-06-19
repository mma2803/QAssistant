import { HttpStatus, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type {
  CreateUserRequest,
  ResetPasswordRequest,
  TenantUser,
  UpdateUserRequest,
} from '@qassistant/shared';
import { RequestContext } from '../auth/request-context.js';
import { FirebaseService } from '../auth/firebase.service.js';
import { tenants, tenantUsers } from '../db/schema.js';
import { newId } from '../db/id.js';
import { AppException } from '../auth/errors.js';
import { toTenantUser } from '../common/serializers.js';

/**
 * Tenant user management via the Admin SDK (contract section 4.2). All routes
 * are admin-only (enforced by the controller role guard); qa-engineer cannot
 * reach them. Every query runs inside the request transaction (ctx.dbTx) which
 * is already RLS-scoped to the acting admin's tenant, and we additionally pass
 * an explicit tenant_id predicate (defense in depth, D10, task 2.8).
 *
 * Each mutating call keeps GCIP (Identity Platform) and the `tenant_users`
 * mirror row in sync (task 2.6).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly ctx: RequestContext,
    private readonly firebase: FirebaseService,
  ) {}

  /** Resolve the acting tenant's GCIP tenant id (needed for tenant-scoped Admin SDK calls). */
  private async gcipTenantId(): Promise<string> {
    const tenantId = this.requireTenant();
    const rows = await this.ctx.dbTx
      .select({ gcipTenantId: tenants.gcipTenantId })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new AppException('not_found', 'Tenant not found', HttpStatus.NOT_FOUND);
    }
    return row.gcipTenantId;
  }

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
    const gcipTenantId = await this.gcipTenantId();

    // Reject a duplicate email within the tenant before touching GCIP.
    const existing = await this.ctx.dbTx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.email, input.email)))
      .limit(1);
    if (existing.length > 0) {
      throw new AppException('conflict', 'A user with this email already exists', HttpStatus.CONFLICT);
    }

    const gcipUid = await this.firebase.createTenantUser({
      gcipTenantId,
      appTenantId: tenantId,
      email: input.email,
      password: input.password,
      role: input.role,
    });

    const [row] = await this.ctx.dbTx
      .insert(tenantUsers)
      .values({
        id: newId(),
        tenantId,
        gcipUid,
        email: input.email,
        role: input.role,
        status: 'active',
        mustChangePassword: true,
      })
      .returning();
    return toTenantUser(row!);
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
    const gcipTenantId = await this.gcipTenantId();
    const target = await this.loadUser(userId);

    const nextRole = input.role ?? (target.role as 'admin' | 'qa-engineer');

    if (input.role && input.role !== target.role) {
      await this.firebase.setTenantUserRole(gcipTenantId, target.gcipUid, tenantId, input.role);
    }
    if (input.status && input.status !== target.status) {
      await this.firebase.setTenantUserDisabled(
        gcipTenantId,
        target.gcipUid,
        input.status === 'disabled',
      );
    }

    const [row] = await this.ctx.dbTx
      .update(tenantUsers)
      .set({
        ...(input.role ? { role: nextRole } : {}),
        ...(input.status ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(tenantUsers.id, userId), eq(tenantUsers.tenantId, tenantId)))
      .returning();
    return toTenantUser(row!);
  }

  /** POST /users/{id}/reset-password: set new password, re-arm mustChangePassword. */
  async resetPassword(userId: string, input: ResetPasswordRequest): Promise<TenantUser> {
    const tenantId = this.requireTenant();
    const gcipTenantId = await this.gcipTenantId();
    const target = await this.loadUser(userId);

    await this.firebase.resetTenantUserPassword(
      gcipTenantId,
      target.gcipUid,
      tenantId,
      target.role as 'admin' | 'qa-engineer',
      input.password,
    );

    const [row] = await this.ctx.dbTx
      .update(tenantUsers)
      .set({ mustChangePassword: true, updatedAt: new Date() })
      .where(and(eq(tenantUsers.id, userId), eq(tenantUsers.tenantId, tenantId)))
      .returning();
    return toTenantUser(row!);
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
