import { z } from 'zod';
import { nonEmptyString } from '../common.js';
import { TENANT_STATUSES, ROLES } from '../enums.js';
import { tenantSchema, tenantUserSchema } from '../entities.js';
import { passwordSchema } from './auth.js';

/**
 * Super-admin provisioning DTOs (contract section 4.1). Privileged path, no
 * tenant session var.
 */

/** POST /admin/tenants: create tenant (a `tenants` row with a generated slug) + first admin user. */
export const createTenantRequestSchema = z.object({
  name: nonEmptyString,
  firstAdmin: z.object({
    email: z.string().email(),
    password: passwordSchema,
  }),
});
export type CreateTenantRequest = z.infer<typeof createTenantRequestSchema>;

export const createTenantResponseSchema = z.object({
  tenant: tenantSchema,
  firstAdmin: tenantUserSchema,
});
export type CreateTenantResponse = z.infer<typeof createTenantResponseSchema>;

/** PATCH /admin/tenants/{tenantId}: set tenant status. */
export const updateTenantRequestSchema = z.object({
  status: z.enum(TENANT_STATUSES),
});
export type UpdateTenantRequest = z.infer<typeof updateTenantRequestSchema>;

/**
 * Tenant user management DTOs (contract section 4.2). Admin SDK-backed.
 */

/** POST /users: create user, set initial password, assign role, mark mustChangePassword. */
export const createUserRequestSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  role: z.enum(ROLES),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

/** PATCH /users/{userId}: change role / disable / enable. */
export const updateUserRequestSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: 'At least one of role or status is required',
  });
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

/** POST /users/{userId}/reset-password: set new password, mark mustChangePassword. */
export const resetPasswordRequestSchema = z.object({
  password: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
