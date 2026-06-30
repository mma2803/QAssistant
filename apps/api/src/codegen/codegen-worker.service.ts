import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { GenerateTaskPayload, NetworkLogChunk } from '@qassistant/shared';
import { networkLogChunkSchema } from '@qassistant/shared';
import type { ModelTier } from '@qassistant/shared/enums';
import { DbService, type Database } from '../db/db.service.js';
import {
  artifacts,
  flags,
  generatedTests,
  generationComments,
  jiraConfigs,
  projects,
  sessions,
} from '../db/schema.js';
import { newId } from '../db/id.js';
import { GCS_READER, decodeArtifactText, type GcsReader } from '../storage/gcs-reader.service.js';
import { SECRET_MANAGER, type SecretManager } from '../secrets/secret-manager.service.js';
import {
  JIRA_CLIENT,
  type JiraClient,
  type JiraIssueContext,
} from '../jira/jira-client.service.js';
import { GEMINI_CLIENT, type GeminiClient } from './gemini.service.js';
import { buildPrompt, type LabeledSource } from './prompt-builder.js';

/**
 * Codegen worker (contract 4.5 POST /internal/tasks/generate). Runs Gemini and
 * writes a generated_tests row. Invoked either by the inline dispatcher (dev,
 * synchronous) or by the OIDC-gated worker endpoint (prod Cloud Tasks).
 *
 * It runs on the privileged BYPASSRLS pool because a Cloud Tasks call carries no
 * tenant request context; tenant_id / project_id from the validated task payload
 * are written explicitly on every row (defense in depth, design D10). The
 * enqueue path has already authorized the session under RLS, and the payload is
 * signed/OIDC-gated, so the worker trusts the payload's ids.
 *
 * Grounding (spec "Context-grounded Playwright generation"):
 *   - recording DOM-replay chunks (from GCS),
 *   - Jira ticket + comments/attachments when the session is Jira-linked,
 *   - tester description,
 *   - project knowledge hub markdown + default-creds reference (labeled, never
 *     the secret value),
 *   - tester-flagged selectors/states,
 *   - optional compressed screenshot context (filenames + counts; raw bytes are
 *     not inlined in MVP, but the labeled summary records their availability).
 * All untrusted text is redacted (D8c) and labeled (D8b) inside buildPrompt.
 */
@Injectable()
export class CodegenWorkerService {
  // How many DOM chunks / screenshots to summarize into the prompt (bounded).
  private static readonly MAX_DOM_CHUNKS = 12;

  constructor(
    private readonly db: DbService,
    @Inject(GCS_READER) private readonly reader: GcsReader,
    @Inject(SECRET_MANAGER) private readonly secrets: SecretManager,
    @Inject(JIRA_CLIENT) private readonly jira: JiraClient,
    @Inject(GEMINI_CLIENT) private readonly gemini: GeminiClient,
  ) {}

  /** Execute one codegen task end-to-end and persist the generated_tests row. */
  async runTask(payload: GenerateTaskPayload): Promise<void> {
    await this.db.withSuperadmin(async ({ db }) => {
      const session = await this.loadSession(db, payload.tenantId, payload.sessionId);
      const project = await this.loadProject(db, payload.tenantId, payload.projectId);

      const tier: ModelTier = payload.modelTier;
      const sources = await this.gatherSources(db, payload, session, project);

      const { prompt, summary } = buildPrompt({
        kind: payload.kind,
        tier,
        testType: payload.testType,
        framework: payload.framework,
        language: payload.language,
        sources,
      });
      const { code, modelId } = await this.gemini.generate({ tier, prompt });

      const version = await this.nextVersion(db, payload.sessionId);
      await db.insert(generatedTests).values({
        id: newId(),
        tenantId: payload.tenantId,
        projectId: payload.projectId,
        sessionId: payload.sessionId,
        version,
        kind: payload.kind,
        modelTier: tier,
        modelId,
        code,
        framework: payload.framework,
        language: payload.language,
        testType: payload.testType,
        reviewStatus: 'draft',
        integrationStatus: 'not_ready',
        promptInputsSummary: summary,
        sourceCommentId: payload.sourceCommentId ?? null,
        createdBy: payload.createdBy,
      });
    });
  }

