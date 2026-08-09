import { useMemo, useState } from 'react';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import type { Tenant } from '@qassistant/shared';

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Super-admin tenant provisioning UI (contract 4.1). Backed by the
 * @SuperAdminOnly() /admin/tenants endpoints: create a tenant + its first
 * admin, list tenants, toggle active/inactive. This page is only routed for
 * super-admin (App.tsx); the backend role guard also rejects any other
 * caller, so this is defense in depth, not the sole control.
 */
export function TenantsPage(): JSX.Element {
  const tenants = useAsync<Tenant[]>(() => api.listTenants(), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  // create form (modal)
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const rows = useMemo(() => {
    const list = tenants.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
    );
  }, [tenants.data, query]);

  async function guard(fn: () => Promise<unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await fn();
      tenants.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(): Promise<void> {
    await guard(async () => {
      await api.createTenant({ name, firstAdmin: { email: adminEmail, password: adminPassword } });
      setName('');
      setAdminEmail('');
      setAdminPassword('');
      setCreateOpen(false);
    });
  }

  async function onToggleStatus(t: Tenant): Promise<void> {
    await guard(() =>
      api.updateTenantStatus(t.id, { status: t.status === 'active' ? 'inactive' : 'active' }),
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenants"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Add tenant
          </Button>
        }
      />
      {error && <p className="text-destructive text-sm">{error}</p>}

      <Card>
        <CardContent>
          <div className="relative max-w-sm">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search by name or slug…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardContent className="px-0">
          {tenants.loading && <p className="text-muted-foreground p-6 text-sm">Loading tenants…</p>}
          {tenants.data && rows.length === 0 && (
            <p className="text-muted-foreground p-6 text-sm">No tenants found.</p>
          )}
          {tenants.data && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{t.slug}</code>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(t.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" disabled={busy} aria-label="Actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            variant={t.status === 'active' ? 'destructive' : 'default'}
                            onSelect={() => void onToggleStatus(t)}
                          >
                            {t.status === 'active' ? 'Deactivate' : 'Activate'}
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

      {/* Add tenant modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add tenant</DialogTitle>
            <DialogDescription>
              The tenant slug is generated automatically from its name. The first admin must change
              this password on first sign-in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="t-name">Tenant name</Label>
              <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-email">First admin email</Label>
              <Input
                id="t-email"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-pw">First admin initial password</Label>
              <Input
                id="t-pw"
                type="text"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !name.trim() || !adminEmail || adminPassword.length < 8}
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
