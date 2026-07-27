import type { Project, Session } from '@qassistant/shared';
import { startSessionRequestSchema } from '@qassistant/shared';
import type { AuthState, ActiveSessionState } from '../shared/messages.js';
import { config } from '../shared/config.js';
import { call } from './client.js';

/**
 * Popup UI (tasks 3.2 + session-start + 3.6 override + stop). It is a thin
 * state machine that renders one of: sign-in, forced password change, the
 * session-start form, or the active-recording view. All work happens in the
 * service worker; this only issues commands and surfaces server errors verbatim
 * (the work-context gate, Jira validation, and must_change_password are all
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
    renderMessage('Super-admins cannot record sessions. Sign in as an admin or qa-engineer.');
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
  const email = el('input', { type: 'email', placeholder: 'you@company.com', autocomplete: 'username' });
  const password = el('input', {
    type: 'password',
    placeholder: 'Password',
    autocomplete: 'current-password',
  });
  const tenant = el('input', {
    type: 'text',
    placeholder: 'tenant slug (blank for super-admin)',
    value: prefillTenant ?? config.tenantSlug,
  });
  const submit = el('button', { textContent: 'Sign in' });

  const form = el('form', {}, [
    el('label', {}, ['Email', email]),
    el('label', {}, ['Password', password]),
    el('label', {}, ['Tenant', tenant]),
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
    showError('Enter your email and password');
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
  const next = el('input', { type: 'password', placeholder: 'New password (min 8 chars)' });
  const confirm = el('input', { type: 'password', placeholder: 'Confirm new password' });
  const submit = el('button', { textContent: 'Set new password' });
  const signOut = el('button', { className: 'secondary', textContent: 'Sign out', type: 'button' });

  view.append(
    el('p', { className: 'hint', textContent: 'You must set a new password before recording.' }),
    el('label', {}, ['New password', next]),
    el('label', {}, ['Confirm', confirm]),
    submit,
    signOut,
  );

  submit.addEventListener('click', () => {
    showError(null);
    if (next.value.length < 8) {
      showError('Password must be at least 8 characters');
      return;
    }
    if (next.value !== confirm.value) {
      showError('Passwords do not match');
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
    renderMessage('Could not load projects.', true);
    return;
  }
  const projects = projectsRes.data.filter((p) => p.status === 'active');
  if (projects.length === 0) {
    renderMessage('No active projects available for your tenant.', true);
    return;
  }

  const projectSelect = el('select') as HTMLSelectElement;
  for (const p of projects) {
    projectSelect.append(el('option', { value: p.id, textContent: p.name }));
  }

  const jira = el('input', { type: 'text', placeholder: 'PROJ-123 (optional)' });
  const description = el('textarea', { placeholder: 'What are you testing? (used if no Jira ID)' });

  const screenshot = el('input', { type: 'checkbox' }) as HTMLInputElement;
  const screenshotLabel = el('label', { className: 'checkbox' }, [screenshot, ' Capture screenshots']);

  const syncScreenshotDefault = () => {
    const p = projects.find((x) => x.id === projectSelect.value);
    screenshot.checked = p?.screenshotDefault ?? false;
  };
  syncScreenshotDefault();
  projectSelect.addEventListener('change', syncScreenshotDefault);

  const start = el('button', { textContent: 'Start recording' });
  const signOut = el('button', { className: 'secondary', textContent: 'Sign out', type: 'button' });

  view.append(
    el('label', {}, ['Project', projectSelect]),
    el('label', {}, ['Jira ID', jira]),
    el('label', {}, ['Description', description]),
    screenshotLabel,
    el('p', {
      className: 'hint',
      textContent:
        'Provide a Jira ID (validated live) or a description. Screenshots default to the project setting; override per session here.',
    }),
    start,
    signOut,
  );

  start.addEventListener('click', () => {
    showError(null);
    const jiraId = jira.value.trim() || undefined;
    const desc = description.value.trim() || undefined;
    // Local pre-check mirrors the schema for fast feedback; the server is the
    // authority (work-context gate + Jira validation).
    const parsed = startSessionRequestSchema.safeParse({
      projectId: projectSelect.value,
      jiraId,
      description: desc,
      screenshotEnabled: screenshot.checked,
    });
    if (!parsed.success) {
      showError('Enter a Jira ID or a non-empty description');
      return;
    }
    void (async () => {
      start.disabled = true;
      start.textContent = 'Starting...';
      const res = await call<Session>({
        type: 'session:start',
        projectId: projectSelect.value,
        jiraId,
        description: desc,
        screenshotEnabled: screenshot.checked,
      });
      start.disabled = false;
      start.textContent = 'Start recording';
      if (!res.ok) {
        // Surface server gate/Jira errors verbatim (e.g. jira_validation_failed).
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
  const ctx = state.session.jiraId
    ? `Jira ${state.session.jiraId}`
    : (state.session.description ?? state.project.name);

  const stop = el('button', { className: 'danger', textContent: 'Stop recording' });

  view.append(
    el('div', { className: 'recording' }, [el('span', { className: 'dot' }), 'Recording']),
    el('p', { className: 'hint', textContent: `Project: ${state.project.name}` }),
    el('p', { className: 'hint', textContent: `Context: ${ctx}` }),
    el('p', {
      className: 'hint',
      textContent: `Screenshots: ${state.screenshotEnabled ? 'on' : 'off'} · Flag hotkey: Alt+Shift+F`,
    }),
    el('div', { className: 'stats' }, [
      stat(state.domChunksUploaded, 'DOM chunks'),
      stat(state.screenshotsUploaded, 'Shots'),
      stat(state.flagsRecorded, 'Flags'),
    ]),
    stop,
  );

  stop.addEventListener('click', () => {
    void (async () => {
      stop.disabled = true;
      stop.textContent = 'Stopping...';
      const res = await call<Session | null>({ type: 'session:stop' });
      if (!res.ok) {
        showError(res.error.message);
        stop.disabled = false;
        stop.textContent = 'Stop recording';
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
    const signOut = el('button', { className: 'secondary', textContent: 'Sign out' });
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
