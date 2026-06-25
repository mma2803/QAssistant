import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Shell } from './components/Shell';
import { LoginPage } from './pages/LoginPage';
import { PasswordChangePage } from './pages/PasswordChangePage';
import { SessionsPage } from './pages/SessionsPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { MetricsPage } from './pages/MetricsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';

/**
 * Role-scoped routing (spec 5.1). Three gates, in order:
 *   1. not signed in            -> LoginPage (Identity Platform email/password)
 *   2. mustChangePassword       -> forced PasswordChangePage (only allowed screen)
 *   3. signed in + clear marker -> the role-scoped shell + pages
 *
 * Admin-only routes (metrics/ranking, users) are removed from the route table
 * for qa-engineers, not merely hidden, so a deep link 404s into a redirect
 * rather than rendering an admin view (defense in depth on top of backend roles).
 */
export function App(): JSX.Element {
  const { loading, signedIn, mustChangePassword, role } = useAuth();

  if (loading) {
    return (
      <div className="center-screen">
        <div className="muted">Loading...</div>
      </div>
    );
  }

  if (!signedIn) {
    return <LoginPage />;
  }

  if (mustChangePassword) {
    // Forced password-change screen: the only thing a flagged user can reach.
    return <PasswordChangePage />;
  }

  const isAdmin = role === 'admin';

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/sessions" replace />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {isAdmin && <Route path="/metrics" element={<MetricsPage />} />}
        {isAdmin && <Route path="/users" element={<UsersPage />} />}
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Routes>
    </Shell>
  );
}