  /** Assemble the labeled, untrusted source blocks for the prompt. */
  private async gatherSources(
    db: Database,
    payload: GenerateTaskPayload,
    session: typeof sessions.$inferSelect,
    project: typeof projects.$inferSelect,
  ): Promise<LabeledSource[]> {
    const sources: LabeledSource[] = [];

    // 1. Primary recorded evidence depends on the test type (configurable-test-type):
    //    - backend → captured HTTP traffic (network_log artifacts),
    //    - ui      → DOM-replay flow (the original behaviour).
    if (payload.testType === 'backend') {
      const netText = await this.loadNetworkLog(db, payload.tenantId, payload.sessionId);
      if (netText) {
        sources.push({
          label: 'recording.network',
          kind: 'recording',
          text: netText,
          note: 'captured HTTP request/response calls; sensitive headers/values redacted',
        });
      } else {
        // 6.5 fallback: no traffic captured. Label the gap so the model grounds
        // the API test in Jira/description/knowledge instead, and reviewers know
        // it is weakly grounded.
        sources.push({
          label: 'recording.network.absent',
          kind: 'recording',
          text: 'No HTTP traffic was captured for this session. Generate the API test from the Jira ticket, tester description, and project knowledge instead; this test is weakly grounded and should be reviewed carefully.',
          note: 'no network_log captured; backend test weakly grounded',
        });
      }
    } else {
      const domText = await this.loadDomReplay(db, payload.tenantId, payload.sessionId);
      if (domText) {
        sources.push({ label: 'recording.dom', kind: 'recording', text: domText });
      }
    }

    // 2. Tester-flagged states (codegen hints; assertions must reflect these).
    const flagRows = await db
      .select()
      .from(flags)
      .where(and(eq(flags.tenantId, payload.tenantId), eq(flags.sessionId, payload.sessionId)))
      .orderBy(asc(flags.eventOffsetMs));
    if (flagRows.length > 0) {
      const text = flagRows
        .map(
          (f) =>
            `- selector: ${f.selector}${f.note ? ` | note: ${f.note}` : ''}${
              f.eventOffsetMs != null ? ` | offsetMs: ${f.eventOffsetMs}` : ''
            }`,
        )
        .join('\n');
      sources.push({
        label: 'recording.flagged_states',
        kind: 'flagged_states',
        text,
        note: 'tester-flagged selectors/states; assertions should reflect these',
      });
    }

    // 3. Jira ticket + comments/attachments when present.
    if (session.jiraId) {
      const jiraText = await this.loadJiraContext(db, payload, session);
      if (jiraText) {
        sources.push({
          label: 'jira.ticket',
          kind: 'jira',
          text: jiraText,
          note: 'linked Jira ticket summary/status/description/comments/attachments',
        });
      }
    }

    // 4. Tester description (frozen work context).
    if (session.description) {
      sources.push({ label: 'tester.description', kind: 'description', text: session.description });
    }

    // 5. Project knowledge hub markdown (optional; generation proceeds if empty).
    if (project.knowledgeMd) {
      sources.push({ label: 'project.knowledge_md', kind: 'knowledge', text: project.knowledgeMd });
    }
    // Default-creds: surface ONLY the labeled reference, never the secret value.
    if (project.defaultCredsSecretRef) {
      sources.push({
        label: 'project.default_creds',
        kind: 'knowledge',
        text: 'Default test credentials exist in Secret Manager. Read them from environment variables at runtime; do not hard-code.',
        note: 'secret reference only; value withheld',
      });
    }
    // Project markdown context = base URL the test should target.
    sources.push({
      label: 'project.base_url',
      kind: 'project',
      text: `Application base URL: ${project.baseUrl}`,
    });

    // 6. Optional compressed screenshot context (counts/filenames; bytes not
    //    inlined). UI-only: screenshots do not help ground an API test.
    if (payload.testType !== 'backend') {
      const shotRows = await db
        .select({ seq: artifacts.seq, gcsPath: artifacts.gcsPath })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.tenantId, payload.tenantId),
            eq(artifacts.sessionId, payload.sessionId),
            eq(artifacts.type, 'screenshot'),
          ),
        )
        .orderBy(asc(artifacts.seq));
      if (shotRows.length > 0) {
        sources.push({
          label: 'recording.screenshots',
          kind: 'screenshots',
          text: `${shotRows.length} viewport screenshot(s) captured for before/after assertion inference.`,
          note: 'compressed/downsampled screenshot context (not raw bytes)',
        });
      }
    }

    // 7. User comments when regenerating (most recent first, bounded).
    const commentRows = await db
      .select()
      .from(generationComments)
      .where(
        and(
          eq(generationComments.tenantId, payload.tenantId),
          eq(generationComments.sessionId, payload.sessionId),
        ),
      )
      .orderBy(desc(generationComments.createdAt))
      .limit(20);
    if (commentRows.length > 0) {
      const text = commentRows
        .reverse()
        .map((c) => `- ${c.body}`)
        .join('\n');
      sources.push({
        label: 'user.comments',
        kind: 'comments',
        text,
        note: 'reviewer comments to incorporate in this regeneration',
      });
    }

    return sources;
  }

  /** Load and concatenate the session's DOM-replay chunks from GCS (bounded). */
  private async loadDomReplay(
    db: Database,
    tenantId: string,
    sessionId: string,
  ): Promise<string> {
    const rows = await db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.tenantId, tenantId),
          eq(artifacts.sessionId, sessionId),
          eq(artifacts.type, 'dom_chunk'),
        ),
      )
      .orderBy(asc(artifacts.seq))
      .limit(CodegenWorkerService.MAX_DOM_CHUNKS);

    const parts: string[] = [];
    for (const row of rows) {
      const bytes = await this.reader.download(row.gcsPath);
      if (!bytes) continue;
      try {
        parts.push(decodeArtifactText(bytes, row.compression as 'none' | 'gzip'));
      } catch {
        // Skip an undecodable chunk rather than failing the whole generation.
      }
    }
    return parts.join('\n');
  }

  /**
   * Load the session's captured HTTP traffic (network_log artifacts) from GCS and
   * render it as a compact, labeled text block for the backend prompt. Sensitive
   * headers/values were already redacted by the extension before upload; the
   * worker still runs everything through redactSecrets() in buildPrompt (defense
   * in depth). Returns '' when no traffic was captured.
   */
  private async loadNetworkLog(db: Database, tenantId: string, sessionId: string): Promise<string> {
    const rows = await db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.tenantId, tenantId),
          eq(artifacts.sessionId, sessionId),
          eq(artifacts.type, 'network_log'),
        ),
      )
      .orderBy(asc(artifacts.seq))
      .limit(CodegenWorkerService.MAX_DOM_CHUNKS);

    const calls: string[] = [];
    for (const row of rows) {
      const bytes = await this.reader.download(row.gcsPath);
      if (!bytes) continue;
      let chunk: NetworkLogChunk;
      try {
        const parsed = JSON.parse(decodeArtifactText(bytes, row.compression as 'none' | 'gzip'));
        chunk = networkLogChunkSchema.parse(parsed);
      } catch {
        // Skip an undecodable/invalid chunk rather than failing the generation.
        continue;
      }
      for (const e of chunk.entries) {
        const reqHeaders = Object.entries(e.requestHeaders)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
        const resHeaders = Object.entries(e.responseHeaders)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
        calls.push(
          [
            `${e.method} ${e.url} -> ${e.status ?? '(no response)'}`,
            reqHeaders ? `  request headers: ${reqHeaders}` : '',
            e.requestBody
              ? `  request body${e.requestBodyTruncated ? ' (truncated)' : ''}: ${e.requestBody}`
              : '',
            resHeaders ? `  response headers: ${resHeaders}` : '',
            e.responseBody
              ? `  response body${e.responseBodyTruncated ? ' (truncated)' : ''}: ${e.responseBody}`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }
    }
    return calls.join('\n\n');
  }

  /** Load Jira description/comments/attachments for a Jira-linked session. */
  private async loadJiraContext(
    db: Database,
    payload: GenerateTaskPayload,
    session: typeof sessions.$inferSelect,
  ): Promise<string> {
    const head = [
      session.jiraId ? `Key: ${session.jiraId}` : '',
      session.jiraSummary ? `Summary: ${session.jiraSummary}` : '',
      session.jiraStatus ? `Status: ${session.jiraStatus}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const cfgRows = await db
      .select()
      .from(jiraConfigs)
      .where(
        and(
          eq(jiraConfigs.tenantId, payload.tenantId),
          eq(jiraConfigs.projectId, payload.projectId),
        ),
      )
      .limit(1);
    const cfg = cfgRows[0];
    if (!cfg || cfg.status !== 'active' || !session.jiraId) {
      return head;
    }

    let ctx: JiraIssueContext = { description: '', comments: [], attachmentNames: [] };
    try {
      const token = await this.secrets.getSecret(cfg.tokenSecretRef);
      ctx = await this.jira.getIssueContext({
        baseUrl: cfg.baseUrl,
        token,
        issueKey: session.jiraId,
      });
    } catch {
      // Best-effort: fall back to the frozen snapshot (head) only.
    }

    const body = [
      head,
      ctx.description ? `Description: ${ctx.description}` : '',
      ctx.comments.length ? `Comments:\n${ctx.comments.map((c) => `- ${c}`).join('\n')}` : '',
      ctx.attachmentNames.length ? `Attachments: ${ctx.attachmentNames.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return body;
  }

  private async loadSession(
    db: Database,
    tenantId: string,
    sessionId: string,
  ): Promise<typeof sessions.$inferSelect> {
    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, tenantId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Session not found for codegen task: ${sessionId}`);
    return row;
  }

  private async loadProject(
    db: Database,
    tenantId: string,
    projectId: string,
  ): Promise<typeof projects.$inferSelect> {
    const rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Project not found for codegen task: ${projectId}`);
    return row;
  }

  /** Next per-session version number (generated_tests.version, U(session,version)). */
  private async nextVersion(db: Database, sessionId: string): Promise<number> {
    const rows = await db
      .select({ version: generatedTests.version })
      .from(generatedTests)
      .where(eq(generatedTests.sessionId, sessionId))
      .orderBy(desc(generatedTests.version))
      .limit(1);
    return (rows[0]?.version ?? 0) + 1;
  }
}
