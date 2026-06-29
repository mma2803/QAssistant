/**
 * MCP server configuration, read from the environment. The server holds no
 * long-lived secrets of its own: credentials arrive at the `authenticate` tool
 * call. These values only locate the QAssistant API and the Identity Platform
 * endpoint used to exchange email/password for an ID token.
 */
export interface McpConfig {
  /**
   * Base URL of the QAssistant REST API, INCLUDING the global prefix, e.g.
   * http://localhost:8080/api/v1. The API mounts every route under /api/v1
   * (see apps/api setGlobalPrefix), so the prefix must be present here.
   */
  apiBaseUrl: string;
  /** Identity Platform (Firebase Auth) Web API key. */
  firebaseApiKey: string;
  /**
   * When set (dev), sign-in is routed to the Auth emulator at this host
   * (e.g. "127.0.0.1:9099") instead of the live Identity Toolkit endpoint.
   */
  authEmulatorHost?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const raw = (env.QASSISTANT_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');
  // The API serves everything under /api/v1. If the configured URL doesn't
  // already include a path segment beyond the host, append the prefix so tool
  // calls hit /api/v1/... instead of 404ing at the bare host.
  const hasPathPrefix = /^https?:\/\/[^/]+\/.+/.test(raw);
  const apiBaseUrl = hasPathPrefix ? raw : `${raw}/api/v1`;
  return {
    apiBaseUrl,
    firebaseApiKey: env.FIREBASE_API_KEY ?? 'local-api-key',
    authEmulatorHost: env.FIREBASE_AUTH_EMULATOR_HOST || undefined,
  };
}
