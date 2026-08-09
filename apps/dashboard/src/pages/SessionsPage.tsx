import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileCode2,
  MoreHorizontal,
  Search,
  Trash2,
  Video,
} from 'lucide-react';
import type { DashboardSessionListItem, Project, SessionStatus } from '@qassistant/shared';
import { INTEGRATION_STATUSES } from '@qassistant/shared';

import { api, saveBlob } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useAuth } from '@/auth/AuthContext';
import {
  formatDateTime,
  formatDuration,
  formatRelative,
  integrationStatusLabel,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import {
  StatusBadge,
  IntegrationBadge,
  TestTypeBadge,
  integrationRowClass,
} from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
const PAGE_SIZE = 50;

type SortKey = 'startedAt' | 'durationSeconds' | 'generatedTestCount';

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Video;
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription>{label}</CardDescription>
        <Icon className="text-muted-foreground size-4" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Recording / artifact browser (spec 5.2 admin; 5.3 qa-engineer restricted to
 * own work). The backend applies the role scope: an admin sees the whole tenant;
 * a qa-engineer's list is filtered to recorded_by = self server-side, so this
 * page renders the same way for both and never leaks another tester's rows.
 *
 * Server-side filters: projectId, status (they reset + refetch). Search, tester,
 * integration filters and sorting are client-side over the loaded pages; "Load
 * more" appends the next cursor page so those never silently miss rows past the
 * first page.
 */
export function SessionsPage(): JSX.Element {
  const { role } = useAuth();
  const navigate = useNavigate();
  const isAdmin = role === 'admin';

  // server-side filters
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState<SessionStatus | ''>('');
  // client-side filters
  const [query, setQuery] = useState('');
  const [tester, setTester] = useState('');
  const [integration, setIntegration] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // sorting + selection
  const [sortKey, setSortKey] = useState<SortKey>('startedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // paginated data
  const [items, setItems] = useState<DashboardSessionListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const projects = useAsync<Project[]>(() => api.listProjects(), []);

  async function load(reset: boolean): Promise<void> {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await api.listSessions({
        projectId: projectId || undefined,
        status: status || undefined,
        limit: PAGE_SIZE,
        cursor: reset ? undefined : (cursor ?? undefined),
      });
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load recordings');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  // Reset + refetch whenever a server-side filter changes.
  useEffect(() => {
    setSelected(new Set());
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, status]);

  const testers = useMemo(
    () =>
      Array.from(new Set(items.map((s) => s.recordedByEmail).filter(Boolean) as string[])).sort(),
    [items],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom).getTime() : null;
    const to = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : null;
    const filtered = items.filter((s) => {
      if (tester && s.recordedByEmail !== tester) return false;
      if (integration && (s.integrationStatus ?? '') !== integration) return false;
      const started = new Date(s.startedAt).getTime();
      if (from !== null && started < from) return false;
      if (to !== null && started > to) return false;
      if (
        q &&
        ![s.projectName, s.jiraId, s.description, s.recordedByEmail]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q))
      )
        return false;
      return true;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      let av: number;
      let bv: number;
      if (sortKey === 'startedAt') {
        av = new Date(a.startedAt).getTime();
        bv = new Date(b.startedAt).getTime();
      } else {
        av = a[sortKey] ?? 0;
        bv = b[sortKey] ?? 0;
      }
      return (av - bv) * dir;
    });
  }, [items, query, tester, integration, dateFrom, dateTo, sortKey, sortDir]);

  const stats = useMemo(
    () => ({
      total: items.length,
      active: items.filter((s) => s.status === 'active').length,
      completed: items.filter((s) => s.status === 'completed').length,
      tests: items.reduce((a, s) => a + s.generatedTestCount, 0),
    }),
    [items],
  );

  // Combined Status filter: session statuses (server-side) + integration
  // statuses (client-side, prefixed "int:"), one active at a time.
  const statusValue = integration ? `int:${integration}` : status ? status : ALL;
  function onStatusChange(v: string): void {
    if (v === ALL) {
      setStatus('');
      setIntegration('');
    } else if (v.startsWith('int:')) {
      setStatus('');
      setIntegration(v.slice(4));
    } else {
      setIntegration('');
      setStatus(v as SessionStatus);
    }
  }

  function toggleSort(key: SortKey): void {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function SortHeader({ label, k }: { label: string; k: SortKey }): JSX.Element {
    const active = sortKey === k;
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className="hover:text-foreground inline-flex items-center gap-1"
      >
        {label}
        {active ? (
          sortDir === 'asc' ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )
        ) : (
          <ArrowUpDown className="size-3.5 opacity-40" />
        )}
      </button>
    );
  }

  const allSelected = rows.length > 0 && rows.every((s) => selected.has(s.id));
  function toggleSelectAll(): void {
    setSelected(allSelected ? new Set() : new Set(rows.map((s) => s.id)));
  }
  function toggleRow(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function onExport(sessionId: string): Promise<void> {
    const { blob, filename } = await api.exportSession(sessionId);
    saveBlob(blob, filename);
  }

  async function onDelete(sessionId: string): Promise<void> {
    if (!confirm('Soft-delete this recording? It can be restored within 30 days.')) return;
    await api.deleteSession(sessionId);
    void load(true);
  }

  async function onBulkExport(): Promise<void> {
    setBulkBusy(true);
    try {
      for (const id of selected) await onExport(id);
    } finally {
      setBulkBusy(false);
    }
  }

  async function onBulkDelete(): Promise<void> {
    if (!confirm(`Soft-delete ${selected.size} recording(s)? They can be restored within 30 days.`))
      return;
    setBulkBusy(true);
    try {
      for (const id of selected) await api.deleteSession(id);
      setSelected(new Set());
      void load(true);
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Recordings" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Loaded recordings" value={stats.total} icon={Video} />
        <StatCard label="Active" value={stats.active} icon={Clock} />
        <StatCard label="Completed" value={stats.completed} icon={Video} />
        <StatCard label="Tests generated" value={stats.tests} icon={FileCode2} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search project, context, tester…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={projectId || ALL} onValueChange={(v) => setProjectId(v === ALL ? '' : v)}>
            <SelectTrigger className="w-48" aria-label="Project">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All projects</SelectItem>
              {(projects.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Combined Status: session status + integration status */}
          <Select value={statusValue} onValueChange={onStatusChange}>
            <SelectTrigger className="w-52" aria-label="Status">
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All status</SelectItem>
              <SelectGroup>
                <SelectLabel>Session</SelectLabel>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Integration</SelectLabel>
                {INTEGRATION_STATUSES.map((s) => (
                  <SelectItem key={s} value={`int:${s}`}>
                    {integrationStatusLabel(s)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {isAdmin && (
            <Select value={tester || ALL} onValueChange={(v) => setTester(v === ALL ? '' : v)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Recorded by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Recorded by: all</SelectItem>
                {testers.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Sort by time */}
          <Select
            value={sortKey === 'startedAt' ? sortDir : 'custom'}
            onValueChange={(v) => {
              setSortKey('startedAt');
              setSortDir(v === 'asc' ? 'asc' : 'desc');
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Sort by time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Newest first</SelectItem>
              <SelectItem value="asc">Oldest first</SelectItem>
              {sortKey !== 'startedAt' && (
                <SelectItem value="custom" disabled>
                  Sorted by column
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          {/* Date range */}
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <span className="text-muted-foreground text-xs">From</span>
              <Input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground text-xs">To</span>
              <Input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40"
              />
            </div>
            {(dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bg-accent/50 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => void onBulkExport()}>
            <Download className="size-4" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={bulkBusy}
            onClick={() => void onBulkDelete()}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <Card className="py-0">
        <CardContent className="px-0">
          {error && <p className="text-destructive p-6 text-sm">{error}</p>}
          {loading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">No recordings found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Work context</TableHead>
                  {isAdmin && <TableHead>Recorded by</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <SortHeader label="Started" k="startedAt" />
                  </TableHead>
                  <TableHead>
                    <SortHeader label="Duration" k="durationSeconds" />
                  </TableHead>
                  <TableHead>
                    <SortHeader label="Tests" k="generatedTestCount" />
                  </TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Integration</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow
                    key={s.id}
                    className={cn('cursor-pointer', integrationRowClass(s.integrationStatus))}
                    onClick={() => navigate(`/sessions/${s.id}`)}
                    data-state={selected.has(s.id) ? 'selected' : undefined}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(s.id)}
                        onCheckedChange={() => toggleRow(s.id)}
                        aria-label="Select row"
                      />
                    </TableCell>
                    <TableCell className="font-medium">{s.projectName}</TableCell>
                    <TableCell className="text-muted-foreground max-w-56 truncate">
                      {s.jiraId ? (
                        <span title={s.jiraSummary ?? ''}>{s.jiraId}</span>
                      ) : s.description ? (
                        s.description
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-muted-foreground">
                        {s.recordedByEmail ?? '—'}
                      </TableCell>
                    )}
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span title={formatDateTime(s.startedAt)}>{formatRelative(s.startedAt)}</span>
                    </TableCell>
                    <TableCell>{formatDuration(s.durationSeconds)}</TableCell>
                    <TableCell>{s.generatedTestCount}</TableCell>
                    <TableCell>
                      {(s.testTypes ?? []).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {(s.testTypes ?? []).map((t) => (
                            <TestTypeBadge key={t} type={t} />
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.integrationStatus ? (
                        <IntegrationBadge status={s.integrationStatus} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => navigate(`/sessions/${s.id}`)}>
                            Open
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void onExport(s.id)}>
                            Export ZIP
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => void onDelete(s.id)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!loading && rows.length > 0 && (
            <div className="text-muted-foreground flex items-center justify-between gap-3 border-t px-6 py-3 text-xs">
              <span>
                Showing {rows.length} of {items.length} loaded
              </span>
              {cursor && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => void load(false)}
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
