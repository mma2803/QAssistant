import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Project, SessionStatus } from '@qassistant/shared';
import { api, saveBlob } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../auth/AuthContext';
import { formatDateTime, formatDuration, integrationStatusLabel } from '../lib/format';

/**
 * Recording / artifact browser (spec 5.2 admin; 5.3 qa-engineer restricted to
 * own work). The backend applies the role scope: an admin sees the whole tenant;
 * a qa-engineer's list is filtered to recorded_by = self server-side, so this
 * page renders the same way for both and never leaks another tester's rows.
 * Soft-deleted recordings are hidden by the backend.
 */
export function SessionsPage(): JSX.Element {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [projectId, setProjectId] = useState<string>('');
  const [status, setStatus] = useState<SessionStatus | ''>('');

  const projects = useAsync<Project[]>(() => api.listProjects(), []);
  const sessions = useAsync(
    () =>
      api.listSessions({
        projectId: projectId || undefined,
        status: status || undefined,
      }),
    [projectId, status],
  );

  async function onDelete(sessionId: string): Promise<void> {
    if (!confirm('Soft-delete this recording? It can be restored within 30 days.')) return;
    await api.deleteSession(sessionId);
    sessions.reload();
  }

  async function onExport(sessionId: string): Promise<void> {
    const { blob, filename } = await api.exportSession(sessionId);
    saveBlob(blob, filename);
  }

  return (
    <div className="col">
      <h1 style={{ margin: 0 }}>Recordings</h1>
      {!isAdmin && (
        <div className="muted">Showing only the recordings you captured.</div>
      )}

      <div className="card row" style={{ flexWrap: 'wrap' }}>
        <label className="col" style={{ gap: 4, minWidth: 220 }}>
          <span className="muted">Project</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col" style={{ gap: 4, minWidth: 160 }}>
          <span className="muted">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as SessionStatus | '')}>
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </label>
      </div>

      <div className="card">
        {sessions.loading && <div className="muted">Loading recordings...</div>}
        {sessions.error && <div className="error">{sessions.error}</div>}
        {sessions.data && sessions.data.items.length === 0 && (
          <div className="muted">No recordings yet.</div>
        )}
        {sessions.data && sessions.data.items.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Work context</th>
                {isAdmin && <th>Recorded by</th>}
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Tests</th>
                <th>Integration</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.items.map((s) => (
                <tr key={s.id}>
                  <td>{s.projectName}</td>
                  <td>
                    {s.jiraId ? <span title={s.jiraSummary ?? ''}>{s.jiraId}</span> : null}
                    {!s.jiraId && s.description ? (
                      <span className="muted">{s.description.slice(0, 60)}</span>
                    ) : null}
                  </td>
                  {isAdmin && <td className="muted">{s.recordedByEmail ?? '-'}</td>}
                  <td>
                    <span className={`badge ${s.status}`}>{s.status}</span>
                  </td>
                  <td className="muted">{formatDateTime(s.startedAt)}</td>
                  <td>{formatDuration(s.durationSeconds)}</td>
                  <td>{s.generatedTestCount}</td>
                  <td>
                    {s.integrationStatus ? (
                      <span className={`badge ${s.integrationStatus}`}>
                        {integrationStatusLabel(s.integrationStatus)}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      <Link to={`/sessions/${s.id}`}>Open</Link>
                      <button onClick={() => void onExport(s.id)}>Export</button>
                      <button className="danger" onClick={() => void onDelete(s.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sessions.data?.nextCursor && (
          <div style={{ marginTop: 12 }} className="muted">
            More results available (pagination cursor present).
          </div>
        )}
      </div>
    </div>
  );
}
