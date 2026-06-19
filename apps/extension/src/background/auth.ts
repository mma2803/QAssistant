import { config, identityToolkitBase, secureTokenBase } from '../shared/config.js';
import {
  clearTokens,
  readTokens,
  writeTokens,
  type StoredTokens,
} from './storage.js';

/**
 * Identity Platform (GCIP) authentication via the REST API (task 3.2).
 *
 * The MV3 service worker reads and refreshes tokens; the popup only sends
 * commands. We use REST rather than the firebase web SDK because the SDK assumes
 * a window/DOM and persistence layer not available in a service worker, and
 * because REST gives explicit control over the refresh token (design D27). The
 * forced first-login password-change flow is implemented with accounts:update +
 * the backend's /auth/complete-password-change marker clear (handled by the API
 * client, not here).
 */

interface SignInResponse {
  idToken: string;
  refreshToken: string;
  expiresIn: string; // seconds, as string
  localId: string;
  email?: string;
}

function tk(path: string): string {
  return `${identityToolkitBase()}/accounts:${path}?key=${encodeURIComponent(config.firebaseApiKey)}`;
}

/** Decode a JWT payload without verifying (claims display only; backend verifies). */
export function decodeJwt(idToken: string): Record<string, unknown> {
  const parts = idToken.split('.');
  if (parts.length < 2) return {};
  try {
    const payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '='));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function expiresAtFrom(expiresInSeconds: string): number {
  const secs = Number.parseInt(expiresInSeconds, 10);
  return Date.now() + (Number.isFinite(secs) ? secs : 3600) * 1000;
}

/** Email/password sign-in against the selected GCIP tenant. */
export async function signIn(
  email: string,
  password: string,
  tenantId: string | undefined,
): Promise<StoredTokens> {
  const gcipTenantId = (tenantId ?? config.firebaseTenantId) || null;
  const body: Record<string, unknown> = { email, password, returnSecureToken: true };
  if (gcipTenantId) body.tenantId = gcipTenantId;

  const res = await fetch(tk('signInWithPassword'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await authError(res, 'Sign-in failed');
  }
  const data = (await res.json()) as SignInResponse;
  const tokens: StoredTokens = {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: expiresAtFrom(data.expiresIn),
    uid: data.localId,
    email: data.email ?? email,
    gcipTenantId,
  };
  await writeTokens(tokens);
  return tokens;
}

/**
 * Set a new password for the signed-in user (forced first-login change). Uses
 * accounts:update with the current ID token; returns refreshed tokens because
 * GCIP rotates the secure token when the password changes. The caller then asks
 * the backend to clear the mustChangePassword marker.
 */
export async function updatePassword(newPassword: string): Promise<StoredTokens> {
  const current = await readTokens();
  if (!current) throw new Error('Not signed in');
  const res = await fetch(tk('update'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: current.idToken, password: newPassword, returnSecureToken: true }),
  });
  if (!res.ok) {
    throw await authError(res, 'Password change failed');
  }
  const data = (await res.json()) as Partial<SignInResponse>;
  const tokens: StoredTokens = {
    ...current,
    idToken: data.idToken ?? current.idToken,
    refreshToken: data.refreshToken ?? current.refreshToken,
    expiresAt: data.expiresIn ? expiresAtFrom(data.expiresIn) : current.expiresAt,
  };
  await writeTokens(tokens);
  return tokens;
}

/**
 * Return a valid ID token, refreshing via the secure-token endpoint when it is
 * within 60s of expiry. Short ID-token TTL + guarded refresh token are the
 * mitigations for the ~1h revocation gap accepted in design D27.
 */
export async function getValidIdToken(): Promise<string | null> {
  const current = await readTokens();
  if (!current) return null;
  if (current.expiresAt - Date.now() > 60_000) {
    return current.idToken;
  }
  return refresh(current);
}

async function refresh(current: StoredTokens): Promise<string | null> {
  const res = await fetch(`${secureTokenBase()}/token?key=${encodeURIComponent(config.firebaseApiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
    }).toString(),
  });
  if (!res.ok) {
    // Refresh failed (token revoked/expired): force re-auth.
    await clearTokens();
    return null;
  }
  const data = (await res.json()) as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: string;
  };
  const idToken = data.id_token ?? data.access_token;
  if (!idToken) {
    await clearTokens();
    return null;
  }
  const next: StoredTokens = {
    ...current,
    idToken,
    refreshToken: data.refresh_token ?? current.refreshToken,
    expiresAt: expiresAtFrom(data.expires_in ?? '3600'),
  };
  await writeTokens(next);
  return next.idToken;
}

export async function signOut(): Promise<void> {
  await clearTokens();
}

async function authError(res: Response, fallback: string): Promise<Error> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) {
      message = humanizeAuthCode(body.error.message);
    }
  } catch {
    /* keep fallback */
  }
  return new Error(message);
}

function humanizeAuthCode(code: string): string {
  switch (code) {
    case 'EMAIL_NOT_FOUND':
    case 'INVALID_PASSWORD':
    case 'INVALID_LOGIN_CREDENTIALS':
      return 'Incorrect email or password';
    case 'USER_DISABLED':
      return 'This account has been disabled';
    case 'WEAK_PASSWORD : Password should be at least 6 characters':
    case 'WEAK_PASSWORD':
      return 'Password is too weak';
    default:
      return code.replace(/_/g, ' ').toLowerCase();
  }
}
