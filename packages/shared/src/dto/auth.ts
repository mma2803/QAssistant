import { z } from 'zod';
import { uuid, nonEmptyString } from '../common.js';
import { ROLES, TOKEN_ROLES } from '../enums.js';
import { tenantSchema, projectSchema } from '../entities.js';

/** Identity derived from the verified Identity Platform ID token (contract section 1). */
export const authContextSchema = z.object({
  uid: z.string(),
  role: z.enum(TOKEN_ROLES),
  // Present for tenant users; absent for super-admin.
  tenantId: uuid.nullable(),
  mustChangePassword: z.boolean(),
});
export type AuthContext = z.infer<typeof authContextSchema>;

/** POST /auth/complete-password-change */
export const completePasswordChangeRequestSchema = z.object({
  newPassword: z.string().min(8),
});
export type CompletePasswordChangeRequest = z.infer<typeof completePasswordChangeRequestSchema>;

/** GET /auth/me response: resolved identity + tenant/projects bootstrap. */
export const authMeResponseSchema = z.object({
  uid: z.string(),
  role: z.enum(TOKEN_ROLES),
  tenantId: uuid.nullable(),
  mustChangePassword: z.boolean(),
  tenant: tenantSchema.nullable(),
  projects: z.array(projectSchema),
});
export type AuthMeResponse = z.infer<typeof authMeResponseSchema>;

/** Shared role assignment input (admin user management). */
export const roleSchema = z.enum(ROLES);

export const passwordSchema = nonEmptyString.min(8);
