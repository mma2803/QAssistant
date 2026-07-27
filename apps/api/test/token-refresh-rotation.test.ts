/**
 * Refresh-token rotation edge cases (auth/token.service.ts).
 *
 * The main http-e2e.test.ts flow only exercises a single, successful refresh.
 * This file drives TokenService directly (service-level, like e2e-flow.test.ts)
 * to prove the two branches a single happy-path refresh can never reach:
 *
 *   - a revoked-refresh-token replay WITHIN the grace window is treated as a
 *     benign double-fire: the request is rejected, but the pair issued by the
 *     original (legitimate) refresh keeps working.
 *   - a revoked-refresh-token replay OUTSIDE the grace window is treated as
 *     theft: every token for the subject is revoked, including the pair
 *     issued by the original refresh.
 *
 * The grace window (REFRESH_REUSE_GRACE_MS, 20s) is a module-private constant,
 * not configurable -- rather than sleeping for real in a test, the "outside
 * the grace window" case is simulated by directly back-dating the revoked
 * row's revoked_at, which is exactly the condition TokenService.refresh()
 * actually checks.
 *
 * Skips cleanly if no Postgres is reachable.
 */
import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  isDbReachable,
  ensureSchema,
  makePools,
  provisionTenant,
  cleanupTenants,
  newId,
  type Pools,
} from './helpers/db.js';
import { buildHarness, type Harness } from './helpers/app.js';
import { authTokens } from '../src/db/schema.js';

let h: Harness | null = null;
let reachable = false;
let pools: Pools | null = null;
const tenantIds: string[] = [];

before(async () => {
  reachable = await isDbReachable();
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn('[token-refresh-rotation] no Postgres reachable; skipping.');
    return;
  }
  await ensureSchema();
  h = await buildHarness();
  pools = makePools();
});

after(async () => {
  if (pools) {
    if (tenantIds.length > 0) await cleanupTenants(pools, tenantIds);
    await pools.close();
  }
  if (h) await h.close();
});

describe('refresh-token rotation reuse detection', () => {
  it('a replay within the grace window is rejected but the legitimate pair still works', async (t) => {
    if (!reachable || !h || !pools) return t.skip('no Postgres reachable');

    const { tenantId, adminUserId } = await provisionTenant(pools, {
      tenantName: 'Grace Window Co',
      slug: `grace-${newId()}`,
      adminEmail: `grace-${newId()}@example.test`,
    });
    tenantIds.push(tenantId);

    const original = await h.tokens.issueTokenPair('tenant_user', adminUserId);

    // Legitimate refresh: rotates the pair, revokes `original.refreshToken`.
    const rotated = await h.tokens.refresh(original.refreshToken);
    assert.ok(rotated.accessToken);
    assert.notEqual(rotated.accessToken, original.accessToken);

    // Immediate replay of the now-revoked original refresh token: within the
    // 20s grace window, so treated as a benign double-fire, not theft.
    await assert.rejects(
      () => h!.tokens.refresh(original.refreshToken),
      (err: unknown) => err instanceof Error && /already used/i.test(err.message),
      'replaying the revoked token should be rejected as already-used',
    );

    // The legitimate rotated pair must still be valid -- a benign double-fire
    // must not nuke the session the OTHER caller already obtained.
    const verified = await h.tokens.verifyAccessToken(rotated.accessToken);
    assert.equal(verified.uid, adminUserId);
  });

  it('a replay outside the grace window is treated as theft and revokes every token', async (t) => {
    if (!reachable || !h || !pools) return t.skip('no Postgres reachable');

    const { tenantId, adminUserId } = await provisionTenant(pools, {
      tenantName: 'Theft Response Co',
      slug: `theft-${newId()}`,
      adminEmail: `theft-${newId()}@example.test`,
    });
    tenantIds.push(tenantId);

    const original = await h.tokens.issueTokenPair('tenant_user', adminUserId);
    const rotated = await h.tokens.refresh(original.refreshToken);

    // Simulate the revoked original token having been revoked long ago (well
    // outside the 20s grace window) by back-dating its revoked_at directly --
    // exactly the condition TokenService.refresh() checks internally.
    const longAgo = new Date(Date.now() - 60_000);
    await h.db.withSuperadmin(async ({ db }) => {
      const tokenHash = createHash('sha256').update(original.refreshToken).digest('hex');
      const rows = await db.select().from(authTokens).where(eq(authTokens.tokenHash, tokenHash)).limit(1);
      assert.ok(rows[0], 'expected the original refresh token row to exist');
      await db.update(authTokens).set({ revokedAt: longAgo }).where(eq(authTokens.id, rows[0].id));
    });

    // Replay outside the grace window: theft response, whole chain revoked.
    await assert.rejects(
      () => h!.tokens.refresh(original.refreshToken),
      (err: unknown) => err instanceof Error && /already used/i.test(err.message),
    );

    // The legitimate rotated pair (issued by the one real refresh) must now
    // ALSO be revoked -- proving the theft response revoked the whole chain,
    // not just the replayed token.
    await assert.rejects(
      () => h!.tokens.verifyAccessToken(rotated.accessToken),
      (err: unknown) => err instanceof Error && /invalid or expired/i.test(err.message),
      'the legitimate rotated access token should be revoked by the theft response',
    );
  });
});
