import type {
  DashboardSessionsResponse,
  SessionDetailResponse,
  GenerationsListResponse,
  GeneratedTest,
  UpdateIntegrationStatusRequest,
} from '@qassistant/shared';
import type { McpConfig } from './config.js';
import type { AuthSession } from './auth.js';

/**
 * Thin REST client of the QAssistant API. Every call carries the session's ID
 * token as a Bearer credential, so tenant isolation and RLS are enforced by the
 * API exactly as for the dashboard. This client never touches Git.
 */
export class ApiClient {
  constructor(
    private readonly config: McpConfig,
    private readonly auth: AuthSession,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.config.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.auth.requireToken()}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`API ${init.method ?? 'GET'} ${path} failed (${res.status}): ${detail}`);
    }
    return (await res.json()) as T;
  }

  /** GET /dashboard/sessions — the tenant's records, optionally filtered. */
  listRecords(params: {
    status?: string;
    projectId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<DashboardSessionsResponse> {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.projectId) q.set('projectId', params.projectId);
    if (params.cursor) q.set('cursor', params.cursor);
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return this.request<DashboardSessionsResponse>(`/dashboard/sessions${qs ? `?${qs}` : ''}`);
  }

  /** GET /dashboard/sessions/{id} — a full record (artifacts, versions, flags). */
  getRecord(sessionId: string): Promise<SessionDetailResponse> {
    return this.request<SessionDetailResponse>(`/dashboard/sessions/${sessionId}`);
  }

  /** GET /generations/ready-to-integrate — approved versions ready to integrate. */
  listReadyToIntegrate(): Promise<GenerationsListResponse> {
    return this.request<GenerationsListResponse>('/generations/ready-to-integrate');
  }

  /** POST /generations/{id}/integrate — report the push outcome. */
  updateIntegrationStatus(
    generatedTestId: string,
    body: UpdateIntegrationStatusRequest,
  ): Promise<GeneratedTest> {
    return this.request<GeneratedTest>(`/generations/${generatedTestId}/integrate`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
}
