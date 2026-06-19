import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDuration } from '../lib/format';

/**
 * Productivity metrics + admin-only Contribution ranking (spec 5.4). The ranking
 * is ordered by the backend (generatedTestCount DESC, totalRecordingSeconds DESC,
 * recordingCount DESC) and the exact ordering metrics are shown: there is no
 * hidden weighted score. The directional / raw wall-clock messaging is shown
 * verbatim so users do not read it as an absolute performance judgment.
 */
export function MetricsPage(): JSX.Element {
  const metrics = useAsync(() => api.metrics(), []);
  const ranking = useAsync(() => api.ranking(), []);

  return (
    <div className="col">
      <h1 style={{ margin: 0 }}>Productivity</h1>

      <div className="card">
        <h3>Per-user metrics</h3>
        {metrics.loading && <div className="muted">Loading...</div>}
        {metrics.error && <div className="error">{metrics.error}</div>}
        {metrics.data && (
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Generated tests</th>
                <th>Total recording time</th>
                <th>Recordings</th>
              </tr>
            </thead>
            <tbody>
              {metrics.data.metrics.map((m) => (
                <tr key={m.userId}>
                  <td>{m.email}</td>
                  <td>{m.generatedTestCount}</td>
                  <td>{formatDuration(m.totalRecordingSeconds)}</td>
                  <td>{m.recordingCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Contribution ranking</h3>
        <div className="notice">
          Directional, not an absolute performance judgment. Because recording
          duration is raw wall-clock (idle time is not excluded in this MVP), this
          ranking indicates relative contribution only. Ordering uses the visible
          metrics below (generated test count, then total recording duration, then
          recording count); there is no hidden weighted score.
        </div>
        {ranking.loading && <div className="muted">Loading...</div>}
        {ranking.error && <div className="error">{ranking.error}</div>}
        {ranking.data && (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>User</th>
                <th>Generated tests</th>
                <th>Total recording duration (raw wall-clock)</th>
                <th>Recordings</th>
              </tr>
            </thead>
            <tbody>
              {ranking.data.ranking.map((m, i) => (
                <tr key={m.userId}>
                  <td>{i + 1}</td>
                  <td>{m.email}</td>
                  <td>{m.generatedTestCount}</td>
                  <td>{formatDuration(m.totalRecordingSeconds)}</td>
                  <td>{m.recordingCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
