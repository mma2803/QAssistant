/**
 * Capture-time secret masking for network logs (change: configurable-test-type,
 * task 4.2). This is the FIRST line of defense: sensitive data is scrubbed in the
 * page before it ever leaves the browser. The API runs its own `redactSecrets()`
 * again before the model sees it (defense in depth).
 *
 * Deliberately a high-confidence denylist (no broad PII): auth/cookie headers and
 * well-known secret shapes in bodies. Mirrors apps/api/src/codegen/redaction.ts.
 */

const REDACTED = '[REDACTED]';

/** Header names whose value is always masked (case-insensitive). */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

/** Mask sensitive header values in a plain header record (keys preserved). */
export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? REDACTED : v;
  }
  return out;
}

const BODY_RULES: Array<{ re: RegExp; replace: (m: string, ...g: string[]) => string }> = [
  // Authorization: Bearer <token> / Basic <b64>
  {
    re: /\b(authorization\s*[:=]\s*)(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi,
    replace: (_m, p1: string, p2: string) => `${p1}${p2} ${REDACTED}`,
  },
  // "<auth-header>: <value>" credential headers embedded in a body.
  {
    re: /\b(x-api-key|x-auth-token|api[-_]?key|authorization)(\s*[:=]\s*)("?)[^"\s,;]+("?)/gi,
    replace: (_m, p1: string, p2: string) => `${p1}${p2}${REDACTED}`,
  },
  // password / token / secret style key-values (json, kv, form).
  {
    re: /\b(password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|client[_-]?secret)(["']?\s*[:=]\s*["']?)([^"'\s,;}{]+)/gi,
    replace: (_m, p1: string, p2: string) => `${p1}${p2}${REDACTED}`,
  },
  // Common API-key / JWT token shapes.
  { re: /\bAIza[0-9A-Za-z_\-]{20,}\b/g, replace: () => REDACTED },
  { re: /\bgh[pousr]_[0-9A-Za-z]{20,}\b/g, replace: () => REDACTED },
  { re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, replace: () => REDACTED },
  { re: /\bsk-[0-9A-Za-z]{20,}\b/g, replace: () => REDACTED },
  { re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replace: () => REDACTED },
];

/** Redact known secret shapes from a request/response body string. */
export function redactBody(input: string | null): string | null {
  if (!input) return input;
  let out = input;
  for (const rule of BODY_RULES) {
    out = out.replace(rule.re, rule.replace as (s: string, ...a: string[]) => string);
  }
  return out;
}
