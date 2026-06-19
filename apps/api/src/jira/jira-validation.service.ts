import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { RequestContext } from '../auth/request-context.js';
import { AppException } from '../auth/errors.js';
import { jiraConfigs } from '../db/schema.js';
import { SECRET_MANAGER, type SecretManager } from '../secrets/secret-manager.service.js';
import {
  JIRA_CLIENT,
  JiraIssueNotFoundError,
  JiraUnavailableError,
  type JiraClient,
  type JiraIssue,
} from './jira-client.service.js';

/**
 * Live Jira validation at session start (contract section 5; spec
 * "Work-context-gated session start"). Steps:
 *   1. Require an ACTIVE jira_configs row for the project, else block.
 *   2. Read the read-only token from Secret Manager (token_secret_ref).
 *   3. Call Jira read-only: issue exists, load summary/status, and confirm the
 *      issue's project key equals jira_configs.project_key.
 *   4. On success, return the snapshot the caller freezes onto the session.
 *   5. Any failure (no config / not found / wrong key / token / outage) raises
 *      jira_validation_failed so the client can retry with a description.
 */
export interface JiraValidationResult {
  jiraId: string;
  jiraSummary: string;
  jiraStatus: string;
}

@Injectable()
export class JiraValidationService {
  constructor(
    private readonly ctx: RequestContext,
    @Inject(JIRA_CLIENT) private readonly jira: JiraClient,
    @Inject(SECRET_MANAGER) private readonly secrets: SecretManager,
  ) {}

  /**
   * Validate `jiraId` against `projectId`'s active Jira config (already tenant
   * authorized by the caller). Throws AppException('jira_validation_failed') on
   * any block path.
   */
  async validate(
    tenantId: string,
    projectId: string,
    jiraId: string,
  ): Promise<JiraValidationResult> {
    const rows = await this.ctx.dbTx
      .select()
      .from(jiraConfigs)
      .where(and(eq(jiraConfigs.tenantId, tenantId), eq(jiraConfigs.projectId, projectId)))
      .limit(1);
    const config = rows[0];
    if (!config || config.status !== 'active') {
      throw new AppException(
        'jira_validation_failed',
        'This project has no active Jira configuration',
        HttpStatus.BAD_REQUEST,
        { reason: 'no_jira_configuration' },
      );
    }

    let token: string;
    try {
      token = await this.secrets.getSecret(config.tokenSecretRef);
    } catch {
      throw new AppException(
        'jira_validation_failed',
        'The project Jira token could not be read',
        HttpStatus.BAD_REQUEST,
        { reason: 'token_unavailable' },
      );
    }

    let issue: JiraIssue;
    try {
      issue = await this.jira.getIssue({
        baseUrl: config.baseUrl,
        token,
        issueKey: jiraId,
      });
    } catch (err) {
      if (err instanceof JiraIssueNotFoundError) {
        throw new AppException(
          'jira_validation_failed',
          'The Jira issue does not exist',
          HttpStatus.BAD_REQUEST,
          { reason: 'issue_not_found' },
        );
      }
      if (err instanceof JiraUnavailableError) {
        throw new AppException(
          'jira_validation_failed',
          'Jira could not be reached or the token failed',
          HttpStatus.BAD_REQUEST,
          { reason: 'jira_unavailable' },
        );
      }
      throw new AppException(
        'jira_validation_failed',
        'Jira validation failed',
        HttpStatus.BAD_REQUEST,
        { reason: 'unknown' },
      );
    }

    if (issue.projectKey !== config.projectKey) {
      throw new AppException(
        'jira_validation_failed',
        `The Jira issue belongs to project ${issue.projectKey}, not ${config.projectKey}`,
        HttpStatus.BAD_REQUEST,
        { reason: 'wrong_project_key', expected: config.projectKey, actual: issue.projectKey },
      );
    }

    return {
      jiraId: issue.key,
      jiraSummary: issue.summary,
      jiraStatus: issue.status,
    };
  }

  /**
   * Read-only connectivity check used by POST /projects/{id}/jira/test. Picks an
   * arbitrary issue (project_key + "-1") to exercise the token and base URL.
   * Returns ok=false with a message rather than throwing, so the dashboard can
   * surface the result inline.
   */
  async testConnection(
    baseUrl: string,
    projectKey: string,
    tokenSecretRef: string,
  ): Promise<{ ok: boolean; message?: string }> {
    let token: string;
    try {
      token = await this.secrets.getSecret(tokenSecretRef);
    } catch {
      return { ok: false, message: 'Stored Jira token could not be read' };
    }
    try {
      await this.jira.getIssue({ baseUrl, token, issueKey: `${projectKey}-1` });
      return { ok: true };
    } catch (err) {
      if (err instanceof JiraIssueNotFoundError) {
        // The token and site work; the probe issue simply does not exist.
        return { ok: true, message: 'Token valid; probe issue not found (expected)' };
      }
      if (err instanceof JiraUnavailableError) {
        return { ok: false, message: err.message };
      }
      return { ok: false, message: 'Jira validation failed' };
    }
  }
}
