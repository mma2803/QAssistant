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

/** POST /auth/login. Omit tenantSlug to authenticate as the super-admin. */
export const loginRequestSchema = z.object({
  tenantSlug: nonEmptyString.optional(),
  email: z.string().email(),
  password: nonEmptyString,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** POST /auth/login and POST /auth/refresh response. */
export const tokenPairResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  uid: z.string(),
  role: z.enum(TOKEN_ROLES),
  tenantId: uuid.nullable(),
  mustChangePassword: z.boolean(),
  expiresAt: z.string(),
});
export type TokenPairResponse = z.infer<typeof tokenPairResponseSchema>;

/** POST /auth/refresh */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().optional(),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

/** POST /auth/logout */
export const logoutRequestSchema = z.object({
  refreshToken: z.string().optional(),
});
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;

/** POST /auth/complete-password-change */
export const completePasswordChangeRequestSchema = z.object({
  newPassword: z.string().min(8),
});
export type CompletePasswordChangeRequest = z.infer<typeof completePasswordChangeRequestSchema>;

/** GET /auth/me response: resolved identity + tenant/projects bootstrap. */
export const authMeResponseSchema = z.object({
  uid: z.string(),
  /** The signed-in account's email, for display (uid is an opaque internal id). */
  email: z.string().email().nullable(),
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
