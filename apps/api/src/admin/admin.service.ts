import { HttpStatus, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type {
  CreateTenantRequest,
  CreateTenantResponse,
  Tenant,
  TenantUser,
  UpdateTenantRequest,
} from '@qassistant/shared';
import { DbService, type Database } from '../db/db.service.js';
import { IdentityService } from '../auth/identity.service.js';
import { tenants, tenantUsers } from '../db/schema.js';
import { newId } from '../db/id.js';
import { AppException } from '../auth/errors.js';
import { toTenant, toTenantUser } from '../common/serializers.js';
import { slugify } from '../common/slugify.js';

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

  /** POST /admin/tenants: create the tenants row + first admin user. */
  async createTenant(input: CreateTenantRequest): Promise<CreateTenantResponse> {
    const tenantId = newId();

    return this.db.withSuperadmin(async ({ db }) => {
      const slug = await this.uniqueSlug(db, input.name);
      const [tenantRow] = await db
        .insert(tenants)
        .values({ id: tenantId, name: input.name, slug, status: 'active' })
        .returning();

      const firstAdminId = await this.identity.createTenantUser(db, {
        tenantId,
        email: input.firstAdmin.email,
        password: input.firstAdmin.password,
        role: 'admin',
      });
      const [userRow] = await db.select().from(tenantUsers).where(eq(tenantUsers.id, firstAdminId));

      return {
        tenant: toTenant(tenantRow!),
        firstAdmin: toTenantUser(userRow!),
      };
    });
  }

  /** Generate a URL-safe, unique tenant slug from the display name (login-time tenant selector). */
  private async uniqueSlug(db: Database, name: string): Promise<string> {
    const base = slugify(name) || 'tenant';
    let candidate = base;
    let suffix = 0;
    // Small tenant counts expected; a short linear probe is fine.
    for (;;) {
      const existing = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, candidate)).limit(1);
      if (existing.length === 0) return candidate;
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
  }

  /** GET /admin/tenants: list all tenants (privileged path, no RLS). */
  async listTenants(): Promise<Tenant[]> {
    return this.db.withSuperadmin(async ({ db }) => {
      const rows = await db.select().from(tenants).orderBy(desc(tenants.createdAt));
      return rows.map(toTenant);
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
