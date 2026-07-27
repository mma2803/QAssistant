import { HttpStatus, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Role } from '@qassistant/shared/enums';
import { DbService, type Database } from '../db/db.service.js';
import { tenantUsers, superAdmins } from '../db/schema.js';
import { newId } from '../db/id.js';
import { AppException } from './errors.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

/**
 * Self-hosted replacement for the Firebase Admin SDK wrapper (firebase.service.ts).
 * Same public shape as before, minus the `gcipTenantId` parameter everywhere
 * (there is no separate provider-tenant concept anymore — `tenants.id` is the
 * only tenant identifier).
 *
 * Every method except `createSuperAdmin` takes the caller's already-open `db`
 * handle (the request's RLS-scoped or superadmin transaction from
 * RequestContext.dbTx) rather than opening its own — an admin managing users
 * in their own tenant must still go through the RLS-enforced app_user pool,
 * exactly as before, so creating/updating a tenant_users row stays subject to
 * the `tenant_isolation` policy rather than bypassing it. `createSuperAdmin`
 * is the one exception: it is called from the standalone seed script, which
 * has no request/transaction context, so it manages its own connection.
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly db: DbService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /** Idempotent on email: creates the super-admin, or resets its password if it already exists. */
  async createSuperAdmin(email: string, password: string): Promise<string> {
    const passwordHash = await this.password.hashPassword(password);
    return this.db.withSuperadmin(async ({ db }) => {
      const existing = await db.select().from(superAdmins).where(eq(superAdmins.email, email)).limit(1);
      if (existing[0]) {
        await db
          .update(superAdmins)
          .set({ passwordHash, status: 'active', updatedAt: new Date() })
          .where(eq(superAdmins.id, existing[0].id));
        return existing[0].id;
      }
      const id = newId();
      await db.insert(superAdmins).values({
        id,
        email,
        passwordHash,
        // Unlike a tenant user's admin-set password, the super-admin's
        // password is operator-chosen (via the seed script's own env vars) —
        // nobody else ever knew it, so there is nothing to force a change from.
        mustChangePassword: false,
        status: 'active',
      });
      return id;
    });
  }

  /** Create a tenant user, hash + store the admin-set initial password, arm mustChangePassword. */
  async createTenantUser(
    db: Database,
    params: { tenantId: string; email: string; password: string; role: Role },
  ): Promise<string> {
    const passwordHash = await this.password.hashPassword(params.password);
    const id = newId();
    await db.insert(tenantUsers).values({
      id,
      tenantId: params.tenantId,
      email: params.email,
      passwordHash,
      role: params.role,
      status: 'active',
      mustChangePassword: true,
    });
    return id;
  }

  /** Re-assign a tenant user's role. */
  async setTenantUserRole(db: Database, userId: string, role: Role): Promise<void> {
    await db.update(tenantUsers).set({ role, updatedAt: new Date() }).where(eq(tenantUsers.id, userId));
  }

  /** Enable or disable sign-in for a tenant user; disabling revokes every outstanding token. */
  async setTenantUserDisabled(db: Database, userId: string, disabled: boolean): Promise<void> {
    await db
      .update(tenantUsers)
      .set({ status: disabled ? 'disabled' : 'active', updatedAt: new Date() })
      .where(eq(tenantUsers.id, userId));
    if (disabled) {
      await this.tokens.revokeAllForSubject('tenant_user', userId);
    }
  }

  /** Admin-driven password reset: set a new password, re-arm mustChangePassword, revoke sessions. */
  async resetTenantUserPassword(db: Database, userId: string, password: string): Promise<void> {
    const passwordHash = await this.password.hashPassword(password);
    await db
      .update(tenantUsers)
      .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(eq(tenantUsers.id, userId));
    await this.tokens.revokeAllForSubject('tenant_user', userId);
  }

  /** Clear the mustChangePassword marker after the user has set a new password. */
  async clearMustChangePassword(db: Database, userId: string): Promise<void> {
    await db
      .update(tenantUsers)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(eq(tenantUsers.id, userId));
  }

  /**
   * Set a tenant user's password as part of completing a forced change
   * (self-service; does not revoke the current session, unlike an admin reset).
   */
  async setTenantUserPassword(db: Database, userId: string, password: string): Promise<void> {
    const passwordHash = await this.password.hashPassword(password);
    await db
      .update(tenantUsers)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(tenantUsers.id, userId));
  }

  async requireTenantUserRow(db: Database, userId: string) {
    const rows = await db.select().from(tenantUsers).where(eq(tenantUsers.id, userId)).limit(1);
    const row = rows[0];
    if (!row) {
      throw new AppException('not_found', 'User not found', HttpStatus.NOT_FOUND);
    }
    return row;
  }
}
