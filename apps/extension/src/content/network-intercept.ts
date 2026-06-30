import type { NetworkLogEntry } from '@qassistant/shared';
import { maskHeaders, redactBody } from '../shared/redact.js';
import { networkCapture } from '../shared/config.js';

/**
 * Network interceptor (change: configurable-test-type, task 4.1/4.2). Runs in the
 * page's MAIN world (declared in the manifest with world:'MAIN') — the only
 * context that can see the page's own `fetch` / `XMLHttpRequest`. It monkey-
 * patches both, captures method/URL/status/headers/bodies/timing for each call,
 * masks sensitive headers and redacts secret body shapes, truncates large bodies,
 * and posts each entry to the isolated content script via window.postMessage.
 *
 * It is intentionally "dumb": it always captures and posts. The isolated recorder
 * only forwards entries to the service worker while a session is recording, so
 * there is no need to signal session start/stop across the world boundary.
 *
 * Known MVP gaps: traffic from service workers / sendBeacon / other contexts is
 * not seen here (documented in design.md).
 */

const POST_TAG = 'qa-net-capture';

/**
 * Drop third-party analytics / ads / telemetry traffic so the captured log
 * reflects the application's own API, not tracking noise (which produces
 * worthless backend tests). Matched against the request's hostname.
 */
const NOISE_HOST_PATTERNS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'g.doubleclick.net',
  'gstatic.com',
  'google.com/pagead',
  'google.com/ccm',
  'facebook.com/tr',
  'connect.facebook.net',
  'segment.io',
  'segment.com',
  'sentry.io',
  'hotjar.com',
  'fullstory.com',
  'mixpanel.com',
  'amplitude.com',
  'clarity.ms',
  'bat.bing.com',
  'cdn.segment',
  'px.ads.linkedin.com',
  'ads.linkedin.com',
  'snap.licdn.com',
  'analytics.tiktok.com',
  'criteo.com',
  'taboola.com',
  'outbrain.com',
  'ads-twitter.com',
  't.co/i/adsct',
  'cloudflareinsights.com',
];

/** Only capture relevant HTTP(S) traffic (skip data:/blob: and known trackers). */
function shouldCapture(rawUrl: string): boolean {
  let abs: URL;
  try {
    abs = new URL(rawUrl, location.href);
  } catch {
    return false;
  }
  if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return false;
  const hostAndPath = `${abs.hostname}${abs.pathname}`.toLowerCase();
  return !NOISE_HOST_PATTERNS.some((p) => hostAndPath.includes(p));
}

function truncate(body: string | null): { body: string | null; truncated: boolean } {
  if (body == null) return { body: null, truncated: false };
  if (body.length <= networkCapture.maxBodyBytes) return { body, truncated: false };
  return { body: body.slice(0, networkCapture.maxBodyBytes), truncated: true };
}

function emit(entry: NetworkLogEntry): void {
  // postMessage to our own window; the isolated content script filters by tag.
  try {
    window.postMessage({ source: POST_TAG, entry }, '*');
  } catch {
    // Non-cloneable payloads are already plain JSON here; ignore any failure.
  }
}

function headersToRecord(headers: Headers | Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((v, k) => {
      out[k] = v;
    });
  } else {
    for (const [k, v] of Object.entries(headers)) out[k] = String(v);
  }
  return maskHeaders(out);
}

function finalize(
  partial: Omit<NetworkLogEntry, 'requestBody' | 'responseBody'> & {
    requestBody: string | null;
    responseBody: string | null;
  },
): NetworkLogEntry {
  const req = truncate(redactBody(partial.requestBody));
  const res = truncate(redactBody(partial.responseBody));
  return {
    ...partial,
    requestBody: req.body,
    responseBody: res.body,
    ...(req.truncated ? { requestBodyTruncated: true } : {}),
    ...(res.truncated ? { responseBodyTruncated: true } : {}),
  };
}

/* ---------------- fetch ---------------- */

