import { record } from 'rrweb';
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
let lastFlaggedEl: Element | null = null;

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

/**
 * Build a reasonably stable CSS selector for an element: prefer #id, else a
 * data-testid, else a tag + nth-of-type path bounded in depth. Mirrors the kind
 * of selector rrweb/codegen consumes; good enough to flag a state for codegen.
 */
function cssSelectorFor(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test');
  if (testId) return `[data-testid="${testId}"]`;

  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node.nodeType === 1 && depth < 5) {
    let part = node.nodeName.toLowerCase();
    const parent = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.nodeName === node!.nodeName);
      if (sameTag.length > 1) {
        const idx = sameTag.indexOf(node) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    if (node.id) {
      parts[0] = `#${CSS.escape(node.id)}`;
      break;
    }
    node = node.parentElement;
    depth += 1;
  }
  return parts.join(' > ');
}

function flagFocused(note?: string): void {
  if (!activeSessionId) return;
  const el = (document.activeElement && document.activeElement !== document.body
    ? document.activeElement
    : lastFlaggedEl) as Element | null;
  if (!el) return;
  const selector = cssSelectorFor(el);
  send({
    type: 'capture:flag',
    sessionId: activeSessionId,
    selector,
    eventOffsetMs: Math.max(0, Date.now() - startedAtMs),
    note,
  });
}

// Track the last interacted element so a flag can target it even if focus moved.
document.addEventListener(
  'pointerdown',
  (e) => {
    if (e.target instanceof Element) lastFlaggedEl = e.target;
  },
  true,
);

// Keydown fallback for the flag hotkey (Alt+Shift+F), complementing
// chrome.commands which may not fire when focus is inside some frames.
document.addEventListener(
  'keydown',
  (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      flagFocused();
    }
  },
  true,
);

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
