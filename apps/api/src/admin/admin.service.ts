import { HttpStatus, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type {
  CreateTenantRequest,
  CreateTenantResponse,
  Tenant,
  TenantUser,
  UpdateTenantRequest,
} from '@qassistant/shared';
import { DbService } from '../db/db.service.js';
import { FirebaseService } from '../auth/firebase.service.js';
import { tenants, tenantUsers } from '../db/schema.js';
import { newId } from '../db/id.js';
import { AppException } from '../auth/errors.js';
import { toTenant, toTenantUser } from '../common/serializers.js';

/**
 * Super-admin provisioning (contract section 4.1). Runs on the privileged
 * BYPASSRLS path (DbService.withSuperadmin): the super-admin has no tenant
 * binding (D10/D24) so it must not set app.tenant_id.
 *
 * Creating a tenant is a two-system write: a GCIP tenant (Identity Platform)
 * plus the `tenants` row, then the first admin user in that GCIP tenant plus
 * its `tenant_users` mirror row. The DB writes share one transaction; the GCIP
 * writes happen first so a DB failure rolls back to a state where the only
 * orphan is an unused GCIP tenant/user (acceptable for MVP; no email sent).
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly db: DbService,
    private readonly firebase: FirebaseService,
  ) {}

  /** POST /admin/tenants: create GCIP tenant + tenants row + first admin user. */
  async createTenant(input: CreateTenantRequest): Promise<CreateTenantResponse> {
    const gcipTenantId = await this.firebase.createGcipTenant(input.name);

    const tenantId = newId();
    const firstAdminUid = await this.firebase.createTenantUser({
      gcipTenantId,
      appTenantId: tenantId,
      email: input.firstAdmin.email,
      password: input.firstAdmin.password,
      role: 'admin',
    });

    return this.db.withSuperadmin(async ({ db }) => {
      const [tenantRow] = await db
        .insert(tenants)
        .values({ id: tenantId, name: input.name, gcipTenantId, status: 'active' })
        .returning();

      const [userRow] = await db
        .insert(tenantUsers)
        .values({
          id: newId(),
          tenantId,
          gcipUid: firstAdminUid,
          email: input.firstAdmin.email,
          role: 'admin',
          status: 'active',
          mustChangePassword: true,
        })
        .returning();

      return {
        tenant: toTenant(tenantRow!),
        firstAdmin: toTenantUser(userRow!),
      };
    });
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
