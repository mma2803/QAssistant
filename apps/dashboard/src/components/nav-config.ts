import {
  Building2,
  FolderKanban,
  LayoutDashboard,
  Settings,
  TrendingUp,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';

import type { Role } from '@/auth/AuthContext';

export type NavItem = {
  to: string;
  /** i18n key (see i18n/translations `nav.*`); translated at render time. */
  label: string;
  icon: LucideIcon;
  /** Which roles see this link. */
  roles: Role[];
};

/**
 * Single source of truth for the sidebar. Kept in sync with the role-scoped
 * route table in App.tsx: super-admin only provisions tenants, admins get
 * productivity + user management on top of the shared QA views.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/tenants', label: 'nav.tenants', icon: Building2, roles: ['super-admin'] },
  { to: '/overview', label: 'nav.overview', icon: LayoutDashboard, roles: ['admin', 'qa-engineer'] },
  { to: '/sessions', label: 'nav.recordings', icon: Video, roles: ['admin', 'qa-engineer'] },
  { to: '/projects', label: 'nav.projects', icon: FolderKanban, roles: ['admin', 'qa-engineer'] },
  { to: '/metrics', label: 'nav.productivity', icon: TrendingUp, roles: ['admin'] },
  { to: '/users', label: 'nav.users', icon: Users, roles: ['admin'] },
  { to: '/settings', label: 'nav.settings', icon: Settings, roles: ['admin', 'qa-engineer'] },
];

export function navItemsForRole(role: Role | null): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
