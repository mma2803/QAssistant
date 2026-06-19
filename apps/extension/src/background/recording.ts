import type { Project, Session } from '@qassistant/shared';
import { capture } from '../shared/config.js';
import type { MaskingConfig, RecorderCommand } from '../shared/messages.js';
import {
  readActiveSession,
  writeActiveSession,
  clearActiveSession,
  type PersistedSession,
} from './storage.js';
import { startSession, stopSession, createFlag } from './api.js';
import { uploadDomChunk, uploadScreenshot } from './upload.js';

/**
 * Recording lifecycle owned by the service worker. Holds per-session state in
 * chrome.storage.local (PersistedSession) so it survives MV3 worker restarts.
 * The content script captures rrweb events and pushes them here; this module
 * buffers, chunks, gzips, uploads, screenshots, and runs the local inactivity
 * timer. The server-side inactivity sweep is the authoritative backstop; this
 * timer just self-closes a healthy extension promptly (contract section 4.4).
 *
 * tenant/uid are NEVER asserted by the extension: POST /sessions returns a
 * server-stamped Session row and we replay its ids back verbatim.
 */

interface RuntimeState {
  project: Project;
  session: Session;
  eventBuffer: unknown[];
  flushTimer: ReturnType<typeof setInterval> | null;
  screenshotTimer: ReturnType<typeof setInterval> | null;
  inactivityTimer: ReturnType<typeof setTimeout> | null;
  uploading: boolean;
}

let runtime: RuntimeState | null = null;

function tabTargetFor(): Promise<chrome.tabs.Tab | undefined> {
  return chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((t) => t[0]);
}

/** Effective screenshot setting: per-session override wins over project default. */
function resolveScreenshot(project: Project, override?: boolean): boolean {
  return override ?? project.screenshotDefault;
}

export async function getActive(): Promise<{
  session: Session;
  project: Project;
  persisted: PersistedSession;
} | null> {
  const persisted = await readActiveSession();
  if (!persisted) return null;
  if (runtime && runtime.session.id === persisted.sessionId) {
    return { session: runtime.session, project: runtime.project, persisted };
  }
  return null;
}

export interface StartArgs {
  project: Project;
  projectId: string;
  jiraId?: string;
  description?: string;
  screenshotEnabled?: boolean;
}

/**
 * Start a session: call POST /sessions (which authorizes the project, validates
 * Jira live when jiraId is present, freezes context, mints the session). On
 * success, persist state, instruct the content recorder to begin, and start the
 * flush/screenshot/inactivity timers.
 */
export async function start(args: StartArgs): Promise<Session> {
  const screenshotEnabled = resolveScreenshot(args.project, args.screenshotEnabled);
  const session = await startSession({
    projectId: args.projectId,
    jiraId: args.jiraId,
    description: args.description,
    screenshotEnabled,
  });

  const inactivityMs =
    (args.project.inactivityTimeoutSeconds ?? 0) > 0
      ? args.project.inactivityTimeoutSeconds * 1000
      : capture.defaultInactivityMs;

  const persisted: PersistedSession = {
    sessionId: session.id,
    projectId: session.projectId,
    tenantId: session.tenantId,
    screenshotEnabled: session.screenshotEnabled,
    inactivityMs,
    startedAtIso: session.startedAt,
    nextDomSeq: 0,
    nextShotSeq: 0,
    flagsRecorded: 0,
    lastActivityMs: Date.now(),
  };
  await writeActiveSession(persisted);

  runtime = {
    project: args.project,
    session,
    eventBuffer: [],
    flushTimer: null,
    screenshotTimer: null,
    inactivityTimer: null,
    uploading: false,
  };

  await commandRecorder({
    type: 'recorder:start',
    sessionId: session.id,
    startedAtIso: session.startedAt,
    masking: maskingFor(args.project),
  });

  startTimers(persisted);
  return session;
}

function maskingFor(project: Project): MaskingConfig {
  const selectors = project.maskingSelectors ?? [];
  const joined = selectors.length > 0 ? selectors.join(', ') : null;
  return {
    // Mask by default: rrweb maskAllInputs covers passwords + token/secret fields.
    maskAllInputs: true,
    // Per-project selectors mask visible text and block subtrees entirely.
    maskTextSelector: joined,
    blockSelector: joined,
  };
}

function startTimers(persisted: PersistedSession): void {
  if (!runtime) return;
  runtime.flushTimer = setInterval(() => void flush('timer'), capture.chunkIntervalMs);
  if (persisted.screenshotEnabled) {
    runtime.screenshotTimer = setInterval(() => void captureScreenshot(), capture.screenshotIntervalMs);
  }
  resetInactivity(persisted.inactivityMs);
}

function resetInactivity(inactivityMs: number): void {
  if (!runtime) return;
  if (runtime.inactivityTimer) clearTimeout(runtime.inactivityTimer);
  runtime.inactivityTimer = setTimeout(() => {
    void stop('inactivity');
  }, inactivityMs);
}

/** Accept a batch of rrweb events from the content recorder. */
export async function ingestEvents(sessionId: string, events: unknown[]): Promise<void> {
  if (!runtime || runtime.session.id !== sessionId) return;
  runtime.eventBuffer.push(...events);
  await noteActivity(sessionId);
  if (runtime.eventBuffer.length >= capture.chunkEventThreshold) {
    await flush('threshold');
  }
}

/** Update the local inactivity timer on any captured activity. */
export async function noteActivity(sessionId: string): Promise<void> {
  const persisted = await readActiveSession();
  if (!persisted || persisted.sessionId !== sessionId) return;
  persisted.lastActivityMs = Date.now();
  await writeActiveSession(persisted);
  resetInactivity(persisted.inactivityMs);
}

