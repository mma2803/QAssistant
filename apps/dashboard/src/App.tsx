import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Shell } from './components/Shell';
import { LoginPage } from './pages/LoginPage';
import { PasswordChangePage } from './pages/PasswordChangePage';
import { OverviewPage } from './pages/OverviewPage';
import { SessionsPage } from './pages/SessionsPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { MetricsPage } from './pages/MetricsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';
import { TenantsPage } from './pages/TenantsPage';

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
      <div className="text-muted-foreground grid min-h-screen place-items-center text-sm">
        Loading…
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

  // Super-admin has no tenant binding, so none of the tenant-scoped routes
  // below apply (the backend would 403 them anyway) -- it gets its own,
  // separate route table: tenant provisioning only.
  if (role === 'super-admin') {
    return (
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to="/tenants" replace />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="*" element={<Navigate to="/tenants" replace />} />
        </Routes>
      </Shell>
    );
  }

  const isAdmin = role === 'admin';

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {isAdmin && <Route path="/metrics" element={<MetricsPage />} />}
        {isAdmin && <Route path="/users" element={<UsersPage />} />}
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </Shell>
  );
}
