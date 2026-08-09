import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Project, TestType } from '@qassistant/shared';
import { TEST_FRAMEWORK_PRESETS } from '@qassistant/shared';

import { api } from '@/lib/api';
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
      setFwError(err instanceof Error ? err.message : 'Could not save the project framework');
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
      setKmError(err instanceof Error ? err.message : 'Could not save knowledge hub');
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
      setCreateError(err instanceof Error ? err.message : 'Could not create project');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Project context"
        actions={
          isAdmin ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New project
            </Button>
          ) : undefined
        }
      />

      {projects.loading && <p className="text-muted-foreground text-sm">Loading projects…</p>}
      {projects.error && <p className="text-destructive text-sm">{projects.error}</p>}
      {projects.data && projects.data.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No active projects yet.
            {isAdmin && ' Use “New project” to create one.'}
          </CardContent>
        </Card>
      )}

      {current && (
        <>
          {/* Project switcher */}
          <div className="flex flex-wrap items-center gap-3">
            <Label className="text-muted-foreground">Project</Label>
            <Select value={current.id} onValueChange={(v) => setSelected(v)}>
              <SelectTrigger className="w-64" aria-label="Project">
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
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="knowledge">Knowledge hub</TabsTrigger>
            </TabsList>

            {/* --- Overview: details + test framework --- */}
            <TabsContent value="overview" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-8">
                  <Meta label="Base URL">{current.baseUrl}</Meta>
                  <Meta label="Status">
                    <StatusBadge status={current.status} />
                  </Meta>
                  <Meta label="Screenshots default">
                    {current.screenshotDefault ? 'On' : 'Off'}
                  </Meta>
                </CardContent>
              </Card>

              <Card className="max-w-2xl">
                <CardHeader>
                  <CardTitle>Test framework</CardTitle>
                  <CardDescription>
                    Default codegen target for this project. Falls back to the tenant default when
                    set to inherit.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {fwError && <p className="text-destructive text-sm">{fwError}</p>}
                  <div className="space-y-2">
                    <Label>Framework / language</Label>
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
                        <SelectItem value={INHERIT}>Inherit tenant default</SelectItem>
                        {TEST_FRAMEWORK_PRESETS.map((p, i) => (
                          <SelectItem key={`${p.framework}-${p.language}`} value={String(i)}>
                            {p.framework} / {p.language}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM}>Custom…</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {fwChoice === CUSTOM && (
                    <div className="flex flex-wrap gap-3">
                      <div className="flex-1 space-y-2">
                        <Label>Framework</Label>
                        <Input
                          value={fwCustomName}
                          onChange={(e) => {
                            setFwCustomName(e.target.value);
                            setFwSaved(false);
                          }}
                          placeholder="Framework"
                        />
                      </div>
                      <div className="flex-1 space-y-2">
                        <Label>Language</Label>
                        <Input
                          value={fwCustomLang}
                          onChange={(e) => {
                            setFwCustomLang(e.target.value);
                            setFwSaved(false);
                          }}
                          placeholder="Language"
                        />
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Default test type</Label>
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
                        <SelectItem value={INHERIT}>Inherit tenant default</SelectItem>
                        <SelectItem value="ui">UI test</SelectItem>
                        <SelectItem value="backend">Back-end test</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      disabled={fwBusy || fwCustomIncomplete}
                      onClick={() => void onSaveFramework()}
                    >
                      {fwBusy ? 'Saving…' : 'Save framework'}
                    </Button>
                    {fwSaved && <span className="text-muted-foreground text-sm">Saved ✓</span>}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* --- Knowledge hub: Write / Preview --- */}
            <TabsContent value="knowledge">
              <Card>
                <CardHeader>
                  <CardTitle>Knowledge hub</CardTitle>
                  <CardDescription>
                    Guidance passed to the test generator. New projects start from a default
                    template — edit or clear it to fit this app.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {kmError && <p className="text-destructive text-sm">{kmError}</p>}

                  {isAdmin ? (
                    <Tabs defaultValue="write">
                      <TabsList>
                        <TabsTrigger value="write">Write</TabsTrigger>
                        <TabsTrigger value="preview">Preview</TabsTrigger>
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
                          placeholder={'# How this app works\n\nLogin, key flows, important selectors…'}
                        />
                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            disabled={kmBusy}
                            onClick={() => void onSaveKnowledge()}
                          >
                            {kmBusy ? 'Saving…' : 'Save knowledge hub'}
                          </Button>
                          {kmSaved && <span className="text-muted-foreground text-sm">Saved ✓</span>}
                        </div>
                      </TabsContent>
                      <TabsContent value="preview">
                        {km.trim() ? (
                          <div
                            className="knowledge"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(km) }}
                          />
                        ) : (
                          <p className="text-muted-foreground text-sm">Nothing to preview yet.</p>
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
                      No knowledge-hub overview has been written for this project.
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
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Its knowledge hub starts from the default guidance template.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {createError && <p className="text-destructive text-sm">{createError}</p>}
            <div className="space-y-2">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-url">Base URL</Label>
              <Input
                id="p-url"
                type="url"
                placeholder="https://app.example.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={screenshotDefault}
                onCheckedChange={(v) => setScreenshotDefault(v === true)}
              />
              Screenshots by default
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !name.trim() || !baseUrl.trim()}
              onClick={() => void onCreate()}
            >
              {busy ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
