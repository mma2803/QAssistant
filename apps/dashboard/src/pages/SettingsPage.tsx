import { useEffect, useState } from 'react';
import { TEST_FRAMEWORK_PRESETS } from '@qassistant/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';

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
  // Whether the user explicitly picked "Custom". Kept as state (not derived from
  // the values) so selecting Custom sticks even when the current values still
  // happen to match a preset — otherwise the dropdown snaps back to the preset.
  const [customMode, setCustomMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seed the form from the loaded default once it arrives. If that default
  // doesn't match any preset, start in Custom mode so the fields are editable.
  useEffect(() => {
    if (settings.data) {
      setFramework(settings.data.defaultTestFramework);
      setLanguage(settings.data.defaultTestLanguage);
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
  // Show "Custom" when explicitly chosen OR when the values match no preset.
  const choice = customMode || presetIndex < 0 ? 'custom' : String(presetIndex);

  function onChoose(value: string): void {
    setSaved(false);
    if (value === 'custom') {
      setCustomMode(true); // reveal the free-form fields and keep them
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
      });
      setFramework(updated.defaultTestFramework);
      setLanguage(updated.defaultTestLanguage);
      settings.reload();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save tenant settings');
    } finally {
      setBusy(false);
    }
  }

  if (settings.loading) return <div className="muted">Loading settings...</div>;
  if (settings.error) return <div className="error">{settings.error}</div>;

  const canSave = framework.trim().length > 0 && language.trim().length > 0;

  return (
    <div className="col">
      <h1 style={{ margin: 0 }}>Settings</h1>

      <div className="card col" style={{ gap: 12, maxWidth: 520 }}>
        <h3 style={{ margin: 0 }}>Default test framework</h3>
        <p className="muted" style={{ margin: 0 }}>
          The default used when generating a test, unless overridden per generation.
          Any team member can change it; it applies tenant-wide.
        </p>

        {error && <div className="error">{error}</div>}

        <label className="col" style={{ gap: 4 }}>
          <span className="muted">Framework / language</span>
          <select value={choice} onChange={(e) => onChoose(e.target.value)}>
            {TEST_FRAMEWORK_PRESETS.map((p, i) => (
              <option key={`${p.framework}-${p.language}`} value={String(i)}>
                {p.framework} / {p.language}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </label>

        {choice === 'custom' && (
          <div className="row" style={{ gap: 8 }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="muted">Framework</span>
              <input
                value={framework}
                onChange={(e) => {
                  setFramework(e.target.value);
                  setSaved(false);
                }}
                placeholder="e.g. WebdriverIO"
              />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="muted">Language</span>
              <input
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  setSaved(false);
                }}
                placeholder="e.g. JavaScript"
              />
            </label>
          </div>
        )}

        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <button className="primary" disabled={busy || !canSave} onClick={() => void onSave()}>
            {busy ? 'Saving...' : 'Save default'}
          </button>
          {saved && <span className="muted">Saved ✓</span>}
        </div>
      </div>
    </div>
  );
}
