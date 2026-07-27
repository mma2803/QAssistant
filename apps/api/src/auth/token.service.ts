import { randomBytes, createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { TokenRole } from '@qassistant/shared/enums';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';
import { DbService, type Database } from '../db/db.service.js';
import { authTokens, tenantUsers, superAdmins } from '../db/schema.js';
import { newId } from '../db/id.js';
import { AppException } from './errors.js';

export type SubjectType = 'tenant_user' | 'super_admin';

export interface VerifiedAccess {
  uid: string;
  role: TokenRole;
  tenantId: string | null;
  mustChangePassword: boolean;
}

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  uid: string;
  role: TokenRole;
  tenantId: string | null;
  mustChangePassword: boolean;
  expiresAt: string;
}

// Window in which a revoked-refresh-token replay is treated as a benign
// concurrent/retried refresh (the other call already got a fresh pair)
// rather than theft. Outside this window a replay revokes every token for
// the subject and forces re-login.
const REFRESH_REUSE_GRACE_MS = 20_000;

/**
 * Opaque, DB-backed bearer tokens (self-hosted auth, replaces Firebase ID
 * tokens + refresh grants). Deliberately NOT JWT: the request pipeline already
 * does a mandatory per-request tenant_users lookup for RLS/active-status
 * (see TransactionInterceptor), so a stateless token buys nothing here while
 * an opaque, hash-indexed token gives instant revocation with no extra
 * moving parts (no signing secret, no algorithm risk, no clock skew).
 *
 * Only the SHA-256 hash of a token is ever persisted; the plaintext exists
 * only in the login/refresh response.
 */
