import type {
  AuthMeResponse,
  Project,
  Session,
  StartSessionRequest,
  RegisterArtifactRequest,
  Artifact,
  CreateFlagRequest,
  Flag,
  UploadUrlsResponse,
  CompletePasswordChangeRequest,
} from '@qassistant/shared';
import { apiBase } from '../shared/config.js';
import { getValidIdToken } from './auth.js';

/** Error carrying the backend envelope code so callers can branch (e.g. gate). */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const token = await getValidIdToken();
  if (!token) {
    throw new ApiError('unauthenticated', 'Not signed in', 401);
  }
  const url = new URL(`${apiBase()}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const env = payload as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      env?.error?.code ?? 'unknown',
      env?.error?.message ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  return payload as T;
}

/* ---- auth ---- */

export function getMe(): Promise<AuthMeResponse> {
  return request<AuthMeResponse>('/auth/me');
}

export function completePasswordChange(newPassword: string): Promise<void> {
  const body: CompletePasswordChangeRequest = { newPassword };
  return request<void>('/auth/complete-password-change', { method: 'POST', body });
}

/* ---- projects ---- */

export function listProjects(): Promise<Project[]> {
  return request<Project[]>('/projects');
}

/* ---- capture ---- */

export function startSession(input: StartSessionRequest): Promise<Session> {
  return request<Session>('/sessions', { method: 'POST', body: input });
}

export function stopSession(sessionId: string): Promise<Session> {
  return request<Session>(`/sessions/${sessionId}/stop`, { method: 'POST' });
}

export function getUploadUrls(
  sessionId: string,
  items: { type: 'dom_chunk' | 'screenshot'; seq: number }[],
): Promise<UploadUrlsResponse> {
  // The contract models /upload-urls as GET; items travel in the querystring as
  // repeated type/seq pairs the backend zips back together.
  const query: Record<string, string> = {};
  items.forEach((it, i) => {
    query[`type${i}`] = it.type;
    query[`seq${i}`] = String(it.seq);
  });
  query.count = String(items.length);
  return request<UploadUrlsResponse>(`/sessions/${sessionId}/upload-urls`, { query });
}

export function registerArtifact(
  sessionId: string,
  input: RegisterArtifactRequest,
): Promise<Artifact> {
  return request<Artifact>(`/sessions/${sessionId}/artifacts`, { method: 'POST', body: input });
}

export function createFlag(sessionId: string, input: CreateFlagRequest): Promise<Flag> {
  return request<Flag>(`/sessions/${sessionId}/flags`, { method: 'POST', body: input });
}
