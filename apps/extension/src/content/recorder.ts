import { record } from 'rrweb';
import type { NetworkLogEntry } from '@qassistant/shared';
import type { RecorderCommand, ContentEvent } from '../shared/messages.js';

/**
 * Content-script recorder (tasks 3.5, 3.7). Runs in the page (the only context
 * with DOM access) and is the source of truth for capture:
 *
 *  - rrweb records clicks/inputs/navigation with selectors as a DOM-replay event
 *    stream. Masking is ON by default: maskAllInputs covers passwords and
 *    token/secret fields; the project's maskTextSelector/blockSelector mask
 *    visible text and block whole subtrees (contract "default DOM masking").
 *  - events are batched and posted to the service worker, which chunks, gzips
 *    and uploads them. The content script keeps no network or auth state.
 *  - the flag hotkey resolves the focused element's selector and the replay
 *    offset and posts a flag (task 3.7). A keydown fallback covers pages where
 *    chrome.commands does not deliver (focus in an iframe, etc.).
 */

let stopFn: (() => void) | null = null;
let activeSessionId: string | null = null;
let startedAtMs = 0;
let lastInteractedEl: Element | null = null;

function send(payload: ContentEvent): void {
  // Fire-and-forget; the SW acks but we don't block capture on it.
  void chrome.runtime.sendMessage({ channel: 'content', payload }).catch(() => undefined);
}

function startRecording(cmd: Extract<RecorderCommand, { type: 'recorder:start' }>): void {
  if (stopFn) return; // already recording
  activeSessionId = cmd.sessionId;
  startedAtMs = Date.parse(cmd.startedAtIso) || Date.now();

  const stop = record({
    emit(event) {
      if (!activeSessionId) return;
      send({ type: 'capture:events', sessionId: activeSessionId, events: [event] });
      send({ type: 'capture:activity', sessionId: activeSessionId });
    },
    // Default masking (mask by default, per spec + design D27).
    maskAllInputs: cmd.masking.maskAllInputs,
    maskTextSelector: cmd.masking.maskTextSelector ?? undefined,
    blockSelector: cmd.masking.blockSelector ?? undefined,
    // Record canvas/styles conservatively; keep payloads lean for chunking.
    recordCanvas: false,
    collectFonts: false,
    // Sampling: capture meaningful interactions without flooding the stream.
    sampling: {
      mousemove: false,
      mouseInteraction: true,
      scroll: 200,
      input: 'last',
    },
  });
  stopFn = stop ?? null;
}

function stopRecording(): void {
  if (stopFn) {
    stopFn();
    stopFn = null;
  }
  activeSessionId = null;
}

// Single uniform attribute list (no per-type special-casing): the first stable
// hook that pins the element wins. Ordered most → least identifying.
const STABLE_ATTRS = [
  'data-testid',
  'data-test',
  'name',
  'aria-label',
  'title',
  'placeholder',
  'role',
  'href',
  'type',
];

// querySelectorAll().length === 1 is the unique-ness oracle the whole algorithm
// relies on; a malformed selector throws, so treat that as "not unique".
function isUnique(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

// CSS.escape escapes identifiers, not attribute *values*; quote and backslash-
// escape the value ourselves so arbitrary attribute content stays valid.
function cssAttrValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Skip auto-generated classes (CSS-modules / styled-components / utility hashes):
// they change every build and make a selector fragile. Keep human-written ones.
function isStableClass(c: string): boolean {
  if (!c || c.length > 40) return false;
  if (/\d/.test(c) && /^[a-z0-9_-]{6,}$/i.test(c) && !/[-_]/.test(c)) return false; // css-1q2w3e
  if (/[_-][0-9a-z]{5,}$/i.test(c) && /\d/.test(c)) return false; // Button_root__1a2b3
  return true;
}

// A stable, syntactically-safe id (skip ids starting with a digit or containing
// odd chars — and verify uniqueness, since duplicate ids exist in the wild).
function idSelector(el: Element): string | null {
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) {
    const sel = `#${CSS.escape(el.id)}`;
    if (isUnique(sel)) return sel;
  }
  return null;
}

// The best single-element token: attribute hook > stable classes > nth-of-type.
// Always tag-qualified — never returns a bare tag that could match the whole page.
function tokenFor(el: Element): string {
  const tag = el.nodeName.toLowerCase();
  for (const attr of STABLE_ATTRS) {
    const val = el.getAttribute(attr);
    if (val && val.length <= 100) return `${tag}[${attr}="${cssAttrValue(val)}"]`;
  }
  const classes = Array.from(el.classList).filter(isStableClass).slice(0, 2);
  if (classes.length) return tag + classes.map((c) => `.${CSS.escape(c)}`).join('');
  const parent = el.parentElement;
  if (parent) {
    const sameTag = Array.from(parent.children).filter((c) => c.nodeName === el.nodeName);
    if (sameTag.length > 1) return `${tag}:nth-of-type(${sameTag.indexOf(el) + 1})`;
  }
  return tag;
}

