import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Download } from 'lucide-react';
import type { GeneratedTest, GenerateRequest, TestType } from '@qassistant/shared';
import { TEST_FRAMEWORK_PRESETS } from '@qassistant/shared';

import { useI18n } from '@/i18n';
import { api, saveBlob } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { ReplayPlayer } from '@/components/ReplayPlayer';
import { AuthImage } from '@/components/AuthImage';
import { formatDateTime, formatDuration } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge, IntegrationBadge, TestTypeBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
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

const DEFAULT = '__default__';
const CUSTOM = 'custom';
const NONE = '__none__';

function Meta({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/**
 * Recording detail (spec 5.2): rrweb DOM-replay, screenshots, flags/selections,
 * the session summary, and the generated versions with approve / integrate and a
 * comment + regenerate workflow. A qa-engineer can only open this for their own
 * recordings (the backend 404s otherwise), so the same page serves spec 5.3.
 */
export function SessionDetailPage(): JSX.Element {
  const { t } = useI18n();
  const { sessionId = '' } = useParams();
  const detail = useAsync(() => api.getSession(sessionId), [sessionId]);
  const replay = useAsync(() => api.getReplay(sessionId), [sessionId]);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function withBusy(id: string, fn: () => Promise<unknown>): Promise<void> {
    setBusyId(id);
    try {
      await fn();
      detail.reload();
    } finally {
      setBusyId(null);
    }
  }

  // Codegen is an async job: POST /generate (and /regenerate) only *enqueues* and
  // returns immediately; the worker writes the new version a few seconds later.
  // A single reload right after enqueue races the worker and shows nothing, which
  // invites re-clicks that pile up duplicate jobs. So we hold the busy state and
  // poll the generations list until a new version appears (or we give up),
  // keeping the button disabled the whole time.
  async function withGeneration(id: string, enqueue: () => Promise<unknown>): Promise<void> {
    const before = detail.data?.generations.length ?? 0;
    setBusyId(id);
    try {
      await enqueue();
      const stepMs = 2000;
      const deadlineMs = 45000;
      for (let waited = 0; waited < deadlineMs; waited += stepMs) {
        await new Promise((resolve) => setTimeout(resolve, stepMs));
        const { items } = await api.listGenerations(sessionId);
        if (items.length > before) {
          detail.reload();
          return;
        }
      }
      toast.error(t('sessionDetail.generationTakingLong'));
      detail.reload();
    } finally {
      setBusyId(null);
    }
  }

  if (detail.loading)
    return <p className="text-muted-foreground text-sm">{t('sessionDetail.loading')}</p>;
  if (detail.error) return <p className="text-destructive text-sm">{detail.error}</p>;
  if (!detail.data) return <p className="text-muted-foreground text-sm">{t('sessionDetail.notFound')}</p>;

  const {
    session,
    projectName,
    recordedByEmail,
    durationSeconds,
    artifacts,
    flags,
    generations,
    comments,
  } = detail.data;
  const screenshots = artifacts.filter((a) => a.type === 'screenshot');
  const domChunks = artifacts.filter((a) => a.type === 'dom_chunk');

  async function onExport(): Promise<void> {
    const { blob, filename } = await api.exportSession(sessionId);
    saveBlob(blob, filename);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('sessionDetail.title')}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/sessions">
                <ArrowLeft className="size-4" />
                {t('sessionDetail.back')}
              </Link>
            </Button>
            <Button onClick={() => void onExport()}>
              <Download className="size-4" />
              {t('sessionDetail.exportZip')}
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap gap-8">
          <Meta label={t('sessionDetail.project')}>{projectName}</Meta>
          <Meta label={t('sessionDetail.recordedBy')}>{recordedByEmail ?? '—'}</Meta>
          <Meta label={t('common.status')}>
            <StatusBadge status={session.status} />
          </Meta>
          <Meta label={t('sessionDetail.started')}>{formatDateTime(session.startedAt)}</Meta>
          <Meta label={t('sessionDetail.duration')}>{formatDuration(durationSeconds)}</Meta>
          {session.jiraId && (
            <Meta label={t('sessionDetail.jira')}>{`${session.jiraId} (${session.jiraStatus ?? '?'})`}</Meta>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('sessionDetail.summary')}</CardTitle>
        </CardHeader>
        <CardContent>
          {session.summary ? (
            <p className="text-sm">{session.summary}</p>
          ) : (
            <p className="text-muted-foreground text-sm">{t('sessionDetail.noSummary')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('sessionDetail.domReplay')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-muted-foreground text-sm">
            {t('sessionDetail.domChunks', { count: domChunks.length })}
            {replay.data?.truncated && t('sessionDetail.domTruncated')}
          </p>
          {replay.loading ? (
            <div className="text-muted-foreground grid min-h-90 place-items-center rounded-lg border text-sm">
              {t('sessionDetail.loadingReplay')}
            </div>
          ) : replay.error ? (
            <div className="text-destructive rounded-lg border p-4 text-sm">{replay.error}</div>
          ) : (
            <ReplayPlayer events={replay.data?.events} />
          )}
        </CardContent>
      </Card>

      {screenshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('sessionDetail.screenshots')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {screenshots.map((s) => (
                <div key={s.id} className="space-y-1">
                  {/* seq is 0-based in storage; show a 1-based label so it reads
                      naturally and matches the popup's screenshot count. */}
                  <div className="text-muted-foreground text-xs">#{s.seq + 1}</div>
                  <AuthImage
                    sessionId={sessionId}
                    artifactId={s.id}
                    alt={t('sessionDetail.screenshotAlt', { n: s.seq + 1 })}
                    zoomable
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('sessionDetail.flagsSelections')}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {flags.length === 0 ? (
            <p className="text-muted-foreground px-6 text-sm">{t('sessionDetail.noFlags')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('sessionDetail.colSelector')}</TableHead>
                  <TableHead>{t('sessionDetail.colNote')}</TableHead>
                  <TableHead>{t('sessionDetail.colOffset')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flags.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{f.selector}</code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{f.note ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {f.eventOffsetMs != null ? `${f.eventOffsetMs}ms` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <GenerationsSection
        sessionId={sessionId}
        projectId={session.projectId}
        generations={generations}
        comments={comments}
        busyId={busyId}
        onApprove={(id) => void withBusy(id, () => api.approveGeneration(id))}
        onComment={(body, generatedTestId) =>
          withBusy('comment', () => api.addComment(sessionId, { body, generatedTestId }))
        }
        onRegenerate={(sourceCommentId, override) =>
          withGeneration('regen', () =>
            api.regenerate(sessionId, { kind: 'playwright_test', sourceCommentId, ...override }),
          )
        }
        onGenerate={(override) => withGeneration('gen', () => api.generate(sessionId, override))}
      />
    </div>
  );
}

interface GenSectionProps {
  sessionId: string;
  projectId: string;
  generations: GeneratedTest[];
  comments: { id: string; body: string; generatedTestId: string | null; createdAt: string }[];
  busyId: string | null;
  onApprove: (id: string) => void;
  onComment: (body: string, generatedTestId?: string) => Promise<void>;
  onRegenerate: (sourceCommentId?: string, override?: Partial<GenerateRequest>) => Promise<void>;
  onGenerate: (override?: Partial<GenerateRequest>) => Promise<void>;
}

/**
 * Generated versions with approve + a comment/regenerate flow. Integration is
 * read-only here: status/ref/error are displayed but only the MCP client (which
 * owns the Git push) sets an integration outcome — there is no integrate action.
 */
function GenerationsSection(props: GenSectionProps): JSX.Element {
  const { t } = useI18n();
  const { generations, comments, busyId } = props;
  const [comment, setComment] = useState('');
  const [target, setTarget] = useState<string>('');

  const project = useAsync(() => api.getProject(props.projectId), [props.projectId]);
  const tenant = useAsync(() => api.getTenantSettings(), []);
  const [fwChoice, setFwChoice] = useState<string>('');
  const [customFw, setCustomFw] = useState('');
  const [customLang, setCustomLang] = useState('');
  const [ttChoice, setTtChoice] = useState<'' | TestType>('');

  const customIncomplete = fwChoice === CUSTOM && !(customFw.trim() && customLang.trim());

  function selectedOverride(): Partial<GenerateRequest> | undefined {
    const override: Partial<GenerateRequest> = {};
    if (fwChoice === CUSTOM) {
      const framework = customFw.trim();
      const language = customLang.trim();
      if (framework && language) {
        override.framework = framework;
        override.language = language;
      }
    } else if (fwChoice !== '') {
      const preset = TEST_FRAMEWORK_PRESETS[Number(fwChoice)];
      if (preset) {
        override.framework = preset.framework;
        override.language = preset.language;
      }
    }
    if (ttChoice !== '') override.testType = ttChoice;
    return Object.keys(override).length > 0 ? override : undefined;
  }

  const effectiveFramework =
    project.data?.defaultTestFramework ?? tenant.data?.defaultTestFramework ?? 'Playwright';
  const effectiveLanguage =
    project.data?.defaultTestLanguage ?? tenant.data?.defaultTestLanguage ?? 'TypeScript';
  const defaultLabel = `${effectiveFramework} / ${effectiveLanguage}`;
  const effectiveTestType: TestType =
    project.data?.defaultTestType ?? tenant.data?.defaultTestType ?? 'ui';
  const testTypeLabel =
    effectiveTestType === 'backend'
      ? t('sessionDetail.testTypeBackend')
      : t('sessionDetail.testTypeUi');

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>{t('sessionDetail.generatedTests')}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={ttChoice === '' ? DEFAULT : ttChoice}
            onValueChange={(v) => setTtChoice(v === DEFAULT ? '' : (v as TestType))}
          >
            <SelectTrigger size="sm" aria-label={t('sessionDetail.testType')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>
                {t('sessionDetail.defaultOption', { label: testTypeLabel })}
              </SelectItem>
              <SelectItem value="ui">{t('sessionDetail.uiTest')}</SelectItem>
              <SelectItem value="backend">{t('sessionDetail.backendTest')}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={fwChoice === '' ? DEFAULT : fwChoice}
            onValueChange={(v) => setFwChoice(v === DEFAULT ? '' : v)}
          >
            <SelectTrigger size="sm" aria-label={t('sessionDetail.testFramework')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>
                {t('sessionDetail.defaultOption', { label: defaultLabel })}
              </SelectItem>
              {TEST_FRAMEWORK_PRESETS.map((p, i) => (
                <SelectItem key={`${p.framework}-${p.language}`} value={String(i)}>
                  {p.framework} / {p.language}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM}>{t('sessionDetail.custom')}</SelectItem>
            </SelectContent>
          </Select>
          {fwChoice === CUSTOM && (
            <>
              <Input
                aria-label={t('sessionDetail.customFramework')}
                value={customFw}
                onChange={(e) => setCustomFw(e.target.value)}
                placeholder={t('sessionDetail.frameworkPlaceholder')}
                className="h-8 w-32"
              />
              <Input
                aria-label={t('sessionDetail.customLanguage')}
                value={customLang}
                onChange={(e) => setCustomLang(e.target.value)}
                placeholder={t('sessionDetail.languagePlaceholder')}
                className="h-8 w-32"
              />
            </>
          )}
          <Button
            size="sm"
            disabled={busyId === 'gen' || customIncomplete}
            onClick={() => void props.onGenerate(selectedOverride())}
          >
            {busyId === 'gen' ? t('sessionDetail.generating') : t('sessionDetail.generate')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {generations.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('sessionDetail.noGenerations')}</p>
        ) : (
          generations
            .slice()
            .reverse()
            .map((g) => (
              <div key={g.id} className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">v{g.version}</strong>
                    <TestTypeBadge type={g.testType} />
                    <Badge variant="outline">{g.modelTier}</Badge>
                    <Badge variant="outline">
                      {g.framework} / {g.language}
                    </Badge>
                    <StatusBadge status={g.reviewStatus} />
                    {g.integrationStatus !== 'not_ready' && (
                      <IntegrationBadge status={g.integrationStatus} />
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    // A failed_to_integrate version stays approved but is a
                    // dead-end until reset; allow re-approving it (back to
                    // ready_to_integrate) so the integration can be retried via
                    // the MCP client. Other approved versions stay disabled.
                    disabled={
                      busyId === g.id ||
                      (g.reviewStatus === 'approved' &&
                        g.integrationStatus !== 'failed_to_integrate')
                    }
                    onClick={() => props.onApprove(g.id)}
                  >
                    {g.integrationStatus === 'failed_to_integrate'
                      ? t('sessionDetail.reApprove')
                      : t('sessionDetail.approve')}
                  </Button>
                </div>
                {g.integrationRef && (
                  <p className="text-muted-foreground text-xs">
                    {t('sessionDetail.integrationRef', { ref: g.integrationRef })}
                  </p>
                )}
                {g.integrationError && (
                  <p className="text-muted-foreground text-xs">
                    {t('sessionDetail.integrationError', { error: g.integrationError })}
                  </p>
                )}
                {g.promptInputsSummary?.sources?.length > 0 && (
                  <p className="text-muted-foreground text-xs">
                    {t('sessionDetail.sources', {
                      list: g.promptInputsSummary.sources.map((s) => s.label).join(', '),
                    })}
                  </p>
                )}
                <pre className="bg-muted max-h-[420px] overflow-auto rounded-md border p-3 text-xs leading-relaxed">
                  {g.code}
                </pre>
              </div>
            ))
        )}

        <Separator />

        <div className="space-y-3">
          <h4 className="text-sm font-semibold">{t('sessionDetail.commentsRegenerate')}</h4>
          {comments.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {comments.map((c) => (
                <li key={c.id}>
                  {c.body}{' '}
                  {c.generatedTestId && (
                    <span className="text-muted-foreground text-xs">{t('sessionDetail.onAVersion')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            <Label htmlFor="gen-comment">{t('sessionDetail.commentLabel')}</Label>
            <Textarea
              id="gen-comment"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('sessionDetail.commentPlaceholder')}
            />
          </div>
          <div className="max-w-xs space-y-2">
            <Label>{t('sessionDetail.targetVersion')}</Label>
            <Select
              value={target === '' ? NONE : target}
              onValueChange={(v) => setTarget(v === NONE ? '' : v)}
            >
              <SelectTrigger className="w-full" aria-label={t('sessionDetail.targetVersion')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('sessionDetail.noSpecificVersion')}</SelectItem>
                {generations.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    v{g.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busyId === 'comment' || comment.trim().length === 0}
              onClick={async () => {
                await props.onComment(comment.trim(), target || undefined);
                setComment('');
              }}
            >
              {t('sessionDetail.addComment')}
            </Button>
            <Button
              disabled={busyId === 'regen' || customIncomplete}
              onClick={() => void props.onRegenerate(undefined, selectedOverride())}
            >
              {busyId === 'regen' ? t('sessionDetail.regenerating') : t('sessionDetail.regenerate')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
