import { useMemo, useState } from 'react';
import { Check, Copy, Link2, MoreHorizontal, Plus, Search } from 'lucide-react';
import { passwordSchema, type Invitation, type Tenant } from '@qassistant/shared';

import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
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
  const { t } = useI18n();
  const tenants = useAsync<Tenant[]>(() => api.listTenants(), []);
  const invitations = useAsync<Invitation[]>(() => api.listInvitations(), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  // create form (modal)
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  // signup-link dialog
  const [linkOpen, setLinkOpen] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);

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
      setError(err instanceof Error ? err.message : t('common.requestFailed'));
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

  async function onDelete(): Promise<void> {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    await guard(async () => {
      await api.deleteTenant(id);
      setDeleteTarget(null);
    });
  }

  async function onCreateLink(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const res = await api.createInvitation({ expiresInDays });
      // Compose the URL from this dashboard's own origin (the API never needs a
      // configured public base URL). Shown once — only the hash is stored.
      setGeneratedUrl(`${window.location.origin}/signup/${res.token}`);
      setCopied(false);
      invitations.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.requestFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onRevokeLink(id: string): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await api.revokeInvitation(id);
      invitations.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.requestFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onCopyLink(): Promise<void> {
    if (!generatedUrl) return;
    await navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
  }

  function closeLinkDialog(): void {
    setLinkOpen(false);
    setGeneratedUrl(null);
    setCopied(false);
    setExpiresInDays(7);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('tenants.title')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setLinkOpen(true)}>
              <Link2 className="size-4" />
              {t('tenants.createSignupLink')}
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t('tenants.addTenant')}
            </Button>
          </div>
        }
      />
      {error && <p className="text-destructive text-sm">{error}</p>}

      <Card>
        <CardContent>
          <div className="relative max-w-sm">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder={t('tenants.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardContent className="px-0">
          {tenants.loading && <p className="text-muted-foreground p-6 text-sm">{t('tenants.loading')}</p>}
          {tenants.data && rows.length === 0 && (
            <p className="text-muted-foreground p-6 text-sm">{t('tenants.none')}</p>
          )}
          {tenants.data && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('tenants.colName')}</TableHead>
                  <TableHead>{t('tenants.colSlug')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('tenants.colCreated')}</TableHead>
                  <TableHead className="w-12 text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{row.slug}</code>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" disabled={busy} aria-label={t('common.actions')}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => void onToggleStatus(row)}>
                            {row.status === 'active' ? t('tenants.deactivate') : t('tenants.activate')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setDeleteTarget(row)}
                          >
                            {t('tenants.delete')}
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

      {/* Signup links */}
      <div>
        <h2 className="mb-2 text-sm font-medium">{t('tenants.signupLinks')}</h2>
        <Card className="py-0">
          <CardContent className="px-0">
            {invitations.loading && (
              <p className="text-muted-foreground p-6 text-sm">{t('tenants.linksLoading')}</p>
            )}
            {invitations.data && invitations.data.length === 0 && (
              <p className="text-muted-foreground p-6 text-sm">{t('tenants.linksNone')}</p>
            )}
            {invitations.data && invitations.data.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('tenants.colUsedBy')}</TableHead>
                    <TableHead>{t('tenants.colExpires')}</TableHead>
                    <TableHead>{t('tenants.colCreated')}</TableHead>
                    <TableHead className="w-12 text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.data.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <StatusBadge status={inv.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {inv.createdTenants.length === 0 ? (
                          <span className="text-xs">{t('tenants.notUsedYet')}</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {inv.createdTenants.map((c) => (
                              <span key={c.tenantId} className="text-xs">
                                <span className="text-foreground font-medium">{c.name}</span>
                                {c.adminEmail ? ` — ${c.adminEmail}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(inv.expiresAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(inv.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {inv.status === 'active' ? (
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
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => void onRevokeLink(inv.id)}
                              >
                                {t('tenants.revoke')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add tenant modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tenants.addTenant')}</DialogTitle>
            <DialogDescription>{t('tenants.addDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="t-name">{t('tenants.tenantName')}</Label>
              <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-email">{t('tenants.firstAdminEmail')}</Label>
              <Input
                id="t-email"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-pw">{t('tenants.firstAdminPassword')}</Label>
              <Input
                id="t-pw"
                type="text"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">{t('password.requirements')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={
                busy ||
                !name.trim() ||
                !adminEmail ||
                !passwordSchema.safeParse(adminPassword).success
              }
              onClick={() => void onCreate()}
            >
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create signup link modal */}
      <Dialog
        open={linkOpen}
        onOpenChange={(open) => (open ? setLinkOpen(true) : closeLinkDialog())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tenants.createSignupLink')}</DialogTitle>
            <DialogDescription>{t('tenants.linkDialogDesc')}</DialogDescription>
          </DialogHeader>

          {generatedUrl ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('tenants.shareLink')}</Label>
                <div className="flex gap-2">
                  <Input readOnly value={generatedUrl} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => void onCopyLink()}>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">{t('tenants.copyOnceHint')}</p>
              </div>
              <DialogFooter>
                <Button onClick={closeLinkDialog}>{t('common.done')}</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="link-expiry">{t('tenants.expiresInDays')}</Label>
                <Input
                  id="link-expiry"
                  type="number"
                  min={1}
                  max={90}
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeLinkDialog}>
                  {t('common.cancel')}
                </Button>
                <Button
                  disabled={busy || expiresInDays < 1 || expiresInDays > 90}
                  onClick={() => void onCreateLink()}
                >
                  {t('tenants.generateLink')}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete tenant confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tenants.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('tenants.deleteDesc', { name: deleteTarget?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void onDelete()}>
              {t('tenants.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
