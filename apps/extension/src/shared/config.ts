/**
 * Build-time + runtime configuration for the extension. Values come from Vite
 * env (import.meta.env) at build time. The default targets the remote VPS
 * deployment so an un-overridden build talks to the hosted API, not localhost.
 * Set VITE_API_BASE_URL to point a build elsewhere (e.g. a local backend).
 */

export const config = {
  tenantSlug: import.meta.env.VITE_DEFAULT_TENANT_SLUG ?? '',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'https://qassistant.app',
} as const;

/** Full REST base, e.g. "https://qassistant.app/api/v1". */
export function apiBase(): string {
  return `${config.apiBaseUrl.replace(/\/$/, '')}/api/v1`;
}

/** Capture tuning. Kept small so chunks upload steadily and limit data loss. */
export const capture = {
  /** Flush rrweb events to a chunk at least this often (ms). */
  chunkIntervalMs: 5_000,
  /** Or sooner once this many buffered events accumulate. */
  chunkEventThreshold: 200,
  /** Periodic viewport screenshot cadence when screenshots are enabled (ms). */
  screenshotIntervalMs: 10_000,
  /**
   * Local inactivity timer. The server timer is the authoritative backstop;
   * this just lets a healthy extension self-close promptly. Resolved per session
   * from the project's inactivityTimeoutSeconds, falling back to this default.
   */
  defaultInactivityMs: 900_000,
} as const;

/**
 * Network-capture tuning (change: configurable-test-type). Caps bound the volume
 * a chatty page can produce; exceeding a cap truncates with a logged marker
 * rather than dropping silently. Bodies are truncated per entry in the page
 * interceptor; entry-count / total-size caps are enforced in the service worker.
 */
export const networkCapture = {
  /** Max bytes kept per request body and per response body (truncated past this). */
  maxBodyBytes: 32_768,
  /** Max captured calls per session. */
  maxEntries: 500,
  /** Max total network-log size per session (sum of buffered+uploaded JSON bytes). */
  maxTotalBytes: 5_242_880,
  /** Flush buffered network entries to a chunk at least this often (ms). */
  flushIntervalMs: 5_000,
  /** Or sooner once this many entries accumulate. */
  flushEntryThreshold: 50,
} as const;
