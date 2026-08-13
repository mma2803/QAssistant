import type { Project, Session } from '@qassistant/shared';
import { passwordSchema, startSessionRequestSchema } from '@qassistant/shared';
import type { AuthState, ActiveSessionState } from '../shared/messages.js';
import { config } from '../shared/config.js';
import { t } from '../shared/i18n.js';
import { call } from './client.js';

/**
 * Popup UI (tasks 3.2 + session-start + 3.6 override + stop). It is a thin
 * state machine that renders one of: sign-in, forced password change, the
 * session-start form, or the active-recording view. All work happens in the
 * service worker; this only issues commands and surfaces server errors verbatim
 * (the work-context gate and must_change_password are all
 * enforced server-side, per the spec).
 */

const view = document.getElementById('view') as HTMLElement;
const who = document.getElementById('who') as HTMLElement;
const errorBox = document.getElementById('error') as HTMLElement;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function showError(message: string | null): void {
  if (!message) {
    errorBox.hidden = true;
    errorBox.textContent = '';
    return;
  }
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function clear(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  view.replaceChildren();
  showError(null);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

/* ---------- top-level render ---------- */

async function render(): Promise<void> {
  const res = await call<AuthState>({ type: 'auth:getState' });
  if (!res.ok) {
    renderSignIn(null);
    return;
  }
  const auth = res.data;
  who.textContent = auth.signedIn && auth.email ? auth.email : '';

  if (!auth.signedIn) {
    renderSignIn(null);
    return;
  }
  if (auth.role === 'super-admin') {
    renderMessage(t('msg.superAdmin'));
    return;
  }
  if (auth.mustChangePassword) {
    renderPasswordChange();
    return;
  }

  const active = await call<ActiveSessionState | null>({ type: 'session:getActive' });
  if (active.ok && active.data) {
    renderActive(active.data);
    return;
  }
  await renderStart();
}

/* ---------- sign-in (3.2) ---------- */

function renderSignIn(prefillTenant: string | null): void {
  clear();
  who.textContent = '';
  const email = el('input', { type: 'email', placeholder: t('signin.email.placeholder'), autocomplete: 'username' });
  const password = el('input', {
    type: 'password',
    placeholder: t('signin.password.placeholder'),
    autocomplete: 'current-password',
  });
  const tenant = el('input', {
    type: 'text',
    placeholder: t('signin.tenant.placeholder'),
    value: prefillTenant ?? config.tenantSlug,
  });
  const submit = el('button', { textContent: t('signin.submit') });

  const form = el('form', {}, [
    el('label', {}, [t('signin.email.label'), email]),
    el('label', {}, [t('signin.password.label'), password]),
    el('label', {}, [t('signin.tenant.label'), tenant]),
    submit,
  ]);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void doSignIn(email.value.trim(), password.value, tenant.value.trim(), submit);
  });
  view.append(form);
}

async function doSignIn(
  email: string,
  password: string,
  tenantSlug: string,
  submit: HTMLButtonElement,
): Promise<void> {
  showError(null);
  if (!email || !password) {
    showError(t('signin.error.missing'));
    return;
  }
  submit.disabled = true;
  const res = await call<AuthState>({
    type: 'auth:signIn',
    email,
    password,
    tenantSlug: tenantSlug || undefined,
  });
  submit.disabled = false;
  if (!res.ok) {
    showError(res.error.message);
    return;
  }
  await render();
}

/* ---------- forced password change (3.2) ---------- */

function renderPasswordChange(): void {
  clear();
  const next = el('input', { type: 'password', placeholder: t('password.new.placeholder') });
  const confirm = el('input', { type: 'password', placeholder: t('password.confirm.placeholder') });
  const submit = el('button', { textContent: t('password.submit') });
  const signOut = el('button', { className: 'secondary', textContent: t('common.signOut'), type: 'button' });

  view.append(
    el('p', { className: 'hint', textContent: t('password.hint') }),
    el('label', {}, [t('password.new.label'), next]),
    el('label', {}, [t('password.confirm.label'), confirm]),
    submit,
    signOut,
  );

  submit.addEventListener('click', () => {
    showError(null);
    if (!passwordSchema.safeParse(next.value).success) {
      showError(t('password.requirements'));
      return;
    }
    if (next.value !== confirm.value) {
      showError(t('password.mismatch'));
      return;
    }
    void (async () => {
      submit.disabled = true;
      const res = await call<AuthState>({
        type: 'auth:completePasswordChange',
        newPassword: next.value,
      });
      submit.disabled = false;
      if (!res.ok) {
        showError(res.error.message);
        return;
      }
      await render();
    })();
  });
  signOut.addEventListener('click', () => void doSignOut());
}

/* ---------- session start (gate is server-side) ---------- */

