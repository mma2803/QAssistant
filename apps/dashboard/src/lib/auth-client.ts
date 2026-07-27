import type { TokenPairResponse } from '@qassistant/shared';

const E2E_AUTH_STORAGE_KEY = 'qassistant:e2e-authenticated';

function isE2EAuthEnabled(): boolean {
  return import.meta.env.VITE_E2E_AUTH === 'true';
}

function hasE2ESession(): boolean {
  return isE2EAuthEnabled() && window.localStorage.getItem(E2E_AUTH_STORAGE_KEY) === 'true';
}

/**
 * Self-hosted auth client for the dashboard (replaces the Firebase Web SDK).
 * The access token is kept in memory only (never localStorage — an XSS
 * hardening property this design deliberately keeps); the refresh token is an
 * HttpOnly/Secure/SameSite=Strict cookie set by the API (see
 * apps/api/src/auth-routes/auth-routes.controller.ts) that the browser sends
 * automatically on same-origin requests via `credentials: 'include'` — the
 * dashboard's JS never reads or stores it.
 */
const API_BASE = ((import.meta.env.VITE_API_BASE_URL ?? '').trim() || '/api') + '/v1';

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;
const listeners = new Set<() => void>();

function setSession(pair: Pick<TokenPairResponse, 'accessToken' | 'expiresAt'> | null): void {
  const nextToken = pair?.accessToken ?? null;
  // Only notify on an actual state change. Without this guard, a dead session
  // free-falls forever: a failed refresh sets the token to null and notifies
  // -> AuthContext's onAuthChanged handler re-bootstraps -> getAccessToken()
  // sees a null token and immediately retries the refresh -> fails again ->
  // notifies again -> unbounded retry loop with no backoff, hammering
  // /auth/refresh. null -> null is not a real change, so it's a no-op here.
  const changed = nextToken !== accessToken;
  accessToken = nextToken;
  accessTokenExpiresAt = pair ? new Date(pair.expiresAt).getTime() : 0;
  if (changed) {
    for (const cb of listeners) cb();
  }
}

export function onAuthChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const env = await res.json().catch(() => null);
    throw new Error(env?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Sign in. `tenantSlug` omitted signs in as the super-admin. */
export async function signIn(email: string, password: string, tenantSlug?: string): Promise<void> {
  if (isE2EAuthEnabled()) {
    window.localStorage.setItem(E2E_AUTH_STORAGE_KEY, 'true');
    setSession({ accessToken: 'e2e-test-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    return;
  }
  const pair = await postJson<TokenPairResponse>('/auth/login', {
    tenantSlug: tenantSlug || undefined,
    email,
    password,
  });
  setSession(pair);
}

export async function signOut(): Promise<void> {
  if (isE2EAuthEnabled()) {
    window.localStorage.removeItem(E2E_AUTH_STORAGE_KEY);
    setSession(null);
    return;
  }
  await postJson('/auth/logout', {}).catch(() => undefined);
  setSession(null);
}

/** Redeem the refresh cookie for a new access token. */
async function refreshAccessToken(): Promise<string | null> {
  try {
    const pair = await postJson<TokenPairResponse>('/auth/refresh', {});
    setSession(pair);
    return pair.accessToken;
  } catch {
    setSession(null);
    return null;
  }
}

/** Get a usable access token, refreshing first if it is missing/near expiry. */
export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  if (isE2EAuthEnabled()) return hasE2ESession() ? 'e2e-test-token' : null;
  const nearExpiry = accessTokenExpiresAt - Date.now() < 30_000;
  if (forceRefresh || !accessToken || nearExpiry) {
    return refreshAccessToken();
  }
  return accessToken;
}

/**
 * Resolve whether a session might exist at all (a refresh cookie may be
 * present even though no access token is held in memory yet, e.g. on a fresh
 * page load) by attempting one refresh. Used once at app bootstrap.
 */
export async function tryRestoreSession(): Promise<boolean> {
  if (isE2EAuthEnabled()) return hasE2ESession();
  const token = await refreshAccessToken();
  return token !== null;
}
