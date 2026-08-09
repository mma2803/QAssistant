import { useEffect, useState } from 'react';
import type { TestType } from '@qassistant/shared';
import { TEST_FRAMEWORK_PRESETS } from '@qassistant/shared';

import { api } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CUSTOM = 'custom';

/**
 * Tenant settings (change: configurable-test-framework). The tenant-wide default
 * test framework/language is a team preference, so this page is open to ANY
 * tenant user (admin or qa-engineer) — the backend route is not admin-gated.
 * Picking a preset or a free-form custom value sets the default used whenever a
 * generation does not specify a per-generation override.
 */
export function SettingsPage(): JSX.Element {
  const settings = useAsync(() => api.getTenantSettings(), []);
  const [framework, setFramework] = useState('');
  const [language, setLanguage] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [testType, setTestType] = useState<TestType>('ui');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data) {
      setFramework(settings.data.defaultTestFramework);
      setLanguage(settings.data.defaultTestLanguage);
      setTestType(settings.data.defaultTestType);
      const matches = TEST_FRAMEWORK_PRESETS.some(
        (p) =>
          p.framework === settings.data!.defaultTestFramework &&
          p.language === settings.data!.defaultTestLanguage,
      );
      setCustomMode(!matches);
    }
  }, [settings.data]);

  const presetIndex = TEST_FRAMEWORK_PRESETS.findIndex(
    (p) => p.framework === framework && p.language === language,
  );
  const choice = customMode || presetIndex < 0 ? CUSTOM : String(presetIndex);

  function onChoose(value: string): void {
    setSaved(false);
    if (value === CUSTOM) {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    const preset = TEST_FRAMEWORK_PRESETS[Number(value)];
    if (preset) {
      setFramework(preset.framework);
      setLanguage(preset.language);
    }
  }

  async function onSave(): Promise<void> {
    setError(null);
    setBusy(true);
    setSaved(false);
    try {
      const updated = await api.setTenantSettings({
        defaultTestFramework: framework.trim(),
        defaultTestLanguage: language.trim(),
        defaultTestType: testType,
      });
      setFramework(updated.defaultTestFramework);
      setLanguage(updated.defaultTestLanguage);
      setTestType(updated.defaultTestType);
      settings.reload();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save tenant settings');
    } finally {
      setBusy(false);
    }
  }

  if (settings.loading) return <p className="text-muted-foreground text-sm">Loading settings…</p>;
  if (settings.error) return <p className="text-destructive text-sm">{settings.error}</p>;

  const canSave = framework.trim().length > 0 && language.trim().length > 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Default test framework</CardTitle>
          <CardDescription>
            Used when generating a test, unless overridden per generation. Any team member can
            change it; it applies tenant-wide.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="space-y-2">
            <Label>Framework / language</Label>
            <Select value={choice} onValueChange={onChoose}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEST_FRAMEWORK_PRESETS.map((p, i) => (
                  <SelectItem key={`${p.framework}-${p.language}`} value={String(i)}>
                    {p.framework} / {p.language}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Custom…</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {choice === CUSTOM && (
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 space-y-2">
                <Label>Framework</Label>
                <Input
                  value={framework}
                  onChange={(e) => {
                    setFramework(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="e.g. WebdriverIO"
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label>Language</Label>
                <Input
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="e.g. JavaScript"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Default test type</Label>
            <Select
              value={testType}
              onValueChange={(v) => {
                setTestType(v as TestType);
                setSaved(false);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ui">UI test (from the recorded DOM flow)</SelectItem>
                <SelectItem value="backend">Back-end test (from captured API traffic)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Button disabled={busy || !canSave} onClick={() => void onSave()}>
              {busy ? 'Saving…' : 'Save default'}
            </Button>
            {saved && <span className="text-muted-foreground text-sm">Saved ✓</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