async function renderStart(): Promise<void> {
  clear();
  const projectsRes = await call<Project[]>({ type: 'projects:list' });
  if (!projectsRes.ok) {
    showError(projectsRes.error.message);
    renderMessage(t('start.loadFailed'), true);
    return;
  }
  const projects = projectsRes.data.filter((p) => p.status === 'active');
  if (projects.length === 0) {
    renderMessage(t('start.noProjects'), true);
    return;
  }

  const projectSelect = el('select') as HTMLSelectElement;
  for (const p of projects) {
    projectSelect.append(el('option', { value: p.id, textContent: p.name }));
  }

  const description = el('textarea', { placeholder: t('start.description.placeholder') });

  const screenshot = el('input', { type: 'checkbox' }) as HTMLInputElement;
  const screenshotLabel = el('label', { className: 'checkbox' }, [screenshot, ` ${t('start.screenshot.label')}`]);

  const syncScreenshotDefault = () => {
    const p = projects.find((x) => x.id === projectSelect.value);
    screenshot.checked = p?.screenshotDefault ?? false;
  };
  syncScreenshotDefault();
  projectSelect.addEventListener('change', syncScreenshotDefault);

  const start = el('button', { textContent: t('start.submit') });
  const signOut = el('button', { className: 'secondary', textContent: t('common.signOut'), type: 'button' });

  view.append(
    el('label', {}, [t('start.project.label'), projectSelect]),
    el('label', {}, [t('start.description.label'), description]),
    screenshotLabel,
    el('p', {
      className: 'hint',
      textContent: t('start.hint'),
    }),
    start,
    signOut,
  );

  start.addEventListener('click', () => {
    showError(null);
    const desc = description.value.trim() || undefined;
    // Local pre-check mirrors the schema for fast feedback; the server is the
    // authority (work-context gate). A non-empty description is required.
    const parsed = startSessionRequestSchema.safeParse({
      projectId: projectSelect.value,
      description: desc,
      screenshotEnabled: screenshot.checked,
    });
    if (!parsed.success) {
      showError(t('start.error.context'));
      return;
    }
    void (async () => {
      start.disabled = true;
      start.textContent = t('start.starting');
      const res = await call<Session>({
        type: 'session:start',
        projectId: projectSelect.value,
        description: desc,
        screenshotEnabled: screenshot.checked,
      });
      start.disabled = false;
      start.textContent = t('start.submit');
      if (!res.ok) {
        // Surface server gate errors verbatim.
        showError(res.error.message);
        return;
      }
      await render();
    })();
  });
  signOut.addEventListener('click', () => void doSignOut());
}

/* ---------- active recording view + stop ---------- */

function renderActive(state: ActiveSessionState): void {
  clear();
  const ctx = state.session.description ?? state.project.name;

  const stop = el('button', { className: 'danger', textContent: t('active.stop') });

  view.append(
    el('div', { className: 'recording' }, [el('span', { className: 'dot' }), t('active.recording')]),
    el('p', { className: 'hint', textContent: t('active.project', { name: state.project.name }) }),
    el('p', { className: 'hint', textContent: t('active.context', { context: ctx }) }),
    el('p', {
      className: 'hint',
      textContent: t('active.screenshots', {
        state: state.screenshotEnabled ? t('active.screenshots.on') : t('active.screenshots.off'),
      }),
    }),
    el('div', { className: 'stats' }, [
      stat(state.domChunksUploaded, t('active.stat.domChunks')),
      stat(state.screenshotsUploaded, t('active.stat.shots')),
      stat(state.flagsRecorded, t('active.stat.flags')),
    ]),
    stop,
  );

  stop.addEventListener('click', () => {
    void (async () => {
      stop.disabled = true;
      stop.textContent = t('active.stopping');
      const res = await call<Session | null>({ type: 'session:stop' });
      if (!res.ok) {
        showError(res.error.message);
        stop.disabled = false;
        stop.textContent = t('active.stop');
        return;
      }
      await render();
    })();
  });

  // Live-refresh the counters while the popup is open.
  refreshTimer = setInterval(() => {
    void (async () => {
      const a = await call<ActiveSessionState | null>({ type: 'session:getActive' });
      if (a.ok && a.data) {
        renderActive(a.data);
      } else {
        await render();
      }
    })();
  }, 2000);
}

function stat(num: number, label: string): HTMLElement {
  return el('div', { className: 'stat' }, [
    el('div', { className: 'num', textContent: String(num) }),
    el('div', { className: 'lbl', textContent: label }),
  ]);
}

/* ---------- shared ---------- */

function renderMessage(message: string, withSignOut = false): void {
  clear();
  view.append(el('p', { className: 'hint', textContent: message }));
  if (withSignOut) {
    const signOut = el('button', { className: 'secondary', textContent: t('common.signOut') });
    signOut.addEventListener('click', () => void doSignOut());
    view.append(signOut);
  }
}

async function doSignOut(): Promise<void> {
  await call({ type: 'auth:signOut' });
  await render();
}

void render();

window.addEventListener('unload', () => {
  if (refreshTimer) clearInterval(refreshTimer);
}, { once: true });
