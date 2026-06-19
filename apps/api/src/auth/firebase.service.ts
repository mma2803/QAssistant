import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { initializeApp, getApps, type App, cert, applicationDefault } from 'firebase-admin/app';
import {
  getAuth,
  type Auth,
  type DecodedIdToken,
  type TenantAwareAuth,
  type UserRecord,
} from 'firebase-admin/auth';
import type { Role, TokenRole } from '@qassistant/shared/enums';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';

/** Custom claims baked into a tenant user's ID token (contract section 1, D21). */
export interface TenantUserClaims {
  role: Role;
  tenantId: string;
  mustChangePassword?: boolean;
  [key: string]: unknown;
}

/**
 * Thin wrapper over the Firebase Admin SDK. Verifies Identity Platform ID
 * tokens (design D21) and exposes the Auth instance for the user-management
 * paths implemented by feature modules.
 *
 * Local path: when FIREBASE_AUTH_EMULATOR_HOST is set, the Admin SDK
 * automatically routes verifyIdToken / user management to the Auth emulator
 * (the SDK reads that env var natively), so no live GCIP backend is required
 * for local dev (design D28).
 */
@Injectable()
export class FirebaseService implements OnModuleInit {
  private app!: App;
  private authInstance!: Auth;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onModuleInit(): void {
    if (getApps().length > 0) {
      this.app = getApps()[0]!;
    } else {
      // With the emulator, the SDK ignores credentials but still needs a
      // projectId. In prod, workload identity supplies application default
      // credentials (no key file, design D9).
      const useEmulator = Boolean(this.config.FIREBASE_AUTH_EMULATOR_HOST);
      // firebase-admin treats a present-but-undefined `credential` as invalid
      // (it checks `'credential' in options`), so the key must be OMITTED rather
      // than set to undefined. With the emulator the SDK never exercises the
      // credential, but the constructor still requires a valid Credential
      // object; omitting the key lets it fall back to (lazy) ADC, which is fine.
      const credential = useEmulator ? undefined : safeApplicationDefault();
      this.app = initializeApp({
        projectId: this.config.FIREBASE_PROJECT_ID,
        ...(credential ? { credential } : {}),
      });
    }
    this.authInstance = getAuth(this.app);
  }

  get auth(): Auth {
    return this.authInstance;
  }

