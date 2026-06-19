/// <reference types="vite/client" />
/// <reference types="chrome" />

interface ImportMetaEnv {
  /** Identity Platform web API key (project-level). */
  readonly VITE_FIREBASE_API_KEY?: string;
  /** GCIP tenant id. One GCIP tenant per app tenant; may be entered at sign-in. */
  readonly VITE_FIREBASE_TENANT_ID?: string;
  /**
   * When set, auth REST calls target the Firebase Auth emulator
   * (e.g. "127.0.0.1:9099"). Lets local dev work without real GCIP.
   */
  readonly VITE_FIREBASE_AUTH_EMULATOR_HOST?: string;
  /** Backend API origin, e.g. "https://api.example.com". "/api/v1" is appended. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