// Last resort for pages with no stable hooks: a fully positional path to the root.
// Verbose but unique — the incompressible case called out in UG-005.
function positionalPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && node !== document.documentElement) {
    const tag = node.nodeName.toLowerCase();
    const parent: Element | null = node.parentElement;
    let part = tag;
    if (parent) {
      const sibs = Array.from(parent.children).filter((c) => c.nodeName === node!.nodeName);
      part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}

/**
 * Build the shortest UNIQUE CSS selector for an element with one generic
 * algorithm (no per-element-type branches): stable #id → distinctive attribute →
 * shortest ancestor path whose uniqueness is verified at each step → positional
 * fallback. Never returns a bare tag. The flag's selector is consumed as a hint
 * by codegen, so uniqueness directly improves the generated assertions.
 */
function cssSelectorFor(el: Element): string {
  const byId = idSelector(el);
  if (byId) return byId;

  // A single distinctive attribute that already pins the element page-wide.
  const tag = el.nodeName.toLowerCase();
  for (const attr of STABLE_ATTRS) {
    const val = el.getAttribute(attr);
    if (val && val.length <= 100) {
      const sel = `${tag}[${attr}="${cssAttrValue(val)}"]`;
      if (isUnique(sel)) return sel;
    }
  }

  // Walk up, prepending the best token per level, until the path is unique
  // (or we hit an ancestor with a unique id to anchor on).
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1) {
    const anchor = idSelector(node);
    if (anchor) {
      parts.unshift(anchor);
      const withAnchor = parts.join(' > ');
      if (isUnique(withAnchor)) return withAnchor;
      break;
    }
    parts.unshift(tokenFor(node));
    const candidate = parts.join(' > ');
    if (isUnique(candidate)) return candidate;
    node = node.parentElement;
  }

  const path = parts.join(' > ');
  return isUnique(path) ? path : positionalPath(el);
}

let lastFlagAtMs = 0;

// Elements that are meaningful to flag/assert. When the recorded target is a
// generic wrapper, we snap to the nearest of these.
const ACTIONABLE =
  'a,button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="radio"],[contenteditable="true"],[onclick],[tabindex]';

function snapToActionable(el: Element): Element {
  if (el.matches(ACTIONABLE)) return el;
  // Clicked a <span>/<svg> inside a button → climb to the actionable ancestor.
  const ancestor = el.closest(ACTIONABLE);
  if (ancestor) return ancestor;
  // Clicked a wrapper that holds exactly one control → that control is the intent.
  const inner = el.querySelectorAll(ACTIONABLE);
  if (inner.length === 1 && inner[0]) return inner[0];
  return el;
}

// Resolve which element the flag targets, by recency. macOS does NOT focus a
// button on click, so document.activeElement is unreliable — fall back to the
// most recently hovered/focused/clicked element. Skip nodes an SPA re-render
// has detached from the DOM.
function resolveFlagTarget(): Element | null {
  const active = document.activeElement;
  let el: Element | null =
    active && active !== document.body && active !== document.documentElement ? active : null;
  if (!el || !el.isConnected) {
    el = lastInteractedEl && lastInteractedEl.isConnected ? lastInteractedEl : null;
  }
  if (!el) return null;
  return snapToActionable(el);
}

function flagFocused(note?: string): void {
  if (!activeSessionId) return;
  // De-dupe: the hotkey can arrive via both chrome.commands and the keydown
  // fallback; collapse a near-simultaneous double-fire into a single flag.
  const now = Date.now();
  if (now - lastFlagAtMs < 300) return;
  const el = resolveFlagTarget();
  if (!el) return;
  lastFlagAtMs = now;
  const selector = cssSelectorFor(el);
  send({
    type: 'capture:flag',
    sessionId: activeSessionId,
    selector,
    eventOffsetMs: Math.max(0, Date.now() - startedAtMs),
    note,
  });
}

// Recency model: track the most recently hovered / focused / clicked element so
// a flag can target what the tester is pointing at, even when no click gave it
// focus (the macOS button case) or the cursor only hovered it. Ignore body/html
// so a hover over an empty gap doesn't clobber the last meaningful element.
function recordInteraction(target: EventTarget | null): void {
  if (
    target instanceof Element &&
    target !== document.body &&
    target !== document.documentElement
  ) {
    lastInteractedEl = target;
  }
}

for (const evt of ['pointerdown', 'mouseover', 'focusin'] as const) {
  document.addEventListener(evt, (e) => recordInteraction(e.target), true);
}

// Keydown fallback for the flag hotkey (Alt+Shift+F), complementing
// chrome.commands which may not fire when focus is inside some frames.
document.addEventListener(
  'keydown',
  (e) => {
    // Match the PHYSICAL key (e.code), not e.key: on macOS Option+Shift+F emits a
    // special character, not "F", so e.key-based matching never fired there.
    if (e.altKey && e.shiftKey && e.code === 'KeyF') {
      e.preventDefault();
      flagFocused();
    }
  },
  true,
);

// Relay captured network calls from the MAIN-world interceptor. The interceptor
// always posts; we only forward to the service worker while recording, so the
// network_log is scoped to the active session (change: configurable-test-type).
window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window) return;
  const data = e.data as { source?: string; entry?: NetworkLogEntry } | null;
  if (!data || data.source !== 'qa-net-capture' || !data.entry) return;
  if (!activeSessionId) return;
  // Network is NOT user activity: analytics/polling fire while the tester is idle
  // and must not keep the inactivity timer alive. Forward the call only.
  send({ type: 'capture:network', sessionId: activeSessionId, entry: data.entry });
});

// Receive commands from the service worker.
chrome.runtime.onMessage.addListener((msg: RecorderCommand | { type: 'recorder:flag' }) => {
  switch (msg.type) {
    case 'recorder:start':
      startRecording(msg);
      break;
    case 'recorder:stop':
      stopRecording();
      break;
    case 'recorder:flag':
      flagFocused();
      break;
    default:
      break;
  }
});

// Announce readiness so the SW can resume a session that spans this navigation.
send({ type: 'content:ready' });