@Injectable()
export class TokenService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /** Issue a fresh access+refresh pair for a subject (login). */
  async issueTokenPair(subjectType: SubjectType, subjectId: string): Promise<IssuedTokenPair> {
    return this.db.withSuperadmin(({ db }) => this.issueTokenPairTx(db, subjectType, subjectId));
  }

  private async issueTokenPairTx(
    db: Database,
    subjectType: SubjectType,
    subjectId: string,
  ): Promise<IssuedTokenPair & { refreshTokenRowId: string }> {
    const subject = await this.loadSubject(db, subjectType, subjectId);
    if (!subject) {
      throw new AppException('unauthenticated', 'Account not found', HttpStatus.UNAUTHORIZED);
    }

    const accessToken = this.generateToken();
    const refreshToken = this.generateToken();
    const refreshTokenRowId = newId();
    const now = new Date();
    const accessExpiresAt = new Date(now.getTime() + this.config.ACCESS_TOKEN_TTL_SECONDS * 1000);
    const refreshExpiresAt = new Date(now.getTime() + this.config.REFRESH_TOKEN_TTL_SECONDS * 1000);

    await db.insert(authTokens).values([
      {
        id: newId(),
        subjectType,
        subjectId,
        kind: 'access',
        tokenHash: this.hashToken(accessToken),
        issuedAt: now,
        expiresAt: accessExpiresAt,
      },
      {
        id: refreshTokenRowId,
        subjectType,
        subjectId,
        kind: 'refresh',
        tokenHash: this.hashToken(refreshToken),
        issuedAt: now,
        expiresAt: refreshExpiresAt,
      },
    ]);

    return {
      accessToken,
      refreshToken,
      refreshTokenRowId,
      uid: subjectId,
      role: subject.role,
      tenantId: subject.tenantId,
      mustChangePassword: subject.mustChangePassword,
      expiresAt: accessExpiresAt.toISOString(),
    };
  }

  /** Verify an access token. Returns the same shape AuthGuard already expects. */
  async verifyAccessToken(token: string): Promise<VerifiedAccess> {
    const tokenHash = this.hashToken(token);
    return this.db.withSuperadmin(async ({ db }) => {
      const rows = await db.select().from(authTokens).where(eq(authTokens.tokenHash, tokenHash)).limit(1);
      const row = rows[0];
      if (!row || row.kind !== 'access' || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
        throw new AppException('unauthenticated', 'Invalid or expired token', HttpStatus.UNAUTHORIZED);
      }
      const subject = await this.loadSubject(db, row.subjectType as SubjectType, row.subjectId);
      if (!subject) {
        throw new AppException('unauthenticated', 'Invalid or expired token', HttpStatus.UNAUTHORIZED);
      }
      return {
        uid: row.subjectId,
        role: subject.role,
        tenantId: subject.tenantId,
        mustChangePassword: subject.mustChangePassword,
      };
    });
  }

  /**
   * Redeem a refresh token for a new pair, rotating it (old one revoked,
   * `replaced_by` set on the old row). A replay of an already-revoked token
   * within the grace window is treated as a benign double-fire (the other
   * call already got a fresh pair — this call cannot hand back the same
   * plaintext, since only its hash was ever stored, so the client must fall
   * back to whatever it currently holds). A replay outside the grace window
   * is treated as theft: every token for the subject is revoked.
   */
  async refresh(refreshToken: string): Promise<IssuedTokenPair> {
    const tokenHash = this.hashToken(refreshToken);
    return this.db.withSuperadmin(async ({ db }) => {
      const rows = await db.select().from(authTokens).where(eq(authTokens.tokenHash, tokenHash)).limit(1);
      const row = rows[0];
      if (!row || row.kind !== 'refresh' || row.expiresAt.getTime() < Date.now()) {
        throw new AppException('unauthenticated', 'Invalid or expired refresh token', HttpStatus.UNAUTHORIZED);
      }

      if (row.revokedAt) {
        const withinGrace = Date.now() - row.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS;
        if (!withinGrace) {
          await this.revokeAllForSubjectTx(db, row.subjectType as SubjectType, row.subjectId);
        }
        throw new AppException(
          'unauthenticated',
          'Refresh token already used',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const pair = await this.issueTokenPairTx(db, row.subjectType as SubjectType, row.subjectId);
      await db
        .update(authTokens)
        .set({ revokedAt: new Date(), replacedBy: pair.refreshTokenRowId })
        .where(eq(authTokens.id, row.id));
      return pair;
    });
  }

  /** Revoke every outstanding token for a subject (disable, password reset, logout-all). */
  async revokeAllForSubject(subjectType: SubjectType, subjectId: string): Promise<void> {
    await this.db.withSuperadmin(({ db }) => this.revokeAllForSubjectTx(db, subjectType, subjectId));
  }

  private async revokeAllForSubjectTx(
    db: Database,
    subjectType: SubjectType,
    subjectId: string,
  ): Promise<void> {
    await db
      .update(authTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(authTokens.subjectType, subjectType), eq(authTokens.subjectId, subjectId)));
  }

  /** Revoke a single refresh token by its plaintext value (logout). */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.db.withSuperadmin(async ({ db }) => {
      await db
        .update(authTokens)
        .set({ revokedAt: new Date() })
        .where(eq(authTokens.tokenHash, tokenHash));
    });
  }

  private async loadSubject(
    db: Database,
    subjectType: SubjectType,
    subjectId: string,
  ): Promise<{ role: TokenRole; tenantId: string | null; mustChangePassword: boolean } | null> {
    if (subjectType === 'super_admin') {
      const rows = await db.select().from(superAdmins).where(eq(superAdmins.id, subjectId)).limit(1);
      const admin = rows[0];
      if (!admin || admin.status !== 'active') return null;
      return { role: 'super-admin', tenantId: null, mustChangePassword: admin.mustChangePassword };
    }
    const rows = await db.select().from(tenantUsers).where(eq(tenantUsers.id, subjectId)).limit(1);
    const user = rows[0];
    if (!user || user.status !== 'active') return null;
    return {
      role: user.role as TokenRole,
      tenantId: user.tenantId,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
