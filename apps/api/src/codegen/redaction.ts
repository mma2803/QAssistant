/**
 * Known-secret redaction (design D8c; spec "Known secrets redacted before model
 * use"). Before any captured DOM, tester description, project markdown, or
 * screenshot-derived context is placed into a Gemini prompt, this scrubs the
 * well-known secret shapes: passwords, tokens, API keys, auth headers, cookies,
 * and bearer credentials.
 *
 * This is deliberately a denylist of high-confidence patterns (D8c: MVP does not
 * require broad PII redaction or configurable custom rules). It runs over the
 * already-assembled text just before model use, so every untrusted source is
 * covered by a single pass.
 */

const REDACTED = '[REDACTED]';

interface Rule {
  re: RegExp;
  /** Replacement that preserves the key/label so the model still sees structure. */
  replace: (match: string, ...groups: string[]) => string;
}

const RULES: Rule[] = [
  // Authorization: Bearer <token> / Authorization: Basic <b64>
  {
    re: /\b(authorization\s*[:=]\s*)(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi,
    replace: (_m, p1: string, p2: string) => `${p1}${p2} ${REDACTED}`,
  },
  // Generic "<auth-header>: <value>" headers that carry credentials.
  {
    re: /\b(x-api-key|x-auth-token|api[-_]?key|authorization)(\s*[:=]\s*)("?)[^"\s,;]+("?)/gi,
    replace: (_m, p1: string, p2: string) => `${p1}${p2}${REDACTED}`,
  },
  // Cookie / Set-Cookie header values.
  {
    re: /\b(set-)?cookie(\s*[:=]\s*)[^\n\r]+/gi,
    replace: (_m, p1: string | undefined, p2: string) => `${p1 ?? ''}cookie${p2}${REDACTED}`,
  },
  // password / passwd / pwd / secret / token followed by a value (json, kv, form).
  {
    re: /\b(password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|client[_-]?secret)(["']?\s*[:=]\s*["']?)([^"'\s,;}{]+)/gi,
    replace: (_m, p1: string, p2: string) => `${p1}${p2}${REDACTED}`,
  },
  // HTML password inputs: value="..." on an input of type password.
  {
    re: /(<input[^>]*type=["']password["'][^>]*value=["'])[^"']*(["'])/gi,
    replace: (_m, p1: string, p2: string) => `${p1}${REDACTED}${p2}`,
  },
  // Common API-key token shapes (Google, GitHub, Slack, generic sk- keys).
  { re: /\bAIza[0-9A-Za-z_\-]{20,}\b/g, replace: () => REDACTED },
  { re: /\bgh[pousr]_[0-9A-Za-z]{20,}\b/g, replace: () => REDACTED },
  { re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, replace: () => REDACTED },
  { re: /\bsk-[0-9A-Za-z]{20,}\b/g, replace: () => REDACTED },
  // JWTs (header.payload.signature).
  {
    re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replace: () => REDACTED,
  },
];

/** Redact known secrets from a single text blob. Safe on empty/undefined input. */
export function redactSecrets(input: string | null | undefined): string {
  if (!input) return '';
  let out = input;
  for (const rule of RULES) {
    out = out.replace(rule.re, rule.replace as (substring: string, ...args: any[]) => string);
  }
  return out;
}
