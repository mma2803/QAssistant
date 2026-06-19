import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { GeneratedTest } from '@qassistant/shared';
import { api, saveBlob } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { AuthImage } from '../components/AuthImage';
import { formatDateTime, formatDuration } from '../lib/format';

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
                <div className="muted">#{s.seq}</div>
                <AuthImage sessionId={sessionId} artifactId={s.id} alt={`screenshot ${s.seq}`} />
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
        generations={generations}
        comments={comments}
        busyId={busyId}
        onApprove={(id) => void withBusy(id, () => api.approveGeneration(id))}
        onIntegrate={(id) => void withBusy(id, () => api.integrateGeneration(id))}
        onComment={(body, generatedTestId) =>
          withBusy('comment', () => api.addComment(sessionId, { body, generatedTestId }))
        }
        onRegenerate={(sourceCommentId) =>
          withBusy('regen', () =>
            api.regenerate(sessionId, { kind: 'playwright_test', sourceCommentId }),
          )
        }
        onGenerate={() => withBusy('gen', () => api.generate(sessionId))}
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
  generations: GeneratedTest[];
  comments: { id: string; body: string; generatedTestId: string | null; createdAt: string }[];
  busyId: string | null;
  onApprove: (id: string) => void;
  onIntegrate: (id: string) => void;
  onComment: (body: string, generatedTestId?: string) => Promise<void>;
  onRegenerate: (sourceCommentId?: string) => Promise<void>;
  onGenerate: () => Promise<void>;
}

/** Generated versions with approve/integrate, plus a comment + regenerate flow. */
function GenerationsSection(props: GenSectionProps): JSX.Element {
  const { generations, comments, busyId } = props;
  const [comment, setComment] = useState('');
  const [target, setTarget] = useState<string>('');

  return (
    <div className="card col">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Generated tests</h3>
        <button
          className="primary"
          disabled={busyId === 'gen'}
          onClick={() => void props.onGenerate()}
        >
          {busyId === 'gen' ? 'Queuing...' : 'Generate'}
        </button>
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
                  <span className="badge">{g.kind}</span>
                  <span className="badge">{g.modelTier}</span>
                  <span className={`badge ${g.reviewStatus}`}>{g.reviewStatus}</span>
                  {g.integrated && <span className="badge integrated">integrated</span>}
                </div>
                <div className="row">
                  <button
                    disabled={busyId === g.id || g.reviewStatus === 'approved'}
                    onClick={() => props.onApprove(g.id)}
                  >
                    Approve
                  </button>
                  <button
                    disabled={busyId === g.id || g.integrated}
                    onClick={() => props.onIntegrate(g.id)}
                  >
                    Integrate
                  </button>
                </div>
              </div>
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
            disabled={busyId === 'regen'}
            onClick={() => void props.onRegenerate(undefined)}
          >
            {busyId === 'regen' ? 'Queuing...' : 'Regenerate with comments'}
          </button>
        </div>
      </div>
    </div>
  );
}
