import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Clock, FileCode2, Trophy, Users, Video } from 'lucide-react';

import type { DashboardSessionListItem, Project } from '@qassistant/shared';
import { api } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { formatDuration } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

type Period = '24h' | '48h' | '7d' | '30d' | 'custom';

const PERIOD_LABEL: Record<Period, string> = {
  '24h': 'Last 24 hours',
  '48h': 'Last 48 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  custom: 'Custom range',
};

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const PAGE_CAP = 20; // safety bound: at most 20×100 sessions scanned per window

const tooltipStyle = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--popover-foreground)',
  fontSize: 12,
} as const;

function localPart(email: string | null): string {
  if (!email) return '—';
  return email.includes('@') ? email.split('@')[0]! : email;
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof Users;
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

function CoverageTile({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}): JSX.Element {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground text-sm">{label}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {total > 0 ? `${value}/${total}` : '—'}
        </span>
      </div>
      <div className="text-2xl font-semibold tabular-nums">{total > 0 ? `${pct}%` : '—'}</div>
      <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
        <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function medal(rank: number): string | null {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
}

/**
 * Productivity metrics + contribution ranking (spec 5.4, admin only). Everything
 * is scoped to the selected time window and computed client-side from the
 * recording list (the ranking/metrics endpoints are all-time only): sessions are
 * paginated until the window is covered, then aggregated per tester and per
 * project. Ranking order matches the spec (generated tests → recording time →
 * recording count) with no hidden weighted score.
 */
export function MetricsPage(): JSX.Element {
  const [period, setPeriod] = useState<Period>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const projects = useAsync<Project[]>(() => api.listProjects(), []);

  const [items, setItems] = useState<DashboardSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Resolve the active window [from, to] in epoch ms.
  const windowMs = useMemo(() => {
    const now = Date.now();
    if (period === 'custom') {
      const from = customFrom ? new Date(customFrom).getTime() : now - 30 * DAY;
      const to = customTo ? new Date(customTo + 'T23:59:59').getTime() : now;
      return { from, to };
    }
    const span = period === '24h' ? DAY : period === '48h' ? 2 * DAY : period === '7d' ? 7 * DAY : 30 * DAY;
    return { from: now - span, to: now };
  }, [period, customFrom, customTo]);

  // Load just enough pages (newest first) to cover the window's start.
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const acc: DashboardSessionListItem[] = [];
        let cursor: string | undefined;
        for (let i = 0; i < PAGE_CAP; i++) {
          const res = await api.listSessions({ limit: 100, cursor });
          acc.push(...res.items);
          const last = res.items[res.items.length - 1];
          cursor = res.nextCursor ?? undefined;
          if (!cursor) break;
          if (last && new Date(last.startedAt).getTime() < windowMs.from) break;
        }
        if (!cancelled) setItems(acc);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load metrics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [windowMs.from]);

  // Sessions within the active window.
  const windowed = useMemo(
    () =>
      items.filter((s) => {
        const t = new Date(s.startedAt).getTime();
        return t >= windowMs.from && t <= windowMs.to;
      }),
    [items, windowMs.from, windowMs.to],
  );

  // Per-tester aggregation → ranking (spec order).
  const ranking = useMemo(() => {
    const map = new Map<
      string,
      { email: string | null; generatedTestCount: number; totalRecordingSeconds: number; recordingCount: number }
    >();
    for (const s of windowed) {
      const e =
        map.get(s.recordedBy) ??
        { email: s.recordedByEmail, generatedTestCount: 0, totalRecordingSeconds: 0, recordingCount: 0 };
      e.generatedTestCount += s.generatedTestCount;
      e.totalRecordingSeconds += s.durationSeconds ?? 0;
      e.recordingCount += 1;
      map.set(s.recordedBy, e);
    }
    return [...map.entries()]
      .map(([userId, v]) => ({ userId, ...v }))
      .sort(
        (a, b) =>
          b.generatedTestCount - a.generatedTestCount ||
          b.totalRecordingSeconds - a.totalRecordingSeconds ||
          b.recordingCount - a.recordingCount,
      );
  }, [windowed]);

  const totals = useMemo(() => {
    const tests = ranking.reduce((a, m) => a + m.generatedTestCount, 0);
    const recordings = windowed.length;
    const seconds = ranking.reduce((a, m) => a + m.totalRecordingSeconds, 0);
    const testers = ranking.length;
    return { testers, tests, recordings, seconds, avgTests: testers ? (tests / testers).toFixed(1) : '0' };
  }, [ranking, windowed]);

  const coverage = useMemo(() => {
    const totalRec = windowed.length;
    const withTests = windowed.filter((s) => s.generatedTestCount > 0).length;
    const candidates = windowed.filter((s) => s.integrationStatus != null).length;
    const integrated = windowed.filter((s) => s.integrationStatus === 'integrated').length;
    const activeProjects = projects.data?.length ?? 0;
    const projectsWithRec = new Set(windowed.map((s) => s.projectName)).size;
    return { totalRec, withTests, candidates, integrated, activeProjects, projectsWithRec };
  }, [windowed, projects.data]);

  const byTester = useMemo(
    () => ranking.slice(0, 10).map((m) => ({ name: localPart(m.email), tests: m.generatedTestCount })).reverse(),
    [ranking],
  );

  const byProject = useMemo(() => {
    const map = new Map<string, { name: string; recordings: number; tests: number }>();
    for (const s of windowed) {
      const e = map.get(s.projectName) ?? { name: s.projectName, recordings: 0, tests: 0 };
      e.recordings += 1;
      e.tests += s.generatedTestCount;
      map.set(s.projectName, e);
    }
    return [...map.values()]
      .sort((a, b) => b.tests - a.tests || b.recordings - a.recordings)
      .slice(0, 10);
  }, [windowed]);

  const empty = !loading && windowed.length === 0;

  const periodFilter = (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
        {/* Selected window shown in blue */}
        <SelectTrigger className="text-primary w-44 font-medium">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="24h">Last 24 hours</SelectItem>
          <SelectItem value="48h">Last 48 hours</SelectItem>
          <SelectItem value="7d">Last 7 days</SelectItem>
          <SelectItem value="30d">Last 30 days</SelectItem>
          <SelectItem value="custom">Custom range</SelectItem>
        </SelectContent>
      </Select>
      {period === 'custom' && (
        <>
          <Input
            type="date"
            value={customFrom}
            max={customTo || undefined}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="w-40"
          />
          <Input
            type="date"
            value={customTo}
            min={customFrom || undefined}
            onChange={(e) => setCustomTo(e.target.value)}
            className="w-40"
          />
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Productivity" actions={periodFilter} />

      <p className="text-primary text-sm font-medium">{PERIOD_LABEL[period]}</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active testers" value={totals.testers} icon={Users} />
        <StatCard
          label="Generated tests"
          value={totals.tests}
          sub={`${totals.avgTests} avg / tester`}
          icon={FileCode2}
        />
        <StatCard label="Recordings" value={totals.recordings} icon={Video} />
        <StatCard
          label="Total recording time"
          value={formatDuration(totals.seconds)}
          sub="Raw wall-clock"
          icon={Clock}
        />
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {loading ? (
        <Card>
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            Loading…
          </CardContent>
        </Card>
      ) : empty ? (
        <Card>
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            No activity in this period.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Test coverage</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-3">
              <CoverageTile
                label="Recordings turned into a test"
                value={coverage.withTests}
                total={coverage.totalRec}
              />
              <CoverageTile
                label="Candidate tests integrated"
                value={coverage.integrated}
                total={coverage.candidates}
              />
              <CoverageTile
                label="Projects with activity"
                value={coverage.projectsWithRec}
                total={coverage.activeProjects}
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Top testers</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(180, byTester.length * 40)}>
                  <BarChart
                    layout="vertical"
                    data={byTester}
                    margin={{ top: 4, right: 36, left: 8, bottom: 4 }}
                  >
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      stroke="var(--muted-foreground)"
                    />
                    <Tooltip cursor={{ fill: 'var(--accent)' }} contentStyle={tooltipStyle} />
                    <Bar dataKey="tests" name="Generated tests" radius={[0, 4, 4, 0]} barSize={18}>
                      {byTester.map((_, i) => (
                        <Cell
                          key={i}
                          fill={i === byTester.length - 1 ? 'var(--chart-1)' : 'var(--chart-2)'}
                        />
                      ))}
                      <LabelList dataKey="tests" position="right" fontSize={12} fill="var(--foreground)" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Project activity</CardTitle>
              </CardHeader>
              <CardContent>
                {byProject.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    No recordings in this period.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(180, byProject.length * 48)}>
                    <BarChart
                      layout="vertical"
                      data={byProject}
                      margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                    >
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        fontSize={11}
                        stroke="var(--muted-foreground)"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={110}
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                        stroke="var(--muted-foreground)"
                      />
                      <Tooltip cursor={{ fill: 'var(--accent)' }} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="recordings" name="Recordings" fill="var(--chart-2)" radius={[0, 4, 4, 0]} barSize={10} />
                      <Bar dataKey="tests" name="Generated tests" fill="var(--chart-1)" radius={[0, 4, 4, 0]} barSize={10} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="py-0">
            <CardHeader className="px-6 pt-6">
              <CardTitle className="flex items-center gap-2">
                <Trophy className="text-warning size-4" />
                Contribution ranking
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">Rank</TableHead>
                    <TableHead>Tester</TableHead>
                    <TableHead className="text-right">Generated tests</TableHead>
                    <TableHead className="text-right">Recording time</TableHead>
                    <TableHead className="text-right">Recordings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ranking.map((m, i) => (
                    <TableRow key={m.userId} className={i === 0 ? 'bg-warning/5' : undefined}>
                      <TableCell className="font-medium">
                        {medal(i + 1) ?? <span className="text-muted-foreground">{i + 1}</span>}
                      </TableCell>
                      <TableCell className="font-medium">{m.email ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.generatedTestCount}</TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {formatDuration(m.totalRecordingSeconds)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {m.recordingCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <p className="text-muted-foreground text-xs">
            Directional, not an absolute performance score. Recording duration is raw wall-clock
            (idle time is not excluded in this MVP). Aggregated from recordings in the selected
            window.
          </p>
        </>
      )}
    </div>
  );
}
