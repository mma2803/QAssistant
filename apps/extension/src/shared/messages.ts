import type { NetworkLogEntry, Project, Session } from '@qassistant/shared';

/**
 * Typed message protocol between the three extension contexts:
 *   popup  -> service worker : commands (sign-in, start, stop, ...)
 *   content -> service worker : capture events (rrweb chunks, flags, activity)
 *   service worker -> content : start/stop recording + masking config
 *
 * Every message is discriminated by `type`. Requests sent via
 * chrome.runtime.sendMessage resolve with the matching `*Result`.
 */

export interface AuthState {
  signedIn: boolean;
  uid: string | null;
  email: string | null;
  role: 'admin' | 'qa-engineer' | 'super-admin' | null;
  tenantId: string | null;
  mustChangePassword: boolean;
}

export interface ActiveSessionState {
  session: Session;
  project: Project;
  screenshotEnabled: boolean;
  /** Effective inactivity timeout for this session, in ms. */
  inactivityMs: number;
  /** Counters surfaced in the popup for reassurance. */
  domChunksUploaded: number;
  screenshotsUploaded: number;
  flagsRecorded: number;
  startedAtIso: string;
}

/** Masking config handed to the content recorder (rrweb options subset). */
export interface MaskingConfig {
  maskAllInputs: boolean;
  maskTextSelector: string | null;
  blockSelector: string | null;
}

/* ---- popup -> service worker ---- */

export type PopupRequest =
  | { type: 'auth:getState' }
  | { type: 'auth:signIn'; email: string; password: string; tenantId?: string }
  | { type: 'auth:completePasswordChange'; newPassword: string }
  | { type: 'auth:signOut' }
  | { type: 'projects:list' }
  | {
      type: 'session:start';
      projectId: string;
      jiraId?: string;
      description?: string;
      screenshotEnabled?: boolean;
    }
  | { type: 'session:getActive' }
  | { type: 'session:stop' };

export interface OkResult<T> {
  ok: true;
  data: T;
}
export interface ErrResult {
  ok: false;
  error: { code: string; message: string };
}
export type Result<T> = OkResult<T> | ErrResult;

/* ---- content -> service worker ---- */

export type ContentEvent =
  | { type: 'capture:events'; sessionId: string; events: unknown[] }
  | { type: 'capture:network'; sessionId: string; entry: NetworkLogEntry }
  | { type: 'capture:flag'; sessionId: string; selector: string; eventOffsetMs: number; note?: string }
  | { type: 'capture:activity'; sessionId: string }
  | { type: 'content:ready' };

/* ---- service worker -> content ---- */

export type RecorderCommand =
  | {
      type: 'recorder:start';
      sessionId: string;
      masking: MaskingConfig;
      startedAtIso: string;
    }
  | { type: 'recorder:stop' }
  | { type: 'recorder:flag' }
  | { type: 'recorder:status' };

export type RecorderStatus = { recording: boolean; sessionId: string | null };
