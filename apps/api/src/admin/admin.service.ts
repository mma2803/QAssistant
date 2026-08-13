import { HttpStatus, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  CreateTenantRequest,
  CreateTenantResponse,
  Tenant,
  TenantUser,
  UpdateTenantRequest,
} from '@qassistant/shared';
import { DbService, type Database } from '../db/db.service.js';
import { IdentityService } from '../auth/identity.service.js';
import { authTokens, tenants, tenantUsers } from '../db/schema.js';
import { newId } from '../db/id.js';
import { AppException } from '../auth/errors.js';
import { toTenant, toTenantUser } from '../common/serializers.js';
import { slugify } from '../common/slugify.js';

/** Parameters shared by both provisioning paths (direct create + link redeem). */
export interface ProvisionTenantInput {
  name: string;
  firstAdmin: { email: string; password: string };
  /** true → first admin must change password on first login; false for link redeem (D5). */
  forcePasswordChange: boolean;
  /** 'suffix' → auto `-1` on slug collision (direct); 'reject' → 409 (link redeem, D4). */
  onDuplicateName: 'suffix' | 'reject';
  /** The signup link that provisioned this tenant, if any (D1). */
  invitationId?: string;
}

/**
 * Super-admin provisioning (contract section 4.1). Runs on the privileged
 * BYPASSRLS path (DbService.withSuperadmin): the super-admin has no tenant
 * binding (D10/D24) so it must not set app.tenant_id.
 *
 * Creating a tenant is a single transaction now that identity lives directly
 * in Postgres: insert the `tenants` row (with a generated slug), then the
 * first admin's `tenant_users` row via IdentityService (hashes the
 * admin-chosen initial password).
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly db: DbService,
    private readonly identity: IdentityService,
  ) {}

  /** POST /admin/tenants: create the tenants row + first admin user (plan B, unchanged behavior). */
  async createTenant(input: CreateTenantRequest): Promise<CreateTenantResponse> {
    return this.db.withSuperadmin(({ db }) =>
      this.provisionTenant(db, {
        name: input.name,
        firstAdmin: input.firstAdmin,
        forcePasswordChange: true,
        onDuplicateName: 'suffix',
      }),
    );
  }

  /**
   * Shared tenant + first-admin creation used by both the direct super-admin
   * path (createTenant) and the signup-link redemption (InvitationsService).
   * Runs on the caller's already-open privileged (`withSuperadmin`) transaction
   * so redemption can validate + provision + record the link atomically.
   */
  async provisionTenant(db: Database, input: ProvisionTenantInput): Promise<CreateTenantResponse> {
    const tenantId = newId();
    const slug = await this.resolveSlug(db, input.name, input.onDuplicateName);
    const [tenantRow] = await db
      .insert(tenants)
      .values({
        id: tenantId,
        name: input.name,
        slug,
        status: 'active',
        createdViaInvitationId: input.invitationId ?? null,
      })
      .returning();

    const firstAdminId = await this.identity.createTenantUser(db, {
      tenantId,
      email: input.firstAdmin.email,
      password: input.firstAdmin.password,
      role: 'admin',
      mustChangePassword: input.forcePasswordChange,
    });
    const [userRow] = await db.select().from(tenantUsers).where(eq(tenantUsers.id, firstAdminId));

    return {
      tenant: toTenant(tenantRow!),
      firstAdmin: toTenantUser(userRow!),
    };
  }

  /**
   * Resolve a URL-safe, unique tenant slug from the display name (login-time
   * tenant selector). 'suffix' appends `-1`, `-2`, … on collision (the trusted
   * super-admin sees the result); 'reject' refuses a duplicate name outright
   * (the self-service redeemer must pick another name — D4).
   */
  private async resolveSlug(
    db: Database,
    name: string,
    onDuplicate: 'suffix' | 'reject',
  ): Promise<string> {
    const base = slugify(name) || 'tenant';
    const taken = async (slug: string): Promise<boolean> => {
      const rows = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
      return rows.length > 0;
    };
    if (!(await taken(base))) return base;
    if (onDuplicate === 'reject') {
      throw new AppException(
        'conflict',
        'A tenant with this name already exists',
        HttpStatus.CONFLICT,
      );
    }
    // Small tenant counts expected; a short linear probe is fine.
    for (let suffix = 1; ; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!(await taken(candidate))) return candidate;
    }
  }

  /** GET /admin/tenants: list all tenants (privileged path, no RLS). Soft-deleted ones are hidden. */
  async listTenants(): Promise<Tenant[]> {
    return this.db.withSuperadmin(async ({ db }) => {
      const rows = await db
        .select()
        .from(tenants)
        .where(isNull(tenants.deletedAt))
        .orderBy(desc(tenants.createdAt));
      return rows.map(toTenant);
    });
  }

  /**
   * DELETE /admin/tenants/{id}: soft-delete a tenant (change: tenant soft-delete).
   * Sets `deleted_at`, revokes every outstanding token for the tenant's users so
   * sessions die immediately, and frees the slug so a tenant of the same name can
   * be created later. Data is preserved (reversible); no cascade.
   */
  async deleteTenant(tenantId: string): Promise<void> {
    return this.db.withSuperadmin(async ({ db }) => {
      const now = new Date();
      const users = await db
        .select({ id: tenantUsers.id })
        .from(tenantUsers)
        .where(eq(tenantUsers.tenantId, tenantId));
      const userIds = users.map((u) => u.id);
      if (userIds.length > 0) {
        await db
          .update(authTokens)
          .set({ revokedAt: now })
          .where(
            and(
              eq(authTokens.subjectType, 'tenant_user'),
              inArray(authTokens.subjectId, userIds),
              isNull(authTokens.revokedAt),
            ),
          );
      }
      const [row] = await db
        .update(tenants)
        .set({
          deletedAt: now,
          // Free the slug so the same tenant name can be re-created later.
          slug: sql`${tenants.slug} || '-deleted-' || ${tenantId}`,
          updatedAt: now,
        })
        .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
        .returning({ id: tenants.id });
      if (!row) {
        throw new AppException('not_found', 'Tenant not found', HttpStatus.NOT_FOUND);
      }
    });
  }

  /** PATCH /admin/tenants/{id}: set tenant status active/inactive. */
  async updateTenantStatus(tenantId: string, input: UpdateTenantRequest): Promise<Tenant> {
    return this.db.withSuperadmin(async ({ db }) => {
      const [row] = await db
        .update(tenants)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId))
        .returning();
      if (!row) {
        throw new AppException('not_found', 'Tenant not found', HttpStatus.NOT_FOUND);
      }
      return toTenant(row);
    });
  }
}
