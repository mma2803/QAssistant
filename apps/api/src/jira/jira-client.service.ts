import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';

/**
 * Read-only Jira REST client abstraction (contract section 5). The token is
 * read-only (issue metadata, description, comments, attachments); no write,
 * transition, or comment-posting (spec: "Jira token uses read-only context
 * permissions").
 *
 * Two drivers behind one interface so the backend works offline:
 *   - 'http'  : live Jira REST v2/v3 via fetch with Bearer/basic token.
 *   - 'local' : an in-memory fixture so session-start Jira validation is
 *               testable without a Jira site. Encodes the spec scenarios:
 *               existing issue, wrong project key, not found, outage.
 */
export interface JiraIssue {
  /** Issue key, e.g. ABC-123. */
  key: string;
  /** The Jira project key the issue belongs to, e.g. ABC. */
  projectKey: string;
  /** Issue title / summary. */
  summary: string;
  /** Issue status name, e.g. "In Progress". */
  status: string;
}

/** Raised when Jira is unreachable or the token fails (distinct from not-found). */
export class JiraUnavailableError extends Error {}
/** Raised when the issue does not exist. */
export class JiraIssueNotFoundError extends Error {}

export interface JiraFetchParams {
  baseUrl: string;
  token: string;
  issueKey: string;
}

/** Issue body + comments + attachment filenames, used as codegen grounding (read-only). */
export interface JiraIssueContext {
  description: string;
  comments: string[];
  attachmentNames: string[];
}

export interface JiraClient {
  /**
   * Fetch a single issue's metadata. Resolves with the issue or throws
   * JiraIssueNotFoundError (issue absent) / JiraUnavailableError (network or
   * auth failure). Project-key matching is the caller's concern.
   */
  getIssue(params: JiraFetchParams): Promise<JiraIssue>;

  /**
   * Fetch the issue's description, comments, and attachment filenames for
   * codegen grounding (read-only). Best-effort: returns empty fields rather than
   * throwing so generation never blocks on Jira context being unavailable.
   */
  getIssueContext(params: JiraFetchParams): Promise<JiraIssueContext>;
}

export const JIRA_CLIENT = Symbol('JIRA_CLIENT');

/**
 * Local fixture client. The host part of baseUrl selects behavior so tests can
 * drive each spec scenario deterministically:
 *   - host contains "outage"      -> JiraUnavailableError
 *   - issueKey ends with "-404"   -> JiraIssueNotFoundError
 *   - otherwise -> an issue whose projectKey is the issueKey's prefix.
 * This means a tester whose project allows key "ABC" validates "ABC-1" but is
 * blocked for "XYZ-1" (wrong project key), matching the contract.
 */
@Injectable()
export class LocalJiraClient implements JiraClient {
  async getIssue(params: JiraFetchParams): Promise<JiraIssue> {
    const { baseUrl, issueKey } = params;
    if (/outage|unreachable/i.test(baseUrl)) {
      throw new JiraUnavailableError('Jira is unreachable (local fixture)');
    }
    if (/-404$/i.test(issueKey) || /notfound/i.test(issueKey)) {
      throw new JiraIssueNotFoundError(`Issue not found: ${issueKey}`);
    }
    const prefix = issueKey.split('-')[0] ?? issueKey;
    return {
      key: issueKey,
      projectKey: prefix,
      summary: `Fixture summary for ${issueKey}`,
      status: 'To Do',
    };
  }

  async getIssueContext(params: JiraFetchParams): Promise<JiraIssueContext> {
    const { issueKey } = params;
    return {
      description: `Fixture description for ${issueKey}: the feature under test should behave as specified.`,
      comments: [`Fixture comment on ${issueKey}: verify the success state after submit.`],
      attachmentNames: [],
    };
  }
}

/**
 * Live HTTP client. Uses the Jira REST issue endpoint with only the fields the
 * contract needs (summary, status, project key). The token is sent as a Bearer
 * (Jira Cloud API tokens / PATs); read-only scope is enforced by the token.
 */
@Injectable()
export class HttpJiraClient implements JiraClient {
  constructor(@Inject(APP_CONFIG) private readonly _config: AppConfig) {}

  async getIssue(params: JiraFetchParams): Promise<JiraIssue> {
    const base = params.baseUrl.replace(/\/$/, '');
    const url = `${base}/rest/api/2/issue/${encodeURIComponent(
      params.issueKey,
    )}?fields=summary,status,project`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.token}`,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      throw new JiraUnavailableError(
        `Jira request failed: ${err instanceof Error ? err.message : 'network error'}`,
      );
    }

    if (res.status === 404) {
      throw new JiraIssueNotFoundError(`Issue not found: ${params.issueKey}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new JiraUnavailableError('Jira authentication failed (token rejected)');
    }
    if (!res.ok) {
      throw new JiraUnavailableError(`Jira returned HTTP ${res.status}`);
    }

    const body = (await res.json()) as {
      key?: string;
      fields?: {
        summary?: string;
        status?: { name?: string };
        project?: { key?: string };
      };
    };
    const projectKey = body.fields?.project?.key;
    if (!projectKey) {
      throw new JiraUnavailableError('Jira response missing project key');
    }
    return {
      key: body.key ?? params.issueKey,
      projectKey,
      summary: body.fields?.summary ?? '',
      status: body.fields?.status?.name ?? '',
    };
  }

  async getIssueContext(params: JiraFetchParams): Promise<JiraIssueContext> {
    const empty: JiraIssueContext = { description: '', comments: [], attachmentNames: [] };
    const base = params.baseUrl.replace(/\/$/, '');
    const url = `${base}/rest/api/2/issue/${encodeURIComponent(
      params.issueKey,
    )}?fields=description,comment,attachment`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${params.token}`, Accept: 'application/json' },
      });
    } catch {
      return empty;
    }
    if (!res.ok) return empty;
    const body = (await res.json()) as {
      fields?: {
        description?: unknown;
        comment?: { comments?: Array<{ body?: unknown }> };
        attachment?: Array<{ filename?: string }>;
      };
    };
    const flatten = (v: unknown): string => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object') {
        // ADF (Atlassian Document Format): collect any nested text nodes.
        const texts: string[] = [];
        const walk = (n: any): void => {
          if (!n) return;
          if (typeof n.text === 'string') texts.push(n.text);
          if (Array.isArray(n.content)) n.content.forEach(walk);
        };
        walk(v);
        return texts.join(' ');
      }
      return '';
    };
    return {
      description: flatten(body.fields?.description),
      comments: (body.fields?.comment?.comments ?? []).map((c) => flatten(c.body)).filter(Boolean),
      attachmentNames: (body.fields?.attachment ?? [])
        .map((a) => a.filename ?? '')
        .filter(Boolean),
    };
  }
}
