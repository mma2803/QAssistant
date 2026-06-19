/**
 * Build-time + runtime configuration for the extension. Values come from Vite
 * env (import.meta.env) at build time. Defaults keep local-emulator dev working
 * without a real GCIP project.
 */

export const config = {
  firebaseApiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'local-api-key',
  firebaseTenantId: import.meta.env.VITE_FIREBASE_TENANT_ID ?? '',
  authEmulatorHost: import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST ?? '',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8080',
} as const;

/** Full REST base, e.g. "http://127.0.0.1:8080/api/v1". */
export function apiBase(): string {
  return `${config.apiBaseUrl.replace(/\/$/, '')}/api/v1`;
}

/**
 * Identity Platform REST base. When the emulator host is set we hit the
 * emulator's identitytoolkit path; otherwise the public Google endpoints. The
 * web SDK is avoided in the MV3 service worker because it assumes a DOM/window;
 * the REST API (signInWithPassword, securetoken refresh, accounts:update) works
 * cleanly in a worker and gives us explicit refresh-token control (design D27).
 */
export function identityToolkitBase(): string {
  if (config.authEmulatorHost) {
    const host = config.authEmulatorHost.startsWith('http')
      ? config.authEmulatorHost
      : `http://${config.authEmulatorHost}`;
    return `${host}/identitytoolkit.googleapis.com/v1`;
  }
  return 'https://identitytoolkit.googleapis.com/v1';
}

export function secureTokenBase(): string {
  if (config.authEmulatorHost) {
    const host = config.authEmulatorHost.startsWith('http')
      ? config.authEmulatorHost
      : `http://${config.authEmulatorHost}`;
    return `${host}/securetoken.googleapis.com/v1`;
  }
  return 'https://securetoken.googleapis.com/v1';
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
