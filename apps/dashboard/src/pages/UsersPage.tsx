import { useMemo, useState } from 'react';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import type { Role, TenantUser } from '@qassistant/shared';

import { api } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const ALL = '__all__';

/**
 * Admin user-management UI (spec 5.5), backed by the Admin SDK endpoints
 * (contract 4.2): create user, change role, enable/disable, reset password. This
 * page is only routed for admins (App.tsx); a qa-engineer token is also rejected
 * by the backend role guard, so this is defense in depth, not the sole control.
 */
export function UsersPage(): JSX.Element {
  const users = useAsync<TenantUser[]>(() => api.listUsers(), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // filters
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');

  // create form (modal)
  const [createOpen, setCreateOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('qa-engineer');

  const rows = useMemo(() => {
    const list = users.data ?? [];
    const q = query.trim().toLowerCase();
    return list.filter(
      (u) => (!roleFilter || u.role === roleFilter) && (!q || u.email.toLowerCase().includes(q)),
    );
  }, [users.data, query, roleFilter]);

  async function guard(fn: () => Promise<unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await fn();
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(): Promise<void> {
    await guard(async () => {
      await api.createUser({ email, password, role });
      setEmail('');
      setPassword('');
      setRole('qa-engineer');
      setCreateOpen(false);
    });
  }

  async function onToggleStatus(u: TenantUser): Promise<void> {
    await guard(() =>
      api.updateUser(u.id, { status: u.status === 'active' ? 'disabled' : 'active' }),
    );
  }

  async function onChangeRole(u: TenantUser, next: Role): Promise<void> {
    if (next === u.role) return;
    await guard(() => api.updateUser(u.id, { role: next }));
  }

  async function onReset(u: TenantUser): Promise<void> {
    const pw = prompt(`New temporary password for ${u.email} (min 8 chars):`);
    if (!pw) return;
    await guard(() => api.resetPassword(u.id, { password: pw }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Add user
          </Button>
        }
      />
      {error && <p className="text-destructive text-sm">{error}</p>}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search by email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={roleFilter || ALL}
            onValueChange={(v) => setRoleFilter(v === ALL ? '' : (v as Role))}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All roles</SelectItem>
              <SelectItem value="qa-engineer">QA engineer</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardContent className="px-0">
          {users.loading && <p className="text-muted-foreground p-6 text-sm">Loading users…</p>}
          {users.data && rows.length === 0 && (
            <p className="text-muted-foreground p-6 text-sm">No users match your filters.</p>
          )}
          {users.data && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Must change pw</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell>
                      <Select
                        value={u.role}
                        disabled={busy}
                        onValueChange={(v) => void onChangeRole(u, v as Role)}
                      >
                        <SelectTrigger size="sm" className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="qa-engineer">qa-engineer</SelectItem>
                          <SelectItem value="admin">admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={u.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.mustChangePassword ? 'yes' : 'no'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(u.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" disabled={busy} aria-label="Actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => void onReset(u)}>
                            Reset password
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant={u.status === 'active' ? 'destructive' : 'default'}
                            onSelect={() => void onToggleStatus(u)}
                          >
                            {u.status === 'active' ? 'Disable' : 'Enable'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add user modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>
              The new user must change this password on first sign-in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="u-email">Email</Label>
              <Input
                id="u-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-pw">Initial password</Label>
              <Input
                id="u-pw"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger className="w-full" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qa-engineer">QA engineer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !email || password.length < 8}
              onClick={() => void onCreate()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
