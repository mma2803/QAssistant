import { z } from 'zod';
import { testFrameworkSchema, testLanguageSchema } from '../common.js';

/**
 * Tenant-wide codegen settings (change: configurable-test-framework). Unlike the
 * super-admin /admin/tenants routes, these are tenant-scoped and open to ANY
 * tenant user (admin or qa-engineer): the default framework/language is a team
 * preference, not a privileged provisioning action.
 */

/** GET /tenant/settings */
export const tenantSettingsResponseSchema = z.object({
  defaultTestFramework: z.string(),
  defaultTestLanguage: z.string(),
});
export type TenantSettingsResponse = z.infer<typeof tenantSettingsResponseSchema>;

/** PUT /tenant/settings: change the tenant-wide default codegen target. */
export const updateTenantSettingsRequestSchema = z.object({
  defaultTestFramework: testFrameworkSchema,
  defaultTestLanguage: testLanguageSchema,
});
export type UpdateTenantSettingsRequest = z.infer<typeof updateTenantSettingsRequestSchema>;