/** Flush buffered events into one gzipped dom_chunk artifact. */
export async function flush(_reason: 'timer' | 'threshold' | 'stop'): Promise<void> {
  if (!runtime || runtime.uploading) return;
  if (runtime.eventBuffer.length === 0) return;
  const persisted = await readActiveSession();
  if (!persisted) return;

  const batch = runtime.eventBuffer;
  runtime.eventBuffer = [];
  runtime.uploading = true;
  const seq = persisted.nextDomSeq;
  try {
    await uploadDomChunk({
      sessionId: persisted.sessionId,
      seq,
      json: JSON.stringify(batch),
      capturedAtIso: new Date().toISOString(),
    });
    persisted.nextDomSeq = seq + 1;
    await writeActiveSession(persisted);
  } catch (err) {
    // Re-buffer the batch so a transient failure doesn't drop events.
    runtime.eventBuffer = batch.concat(runtime.eventBuffer);
    console.warn('dom_chunk upload failed, will retry', err);
  } finally {
    runtime.uploading = false;
  }
}

/** Capture a viewport-only screenshot of the active tab and upload it. */
async function captureScreenshot(): Promise<void> {
  if (!runtime) return;
  const persisted = await readActiveSession();
  if (!persisted || !persisted.screenshotEnabled) return;
  try {
    const tab = await tabTargetFor();
    if (!tab || tab.windowId === undefined) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 70,
    });
    const blob = dataUrlToBlob(dataUrl);
    const seq = persisted.nextShotSeq;
    await uploadScreenshot({
      sessionId: persisted.sessionId,
      seq,
      blob,
      capturedAtIso: new Date().toISOString(),
    });
    persisted.nextShotSeq = seq + 1;
    await writeActiveSession(persisted);
  } catch (err) {
    console.warn('screenshot capture/upload failed', err);
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = /data:(.*?);base64/.exec(head ?? '')?.[1] ?? 'image/jpeg';
  const bin = atob(b64 ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Record a flag from the hotkey (task 3.7). */
export async function flag(
  sessionId: string,
  selector: string,
  eventOffsetMs: number,
  note?: string,
): Promise<void> {
  const persisted = await readActiveSession();
  if (!persisted || persisted.sessionId !== sessionId) return;
  await createFlag(sessionId, { selector, eventOffsetMs, note: note ?? null });
  persisted.flagsRecorded += 1;
  await writeActiveSession(persisted);
  await noteActivity(sessionId);
}

/**
 * Stop the session: flush remaining events, tell the recorder to stop, call
 * POST /stop (server stamps ended_at + close_reason + triggers summary), then
 * clear local state. `reason` is informational for the popup; the server sets
 * the authoritative close_reason (stopped vs inactivity is server-derived from
 * which endpoint/sweep fired, per contract section 4.4).
 */
export async function stop(_reason: 'stopped' | 'inactivity'): Promise<Session | null> {
  const persisted = await readActiveSession();
  if (!persisted) {
    teardownRuntime();
    return null;
  }
  await flush('stop');
  await commandRecorder({ type: 'recorder:stop' });
  let result: Session | null = null;
  try {
    result = await stopSession(persisted.sessionId);
  } catch (err) {
    console.warn('stopSession failed (server backstop will close it)', err);
  }
  teardownRuntime();
  await clearActiveSession();
  return result;
}

function teardownRuntime(): void {
  if (!runtime) return;
  if (runtime.flushTimer) clearInterval(runtime.flushTimer);
  if (runtime.screenshotTimer) clearInterval(runtime.screenshotTimer);
  if (runtime.inactivityTimer) clearTimeout(runtime.inactivityTimer);
  runtime = null;
}

/** Send a command to the active tab's content recorder. */
async function commandRecorder(cmd: RecorderCommand): Promise<void> {
  const tab = await tabTargetFor();
  if (!tab || tab.id === undefined) return;
  try {
    await chrome.tabs.sendMessage(tab.id, cmd);
  } catch {
    // Content script may not be present yet (e.g. chrome:// page); ignore.
  }
}

/**
 * Re-arm runtime after a service-worker restart while a session is persisted.
 * Re-asks the content recorder to resume and restarts timers. Buffered events
 * that were never persisted are lost (accepted; chunks flush every few seconds).
 */
export async function rehydrate(projectLookup: (id: string) => Promise<Project | null>): Promise<void> {
  if (runtime) return;
  const persisted = await readActiveSession();
  if (!persisted) return;
  const project = await projectLookup(persisted.projectId);
  if (!project) return;
  // Reconstruct a minimal Session view from persisted fields for the popup.
  const session: Session = {
    id: persisted.sessionId,
    tenantId: persisted.tenantId,
    projectId: persisted.projectId,
    recordedBy: '',
    jiraId: null,
    jiraSummary: null,
    jiraStatus: null,
    description: null,
    screenshotEnabled: persisted.screenshotEnabled,
    status: 'active',
    closeReason: null,
    summary: null,
    startedAt: persisted.startedAtIso,
    endedAt: null,
    deletedAt: null,
    purgeAt: null,
    createdAt: persisted.startedAtIso,
    updatedAt: persisted.startedAtIso,
  };
  runtime = {
    project,
    session,
    eventBuffer: [],
    flushTimer: null,
    screenshotTimer: null,
    inactivityTimer: null,
    uploading: false,
  };
  await commandRecorder({
    type: 'recorder:start',
    sessionId: persisted.sessionId,
    startedAtIso: persisted.startedAtIso,
    masking: maskingFor(project),
  });
  startTimers(persisted);
}
