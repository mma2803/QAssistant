import { apiBase, config } from '../shared/config.js';
import {
  clearTokens,
  readTokens,
  writeTokens,
  type StoredTokens,
} from './storage.js';

/**
 * Self-hosted auth via the backend's own REST endpoints (task 3.2; replaces
 * Identity Platform/Firebase). The MV3 service worker reads and refreshes
 * tokens; the popup only sends commands. REST (not a client SDK) gives
 * explicit control over the refresh token in a service-worker context, same
 * as before — only the endpoints changed, from Google's Identity Toolkit to
 * this backend's /auth/login, /auth/refresh, /auth/logout.
 */

interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  uid: string;
  role: 'admin' | 'qa-engineer' | 'super-admin';
  tenantId: string | null;
  mustChangePassword: boolean;
  expiresAt: string;
}

function authUrl(path: string): string {
  return `${apiBase()}/auth/${path}`;
}

function toStoredTokens(data: TokenPairResponse, email: string, tenantSlug: string | null): StoredTokens {
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: new Date(data.expiresAt).getTime(),
    uid: data.uid,
    email,
    role: data.role,
    tenantId: data.tenantId,
    mustChangePassword: data.mustChangePassword,
    tenantSlug,
  };
}

/** Email/password sign-in against the selected tenant (blank = super-admin). */
export async function signIn(
  email: string,
  password: string,
  tenantSlug: string | undefined,
): Promise<StoredTokens> {
  const selected = (tenantSlug ?? config.tenantSlug) || undefined;

  const res = await fetch(authUrl('login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, tenantSlug: selected }),
  });
  if (!res.ok) {
    throw await authError(res, 'Sign-in failed');
  }
  const data = (await res.json()) as TokenPairResponse;
  const tokens = toStoredTokens(data, email, selected ?? null);
  await writeTokens(tokens);
  return tokens;
}

/**
 * Return a valid access token, refreshing when it is within 60s of expiry.
 * Short access-token TTL + a rotated refresh token are the mitigations for the
 * revocation gap (design D27; see apps/api/src/auth/token.service.ts).
 */
export async function getValidAccessToken(): Promise<string | null> {
  const current = await readTokens();
  if (!current) return null;
  if (current.expiresAt - Date.now() > 60_000) {
    return current.accessToken;
  }
  return refresh(current);
}

// Guards against two callers refreshing concurrently in the same worker
// instance (the source of the benign refresh-race the backend's grace-window
// rotation logic tolerates, see token.service.ts) by sharing one in-flight call.
let refreshing: Promise<string | null> | null = null;

async function refresh(current: StoredTokens): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = doRefresh(current);
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

async function doRefresh(current: StoredTokens): Promise<string | null> {
  const res = await fetch(authUrl('refresh'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  if (!res.ok) {
    // Refresh failed (token revoked/expired): force re-auth.
    await clearTokens();
    return null;
  }
  const data = (await res.json()) as TokenPairResponse;
  const next = toStoredTokens(data, current.email ?? '', current.tenantSlug);
  await writeTokens(next);
  return next.accessToken;
}

export async function signOut(): Promise<void> {
  const current = await readTokens();
  await clearTokens();
  if (!current) return;
  await fetch(authUrl('logout'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  }).catch(() => undefined);
}

async function authError(res: Response, fallback: string): Promise<Error> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch {
    /* keep fallback */
  }
  return new Error(message);
}
