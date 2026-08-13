import { z } from 'zod';
import { nonEmptyString, uuid, isoTimestamp } from '../common.js';
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
 * Reusable tenant signup links (change: tenant-signup-links). The super-admin
 * issues an expiring, reusable link; a recipient redeems it (public path) to
 * self-provision a tenant + first admin. Only a hash of the token is stored;
 * the plaintext token is returned exactly once at issue time.
 */

/** Derived status of a signup link (not stored: computed from expiry/revocation). */
export const INVITATION_STATUSES = ['active', 'expired', 'revoked'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** POST /admin/tenants/invitations: issue a link. Expiry is in days (1..90). */
export const createInvitationRequestSchema = z.object({
  expiresInDays: z.number().int().min(1).max(90),
});
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

/** Issue response: the plaintext token is returned ONCE (never recoverable later). */
export const createInvitationResponseSchema = z.object({
  id: uuid,
  token: z.string(),
  expiresAt: isoTimestamp,
});
export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>;

/** A tenant provisioned through a signup link, with the account that redeemed it. */
export const invitationRedeemerSchema = z.object({
  tenantId: uuid,
  name: z.string(),
  slug: z.string(),
  /** Email of the tenant's first admin (the person who used the link); null if unknown. */
  adminEmail: z.string().nullable(),
  createdAt: isoTimestamp,
});
export type InvitationRedeemer = z.infer<typeof invitationRedeemerSchema>;

/** Listing entity (GET /admin/tenants/invitations). Never exposes the token/hash. */
export const invitationSchema = z.object({
  id: uuid,
  expiresAt: isoTimestamp,
  revokedAt: isoTimestamp.nullable(),
  createdTenantCount: z.number().int().nonnegative(),
  /** Which tenants (and the admin who created them) were provisioned via this link. */
  createdTenants: z.array(invitationRedeemerSchema),
  status: z.enum(INVITATION_STATUSES),
  createdAt: isoTimestamp,
});
export type Invitation = z.infer<typeof invitationSchema>;

/** GET /signup/{token} (public): reports only validity + expiry, nothing identifying. */
export const validateInvitationResponseSchema = z.object({
  valid: z.boolean(),
  expiresAt: isoTimestamp.nullable(),
});
export type ValidateInvitationResponse = z.infer<typeof validateInvitationResponseSchema>;

/** POST /signup (public): redeem a link to create a tenant + its first admin. */
export const redeemInvitationRequestSchema = z.object({
  token: nonEmptyString,
  name: nonEmptyString,
  firstAdmin: z.object({
    email: z.string().email(),
    password: passwordSchema,
  }),
});
export type RedeemInvitationRequest = z.infer<typeof redeemInvitationRequestSchema>;

/** Redemption returns the same shape as a direct tenant creation. */
export const redeemInvitationResponseSchema = createTenantResponseSchema;
export type RedeemInvitationResponse = z.infer<typeof redeemInvitationResponseSchema>;

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
