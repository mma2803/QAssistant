/**
 * chrome.storage.local wrappers. Per design D27 this store holds the user's
 * identity tokens (ID + refresh). chrome.storage.local is per-extension isolated
 * (other extensions cannot read it). The stored refresh token IS the user's
 * identity, so it is treated as a secret: never logged, never sent anywhere but
 * the Identity Platform secure-token endpoint, and cleared on sign-out.
 */

export interface StoredTokens {
  idToken: string;
  refreshToken: string;
  /** Epoch ms when the ID token expires. */
  expiresAt: number;
  uid: string;
  email: string | null;
  /** GCIP tenant id used at sign-in; needed for re-auth and display. */
  gcipTenantId: string | null;
}

const TOKENS_KEY = 'qa.tokens';
const SESSION_KEY = 'qa.activeSession';

export async function readTokens(): Promise<StoredTokens | null> {
  const out = await chrome.storage.local.get(TOKENS_KEY);
  return (out[TOKENS_KEY] as StoredTokens | undefined) ?? null;
}

export async function writeTokens(tokens: StoredTokens): Promise<void> {
  await chrome.storage.local.set({ [TOKENS_KEY]: tokens });
}

export async function clearTokens(): Promise<void> {
  await chrome.storage.local.remove(TOKENS_KEY);
}

/**
 * Active-session persistence. The service worker is non-persistent in MV3 and
 * can be torn down between events; the in-flight session state must survive a
 * worker restart so capture and upload resume. We store a serializable subset.
 */
export interface PersistedSession {
  sessionId: string;
  projectId: string;
  tenantId: string;
  screenshotEnabled: boolean;
  inactivityMs: number;
  startedAtIso: string;
  /** Next sequence numbers per artifact type (monotonic per session). */
  nextDomSeq: number;
  nextShotSeq: number;
  flagsRecorded: number;
  /** Last time we saw a capture event, for the local inactivity timer. */
  lastActivityMs: number;
}

export async function readActiveSession(): Promise<PersistedSession | null> {
  const out = await chrome.storage.local.get(SESSION_KEY);
  return (out[SESSION_KEY] as PersistedSession | undefined) ?? null;
}

export async function writeActiveSession(s: PersistedSession): Promise<void> {
  await chrome.storage.local.set({ [SESSION_KEY]: s });
}

export async function clearActiveSession(): Promise<void> {
  await chrome.storage.local.remove(SESSION_KEY);
}
