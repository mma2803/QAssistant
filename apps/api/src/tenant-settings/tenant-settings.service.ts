import { HttpStatus, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { TenantSettingsResponse, UpdateTenantSettingsRequest } from '@qassistant/shared';
import { RequestContext } from '../auth/request-context.js';
import { AppException } from '../auth/errors.js';
import { tenants } from '../db/schema.js';

/**
 * Tenant-wide codegen settings (change: configurable-test-framework). Reads and
 * writes run in the RLS-scoped request transaction against the caller's own
 * tenant row. ANY tenant user (admin or qa-engineer) may change the default
 * framework/language: it is a team preference, not a privileged provisioning
 * action, and migration 0002 grants app_user a column-scoped UPDATE on exactly
 * the two default_* columns (+ updated_at) plus a self-row UPDATE policy.
 */
@Injectable()
export class TenantSettingsService {
  constructor(private readonly ctx: RequestContext) {}

  private requireTenant(): string {
    const tenantId = this.ctx.tenantId;
    if (!tenantId) {
      throw new AppException('forbidden', 'Tenant scope required', HttpStatus.FORBIDDEN);
    }
    return tenantId;
  }

  /** GET /tenant/settings */
  async get(): Promise<TenantSettingsResponse> {
    const tenantId = this.requireTenant();
    const rows = await this.ctx.dbTx
      .select({
        defaultTestFramework: tenants.defaultTestFramework,
        defaultTestLanguage: tenants.defaultTestLanguage,
        defaultTestType: tenants.defaultTestType,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new AppException('not_found', 'Tenant not found', HttpStatus.NOT_FOUND);
    }
    return row as TenantSettingsResponse;
  }

  /** PUT /tenant/settings: change the tenant-wide default codegen target. */
  async update(input: UpdateTenantSettingsRequest): Promise<TenantSettingsResponse> {
    const tenantId = this.requireTenant();
    const [row] = await this.ctx.dbTx
      .update(tenants)
      .set({
        defaultTestFramework: input.defaultTestFramework,
        defaultTestLanguage: input.defaultTestLanguage,
        ...(input.defaultTestType !== undefined
          ? { defaultTestType: input.defaultTestType }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))
      .returning({
        defaultTestFramework: tenants.defaultTestFramework,
        defaultTestLanguage: tenants.defaultTestLanguage,
        defaultTestType: tenants.defaultTestType,
      });
    if (!row) {
      throw new AppException('not_found', 'Tenant not found', HttpStatus.NOT_FOUND);
    }
    return row as TenantSettingsResponse;
  }
}
