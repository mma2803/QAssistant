import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

/**
 * App shell: a role-aware sidebar + the routed content. The contribution
 * ranking and user management links only render for admins (spec 5.3/5.4/5.5);
 * the routes themselves are also admin-gated in App.tsx.
 */
export function Shell({ children }: { children: ReactNode }): JSX.Element {
  const { me, role, signOut } = useAuth();
  const isAdmin = role === 'admin';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">QAssistant</div>
        <nav>
          <NavLink to="/sessions">Recordings</NavLink>
          <NavLink to="/projects">Project context</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          {isAdmin && <NavLink to="/metrics">Productivity</NavLink>}
          {isAdmin && <NavLink to="/users">Users</NavLink>}
        </nav>
        <div className="spacer" />
        <div className="who">
          {me?.tenant?.name ? <div>{me.tenant.name}</div> : null}
          <div>{role === 'admin' ? 'Admin' : 'QA engineer'}</div>
          <div>{me?.uid}</div>
        </div>
        <button onClick={() => void signOut()}>Sign out</button>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