  /**
   * Verify an Identity Platform ID token. `checkRevoked=true` so a disabled or
   * revoked user is rejected on the next refresh (the ~1h revocation gap of
   * D21 is accepted for MVP). Throws on any verification failure.
   *
   * Tenant users live under a GCIP tenant, so the `checkRevoked` user lookup
   * must run against the tenant-aware Auth instance, not the project-level one
   * (a project-level getUser never finds a tenant user -> auth/user-not-found).
   * We first verify the signature without the revocation check to read the
   * `firebase.tenant` claim, then re-verify with revocation on the correct
   * Auth instance (tenant-aware for tenant users; project-level for the
   * super-admin). The tenant-aware verify additionally enforces that the
   * token's tenant matches.
   */
  async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    // A tenant user lives under its GCIP tenant, so the token must be verified
    // by the tenant-aware Auth instance: the project-level instance cannot
    // resolve a tenant user (it fails with auth/user-not-found, even before the
    // checkRevoked lookup). The tenant id is read from the (still unverified)
    // JWT payload purely to ROUTE to the right verifier; the subsequent
    // verifyIdToken fully validates the token (and that its tenant matches), so
    // a forged tenant claim cannot pass.
    const tenantId = readTenantClaim(idToken);
    const auth = tenantId ? this.authForTenant(tenantId) : this.authInstance;
    return auth.verifyIdToken(idToken, true);
  }

  // --------------------------------------------------------------------------
  // Provisioning helpers (Admin SDK). Used by the privileged super-admin path
  // (tenant + first-admin creation) and the tenant-admin user-management path.
  // All tenant-user operations are scoped to a GCIP tenant via authForTenant so
  // one GCIP tenant maps to one app tenant (D1, D3).
  // --------------------------------------------------------------------------

  /** Project-level Auth (no GCIP tenant): the super-admin lives here. */
  get projectAuth(): Auth {
    return this.authInstance;
  }

  /** Tenant-scoped Auth for a given GCIP tenant id (D1: one GCIP tenant per app tenant). */
  authForTenant(gcipTenantId: string): TenantAwareAuth {
    return this.authInstance.tenantManager().authForTenant(gcipTenantId);
  }

  /**
   * Create a GCIP tenant (Identity Platform multi-tenancy). Enables the
   * email/password provider; no email sending (MVP) so verification is off.
   * Returns the GCIP tenant id, stored on the `tenants` row.
   */
  async createGcipTenant(displayName: string): Promise<string> {
    const tenant = await this.authInstance.tenantManager().createTenant({
      // GCIP truncates/normalizes displayName; keep it within limits.
      displayName: normalizeTenantDisplayName(displayName),
      emailSignInConfig: { enabled: true, passwordRequired: true },
    });
    return tenant.tenantId;
  }

  /**
   * Create the super-admin GCIP account at project level (no tenant). Idempotent
   * on email: if the account already exists, its uid is returned and the
   * super-admin claim is (re)applied. Used by the bootstrap seed (task 2.1).
   */
  async createSuperAdmin(email: string, password: string): Promise<string> {
    const auth = this.authInstance;
    let user: UserRecord;
    try {
      user = await auth.createUser({ email, password, emailVerified: false });
    } catch (err) {
      if (isEmailExistsError(err)) {
        user = await auth.getUserByEmail(email);
        await auth.updateUser(user.uid, { password });
      } else {
        throw err;
      }
    }
    const claims: Record<string, unknown> = { role: 'super-admin' satisfies TokenRole };
    await auth.setCustomUserClaims(user.uid, claims);
    return user.uid;
  }

  /**
   * Create a tenant user inside the tenant's GCIP tenant, set the initial
   * password, and bake the { role, tenantId, mustChangePassword } claims so the
   * forced-password-change gate fires on first login (contract section 4.2).
   * Returns the new GCIP uid.
   */
  async createTenantUser(params: {
    gcipTenantId: string;
    appTenantId: string;
    email: string;
    password: string;
    role: Role;
  }): Promise<string> {
    const auth = this.authForTenant(params.gcipTenantId);
    const user = await auth.createUser({
      email: params.email,
      password: params.password,
      emailVerified: false,
    });
    await auth.setCustomUserClaims(user.uid, {
      role: params.role,
      tenantId: params.appTenantId,
      mustChangePassword: true,
    } satisfies TenantUserClaims);
    return user.uid;
  }

  /** Re-assign a tenant user's role claim, preserving tenantId / mustChangePassword. */
  async setTenantUserRole(gcipTenantId: string, uid: string, appTenantId: string, role: Role): Promise<void> {
    const auth = this.authForTenant(gcipTenantId);
    const existing = (await auth.getUser(uid)).customClaims ?? {};
    await auth.setCustomUserClaims(uid, {
      ...existing,
      role,
      tenantId: appTenantId,
    });
  }

  /** Enable or disable sign-in for a tenant user (data is preserved; D-disable). */
  async setTenantUserDisabled(gcipTenantId: string, uid: string, disabled: boolean): Promise<void> {
    await this.authForTenant(gcipTenantId).updateUser(uid, { disabled });
  }

  /**
   * Admin-driven password reset: set a new password and re-arm the
   * mustChangePassword marker so the user must change it on next login
   * (contract section 4.2; D3 "reset by an admin, not self-service").
   */
  async resetTenantUserPassword(
    gcipTenantId: string,
    uid: string,
    appTenantId: string,
    role: Role,
    password: string,
  ): Promise<void> {
    const auth = this.authForTenant(gcipTenantId);
    await auth.updateUser(uid, { password });
    await auth.setCustomUserClaims(uid, {
      role,
      tenantId: appTenantId,
      mustChangePassword: true,
    } satisfies TenantUserClaims);
  }

  /**
   * Clear the mustChangePassword marker after the user has set a new password
   * (POST /auth/complete-password-change). Re-applies role/tenantId so the
   * remaining claims are intact.
   */
  async clearMustChangePassword(
    gcipTenantId: string,
    uid: string,
    appTenantId: string,
    role: Role,
  ): Promise<void> {
    await this.authForTenant(gcipTenantId).setCustomUserClaims(uid, {
      role,
      tenantId: appTenantId,
    });
  }

  /**
   * Set a tenant user's password as part of completing a forced change. The
   * marker is cleared separately so claims and password are consistent.
   */
  async setTenantUserPassword(gcipTenantId: string, uid: string, password: string): Promise<void> {
    await this.authForTenant(gcipTenantId).updateUser(uid, { password });
  }
}

/**
 * Read the GCIP tenant id (`firebase.tenant`) from an ID token WITHOUT verifying
 * it. Used only to route the token to the correct (tenant-aware) verifier; the
 * caller always runs a full verifyIdToken afterwards. Returns undefined for a
 * project-level (super-admin) token or any malformed input.
 */
function readTenantClaim(idToken: string): string | undefined {
  const segments = idToken.split('.');
  if (segments.length < 2) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(segments[1]!, 'base64url').toString('utf8')) as {
      firebase?: { tenant?: string };
    };
    return payload.firebase?.tenant;
  } catch {
    return undefined;
  }
}

/** GCIP displayName: alphanumeric/space, trimmed to a safe length. */
function normalizeTenantDisplayName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 \-]/g, '').trim() || 'Tenant';
  return cleaned.slice(0, 20);
}

/** Detect the Admin SDK "email already exists" error (idempotent bootstrap). */
function isEmailExistsError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'auth/email-already-exists'
  );
}

/** Returns ADC, or undefined if not configured (lets local/test boot without GCP creds). */
function safeApplicationDefault() {
  try {
    return applicationDefault();
  } catch {
    return undefined;
  }
}

// Re-export so feature modules can build credentials without importing firebase-admin directly.
export { cert };
export type { DecodedIdToken };
