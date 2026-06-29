import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { GeneratedTest, GenerateRequest } from '@qassistant/shared';
import { TEST_FRAMEWORK_PRESETS } from '@qassistant/shared';
import { api, saveBlob } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { AuthImage } from '../components/AuthImage';
import { formatDateTime, formatDuration, integrationStatusLabel } from '../lib/format';

/**
 * Recording detail (spec 5.2): rrweb DOM-replay, screenshots, flags/selections,
 * the session summary, and the generated versions with approve / integrate and a
 * comment + regenerate workflow. A qa-engineer can only open this for their own
 * recordings (the backend 404s otherwise), so the same page serves spec 5.3.
 */
export function SessionDetailPage(): JSX.Element {
  const { sessionId = '' } = useParams();
  const detail = useAsync(() => api.getSession(sessionId), [sessionId]);
  const replay = useAsync(() => api.getReplay(sessionId), [sessionId]);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function withBusy(id: string, fn: () => Promise<unknown>): Promise<void> {
    setBusyId(id);
    try {
      await fn();
      detail.reload();
    } finally {
      setBusyId(null);
    }
  }

  if (detail.loading) return <div className="muted">Loading recording...</div>;
  if (detail.error) return <div className="error">{detail.error}</div>;
  if (!detail.data) return <div className="muted">Not found.</div>;

  const { session, projectName, recordedByEmail, durationSeconds, artifacts, flags, generations, comments } =
    detail.data;
  const screenshots = artifacts.filter((a) => a.type === 'screenshot');
  const domChunks = artifacts.filter((a) => a.type === 'dom_chunk');

  async function onExport(): Promise<void> {
    const { blob, filename } = await api.exportSession(sessionId);
    saveBlob(blob, filename);
  }

  return (
    <div className="col">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Recording</h1>
        <div className="row">
          <Link to="/sessions">Back</Link>
          <button onClick={() => void onExport()}>Export ZIP</button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap', gap: 24 }}>
          <Meta k="Project" v={projectName} />
          <Meta k="Recorded by" v={recordedByEmail ?? '-'} />
          <Meta k="Status" v={session.status} />
          <Meta k="Started" v={formatDateTime(session.startedAt)} />
          <Meta k="Duration" v={formatDuration(durationSeconds)} />
          {session.jiraId && <Meta k="Jira" v={`${session.jiraId} (${session.jiraStatus ?? '?'})`} />}
        </div>
        {session.description && <p className="muted">{session.description}</p>}
      </div>

      <div className="card">
        <h3>Summary</h3>
        {session.summary ? (
          <p>{session.summary}</p>
        ) : (
          <div className="muted">No summary yet (generated automatically on stop).</div>
        )}
      </div>

      <div className="card">
        <h3>DOM-replay</h3>
        <div className="muted" style={{ marginBottom: 8 }}>
          {domChunks.length} DOM chunk(s) captured.
          {replay.data?.truncated && ' Showing the first part of a long recording; use Export for the full stream.'}
        </div>
        {replay.loading ? (
          <div className="replay-host" style={{ display: 'grid', placeItems: 'center', color: '#666' }}>
            Loading replay...
          </div>
        ) : replay.error ? (
          <div className="replay-host error" style={{ padding: 16 }}>{replay.error}</div>
        ) : (
          <ReplayPlayer events={replay.data?.events} />
        )}
      </div>

      {screenshots.length > 0 && (
        <div className="card">
          <h3>Screenshots</h3>
          <div className="shots">
            {screenshots.map((s) => (
              <div key={s.id}>
                {/* seq is 0-based in storage; show a 1-based label so it reads
                    naturally and matches the popup's screenshot count. */}
                <div className="muted">#{s.seq + 1}</div>
                <AuthImage sessionId={sessionId} artifactId={s.id} alt={`screenshot ${s.seq + 1}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3>Flags &amp; selections</h3>
        {flags.length === 0 ? (
          <div className="muted">No flagged selectors.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Selector</th>
                <th>Note</th>
                <th>Offset</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.id}>
                  <td>
                    <code>{f.selector}</code>
                  </td>
                  <td className="muted">{f.note ?? '-'}</td>
                  <td className="muted">{f.eventOffsetMs != null ? `${f.eventOffsetMs}ms` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <GenerationsSection
        sessionId={sessionId}
        projectId={session.projectId}
        generations={generations}
        comments={comments}
        busyId={busyId}
        onApprove={(id) => void withBusy(id, () => api.approveGeneration(id))}
        onComment={(body, generatedTestId) =>
          withBusy('comment', () => api.addComment(sessionId, { body, generatedTestId }))
        }
        onRegenerate={(sourceCommentId, override) =>
          withBusy('regen', () =>
            api.regenerate(sessionId, { kind: 'playwright_test', sourceCommentId, ...override }),
          )
        }
        onGenerate={(override) => withBusy('gen', () => api.generate(sessionId, override))}
      />
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="col" style={{ gap: 2 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        {k}
      </span>
      <span>{v}</span>
    </div>
  );
}

interface GenSectionProps {
  sessionId: string;
  projectId: string;
  generations: GeneratedTest[];
  comments: { id: string; body: string; generatedTestId: string | null; createdAt: string }[];
  busyId: string | null;
  onApprove: (id: string) => void;
  onComment: (body: string, generatedTestId?: string) => Promise<void>;
  onRegenerate: (sourceCommentId?: string, override?: Partial<GenerateRequest>) => Promise<void>;
  onGenerate: (override?: Partial<GenerateRequest>) => Promise<void>;
}

/**
 * Generated versions with approve + a comment/regenerate flow. Integration is
 * read-only here: status/ref/error are displayed but only the MCP client (which
 * owns the Git push) sets an integration outcome — there is no integrate action.
 */
function GenerationsSection(props: GenSectionProps): JSX.Element {
  const { generations, comments, busyId } = props;
  const [comment, setComment] = useState('');
  const [target, setTarget] = useState<string>('');

  // Per-generation framework/language selector. '' = use the resolved default
  // (no override sent), '0'..'N' = a preset, 'custom' = the free-form entry.
  // Choosing here only affects this generation; it never changes any default.
  // The effective default for this session is the project default, falling back
  // to the tenant default, then Playwright/TypeScript.
  const project = useAsync(() => api.getProject(props.projectId), [props.projectId]);
  const tenant = useAsync(() => api.getTenantSettings(), []);
  const [fwChoice, setFwChoice] = useState<string>('');
  const [customFw, setCustomFw] = useState('');
  const [customLang, setCustomLang] = useState('');

  const customIncomplete = fwChoice === 'custom' && !(customFw.trim() && customLang.trim());

  function selectedOverride(): Partial<GenerateRequest> | undefined {
    if (fwChoice === '') return undefined; // fall back to tenant default
    if (fwChoice === 'custom') {
      const framework = customFw.trim();
      const language = customLang.trim();
      return framework && language ? { framework, language } : undefined;
    }
    const preset = TEST_FRAMEWORK_PRESETS[Number(fwChoice)];
    return preset ? { framework: preset.framework, language: preset.language } : undefined;
  }

  const effectiveFramework =
    project.data?.defaultTestFramework ?? tenant.data?.defaultTestFramework ?? 'Playwright';
  const effectiveLanguage =
    project.data?.defaultTestLanguage ?? tenant.data?.defaultTestLanguage ?? 'TypeScript';
  const defaultLabel = `${effectiveFramework} / ${effectiveLanguage}`;

  return (
    <div className="card col">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Generated tests</h3>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            aria-label="Test framework"
            value={fwChoice}
            onChange={(e) => setFwChoice(e.target.value)}
          >
            <option value="">Default ({defaultLabel})</option>
            {TEST_FRAMEWORK_PRESETS.map((p, i) => (
              <option key={`${p.framework}-${p.language}`} value={String(i)}>
                {p.framework} / {p.language}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          {fwChoice === 'custom' && (
            <>
              <input
                aria-label="Custom framework"
                value={customFw}
                onChange={(e) => setCustomFw(e.target.value)}
                placeholder="Framework"
                style={{ width: 120 }}
              />
              <input
                aria-label="Custom language"
                value={customLang}
                onChange={(e) => setCustomLang(e.target.value)}
                placeholder="Language"
                style={{ width: 120 }}
              />
            </>
          )}
          <button
            className="primary"
            disabled={busyId === 'gen' || customIncomplete}
            onClick={() => void props.onGenerate(selectedOverride())}
          >
            {busyId === 'gen' ? 'Queuing...' : 'Generate'}
          </button>
        </div>
      </div>

      {generations.length === 0 ? (
        <div className="muted">No generations yet.</div>
      ) : (
        generations
          .slice()
          .reverse()
          .map((g) => (
            <div key={g.id} className="col" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="row">
                  <strong>v{g.version}</strong>
                  <span className="badge">{g.modelTier}</span>
                  <span className="badge">{g.framework} / {g.language}</span>
                  <span className={`badge ${g.reviewStatus}`}>{g.reviewStatus}</span>
                  {g.integrationStatus !== 'not_ready' && (
                    <span className={`badge ${g.integrationStatus}`}>
                      {integrationStatusLabel(g.integrationStatus)}
                    </span>
                  )}
                </div>
                <div className="row">
                  <button
                    // A failed_to_integrate version stays approved but is a
                    // dead-end until reset; allow re-approving it (back to
                    // ready_to_integrate) so the integration can be retried via
                    // the MCP client. Other approved versions stay disabled.
                    disabled={
                      busyId === g.id ||
                      (g.reviewStatus === 'approved' &&
                        g.integrationStatus !== 'failed_to_integrate')
                    }
                    onClick={() => props.onApprove(g.id)}
                  >
                    {g.integrationStatus === 'failed_to_integrate' ? 'Re-approve (retry)' : 'Approve'}
                  </button>
                </div>
              </div>
              {g.integrationRef && (
                <div className="muted" style={{ fontSize: 12 }}>
                  Integration ref: {g.integrationRef}
                </div>
              )}
              {g.integrationError && (
                <div className="muted" style={{ fontSize: 12 }}>
                  Integration error: {g.integrationError}
                </div>
              )}
              {g.promptInputsSummary?.sources?.length > 0 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  Sources: {g.promptInputsSummary.sources.map((s) => s.label).join(', ')}
                </div>
              )}
              <pre className="code">{g.code}</pre>
            </div>
          ))
      )}

      <div className="col" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <h4 style={{ margin: 0 }}>Comments &amp; regenerate</h4>
        {comments.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {comments.map((c) => (
              <li key={c.id}>
                <span>{c.body}</span>{' '}
                <span className="muted" style={{ fontSize: 12 }}>
                  {c.generatedTestId ? `(on a version)` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <label className="col" style={{ gap: 4 }}>
          <span className="muted">Comment to steer the next generation</span>
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="e.g. assert the success toast, use the data-test-id selectors"
          />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="muted">Target version (optional)</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">No specific version</option>
            {generations.map((g) => (
              <option key={g.id} value={g.id}>
                v{g.version}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button
            disabled={busyId === 'comment' || comment.trim().length === 0}
            onClick={async () => {
              await props.onComment(comment.trim(), target || undefined);
              setComment('');
            }}
          >
            Add comment
          </button>
          <button
            className="primary"
            disabled={busyId === 'regen' || customIncomplete}
            onClick={() => void props.onRegenerate(undefined, selectedOverride())}
          >
            {busyId === 'regen' ? 'Queuing...' : 'Regenerate with comments'}
          </button>
        </div>
      </div>
    </div>
  );
}
