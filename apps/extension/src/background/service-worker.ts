import type { Project } from '@qassistant/shared';
import type {
  AuthState,
  ContentEvent,
  PopupRequest,
  Result,
  ActiveSessionState,
} from '../shared/messages.js';
import { signIn, signOut, getValidAccessToken } from './auth.js';
import { readTokens } from './storage.js';
import { ApiError, getMe, completePasswordChange, listProjects } from './api.js';
import * as recording from './recording.js';

/**
 * MV3 service worker (task 3.1/3.2): the extension's brain. Handles popup
 * commands, content-script capture events, and the flag hotkey. Owns auth token
 * refresh and the recording lifecycle. Non-persistent: rehydrates an in-flight
 * session from chrome.storage.local whenever it is woken.
 */

let projectCache: Project[] = [];

async function projectLookup(id: string): Promise<Project | null> {
  const cached = projectCache.find((p) => p.id === id);
  if (cached) return cached;
  try {
    projectCache = await listProjects();
  } catch {
    return null;
  }
  return projectCache.find((p) => p.id === id) ?? null;
}

// Resume any in-flight session as soon as the worker starts.
void recording.rehydrate(projectLookup);

/* ---------- auth state assembly ---------- */

async function currentAuthState(): Promise<AuthState> {
  const tokens = await readTokens();
  if (!tokens) {
    return {
      signedIn: false,
      uid: null,
      email: null,
      role: null,
      tenantId: null,
      mustChangePassword: false,
    };
  }
  // Prefer authoritative state from the backend /auth/me; fall back to the
  // locally stored tokens (captured at sign-in/refresh time) if unreachable.
  try {
    const me = await getMe();
    return {
      signedIn: true,
      uid: me.uid,
      email: tokens.email,
      role: me.role,
      tenantId: me.tenantId,
      mustChangePassword: me.mustChangePassword,
    };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'must_change_password') {
      return {
        signedIn: true,
        uid: tokens.uid,
        email: tokens.email,
        role: tokens.role,
        tenantId: tokens.tenantId,
        mustChangePassword: true,
      };
    }
    return {
      signedIn: true,
      uid: tokens.uid,
      email: tokens.email,
      role: tokens.role,
      tenantId: tokens.tenantId,
      mustChangePassword: tokens.mustChangePassword,
    };
  }
}

async function activeSessionState(): Promise<ActiveSessionState | null> {
  const active = await recording.getActive();
  if (!active) return null;
  return {
    session: active.session,
    project: active.project,
    screenshotEnabled: active.persisted.screenshotEnabled,
    inactivityMs: active.persisted.inactivityMs,
    domChunksUploaded: active.persisted.nextDomSeq,
    screenshotsUploaded: active.persisted.nextShotSeq,
    flagsRecorded: active.persisted.flagsRecorded,
    startedAtIso: active.persisted.startedAtIso,
  };
}

/* ---------- popup request handling ---------- */

async function handlePopup(req: PopupRequest): Promise<Result<unknown>> {
  try {
    switch (req.type) {
      case 'auth:getState':
        return { ok: true, data: await currentAuthState() };

      case 'auth:signIn': {
        await signIn(req.email, req.password, req.tenantSlug);
        return { ok: true, data: await currentAuthState() };
      }

      case 'auth:completePasswordChange': {
        // The backend sets the new password hash and clears the marker in one
        // call. Capture is blocked by the server until mustChangePassword is
        // cleared, so this must succeed before any session can start (task 3.2).
        await completePasswordChange(req.newPassword);
        return { ok: true, data: await currentAuthState() };
      }

      case 'auth:signOut': {
        await signOut();
        projectCache = [];
        return { ok: true, data: await currentAuthState() };
      }

      case 'projects:list': {
        projectCache = await listProjects();
        return { ok: true, data: projectCache };
      }

      case 'session:start': {
        const project = await projectLookup(req.projectId);
        if (!project) {
          return { ok: false, error: { code: 'not_found', message: 'Project not found' } };
        }
        const session = await recording.start({
          project,
          projectId: req.projectId,
          description: req.description,
          screenshotEnabled: req.screenshotEnabled,
        });
        return { ok: true, data: session };
      }

      case 'session:getActive':
        return { ok: true, data: await activeSessionState() };

      case 'session:stop': {
        const result = await recording.stop('stopped');
        return { ok: true, data: result };
      }

      default:
        return { ok: false, error: { code: 'bad_request', message: 'Unknown request' } };
    }
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    return {
      ok: false,
      error: { code: 'unknown', message: err instanceof Error ? err.message : 'Unexpected error' },
    };
  }
}

/* ---------- content event handling ---------- */

async function handleContent(ev: ContentEvent): Promise<void> {
  switch (ev.type) {
    case 'capture:events':
      await recording.ingestEvents(ev.sessionId, ev.events);
      break;
    case 'capture:network':
      await recording.ingestNetwork(ev.sessionId, ev.entry);
      break;
    case 'capture:flag':
      await recording.flag(ev.sessionId, ev.selector, ev.eventOffsetMs, ev.note);
      break;
    case 'capture:activity':
      await recording.noteActivity(ev.sessionId);
      break;
    case 'content:ready':
      // A page (re)loaded mid-session (e.g. a full-page navigation); re-arm the
      // new document so DOM capture and the flag hotkey keep working on the new
      // URL. rehydrate() alone short-circuits when the worker is still warm.
      await recording.resumeOnNavigation(projectLookup);
      break;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const m = msg as { channel?: string };
  if (m.channel === 'popup') {
    handlePopup(msg.payload as PopupRequest).then(sendResponse);
    return true; // async response
  }
  if (m.channel === 'content') {
    handleContent(msg.payload as ContentEvent).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

/* ---------- flag hotkey (task 3.7) ---------- */

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'flag-state') return;
  // Forward to the content recorder, which resolves the focused element's
  // selector and the replay offset, then posts the flag back to us.
  void (async () => {
    const active = await recording.getActive();
    if (!active) return;
    const tab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (!tab?.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'recorder:flag' });
    } catch {
      /* no recorder on this page */
    }
  })();
});

// Keep tokens warm so the first capture call doesn't stall on a cold refresh.
void getValidAccessToken();
