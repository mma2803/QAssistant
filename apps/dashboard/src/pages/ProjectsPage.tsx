import { useEffect, useState } from 'react';
import type { Project } from '@qassistant/shared';
import { TEST_FRAMEWORK_PRESETS } from '@qassistant/shared';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useAsync } from '../lib/useAsync';
import { renderMarkdown } from '../lib/markdown';

/**
 * Per-project context section (spec 5.5). Lists the tenant's active projects and
 * renders the selected project's knowledge-hub markdown overview. Reads are
 * available to both roles (the backend opens project reads to any tenant user);
 * project creation is admin-only (contract 4.3), so the create form is gated to
 * admins here (the backend role guard is the authoritative control).
 */
export function ProjectsPage(): JSX.Element {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const projects = useAsync<Project[]>(() => api.listProjects(), []);
  const [selected, setSelected] = useState<string>('');

  // create form (admin only)
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

  // per-project test framework (any tenant user). '' = inherit tenant default,
  // '0'..'N' = a preset, 'custom' = the free-form fields.
  const [fwChoice, setFwChoice] = useState('');
  const [fwCustomName, setFwCustomName] = useState('');
  const [fwCustomLang, setFwCustomLang] = useState('');
  const [fwError, setFwError] = useState<string | null>(null);
  const [fwBusy, setFwBusy] = useState(false);
  const [fwSaved, setFwSaved] = useState(false);

  const current = (projects.data ?? []).find((p) => p.id === selected) ?? projects.data?.[0] ?? null;

  // Load the selected project's overview into the editor when the project changes.
  useEffect(() => {
    setKm(current?.knowledgeMd ?? '');
    setKmError(null);
    setKmSaved(false);
  }, [current?.id]);

  // Seed the framework selector from the selected project: null -> inherit,
  // a preset match -> that preset, otherwise -> custom with the stored values.
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
    setFwChoice(idx >= 0 ? String(idx) : 'custom');
    setFwCustomName(fw);
    setFwCustomLang(lang);
  }, [current?.id]);

  async function onSaveFramework(): Promise<void> {
    if (!current) return;
    setFwError(null);
    setFwBusy(true);
    setFwSaved(false);
    try {
      let body: { defaultTestFramework: string | null; defaultTestLanguage: string | null };
      if (fwChoice === '') {
        body = { defaultTestFramework: null, defaultTestLanguage: null };
      } else if (fwChoice === 'custom') {
        body = {
          defaultTestFramework: fwCustomName.trim(),
          defaultTestLanguage: fwCustomLang.trim(),
        };
      } else {
        const preset = TEST_FRAMEWORK_PRESETS[Number(fwChoice)]!;
        body = { defaultTestFramework: preset.framework, defaultTestLanguage: preset.language };
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

  const fwCustomIncomplete =
    fwChoice === 'custom' && !(fwCustomName.trim() && fwCustomLang.trim());

  async function onSaveKnowledge(): Promise<void> {
    if (!current) return;
    setKmError(null);
    setKmBusy(true);
    setKmSaved(false);
    try {
      await api.setKnowledge(current.id, {
        knowledgeMd: km.trim() ? km : null,
        // Preserve the existing credentials reference; this editor only edits the overview.
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
      projects.reload();
      setSelected(created.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create project');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col">
      <h1 style={{ margin: 0 }}>Project context</h1>

      {isAdmin && (
        <div className="card col">
          <h3 style={{ margin: 0 }}>New project</h3>
          {createError && <div className="error">{createError}</div>}
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
            <label className="col" style={{ gap: 4, minWidth: 220 }}>
              <span className="muted">Name</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="col" style={{ gap: 4, minWidth: 260 }}>
              <span className="muted">Base URL</span>
              <input
                type="url"
                placeholder="https://app.example.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </label>
            <label className="row" style={{ gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={screenshotDefault}
                onChange={(e) => setScreenshotDefault(e.target.checked)}
              />
              <span className="muted">Screenshots by default</span>
            </label>
            <button
              className="primary"
              type="button"
              disabled={busy || !name.trim() || !baseUrl.trim()}
              onClick={() => void onCreate()}
            >
              {busy ? 'Creating...' : 'Create project'}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        {projects.loading && <div className="muted">Loading projects...</div>}
        {projects.error && <div className="error">{projects.error}</div>}
        {projects.data && projects.data.length === 0 && (
          <div className="muted">No active projects.</div>
        )}
        {projects.data && projects.data.length > 0 && (
          <label className="col" style={{ gap: 4, maxWidth: 360 }}>
            <span className="muted">Project</span>
            <select
              value={current?.id ?? ''}
              onChange={(e) => setSelected(e.target.value)}
            >
              {projects.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {current && (
        <div className="card col">
          <div className="row" style={{ flexWrap: 'wrap', gap: 24 }}>
            <div className="col" style={{ gap: 2 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Base URL
              </span>
              <span>{current.baseUrl}</span>
            </div>
            <div className="col" style={{ gap: 2 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Status
              </span>
              <span className={`badge ${current.status}`}>{current.status}</span>
            </div>
            <div className="col" style={{ gap: 2 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Screenshots default
              </span>
              <span>{current.screenshotDefault ? 'on' : 'off'}</span>
            </div>
          </div>

          <h3 style={{ marginBottom: 0 }}>Test framework</h3>
          {/* Per-project default codegen target. Open to any tenant user; falls
              back to the tenant default when set to "Inherit". */}
          <div className="col" style={{ gap: 8, maxWidth: 460 }}>
            {fwError && <div className="error">{fwError}</div>}
            <select
              value={fwChoice}
              onChange={(e) => {
                setFwChoice(e.target.value);
                setFwSaved(false);
              }}
            >
              <option value="">Inherit tenant default</option>
              {TEST_FRAMEWORK_PRESETS.map((p, i) => (
                <option key={`${p.framework}-${p.language}`} value={String(i)}>
                  {p.framework} / {p.language}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {fwChoice === 'custom' && (
              <div className="row" style={{ gap: 8 }}>
                <input
                  value={fwCustomName}
                  onChange={(e) => {
                    setFwCustomName(e.target.value);
                    setFwSaved(false);
                  }}
                  placeholder="Framework"
                  style={{ width: 160 }}
                />
                <input
                  value={fwCustomLang}
                  onChange={(e) => {
                    setFwCustomLang(e.target.value);
                    setFwSaved(false);
                  }}
                  placeholder="Language"
                  style={{ width: 160 }}
                />
              </div>
            )}
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <button
                className="primary"
                type="button"
                disabled={fwBusy || fwCustomIncomplete}
                onClick={() => void onSaveFramework()}
              >
                {fwBusy ? 'Saving...' : 'Save framework'}
              </button>
              {fwSaved && <span className="muted">Saved ✓</span>}
            </div>
          </div>

          <h3 style={{ marginBottom: 0 }}>Knowledge hub</h3>
          {isAdmin ? (
            // Admins edit the overview here (the backend role guard is the
            // authoritative control); the PUT endpoint is admin-only.
            <div className="col" style={{ gap: 8 }}>
              {kmError && <div className="error">{kmError}</div>}
              <textarea
                value={km}
                onChange={(e) => {
                  setKm(e.target.value);
                  setKmSaved(false);
                }}
                rows={10}
                placeholder="# How this app works&#10;&#10;Login, key flows, important selectors..."
                style={{ width: '100%', fontFamily: 'monospace', resize: 'vertical' }}
              />
              <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                <button
                  className="primary"
                  type="button"
                  disabled={kmBusy}
                  onClick={() => void onSaveKnowledge()}
                >
                  {kmBusy ? 'Saving...' : 'Save knowledge hub'}
                </button>
                {kmSaved && <span className="muted">Saved ✓</span>}
              </div>
              {km.trim() && (
                <div
                  className="knowledge"
                  // Markdown is escaped in renderMarkdown (no raw HTML passthrough).
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(km) }}
                />
              )}
            </div>
          ) : current.knowledgeMd ? (
            <div
              className="knowledge"
              // Markdown is escaped before rendering in renderMarkdown (no raw HTML
              // passthrough), so this is safe for admin-authored overviews.
              dangerouslySetInnerHTML={{ __html: renderMarkdown(current.knowledgeMd) }}
            />
          ) : (
            <div className="muted">No knowledge-hub overview has been written for this project.</div>
          )}
        </div>
      )}
    </div>
  );
}
