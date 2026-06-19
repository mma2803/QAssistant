import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onIdTokenChanged,
  type Auth,
  type User,
} from 'firebase/auth';

const E2E_AUTH_STORAGE_KEY = 'qassistant:e2e-authenticated';

function isE2EAuthEnabled(): boolean {
  return import.meta.env.VITE_E2E_AUTH === 'true';
}

function hasE2ESession(): boolean {
  return isE2EAuthEnabled() && window.localStorage.getItem(E2E_AUTH_STORAGE_KEY) === 'true';
}

/**
 * Identity Platform (Firebase Auth) client for the dashboard. Sign-in is
 * email/password against a GCIP tenant (one GCIP tenant per app tenant). The
 * verified ID token carries the { role, tenantId, mustChangePassword } claims the
 * backend trusts; the SPA never asserts identity itself.
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'local-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'localhost',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'main-nima',
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;

export function getAuthClient(): Auth {
  if (!app) {
    app = initializeApp(config);
  }
  if (!auth) {
    auth = getAuth(app);
    const emulator = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST;
    if (emulator) {
      // e.g. "127.0.0.1:9099" -> "http://127.0.0.1:9099"
      const url = emulator.startsWith('http') ? emulator : `http://${emulator}`;
      connectAuthEmulator(auth, url, { disableWarnings: true });
    }
  }
  return auth;
}

/**
 * Sign in with email/password. `tenantId` selects the GCIP tenant; when omitted
 * we fall back to the build-time default. The backend rejects a token whose
 * tenant does not match an active app tenant.
 */
export async function signIn(email: string, password: string, tenantId?: string): Promise<User> {
  if (isE2EAuthEnabled()) {
    window.localStorage.setItem(E2E_AUTH_STORAGE_KEY, 'true');
    return {} as User;
  }
  const client = getAuthClient();
  const selected = tenantId ?? import.meta.env.VITE_FIREBASE_TENANT_ID;
  client.tenantId = selected && selected.length > 0 ? selected : null;
  const cred = await signInWithEmailAndPassword(client, email, password);
  return cred.user;
}

export async function signOut(): Promise<void> {
  if (isE2EAuthEnabled()) {
    window.localStorage.removeItem(E2E_AUTH_STORAGE_KEY);
    return;
  }
  await fbSignOut(getAuthClient());
}

/**
 * Re-authenticate the current user with a freshly-set password.
 *
 * Used by the forced password-change screen AFTER the backend has set the new
 * password (Admin SDK) and cleared the mustChangePassword marker. The backend
 * verifies tokens with checkRevoked=true, and changing a password bumps the
 * user's tokensValidAfterTime, so every token from the old session (including
 * refresh-token exchanges, which keep the original auth_time) is treated as
 * revoked. A fresh sign-in mints a token with a current auth_time that passes
 * the revocation check. The GCIP tenant stays selected on the client from the
 * original sign-in.
 */
export async function reauthenticate(newPassword: string): Promise<void> {
  if (isE2EAuthEnabled()) {
    if (!hasE2ESession()) throw new Error('Not signed in');
    return;
  }
  const client = getAuthClient();
  const email = client.currentUser?.email;
  if (!email) throw new Error('Not signed in');
  await signInWithEmailAndPassword(client, email, newPassword);
}

/** Get a fresh ID token for the current user (forceRefresh re-reads claims). */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  if (isE2EAuthEnabled()) return hasE2ESession() ? 'e2e-test-token' : null;
  const user = getAuthClient().currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

export function onAuthChanged(cb: (user: User | null) => void): () => void {
  if (isE2EAuthEnabled()) {
    queueMicrotask(() => cb(hasE2ESession() ? ({} as User) : null));
    return () => undefined;
  }
  return onIdTokenChanged(getAuthClient(), cb);
}
