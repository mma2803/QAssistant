import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Project, TestType } from '@qassistant/shared';
import { TEST_FRAMEWORK_PRESETS } from '@qassistant/shared';

import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/lib/useAsync';
import { renderMarkdown } from '@/lib/markdown';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const INHERIT = '__inherit__';
const CUSTOM = 'custom';

function Meta({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/**
 * Per-project context section (spec 5.5). A project switcher drives two tabs:
 * "Overview" (details + codegen defaults) and "Knowledge hub" (the editable
 * test-generation guidance, seeded from a default template on creation). Reads
 * are open to both roles; project creation and knowledge editing are admin-only
 * (the backend role guard is the authoritative control).
 */
export function ProjectsPage(): JSX.Element {
  const { t } = useI18n();
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const projects = useAsync<Project[]>(() => api.listProjects(), []);
  const [selected, setSelected] = useState<string>('');

  // create form (admin only), in a modal
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [screenshotDefault, setScreenshotDefault] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // knowledge hub editor (admin only; spec "Admin edits project context")
  const [km, setKm] = useState('');
  const [kmError, setKmError] = useState<string | null>(null);
  const [kmBusy, setKmBusy] = useState(false);
  const [kmSaved, setKmSaved] = useState(false);

  // per-project test framework (any tenant user).
  const [fwChoice, setFwChoice] = useState('');
  const [fwCustomName, setFwCustomName] = useState('');
  const [fwCustomLang, setFwCustomLang] = useState('');
  const [fwError, setFwError] = useState<string | null>(null);
  const [fwBusy, setFwBusy] = useState(false);
  const [fwSaved, setFwSaved] = useState(false);
  const [ttChoice, setTtChoice] = useState<'' | TestType>('');

  const current = (projects.data ?? []).find((p) => p.id === selected) ?? projects.data?.[0] ?? null;

  useEffect(() => {
    setKm(current?.knowledgeMd ?? '');
    setKmError(null);
    setKmSaved(false);
  }, [current?.id]);

  useEffect(() => {
    setFwError(null);
    setFwSaved(false);
    const fw = current?.defaultTestFramework ?? null;
    const lang = current?.defaultTestLanguage ?? null;
    if (!fw || !lang) {
      setFwChoice('');
      setFwCustomName('');
      setFwCustomLang('');
      return;
    }
    const idx = TEST_FRAMEWORK_PRESETS.findIndex((p) => p.framework === fw && p.language === lang);
    setFwChoice(idx >= 0 ? String(idx) : CUSTOM);
    setFwCustomName(fw);
    setFwCustomLang(lang);
  }, [current?.id]);

  useEffect(() => {
    setTtChoice(current?.defaultTestType ?? '');
  }, [current?.id]);

  async function onSaveFramework(): Promise<void> {
    if (!current) return;
    setFwError(null);
    setFwBusy(true);
    setFwSaved(false);
    try {
      let body: {
        defaultTestFramework: string | null;
        defaultTestLanguage: string | null;
        defaultTestType: TestType | null;
      };
      const defaultTestType: TestType | null = ttChoice === '' ? null : ttChoice;
      if (fwChoice === '') {
        body = { defaultTestFramework: null, defaultTestLanguage: null, defaultTestType };
      } else if (fwChoice === CUSTOM) {
        body = {
          defaultTestFramework: fwCustomName.trim(),
          defaultTestLanguage: fwCustomLang.trim(),
          defaultTestType,
        };
      } else {
        const preset = TEST_FRAMEWORK_PRESETS[Number(fwChoice)]!;
        body = {
          defaultTestFramework: preset.framework,
          defaultTestLanguage: preset.language,
          defaultTestType,
        };
      }
      await api.setProjectTestFramework(current.id, body);
      projects.reload();
      setFwSaved(true);
    } catch (err) {
      setFwError(err instanceof Error ? err.message : t('projects.saveFrameworkError'));
    } finally {
      setFwBusy(false);
    }
  }

  const fwCustomIncomplete = fwChoice === CUSTOM && !(fwCustomName.trim() && fwCustomLang.trim());

  async function onSaveKnowledge(): Promise<void> {
    if (!current) return;
    setKmError(null);
    setKmBusy(true);
    setKmSaved(false);
    try {
      await api.setKnowledge(current.id, {
        knowledgeMd: km.trim() ? km : null,
        defaultCredsSecretRef: current.defaultCredsSecretRef ?? null,
      });
      projects.reload();
      setKmSaved(true);
    } catch (err) {
      setKmError(err instanceof Error ? err.message : t('projects.saveKnowledgeError'));
    } finally {
      setKmBusy(false);
    }
  }

  async function onCreate(): Promise<void> {
    setCreateError(null);
    setBusy(true);
    try {
      const created = await api.createProject({
        name,
        baseUrl,
        screenshotDefault,
        maskingSelectors: [],
        inactivityTimeoutSeconds: 900,
      });
      setName('');
      setBaseUrl('');
      setScreenshotDefault(false);
      setCreateOpen(false);
      projects.reload();
      setSelected(created.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('projects.createError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('projects.title')}
        actions={
          isAdmin ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t('projects.newProject')}
            </Button>
          ) : undefined
        }
      />

      {projects.loading && (
        <p className="text-muted-foreground text-sm">{t('projects.loadingProjects')}</p>
      )}
      {projects.error && <p className="text-destructive text-sm">{projects.error}</p>}
      {projects.data && projects.data.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            {t('projects.noProjects')}
            {isAdmin && t('projects.noProjectsAdminHint')}
          </CardContent>
        </Card>
      )}

      {current && (
        <>
          {/* Project switcher */}
          <div className="flex flex-wrap items-center gap-3">
            <Label className="text-muted-foreground">{t('projects.projectLabel')}</Label>
            <Select value={current.id} onValueChange={(v) => setSelected(v)}>
              <SelectTrigger className="w-64" aria-label={t('projects.projectLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(projects.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <StatusBadge status={current.status} />
          </div>

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">{t('projects.overviewTab')}</TabsTrigger>
              <TabsTrigger value="knowledge">{t('projects.knowledgeTab')}</TabsTrigger>
            </TabsList>

            {/* --- Overview: details + test framework --- */}
            <TabsContent value="overview" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t('projects.details')}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-8">
                  <Meta label={t('projects.baseUrl')}>{current.baseUrl}</Meta>
                  <Meta label={t('common.status')}>
                    <StatusBadge status={current.status} />
                  </Meta>
                  <Meta label={t('projects.screenshotsDefault')}>
                    {current.screenshotDefault ? t('projects.on') : t('projects.off')}
                  </Meta>
                </CardContent>
              </Card>

              <Card className="max-w-2xl">
                <CardHeader>
                  <CardTitle>{t('projects.testFramework')}</CardTitle>
                  <CardDescription>{t('projects.testFrameworkDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {fwError && <p className="text-destructive text-sm">{fwError}</p>}
                  <div className="space-y-2">
                    <Label>{t('projects.frameworkLanguage')}</Label>
                    <Select
                      value={fwChoice === '' ? INHERIT : fwChoice}
                      onValueChange={(v) => {
                        setFwChoice(v === INHERIT ? '' : v);
                        setFwSaved(false);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={INHERIT}>{t('projects.inheritTenantDefault')}</SelectItem>
                        {TEST_FRAMEWORK_PRESETS.map((p, i) => (
                          <SelectItem key={`${p.framework}-${p.language}`} value={String(i)}>
                            {p.framework} / {p.language}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM}>{t('projects.custom')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {fwChoice === CUSTOM && (
                    <div className="flex flex-wrap gap-3">
                      <div className="flex-1 space-y-2">
                        <Label>{t('projects.framework')}</Label>
                        <Input
                          value={fwCustomName}
                          onChange={(e) => {
                            setFwCustomName(e.target.value);
                            setFwSaved(false);
                          }}
                          placeholder={t('projects.framework')}
                        />
                      </div>
                      <div className="flex-1 space-y-2">
                        <Label>{t('projects.language')}</Label>
                        <Input
                          value={fwCustomLang}
                          onChange={(e) => {
                            setFwCustomLang(e.target.value);
                            setFwSaved(false);
                          }}
                          placeholder={t('projects.language')}
                        />
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>{t('projects.defaultTestType')}</Label>
                    <Select
                      value={ttChoice === '' ? INHERIT : ttChoice}
                      onValueChange={(v) => {
                        setTtChoice(v === INHERIT ? '' : (v as TestType));
                        setFwSaved(false);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={INHERIT}>{t('projects.inheritTenantDefault')}</SelectItem>
                        <SelectItem value="ui">{t('projects.uiTest')}</SelectItem>
                        <SelectItem value="backend">{t('projects.backendTest')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      disabled={fwBusy || fwCustomIncomplete}
                      onClick={() => void onSaveFramework()}
                    >
                      {fwBusy ? t('common.saving') : t('projects.saveFramework')}
                    </Button>
                    {fwSaved && (
                      <span className="text-muted-foreground text-sm">{t('projects.saved')}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* --- Knowledge hub: Write / Preview --- */}
            <TabsContent value="knowledge">
              <Card>
                <CardHeader>
                  <CardTitle>{t('projects.knowledgeTab')}</CardTitle>
                  <CardDescription>{t('projects.knowledgeDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {kmError && <p className="text-destructive text-sm">{kmError}</p>}

                  {isAdmin ? (
                    <Tabs defaultValue="write">
                      <TabsList>
                        <TabsTrigger value="write">{t('projects.write')}</TabsTrigger>
                        <TabsTrigger value="preview">{t('projects.preview')}</TabsTrigger>
                      </TabsList>
                      <TabsContent value="write" className="space-y-4">
                        <Textarea
                          value={km}
                          onChange={(e) => {
                            setKm(e.target.value);
                            setKmSaved(false);
                          }}
                          rows={16}
                          className="font-mono text-xs"
                          placeholder={t('projects.knowledgePlaceholder')}
                        />
                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            disabled={kmBusy}
                            onClick={() => void onSaveKnowledge()}
                          >
                            {kmBusy ? t('common.saving') : t('projects.saveKnowledge')}
                          </Button>
                          {kmSaved && (
                            <span className="text-muted-foreground text-sm">
                              {t('projects.saved')}
                            </span>
                          )}
                        </div>
                      </TabsContent>
                      <TabsContent value="preview">
                        {km.trim() ? (
                          <div
                            className="knowledge"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(km) }}
                          />
                        ) : (
                          <p className="text-muted-foreground text-sm">
                            {t('projects.nothingToPreview')}
                          </p>
                        )}
                      </TabsContent>
                    </Tabs>
                  ) : current.knowledgeMd ? (
                    <div
                      className="knowledge"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(current.knowledgeMd) }}
                    />
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      {t('projects.noKnowledgeWritten')}
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* New project modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('projects.newProject')}</DialogTitle>
            <DialogDescription>{t('projects.newProjectDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {createError && <p className="text-destructive text-sm">{createError}</p>}
            <div className="space-y-2">
              <Label htmlFor="p-name">{t('projects.name')}</Label>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-url">{t('projects.baseUrl')}</Label>
              <Input
                id="p-url"
                type="url"
                placeholder={t('projects.baseUrlPlaceholder')}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={screenshotDefault}
                onCheckedChange={(v) => setScreenshotDefault(v === true)}
              />
              {t('projects.screenshotsByDefault')}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={busy || !name.trim() || !baseUrl.trim()}
              onClick={() => void onCreate()}
            >
              {busy ? t('projects.creating') : t('projects.createProject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
