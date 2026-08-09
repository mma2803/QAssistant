import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ChevronsUpDown,
  KeyRound,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

import { useAuth } from '@/auth/AuthContext';
import { BugMark } from '@/components/Logo';
import { navItemsForRole, type NavItem } from '@/components/nav-config';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const COLLAPSE_KEY = 'qassistant.sidebar.collapsed';

function roleLabel(isSuperAdmin: boolean, isAdmin: boolean): string {
  return isSuperAdmin ? 'Super-admin' : isAdmin ? 'Admin' : 'QA engineer';
}

function initials(uid: string | null | undefined): string {
  if (!uid) return '?';
  const name = uid.includes('@') ? uid.split('@')[0]! : uid;
  const parts = name.split(/[.\-_ ]+/).filter(Boolean);
  const chars = parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : name.slice(0, 2);
  return chars.toUpperCase();
}

function Brand({ collapsed }: { collapsed?: boolean }): JSX.Element {
  return (
    <div className={cn('flex h-14 items-center gap-2 px-4', collapsed && 'justify-center px-0')}>
      <BugMark className="size-8" />
      {!collapsed && (
        <span className="text-base font-semibold tracking-tight">
          <span className="text-[#4F46E5] dark:text-[#818CF8]">Q</span>Assistant
        </span>
      )}
    </div>
  );
}

function NavItems({
  items,
  collapsed,
  onNavigate,
}: {
  items: NavItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
}): JSX.Element {
  return (
    <nav className={cn('flex flex-col gap-1 py-2', collapsed ? 'px-2' : 'px-3')}>
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
              collapsed && 'justify-center px-0',
            )
          }
        >
          <Icon className="size-4 shrink-0" />
          {!collapsed && label}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * App shell: a role-aware sidebar + a topbar with the theme toggle and user
 * menu. On desktop the sidebar collapses to an icon rail (persisted); on mobile
 * it becomes a slide-over Sheet. Navigation and route gating stay driven by role
 * (see nav-config.ts and App.tsx).
 */
export function Shell({ children }: { children: ReactNode }): JSX.Element {
  const { me, role, email, signOut, completePasswordChange } = useAuth();
  const isAdmin = role === 'admin';
  const isSuperAdmin = role === 'super-admin';
  const items = navItemsForRole(role);
  // Prefer the email (server-provided, or remembered from sign-in) over the
  // opaque uid for display.
  const displayName = email;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(COLLAPSE_KEY) === '1',
  );

  // Self-service password change
  const [pwOpen, setPwOpen] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  async function onChangePassword(e: FormEvent): Promise<void> {
    e.preventDefault();
    setPwError(null);
    if (pw1.length < 8) {
      setPwError('Password must be at least 8 characters');
      return;
    }
    if (pw1 !== pw2) {
      setPwError('Passwords do not match');
      return;
    }
    setPwBusy(true);
    try {
      await completePasswordChange(pw1);
      setPwOpen(false);
      setPw1('');
      setPw2('');
      toast.success('Password updated');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setPwBusy(false);
    }
  }

  // User block, rendered at the bottom of the sidebar (and the mobile drawer).
  // Collapsed rail → avatar-only trigger with the menu opening to the right;
  // expanded → a full-width card (avatar + email + role/tenant) opening upward.
  function userMenu(collapsed: boolean): JSX.Element {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {collapsed ? (
            <Button variant="ghost" size="icon" className="mx-auto" aria-label="Open account menu">
              <Avatar className="size-7">
                <AvatarFallback>{initials(displayName)}</AvatarFallback>
              </Avatar>
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="h-auto w-full justify-start gap-2 px-2 py-2"
              aria-label="Open account menu"
            >
              <Avatar className="size-8">
                <AvatarFallback>{initials(displayName)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col items-start text-left">
                <span className="w-full truncate text-sm font-medium">
                  {displayName ?? 'Account'}
                </span>
                <span className="text-muted-foreground w-full truncate text-xs">
                  {roleLabel(isSuperAdmin, isAdmin)}
                  {me?.tenant?.name ? ` · ${me.tenant.name}` : ''}
                </span>
              </div>
              <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={collapsed ? 'right' : 'top'}
          align={collapsed ? 'end' : 'start'}
          className="w-56"
        >
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate">{displayName}</span>
            <span className="text-muted-foreground text-xs font-normal">
              {roleLabel(isSuperAdmin, isAdmin)}
              {me?.tenant?.name ? ` · ${me.tenant.name}` : ''}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setPwError(null);
              setPwOpen(true);
            }}
          >
            <KeyRound className="size-4" />
            Change password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'bg-sidebar border-sidebar-border fixed inset-y-0 left-0 z-30 hidden flex-col border-r transition-[width] duration-200 md:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <Brand collapsed={collapsed} />
        <Separator />
        <div className="flex-1 overflow-y-auto">
          <NavItems items={items} collapsed={collapsed} />
        </div>
        <Separator />
        <div className="p-2">{userMenu(collapsed)}</div>
      </aside>

      {/* Main column */}
      <div
        className={cn(
          'flex min-h-screen flex-col transition-[padding] duration-200',
          collapsed ? 'md:pl-16' : 'md:pl-64',
        )}
      >
        <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
          {/* Mobile menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-64 flex-col p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Brand />
              <Separator />
              <div className="flex-1 overflow-y-auto">
                <NavItems items={items} onNavigate={() => setMobileOpen(false)} />
              </div>
              <Separator />
              <div className="p-2">{userMenu(false)}</div>
            </SheetContent>
          </Sheet>

          {/* Desktop collapse toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </Button>

          <div className="flex-1" />
          <ModeToggle />
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      {/* Self-service change password */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              {displayName ? `Signed in as ${displayName}.` : ''} Set a new password for your
              account.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onChangePassword}>
            <div className="space-y-2">
              <Label htmlFor="new-pw">New password</Label>
              <Input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pw">Confirm password</Label>
              <Input
                id="confirm-pw"
                type="password"
                autoComplete="new-password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                required
              />
            </div>
            {pwError && <p className="text-destructive text-sm">{pwError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPwOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pwBusy}>
                {pwBusy ? 'Saving…' : 'Update password'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
