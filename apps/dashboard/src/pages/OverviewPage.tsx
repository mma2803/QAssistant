import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CheckCircle2, Clock, FileCode2, Video } from 'lucide-react';
import type { DashboardSessionListItem } from '@qassistant/shared';

import { api } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { formatRelative } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge, IntegrationBadge, TestTypeBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
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
        {sub && <p className="text-muted-foreground mt-1 text-xs">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Landing overview: at-a-glance stats, a recent-activity feed and a recordings
 * trend, computed client-side from the most recent page of sessions (role scope
 * is applied server-side, so a qa-engineer sees only their own work). No new
 * backend endpoint — this reuses GET /dashboard/sessions.
 */
export function OverviewPage(): JSX.Element {
  const sessions = useAsync(() => api.listSessions({ limit: 100 }), []);
  const items: DashboardSessionListItem[] = sessions.data?.items ?? [];

  const stats = useMemo(() => {
    const integrated = items.filter((s) => s.integrationStatus === 'integrated').length;
    const failed = items.filter((s) => s.integrationStatus === 'failed_to_integrate').length;
    const attempts = integrated + failed;
    return {
      total: items.length,
      active: items.filter((s) => s.status === 'active').length,
      tests: items.reduce((a, s) => a + s.generatedTestCount, 0),
      integrated,
      successRate: attempts ? Math.round((integrated / attempts) * 100) : null,
    };
  }, [items]);

  const trend = useMemo(() => {
    const days = 14;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = Array.from({ length: days }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (days - 1 - i));
      return { key: d.toISOString().slice(0, 10), label: `${d.getMonth() + 1}/${d.getDate()}`, count: 0 };
    });
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const s of items) {
      const k = new Date(s.startedAt).toISOString().slice(0, 10);
      const b = byKey.get(k);
      if (b) b.count += 1;
    }
    return buckets;
  }, [items]);

  const recent = useMemo(
    () =>
      [...items]
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .slice(0, 6),
    [items],
  );

  const testTypeSplit = useMemo(() => {
    let ui = 0;
    let backend = 0;
    for (const s of items)
      for (const t of s.testTypes ?? []) (t === 'backend' ? (backend += 1) : (ui += 1));
    return { ui, backend };
  }, [items]);

  return (
    <div className="space-y-6">
      <PageHeader title="Welcome back 👋" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Recordings" value={stats.total} sub="Most recent 100" icon={Video} />
        <StatCard label="Active sessions" value={stats.active} icon={Clock} />
        <StatCard label="Tests generated" value={stats.tests} icon={FileCode2} />
        <StatCard
          label="Integrated"
          value={stats.integrated}
          sub={stats.successRate !== null ? `${stats.successRate}% success rate` : 'No attempts yet'}
          icon={CheckCircle2}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Recordings over time</CardTitle>
            <CardDescription>Last 14 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--muted-foreground)"
                  interval="preserveStartEnd"
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip
                  cursor={{ fill: 'var(--accent)' }}
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--popover-foreground)',
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent recordings</CardTitle>
            <CardDescription>Your latest sessions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {sessions.loading && <p className="text-muted-foreground text-sm">Loading…</p>}
            {!sessions.loading && recent.length === 0 && (
              <p className="text-muted-foreground text-sm">No recordings yet.</p>
            )}
            {recent.map((s) => (
              <Link
                key={s.id}
                to={`/sessions/${s.id}`}
                className="hover:bg-accent -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.projectName}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {s.jiraId || s.description || 'No context'} · {formatRelative(s.startedAt)}
                  </div>
                </div>
                {s.integrationStatus ? (
                  <IntegrationBadge status={s.integrationStatus} />
                ) : (
                  <StatusBadge status={s.status} />
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Generated test types</CardTitle>
            <CardDescription>UI vs back-end across recent sessions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <TestTypeBadge type="ui" />
              <span className="text-sm font-medium">{testTypeSplit.ui}</span>
            </div>
            <div className="flex items-center justify-between">
              <TestTypeBadge type="backend" />
              <span className="text-sm font-medium">{testTypeSplit.backend}</span>
            </div>
            {testTypeSplit.ui + testTypeSplit.backend === 0 && (
              <p className="text-muted-foreground text-sm">No tests generated yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Integration status</CardTitle>
            <CardDescription>Where your candidate tests stand.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['ready_to_integrate', 'integrated', 'failed_to_integrate', 'not_ready'] as const).map(
              (st) => (
                <div key={st} className="rounded-lg border p-3">
                  <div className="text-2xl font-semibold">
                    {items.filter((s) => (s.integrationStatus ?? 'not_ready') === st).length}
                  </div>
                  <div className="mt-1">
                    <IntegrationBadge status={st} />
                  </div>
                </div>
              ),
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
