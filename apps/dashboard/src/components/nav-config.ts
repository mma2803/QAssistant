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
  { to: '/tenants', label: 'Tenants', icon: Building2, roles: ['super-admin'] },
  { to: '/overview', label: 'Overview', icon: LayoutDashboard, roles: ['admin', 'qa-engineer'] },
  { to: '/sessions', label: 'Recordings', icon: Video, roles: ['admin', 'qa-engineer'] },
  { to: '/projects', label: 'Project context', icon: FolderKanban, roles: ['admin', 'qa-engineer'] },
  { to: '/metrics', label: 'Productivity', icon: TrendingUp, roles: ['admin'] },
  { to: '/users', label: 'Users', icon: Users, roles: ['admin'] },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ['admin', 'qa-engineer'] },
];

export function navItemsForRole(role: Role | null): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
