import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type {
  CreateInvitationRequest,
  CreateInvitationResponse,
  Invitation,
  InvitationRedeemer,
  InvitationStatus,
  RedeemInvitationRequest,
  RedeemInvitationResponse,
  ValidateInvitationResponse,
} from '@qassistant/shared';
import { DbService, type Database } from '../db/db.service.js';
import { tenantInvitations, tenants, tenantUsers } from '../db/schema.js';
import { newId } from '../db/id.js';
import { AppException } from '../auth/errors.js';
import { AdminService } from './admin.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Reusable tenant signup links (change: tenant-signup-links). The super-admin
 * issues an expiring, reusable link; a recipient redeems it on the public
 * /signup path to self-provision a tenant + first admin. Only the SHA-256 hash
 * of the token is stored (same posture as auth_tokens); the plaintext is
 * returned exactly once at issue time.
 *
 * Everything runs on the privileged BYPASSRLS path (`withSuperadmin`): the
 * super-admin has no tenant binding, and the public redeem has no tenant
 * context at all, so neither may take the RLS-scoped app_user pool.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: DbService,
    private readonly admin: AdminService,
  ) {}

  /** POST /admin/tenants/invitations: mint a reusable link, store only its hash. */
  async issue(
    createdBy: string,
    input: CreateInvitationRequest,
  ): Promise<CreateInvitationResponse> {
    const id = newId();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + input.expiresInDays * MS_PER_DAY);
    await this.db.withSuperadmin(async ({ db }) => {
      await db.insert(tenantInvitations).values({
        id,
        tokenHash: this.hashToken(token),
        createdBy,
        expiresAt,
      });
    });
    // Plaintext token returned once; never persisted, never recoverable later.
    return { id, token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * GET /admin/tenants/invitations: list links with their derived status and,
   * for each, the tenants provisioned through it and the admin who redeemed it
   * (so the super-admin can see WHO used each link, not just a count).
   */
  async list(): Promise<Invitation[]> {
    return this.db.withSuperadmin(async ({ db }) => {
      const links = await db
        .select()
        .from(tenantInvitations)
        .orderBy(desc(tenantInvitations.createdAt));

      // Tenants provisioned via any link (oldest first), plus each tenant's
      // first user — the person who redeemed the link.
      const createdRows = await db
        .select({
          invitationId: tenants.createdViaInvitationId,
          tenantId: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          createdAt: tenants.createdAt,
        })
        .from(tenants)
        .where(isNotNull(tenants.createdViaInvitationId))
        .orderBy(asc(tenants.createdAt));

      const tenantIds = createdRows.map((r) => r.tenantId);
      const firstAdminByTenant = new Map<string, string>();
      if (tenantIds.length > 0) {
        const userRows = await db
          .select({ tenantId: tenantUsers.tenantId, email: tenantUsers.email })
          .from(tenantUsers)
          .where(inArray(tenantUsers.tenantId, tenantIds))
          .orderBy(asc(tenantUsers.createdAt));
        for (const u of userRows) {
          if (!firstAdminByTenant.has(u.tenantId)) firstAdminByTenant.set(u.tenantId, u.email);
        }
      }

      const byInvitation = new Map<string, InvitationRedeemer[]>();
      for (const r of createdRows) {
        if (!r.invitationId) continue;
        const list = byInvitation.get(r.invitationId) ?? [];
        list.push({
          tenantId: r.tenantId,
          name: r.name,
          slug: r.slug,
          adminEmail: firstAdminByTenant.get(r.tenantId) ?? null,
          createdAt: r.createdAt.toISOString(),
        });
        byInvitation.set(r.invitationId, list);
      }

      const now = new Date();
      return links.map((l) => {
        const createdTenants = byInvitation.get(l.id) ?? [];
        return {
          id: l.id,
          expiresAt: l.expiresAt.toISOString(),
          revokedAt: l.revokedAt ? l.revokedAt.toISOString() : null,
          createdTenants,
          createdTenantCount: createdTenants.length,
          status: this.linkStatus(l, now),
          createdAt: l.createdAt.toISOString(),
        };
      });
    });
  }

  /** DELETE /admin/tenants/invitations/{id}: revoke a link (idempotent-ish). */
  async revoke(id: string): Promise<void> {
    await this.db.withSuperadmin(async ({ db }) => {
      const [row] = await db
        .update(tenantInvitations)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(tenantInvitations.id, id))
        .returning({ id: tenantInvitations.id });
      if (!row) {
        throw new AppException('not_found', 'Signup link not found', HttpStatus.NOT_FOUND);
      }
    });
  }

  /** GET /signup/{token} (public): report only validity + expiry, nothing identifying. */
  async validate(token: string): Promise<ValidateInvitationResponse> {
    return this.db.withSuperadmin(async ({ db }) => {
      const row = await this.findByToken(db, token);
      if (!row || this.linkStatus(row, new Date()) !== 'active') {
        return { valid: false, expiresAt: null };
      }
      return { valid: true, expiresAt: row.expiresAt.toISOString() };
    });
  }

  /**
   * POST /signup (public): redeem a link to create a tenant + first admin.
   * Validates + provisions + stamps the link in one privileged transaction.
   * Duplicate tenant name → 409 (nothing created); first admin is NOT forced to
   * change password since they chose it themselves.
   */
  async redeem(input: RedeemInvitationRequest): Promise<RedeemInvitationResponse> {
    return this.db.withSuperadmin(async (tx) => {
      const row = await this.findByToken(tx.db, input.token);
      if (!row) {
        throw new AppException('not_found', 'Invalid signup link', HttpStatus.NOT_FOUND);
      }
      const status = this.linkStatus(row, new Date());
      if (status !== 'active') {
        throw new AppException(
          'forbidden',
          status === 'revoked' ? 'This signup link has been revoked' : 'This signup link has expired',
          HttpStatus.FORBIDDEN,
        );
      }
      return this.admin.provisionTenant(tx.db, {
        name: input.name,
        firstAdmin: input.firstAdmin,
        forcePasswordChange: false,
        onDuplicateName: 'reject',
        invitationId: row.id,
      });
    });
  }

  // --- helpers -------------------------------------------------------------

  private async findByToken(db: Database, token: string) {
    const rows = await db
      .select()
      .from(tenantInvitations)
      .where(eq(tenantInvitations.tokenHash, this.hashToken(token)))
      .limit(1);
    return rows[0];
  }

  private linkStatus(
    row: { expiresAt: Date; revokedAt: Date | null },
    now: Date,
  ): InvitationStatus {
    if (row.revokedAt) return 'revoked';
    if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
    return 'active';
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