const nativeFetch = window.fetch;
if (typeof nativeFetch === 'function') {
  window.fetch = async function patchedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = input instanceof Request ? input.url : String(input);
    if (!shouldCapture(url)) return nativeFetch.call(this, input as RequestInfo, init);
    const startedAtMs = performance.now();
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const requestHeaders = headersToRecord(
      init?.headers as Record<string, string> | undefined ??
        (input instanceof Request ? input.headers : undefined),
    );
    const requestBody =
      typeof init?.body === 'string' ? init.body : init?.body != null ? '[non-text body]' : null;

    try {
      const response = await nativeFetch.call(this, input as RequestInfo, init);
      let responseBody: string | null = null;
      try {
        // Clone so the page still consumes the body normally.
        responseBody = await response.clone().text();
      } catch {
        responseBody = null;
      }
      emit(
        finalize({
          method,
          url,
          status: response.status,
          requestHeaders,
          responseHeaders: headersToRecord(response.headers),
          requestBody,
          responseBody,
          startedAtMs: Math.round(startedAtMs),
          durationMs: Math.round(performance.now() - startedAtMs),
        }),
      );
      return response;
    } catch (err) {
      emit(
        finalize({
          method,
          url,
          status: null,
          requestHeaders,
          responseHeaders: {},
          requestBody,
          responseBody: null,
          startedAtMs: Math.round(startedAtMs),
          durationMs: Math.round(performance.now() - startedAtMs),
        }),
      );
      throw err;
    }
  } as typeof window.fetch;
}

/* ---------------- navigator.sendBeacon ---------------- */

const nativeSendBeacon = navigator.sendBeacon?.bind(navigator);
if (typeof nativeSendBeacon === 'function') {
  navigator.sendBeacon = function patchedSendBeacon(url: string | URL, data?: BodyInit | null): boolean {
    const u = String(url);
    if (shouldCapture(u)) {
      const body = typeof data === 'string' ? data : data != null ? '[non-text body]' : null;
      emit(
        finalize({
          method: 'POST',
          url: u,
          status: null,
          requestHeaders: {},
          responseHeaders: {},
          requestBody: body,
          responseBody: null,
          startedAtMs: Math.round(performance.now()),
          durationMs: null,
        }),
      );
    }
    return nativeSendBeacon(url, data ?? undefined);
  };
}

/* ---------------- XMLHttpRequest ---------------- */

interface XhrMeta {
  method: string;
  url: string;
  startedAtMs: number;
  requestBody: string | null;
  requestHeaders: Record<string, string>;
}

const XHR = XMLHttpRequest.prototype;
const nativeOpen = XHR.open;
const nativeSend = XHR.send;
const nativeSetHeader = XHR.setRequestHeader;
const META = new WeakMap<XMLHttpRequest, XhrMeta>();

XHR.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  META.set(this, {
    method: String(method).toUpperCase(),
    url: String(url),
    startedAtMs: 0,
    requestBody: null,
    requestHeaders: {},
  });
  // @ts-expect-error forward original args verbatim
  return nativeOpen.call(this, method, url, ...rest);
};

XHR.setRequestHeader = function patchedSetHeader(this: XMLHttpRequest, name: string, value: string) {
  const meta = META.get(this);
  if (meta) meta.requestHeaders[name] = value;
  return nativeSetHeader.call(this, name, value);
};

XHR.send = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
  const meta = META.get(this);
  if (meta && shouldCapture(meta.url)) {
    meta.startedAtMs = performance.now();
    meta.requestBody = typeof body === 'string' ? body : body != null ? '[non-text body]' : null;
    this.addEventListener('loadend', () => {
      let responseBody: string | null = null;
      try {
        responseBody = this.responseType === '' || this.responseType === 'text' ? this.responseText : null;
      } catch {
        responseBody = null;
      }
      const responseHeaders = parseRawHeaders(this.getAllResponseHeaders());
      emit(
        finalize({
          method: meta.method,
          url: meta.url,
          status: this.status || null,
          requestHeaders: maskHeaders(meta.requestHeaders),
          responseHeaders,
          requestBody: meta.requestBody,
          responseBody,
          startedAtMs: Math.round(meta.startedAtMs),
          durationMs: Math.round(performance.now() - meta.startedAtMs),
        }),
      );
    });
  }
  return nativeSend.call(this, body as Parameters<typeof nativeSend>[0]);
};

function parseRawHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return maskHeaders(out);
}
