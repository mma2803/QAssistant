import { useMemo, useState } from 'react';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import { passwordSchema, type Role, type TenantUser } from '@qassistant/shared';

import { useI18n } from '@/i18n';
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
  const { t } = useI18n();
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
      setError(err instanceof Error ? err.message : t('common.requestFailed'));
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
    const pw = prompt(
      t('users.resetPrompt', { email: u.email, requirements: t('password.requirements') }),
    );
    if (!pw) return;
    if (!passwordSchema.safeParse(pw).success) {
      setError(t('password.requirements'));
      return;
    }
    await guard(() => api.resetPassword(u.id, { password: pw }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('users.title')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t('users.addUser')}
          </Button>
        }
      />
      {error && <p className="text-destructive text-sm">{error}</p>}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder={t('users.searchPlaceholder')}
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
              <SelectValue placeholder={t('users.allRoles')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('users.allRoles')}</SelectItem>
              <SelectItem value="qa-engineer">{t('roles.qa-engineer')}</SelectItem>
              <SelectItem value="admin">{t('roles.admin')}</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardContent className="px-0">
          {users.loading && (
            <p className="text-muted-foreground p-6 text-sm">{t('users.loading')}</p>
          )}
          {users.data && rows.length === 0 && (
            <p className="text-muted-foreground p-6 text-sm">{t('users.noMatch')}</p>
          )}
          {users.data && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.email')}</TableHead>
                  <TableHead>{t('common.role')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('users.mustChangePassword')}</TableHead>
                  <TableHead>{t('common.created')}</TableHead>
                  <TableHead className="w-12 text-right">{t('common.actions')}</TableHead>
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
                          <SelectItem value="qa-engineer">{t('roles.qa-engineer')}</SelectItem>
                          <SelectItem value="admin">{t('roles.admin')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={u.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.mustChangePassword ? t('users.mustChangeYes') : t('users.mustChangeNo')}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(u.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            aria-label={t('common.actions')}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => void onReset(u)}>
                            {t('users.resetPassword')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant={u.status === 'active' ? 'destructive' : 'default'}
                            onSelect={() => void onToggleStatus(u)}
                          >
                            {u.status === 'active' ? t('users.disable') : t('users.enable')}
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
            <DialogTitle>{t('users.addUser')}</DialogTitle>
            <DialogDescription>{t('users.createDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="u-email">{t('common.email')}</Label>
              <Input
                id="u-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-pw">{t('users.initialPassword')}</Label>
              <Input
                id="u-pw"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">{t('password.requirements')}</p>
            </div>
            <div className="space-y-2">
              <Label>{t('common.role')}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger className="w-full" aria-label={t('common.role')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qa-engineer">{t('roles.qa-engineer')}</SelectItem>
                  <SelectItem value="admin">{t('roles.admin')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={busy || !email || !passwordSchema.safeParse(password).success}
              onClick={() => void onCreate()}
            >
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
