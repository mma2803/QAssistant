import { SetMetadata } from '@nestjs/common';

/**
 * Route metadata consumed by the AuthGuard. Feature modules annotate their
 * controllers/handlers with these.
 */

/** Skip token verification entirely (health, internal worker endpoints handle their own auth). */
export const IS_PUBLIC = 'auth:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Allow this route even when the verified token carries mustChangePassword.
 * Only /auth/complete-password-change and /auth/me set this (contract section 4.2).
 */
export const ALLOW_PASSWORD_CHANGE = 'auth:allowDuringPasswordChange';
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE, true);

/** Restrict the route to the super-admin role (privileged provisioning path). */
export const SUPER_ADMIN_ONLY = 'auth:superAdminOnly';
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY, true);

/** Restrict the route to one or more tenant roles (admin / qa-engineer). */
export const REQUIRED_ROLES = 'auth:requiredRoles';
export const Roles = (...roles: Array<'admin' | 'qa-engineer'>) =>
  SetMetadata(REQUIRED_ROLES, roles);
