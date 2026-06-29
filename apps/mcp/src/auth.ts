import type { McpConfig } from './config.js';

/**
 * Session token store + Identity Platform sign-in. The ID token is kept in
 * memory for the process lifetime only — never persisted. Sign-in mirrors the
 * dashboard: email/password against a GCIP tenant (one GCIP tenant per app
 * tenant); the resulting ID token carries the { role, tenantId } claims the
 * QAssistant API trusts.
 */
export class AuthSession {
  private idToken: string | null = null;
  private tenantId: string | null = null;

  constructor(private readonly config: McpConfig) {}

  isAuthenticated(): boolean {
    return this.idToken !== null;
  }

  /** The bearer token for API calls, or throws if not yet authenticated. */
  requireToken(): string {
    if (!this.idToken) {
      throw new Error('Not authenticated: call the `authenticate` tool first.');
    }
    return this.idToken;
  }

  currentTenantId(): string | null {
    return this.tenantId;
  }

  /**
   * Exchange email/password (+ optional GCIP tenantId) for an ID token via the
   * Identity Toolkit `signInWithPassword` endpoint. Routed to the Auth emulator
   * when FIREBASE_AUTH_EMULATOR_HOST is set.
   */
  async authenticate(email: string, password: string, tenantId?: string): Promise<void> {
    const base = this.config.authEmulatorHost
      ? `http://${this.config.authEmulatorHost}/identitytoolkit.googleapis.com/v1`
      : 'https://identitytoolkit.googleapis.com/v1';
    const url = `${base}/accounts:signInWithPassword?key=${this.config.firebaseApiKey}`;

    const body: Record<string, unknown> = {
      email,
      password,
      returnSecureToken: true,
    };
    if (tenantId && tenantId.length > 0) {
      body.tenantId = tenantId;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Authentication failed (${res.status}): ${detail}`);
    }
    const data = (await res.json()) as { idToken?: string };
    if (!data.idToken) {
      throw new Error('Authentication response did not include an ID token.');
    }
    this.idToken = data.idToken;
    this.tenantId = tenantId ?? null;
  }
}
