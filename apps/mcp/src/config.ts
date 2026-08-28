/**
 * MCP server configuration, read from the environment. The server holds no
 * long-lived secrets of its own: credentials arrive at the `authenticate` tool
 * call. This value only locates the QAssistant API; sign-in goes through the
 * API's own /auth/login endpoint.
 */
export interface McpConfig {
  /**
   * Base URL of the QAssistant REST API, INCLUDING the global prefix, e.g.
   * https://qassistant.app/api/v1. The API mounts every route under /api/v1
   * (see apps/api setGlobalPrefix), so the prefix must be present here.
   */
  apiBaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  // Default to the remote VPS deployment; QASSISTANT_API_URL overrides it.
  const raw = (env.QASSISTANT_API_URL ?? 'https://qassistant.app').replace(/\/$/, '');
  // The API serves everything under /api/v1. If the configured URL doesn't
  // already include a path segment beyond the host, append the prefix so tool
  // calls hit /api/v1/... instead of 404ing at the bare host.
  const hasPathPrefix = /^https?:\/\/[^/]+\/.+/.test(raw);
  const apiBaseUrl = hasPathPrefix ? raw : `${raw}/api/v1`;
  return { apiBaseUrl };
}
