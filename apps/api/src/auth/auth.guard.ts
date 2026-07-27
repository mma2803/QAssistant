import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { TokenRole, Role } from '@qassistant/shared/enums';
import { TokenService } from './token.service.js';
import { getRequestState } from './request-context.js';
import {
  IS_PUBLIC,
  ALLOW_PASSWORD_CHANGE,
  SUPER_ADMIN_ONLY,
  REQUIRED_ROLES,
} from './decorators.js';
import { MustChangePasswordException } from './errors.js';

/**
 * Verifies the opaque bearer access token and populates the request-scoped
 * RequestContext with the verified identity (contract section 1, steps 1-2).
 * Also enforces:
 *   - the must_change_password gate (blocks everything except the two allowed
 *     routes when the marker is set, contract section 4.2),
 *   - super-admin-only routes,
 *   - tenant role requirements.
 *
 * It does NOT open the DB transaction; that is the TransactionInterceptor's job
 * (it runs after guards and wraps the handler). The two share the same
 * request-scoped RequestContext instance.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const ctx = getRequestState(req);
    const token = extractBearer(req.header('authorization'));
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let decoded;
    try {
      decoded = await this.tokens.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const role = decoded.role as TokenRole | undefined;
    if (!role) {
      throw new UnauthorizedException('Token is missing the role claim');
    }

    ctx.uid = decoded.uid;
    ctx.role = role;
    ctx.tenantId = role === 'super-admin' ? null : (decoded.tenantId as string | undefined) ?? null;
    ctx.mustChangePassword = decoded.mustChangePassword === true;

    if (role !== 'super-admin' && !ctx.tenantId) {
      throw new UnauthorizedException('Tenant user token is missing the tenantId claim');
    }

    // must_change_password gate: only the two allowlisted routes pass.
    if (ctx.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw new MustChangePasswordException();
      }
    }

    // Super-admin-only routes.
    const superAdminOnly = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (superAdminOnly && role !== 'super-admin') {
      throw new ForbiddenException('Super-admin only');
    }
    // A super-admin token must not reach tenant-scoped routes.
    if (!superAdminOnly && role === 'super-admin') {
      throw new ForbiddenException('Super-admin may only use provisioning endpoints');
    }

    // Tenant role requirements.
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles && requiredRoles.length > 0) {
      if (role === 'super-admin' || !requiredRoles.includes(role)) {
        throw new ForbiddenException('Insufficient role');
      }
    }

    return true;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}
