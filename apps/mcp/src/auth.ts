import type { McpConfig } from './config.js';

/**
 * Session token store + sign-in against the QAssistant API's own auth
 * endpoint. The access token is kept in memory for the process lifetime only
 * — never persisted. Sign-in mirrors the dashboard: email/password against a
 * tenant (selected by slug); the resulting access token carries the
 * { role, tenantId } the QAssistant API trusts. No refresh: matching the
 * original scope, a re-run of `authenticate` is required once the token
 * expires.
 */
export class AuthSession {
  private accessToken: string | null = null;
  private tenantId: string | null = null;

  constructor(private readonly config: McpConfig) {}

  isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  /** The bearer token for API calls, or throws if not yet authenticated. */
  requireToken(): string {
    if (!this.accessToken) {
      throw new Error('Not authenticated: call the `authenticate` tool first.');
    }
    return this.accessToken;
  }

  currentTenantId(): string | null {
    return this.tenantId;
  }

  /** Exchange email/password (+ optional tenant slug) for an access token. */
  async authenticate(email: string, password: string, tenantSlug?: string): Promise<void> {
    const res = await fetch(`${this.config.apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        tenantSlug: tenantSlug && tenantSlug.length > 0 ? tenantSlug : undefined,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Authentication failed (${res.status}): ${detail}`);
    }
    const data = (await res.json()) as { accessToken?: string; tenantId?: string | null };
    if (!data.accessToken) {
      throw new Error('Authentication response did not include an access token.');
    }
    this.accessToken = data.accessToken;
    this.tenantId = data.tenantId ?? null;
  }
}
