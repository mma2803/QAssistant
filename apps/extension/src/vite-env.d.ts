/// <reference types="vite/client" />
/// <reference types="chrome" />

interface ImportMetaEnv {
  /** Default tenant slug prefilled at sign-in; may be overridden in the form. */
  readonly VITE_DEFAULT_TENANT_SLUG?: string;
  /** Backend API origin, e.g. "https://api.example.com". "/api/v1" is appended. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
