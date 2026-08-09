import { HttpStatus, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  AuthMeResponse,
  CompletePasswordChangeRequest,
  LoginRequest,
  TokenPairResponse,
} from '@qassistant/shared';
import { RequestContext } from '../auth/request-context.js';
import { IdentityService } from '../auth/identity.service.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService, type IssuedTokenPair } from '../auth/token.service.js';
import { DbService } from '../db/db.service.js';
import { projects, tenants, tenantUsers, superAdmins } from '../db/schema.js';
import { AppException } from '../auth/errors.js';
import { toProject, toTenant } from '../common/serializers.js';

/**
 * Self-hosted auth routes (contract section 4.2, extended by the self-hosted
 * auth migration):
 *  - POST /auth/login: password login, tenant-scoped (tenantSlug) or
 *    super-admin (no tenantSlug). Issues an access+refresh pair.
 *  - POST /auth/refresh: redeem a refresh token for a new pair (rotated).
 *  - POST /auth/logout: revoke a refresh token.
 *  - POST /auth/complete-password-change: the ONLY mutating call allowed while
 *    the mustChangePassword marker is set. Sets the new password and clears
 *    the marker.
 *  - GET /auth/me: resolved identity + tenant/projects bootstrap.
 *
 * login/refresh/logout are unauthenticated (@Public()) and read outside the
 * request transaction (DbService.superadmin: a non-transactional handle on
 * the BYPASSRLS pool — there is no tenant RLS context yet before a token
 * exists). complete-password-change and me rely on the request transaction
 * (RLS-scoped) and the verified identity in RequestContext.
 */
@Injectable()
export class AuthRoutesService {
  constructor(
    private readonly ctx: RequestContext,
    private readonly db: DbService,
    private readonly identity: IdentityService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /** POST /auth/login. */
  async login(input: LoginRequest): Promise<TokenPairResponse> {
    const invalid = () =>
      new AppException('unauthenticated', 'Invalid credentials', HttpStatus.UNAUTHORIZED);

    if (!input.tenantSlug) {
      const rows = await this.db.superadmin
        .select()
        .from(superAdmins)
        .where(eq(superAdmins.email, input.email))
        .limit(1);
      const admin = rows[0];
      if (!admin || admin.status !== 'active') {
        await this.password.verifyDummyPassword(input.password);
        throw invalid();
      }
      const ok = await this.password.verifyPassword(admin.passwordHash, input.password);
      if (!ok) throw invalid();
      return toTokenPairResponse(await this.tokens.issueTokenPair('super_admin', admin.id));
    }

    const tenantRows = await this.db.superadmin
      .select()
      .from(tenants)
      .where(eq(tenants.slug, input.tenantSlug))
      .limit(1);
    const tenant = tenantRows[0];
    if (!tenant) {
      await this.password.verifyDummyPassword(input.password);
      throw invalid();
    }

    const userRows = await this.db.superadmin
      .select()
      .from(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tenant.id), eq(tenantUsers.email, input.email)))
      .limit(1);
    const user = userRows[0];
    if (!user || user.status !== 'active') {
      await this.password.verifyDummyPassword(input.password);
      throw invalid();
    }
    const ok = await this.password.verifyPassword(user.passwordHash, input.password);
    if (!ok) throw invalid();

    return toTokenPairResponse(await this.tokens.issueTokenPair('tenant_user', user.id));
  }

  /** POST /auth/refresh. */
  async refresh(refreshToken: string | undefined): Promise<TokenPairResponse> {
    if (!refreshToken) {
      throw new AppException('unauthenticated', 'Missing refresh token', HttpStatus.UNAUTHORIZED);
    }
    return toTokenPairResponse(await this.tokens.refresh(refreshToken));
  }

  /** POST /auth/logout. */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.tokens.revokeRefreshToken(refreshToken);
    }
  }

  /** POST /auth/complete-password-change: set new password, clear the marker. */
  async completePasswordChange(input: CompletePasswordChangeRequest): Promise<{ mustChangePassword: false }> {
    const tenantId = this.ctx.tenantId;
    const actingUserId = this.ctx.actingUserId;
    if (!tenantId || !actingUserId) {
      throw new AppException('forbidden', 'Tenant user required', HttpStatus.FORBIDDEN);
    }

    await this.identity.setTenantUserPassword(this.ctx.dbTx, actingUserId, input.newPassword);
    await this.identity.clearMustChangePassword(this.ctx.dbTx, actingUserId);

    return { mustChangePassword: false };
  }

  /** GET /auth/me: resolved identity + tenant/active-projects bootstrap. */
  async me(): Promise<AuthMeResponse> {
    // Super-admin: project-level, no tenant binding (D10). No bootstrap data.
    if (this.ctx.isSuperAdmin() || !this.ctx.tenantId) {
      const superRows = await this.ctx.dbTx
        .select({ email: superAdmins.email })
        .from(superAdmins)
        .where(eq(superAdmins.id, this.ctx.uid))
        .limit(1);
      return {
        uid: this.ctx.uid,
        email: superRows[0]?.email ?? null,
        role: this.ctx.role,
        tenantId: this.ctx.tenantId,
        mustChangePassword: this.ctx.mustChangePassword,
        tenant: null,
        projects: [],
      };
    }

    const tenantId = this.ctx.tenantId;

    const tenantRows = await this.ctx.dbTx
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    // Active projects in the tenant (extension/dashboard bootstrap; D4 "select a
    // project before capture"). qa-engineer and admin both see all active
    // projects in their tenant (D12 tenant-wide access).
    const projectRows = await this.ctx.dbTx
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.status, 'active')));

    const userRows = await this.ctx.dbTx
      .select({ email: tenantUsers.email })
      .from(tenantUsers)
      .where(eq(tenantUsers.id, this.ctx.uid))
      .limit(1);

    return {
      uid: this.ctx.uid,
      email: userRows[0]?.email ?? null,
      role: this.ctx.role,
      tenantId: this.ctx.tenantId,
      mustChangePassword: this.ctx.mustChangePassword,
      tenant: tenantRows[0] ? toTenant(tenantRows[0]) : null,
      projects: projectRows.map(toProject),
    };
  }
}

function toTokenPairResponse(pair: IssuedTokenPair): TokenPairResponse {
  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    uid: pair.uid,
    role: pair.role,
    tenantId: pair.tenantId,
    mustChangePassword: pair.mustChangePassword,
    expiresAt: pair.expiresAt,
  };
}
