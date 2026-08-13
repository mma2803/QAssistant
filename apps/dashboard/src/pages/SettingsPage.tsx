import { useEffect, useState } from 'react';
import type { TestType } from '@qassistant/shared';
import { TEST_FRAMEWORK_PRESETS } from '@qassistant/shared';

import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
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
  const { t } = useI18n();
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
      setError(err instanceof Error ? err.message : t('settings.saveError'));
    } finally {
      setBusy(false);
    }
  }

  if (settings.loading) return <p className="text-muted-foreground text-sm">{t('settings.loading')}</p>;
  if (settings.error) return <p className="text-destructive text-sm">{settings.error}</p>;

  const canSave = framework.trim().length > 0 && language.trim().length > 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.title')} />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t('settings.frameworkCardTitle')}</CardTitle>
          <CardDescription>{t('settings.frameworkCardDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="space-y-2">
            <Label>{t('settings.frameworkLanguageLabel')}</Label>
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
                <SelectItem value={CUSTOM}>{t('settings.customOption')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {choice === CUSTOM && (
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 space-y-2">
                <Label>{t('settings.frameworkLabel')}</Label>
                <Input
                  value={framework}
                  onChange={(e) => {
                    setFramework(e.target.value);
                    setSaved(false);
                  }}
                  placeholder={t('settings.frameworkPlaceholder')}
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label>{t('settings.languageLabel')}</Label>
                <Input
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value);
                    setSaved(false);
                  }}
                  placeholder={t('settings.languagePlaceholder')}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>{t('settings.testTypeLabel')}</Label>
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
                <SelectItem value="ui">{t('settings.testTypeUi')}</SelectItem>
                <SelectItem value="backend">{t('settings.testTypeBackend')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Button disabled={busy || !canSave} onClick={() => void onSave()}>
              {busy ? t('common.saving') : t('settings.saveDefault')}
            </Button>
            {saved && <span className="text-muted-foreground text-sm">{t('settings.saved')}</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
