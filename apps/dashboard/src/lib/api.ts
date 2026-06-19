import type {
  AuthMeResponse,
  DashboardSessionsResponse,
  DashboardSessionsQuery,
  SessionDetailResponse,
  SessionReplayResponse,
  MetricsResponse,
  RankingResponse,
  Session,
  Project,
  TenantUser,
  GeneratedTest,
  GenerationComment,
  JobResponse,
  CreateProjectRequest,
  CreateUserRequest,
  UpdateUserRequest,
  ResetPasswordRequest,
  CreateCommentRequest,
  RegenerateRequest,
  ErrorEnvelope,
} from '@qassistant/shared';
import { getIdToken } from './firebase';

/**
 * Small typed REST client. Every request carries the verified Identity Platform
 * ID token; the backend derives tenant/role/uid from it (the client never
 * asserts identity). Response bodies are the shared DTO types, so the dashboard
 * and backend cannot drift on shape.
 */
// An empty VITE_API_BASE_URL (the .env.example default for same-origin dev via
// the Vite proxy) must fall back to '/api' just like an unset one; `??` only
// catches null/undefined, so an empty string would otherwise yield '/v1'.
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').trim() || '/api';
const BASE = API_BASE + '/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the backend is blocking on a forced password change. */
  get isMustChangePassword(): boolean {
    return this.code === 'must_change_password';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const token = await getIdToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const url = new URL(BASE + path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    let code = 'unknown';
    let message = res.statusText;
    let details: Record<string, unknown> | undefined;
    if (contentType.includes('application/json')) {
      const env = (await res.json()) as ErrorEnvelope;
      code = env.error?.code ?? code;
      message = env.error?.message ?? message;
      details = env.error?.details;
    }
    throw new ApiError(res.status, code, message, details);
  }

  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return undefined as T;
}

/** Download a binary response (the session export ZIP) as a Blob. */
async function downloadBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  const token = await getIdToken();
  const res = await fetch(new URL(BASE + path, window.location.origin).toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, 'export_failed', `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  return { blob, filename: match?.[1] ?? 'export.zip' };
}

/**
 * Fetch a binary artifact (a screenshot) as a Blob over the authenticated API.
 * Plain <img src> cannot carry the bearer token, so artifact bytes are fetched
 * here and rendered via an object URL (see AuthImage).
 */
async function fetchArtifactBlob(path: string): Promise<Blob> {
  const token = await getIdToken();
  const res = await fetch(new URL(BASE + path, window.location.origin).toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, 'artifact_fetch_failed', `Artifact fetch failed (${res.status})`);
  }
  return res.blob();
}

export const api = {
  // --- identity / bootstrap ---
  me: () => request<AuthMeResponse>('GET', '/auth/me'),
  completePasswordChange: (newPassword: string) =>
    request<AuthMeResponse>('POST', '/auth/complete-password-change', { newPassword }),

  // --- projects (context section; create is admin-only, 4.3) ---
  listProjects: () => request<Project[]>('GET', '/projects'),
  getProject: (projectId: string) => request<Project>('GET', `/projects/${projectId}`),
  createProject: (body: CreateProjectRequest) => request<Project>('POST', '/projects', body),

  // --- dashboard reads (4.7) ---
  listSessions: (q: Partial<DashboardSessionsQuery> = {}) =>
    request<DashboardSessionsResponse>('GET', '/dashboard/sessions', undefined, {
      limit: q.limit,
      cursor: q.cursor,
      projectId: q.projectId,
      status: q.status,
    }),
  getSession: (sessionId: string) =>
    request<SessionDetailResponse>('GET', `/dashboard/sessions/${sessionId}`),
  getReplay: (sessionId: string) =>
    request<SessionReplayResponse>('GET', `/dashboard/sessions/${sessionId}/replay`),
  artifactUrl: (sessionId: string, artifactId: string) =>
    fetchArtifactBlob(`/dashboard/sessions/${sessionId}/artifacts/${artifactId}`),
  metrics: () => request<MetricsResponse>('GET', '/dashboard/metrics'),
  ranking: () => request<RankingResponse>('GET', '/dashboard/ranking'),

  // --- lifecycle (4.6) ---
  deleteSession: (sessionId: string) => request<Session>('DELETE', `/sessions/${sessionId}`),
  restoreSession: (sessionId: string) =>
    request<Session>('POST', `/sessions/${sessionId}/restore`),
  exportSession: (sessionId: string) => downloadBlob(`/sessions/${sessionId}/export`),

  // --- codegen review (4.5) ---
  listGenerations: (sessionId: string) =>
    request<{ items: GeneratedTest[] }>('GET', `/sessions/${sessionId}/generations`),
  approveGeneration: (generatedTestId: string) =>
    request<GeneratedTest>('POST', `/generations/${generatedTestId}/approve`),
  integrateGeneration: (generatedTestId: string) =>
    request<GeneratedTest>('POST', `/generations/${generatedTestId}/integrate`),
  addComment: (sessionId: string, body: CreateCommentRequest) =>
    request<GenerationComment>('POST', `/sessions/${sessionId}/comments`, body),
  regenerate: (sessionId: string, body: RegenerateRequest) =>
    request<JobResponse>('POST', `/sessions/${sessionId}/regenerate`, body),
  generate: (sessionId: string) =>
    request<JobResponse>('POST', `/sessions/${sessionId}/generate`, { kind: 'playwright_test' }),

  // --- user management (4.2, admin) ---
  listUsers: () => request<TenantUser[]>('GET', '/users'),
  createUser: (body: CreateUserRequest) => request<TenantUser>('POST', '/users', body),
  updateUser: (userId: string, body: UpdateUserRequest) =>
    request<TenantUser>('PATCH', `/users/${userId}`, body),
  resetPassword: (userId: string, body: ResetPasswordRequest) =>
    request<TenantUser>('POST', `/users/${userId}/reset-password`, body),
};

/** Trigger a browser download for a fetched blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
