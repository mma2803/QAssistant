import type { Page, Route } from '@playwright/test';

export const ids = {
  tenant: '00000000-0000-4000-8000-000000000001',
  admin: '00000000-0000-4000-8000-000000000002',
  qa: '00000000-0000-4000-8000-000000000003',
  project: '00000000-0000-4000-8000-000000000004',
  project2: '00000000-0000-4000-8000-000000000005',
  session: '00000000-0000-4000-8000-000000000006',
  artifact: '00000000-0000-4000-8000-000000000007',
  domArtifact: '00000000-0000-4000-8000-000000000008',
  flag: '00000000-0000-4000-8000-000000000009',
  generation: '00000000-0000-4000-8000-000000000010',
  comment: '00000000-0000-4000-8000-000000000011',
  job: '00000000-0000-4000-8000-000000000012',
};

const now = new Date().toISOString();
// Recent so the Productivity time-window (which defaults to the last 7 days and
// is computed client-side against the real clock) includes the fixture session.
const recent = new Date(Date.now() - 5 * 60_000).toISOString();

export const projects = [
  {
    id: ids.project,
    tenantId: ids.tenant,
    name: 'Checkout',
    baseUrl: 'https://checkout.example.test',
    status: 'active',
    screenshotDefault: true,
    knowledgeMd: '# Checkout\n\nUse **data-testid** selectors.',
    defaultCredsSecretRef: null,
    maskingSelectors: ['input[type=password]'],
    inactivityTimeoutSeconds: 900,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: ids.project2,
    tenantId: ids.tenant,
    name: 'Billing',
    baseUrl: 'https://billing.example.test',
    status: 'active',
    screenshotDefault: false,
    knowledgeMd: null,
    defaultCredsSecretRef: null,
    maskingSelectors: [],
    inactivityTimeoutSeconds: 1200,
    createdAt: now,
    updatedAt: now,
  },
];

export const session = {
  id: ids.session,
  tenantId: ids.tenant,
  projectId: ids.project,
  recordedBy: ids.qa,
  jiraId: 'QA-42',
  jiraSummary: 'Checkout succeeds',
  jiraStatus: 'In Progress',
  description: 'Verify card checkout and the success message.',
  screenshotEnabled: true,
  status: 'completed',
  closeReason: 'manual',
  summary: 'The tester completed checkout and observed the confirmation.',
  startedAt: recent,
  endedAt: now,
  deletedAt: null,
  purgeAt: null,
  createdAt: recent,
  updatedAt: now,
};

export const generation = {
  id: ids.generation,
  tenantId: ids.tenant,
  projectId: ids.project,
  sessionId: ids.session,
  version: 1,
  kind: 'playwright_test',
  modelTier: 'pro',
  modelId: 'gemini-pro-test',
  code: "test('checkout', async ({ page }) => { await expect(page.getByText('Success')).toBeVisible(); });",
  reviewStatus: 'pending',
  approvedBy: null,
  approvedAt: null,
  integrationStatus: 'not_ready',
  integrationRef: null,
  integrationError: null,
  integratedBy: null,
  integratedAt: null,
  promptInputsSummary: { sources: [{ label: 'QA-42', kind: 'jira' }] },
  sourceCommentId: null,
  createdBy: ids.qa,
  createdAt: now,
  updatedAt: now,
};

export const users = [
  {
    id: ids.qa,
    tenantId: ids.tenant,
    email: 'qa@example.test',
    role: 'qa-engineer',
    status: 'active',
    mustChangePassword: false,
    createdAt: now,
    updatedAt: now,
  },
];

export type ApiRequest = { method: string; pathname: string; search: string; body?: unknown };

export interface MockApiOptions {
  role?: 'admin' | 'qa-engineer' | 'super-admin';
  mustChangePassword?: boolean;
  onRequest?: (request: ApiRequest) => void;
  handleRequest?: (route: Route, request: ApiRequest) => boolean | Promise<boolean>;
  /**
   * Optionally delay a mocked response by the returned number of milliseconds
   * before it is fulfilled. Return undefined (or a non-positive number) for
   * requests that should resolve immediately as usual. Useful for tests that
   * need to observe transient loading states.
   */
  delayMs?: (request: ApiRequest) => number | undefined;
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function uidFor(role: 'admin' | 'qa-engineer' | 'super-admin'): string {
  if (role === 'admin') return 'admin-uid';
  if (role === 'qa-engineer') return 'qa-uid';
  return 'super-admin-uid';
}

function emailFor(role: 'admin' | 'qa-engineer' | 'super-admin'): string {
  if (role === 'admin') return 'admin@example.test';
  if (role === 'qa-engineer') return 'qa@example.test';
  return 'super@example.test';
}

function me(role: 'admin' | 'qa-engineer' | 'super-admin', mustChangePassword: boolean) {
  if (role === 'super-admin') {
    return {
      uid: uidFor(role),
      email: emailFor(role),
      role,
      tenantId: null,
      mustChangePassword,
      tenant: null,
      projects: [],
    };
  }
  return {
    uid: uidFor(role),
    email: emailFor(role),
    role,
    tenantId: ids.tenant,
    mustChangePassword,
    tenant: { id: ids.tenant, name: 'Acme QA', status: 'active' },
  };
}

export const tenant = {
  id: ids.tenant,
  name: 'Acme QA',
  slug: 'acme-qa',
  status: 'active',
  defaultTestFramework: 'Playwright',
  defaultTestLanguage: 'TypeScript',
  defaultTestType: 'ui',
  createdAt: now,
  updatedAt: now,
};

export async function installMockApi(page: Page, options: MockApiOptions = {}): Promise<void> {
  const role = options.role ?? 'admin';
  let mustChangePassword = options.mustChangePassword ?? false;
  let currentUsers = structuredClone(users);
  let currentGeneration = structuredClone(generation);
  let currentTenants = structuredClone([tenant]);
  let currentInvitations: Array<{
    id: string;
    expiresAt: string;
    revokedAt: string | null;
    createdTenantCount: number;
    createdTenants: Array<{ tenantId: string; name: string; slug: string; adminEmail: string | null; createdAt: string }>;
    status: string;
    createdAt: string;
  }> = [];

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postDataJSON?.();
    const apiRequest = { method, pathname: url.pathname, search: url.search, body };
    options.onRequest?.(apiRequest);
    const delay = options.delayMs?.(apiRequest);
    if (typeof delay === 'number' && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (await options.handleRequest?.(route, apiRequest)) return;

    if (method === 'GET' && url.pathname === '/api/v1/auth/me') {
      return json(route, me(role, mustChangePassword));
    }
    if (method === 'POST' && url.pathname === '/api/v1/auth/login') {
      return json(
        route,
        {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          uid: uidFor(role),
          role,
          tenantId: role === 'super-admin' ? null : ids.tenant,
          mustChangePassword,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
        201,
      );
    }
    if (method === 'POST' && url.pathname === '/api/v1/auth/refresh') {
      return json(
        route,
        {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          uid: uidFor(role),
          role,
          tenantId: role === 'super-admin' ? null : ids.tenant,
          mustChangePassword,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
        201,
      );
    }
    if (method === 'POST' && url.pathname === '/api/v1/auth/logout') {
      return json(route, { ok: true }, 201);
    }
    if (method === 'POST' && url.pathname === '/api/v1/auth/complete-password-change') {
      mustChangePassword = false;
      return json(route, me(role, false));
    }
    if (method === 'GET' && url.pathname === '/api/v1/projects') return json(route, projects);
    if (method === 'GET' && url.pathname === `/api/v1/projects/${ids.project}`) {
      return json(route, projects[0]);
    }
    if (method === 'GET' && url.pathname === '/api/v1/dashboard/sessions') {
      // Terminate pagination on the second page (a cursor is present) so the
      // Productivity view's paginate-until-window loop stops; the first page
      // still advertises a nextCursor so the records list shows "Load more".
      if (url.searchParams.has('cursor')) {
        return json(route, { items: [], nextCursor: null });
      }
      return json(route, {
        items: [{ ...session, projectName: 'Checkout', recordedByEmail: 'qa@example.test', durationSeconds: 300, generatedTestCount: 1, testTypes: ['ui'], integrationStatus: null }],
        nextCursor: 'next-page',
      });
    }
    if (method === 'GET' && url.pathname === `/api/v1/dashboard/sessions/${ids.session}`) {
      return json(route, {
        session,
        projectName: 'Checkout',
        recordedByEmail: 'qa@example.test',
        durationSeconds: 300,
        artifacts: [
          { id: ids.domArtifact, tenantId: ids.tenant, projectId: ids.project, sessionId: ids.session, type: 'dom_chunk', seq: 0, gcsPath: 'dom.json', contentType: 'application/json', sizeBytes: 2, checksum: null, compression: 'none', capturedAt: now, createdAt: now, updatedAt: now },
          { id: ids.artifact, tenantId: ids.tenant, projectId: ids.project, sessionId: ids.session, type: 'screenshot', seq: 0, gcsPath: 'shot.png', contentType: 'image/png', sizeBytes: 68, checksum: null, compression: 'none', capturedAt: now, createdAt: now, updatedAt: now },
        ],
        flags: [{ id: ids.flag, tenantId: ids.tenant, projectId: ids.project, sessionId: ids.session, selector: '[data-testid=success]', note: 'Success state', eventOffsetMs: 4200, createdAt: now, updatedAt: now }],
        generations: [currentGeneration],
        comments: [{ id: ids.comment, tenantId: ids.tenant, projectId: ids.project, sessionId: ids.session, generatedTestId: ids.generation, body: 'Assert the receipt number.', createdBy: ids.qa, createdAt: now, updatedAt: now }],
      });
    }
    if (method === 'GET' && url.pathname === `/api/v1/dashboard/sessions/${ids.session}/replay`) {
      return json(route, { events: [], chunkCount: 1, truncated: false });
    }
    if (method === 'GET' && url.pathname === `/api/v1/dashboard/sessions/${ids.session}/artifacts/${ids.artifact}`) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
    }
    if (method === 'GET' && url.pathname === '/api/v1/dashboard/metrics') {
      return json(route, { metrics: [{ userId: ids.qa, email: 'qa@example.test', generatedTestCount: 4, totalRecordingSeconds: 7200, recordingCount: 3 }] });
    }
    if (method === 'GET' && url.pathname === '/api/v1/dashboard/ranking') {
      return json(route, { ranking: [{ userId: ids.qa, email: 'qa@example.test', generatedTestCount: 4, totalRecordingSeconds: 7200, recordingCount: 3 }] });
    }
    if (method === 'DELETE' && url.pathname === `/api/v1/sessions/${ids.session}`) {
      return json(route, { ...session, deletedAt: now, purgeAt: '2026-07-14T10:00:00.000Z' });
    }
    if (method === 'POST' && url.pathname === `/api/v1/sessions/${ids.session}/restore`) {
      return json(route, session);
    }
    if (method === 'GET' && url.pathname === `/api/v1/sessions/${ids.session}/export`) {
      return route.fulfill({ status: 200, contentType: 'application/zip', headers: { 'content-disposition': 'attachment; filename="session.zip"' }, body: 'zip-content' });
    }
    if (method === 'GET' && url.pathname === `/api/v1/sessions/${ids.session}/generations`) {
      return json(route, { items: [currentGeneration] });
    }
    if (method === 'POST' && url.pathname === `/api/v1/generations/${ids.generation}/approve`) {
      // Approval makes the version the session's ready_to_integrate candidate.
      currentGeneration = { ...currentGeneration, reviewStatus: 'approved', approvedBy: ids.admin, approvedAt: now, integrationStatus: 'ready_to_integrate' };
      return json(route, currentGeneration);
    }
    if (method === 'POST' && url.pathname === `/api/v1/generations/${ids.generation}/integrate`) {
      const ref = body && typeof body === 'object' && 'ref' in body ? (body as { ref?: string }).ref ?? null : null;
      currentGeneration = { ...currentGeneration, integrationStatus: 'integrated', integrationRef: ref, integratedBy: ids.admin, integratedAt: now };
      return json(route, currentGeneration);
    }
    if (method === 'POST' && url.pathname === `/api/v1/sessions/${ids.session}/comments`) {
      return json(route, { id: ids.comment, tenantId: ids.tenant, projectId: ids.project, sessionId: ids.session, generatedTestId: body && typeof body === 'object' && 'generatedTestId' in body ? body.generatedTestId : null, body: body && typeof body === 'object' && 'body' in body ? body.body : '', createdBy: ids.admin, createdAt: now, updatedAt: now }, 201);
    }
    if (method === 'POST' && (url.pathname === `/api/v1/sessions/${ids.session}/generate` || url.pathname === `/api/v1/sessions/${ids.session}/regenerate`)) {
      return json(route, { jobId: ids.job }, 202);
    }
    if (method === 'GET' && url.pathname === '/api/v1/users') return json(route, currentUsers);
    if (method === 'POST' && url.pathname === '/api/v1/users') {
      const created = { ...users[0], id: ids.admin, email: body && typeof body === 'object' && 'email' in body ? String(body.email) : 'new@example.test', role: body && typeof body === 'object' && 'role' in body ? body.role : 'qa-engineer', mustChangePassword: true };
      currentUsers = [...currentUsers, created];
      return json(route, created, 201);
    }
    const userMatch = url.pathname.match(/^\/api\/v1\/users\/([^/]+)$/);
    if (method === 'PATCH' && userMatch) {
      currentUsers = currentUsers.map((user) => user.id === userMatch[1] ? { ...user, ...(body as object) } : user);
      return json(route, currentUsers.find((user) => user.id === userMatch[1]));
    }
    const resetMatch = url.pathname.match(/^\/api\/v1\/users\/([^/]+)\/reset-password$/);
    if (method === 'POST' && resetMatch) {
      currentUsers = currentUsers.map((user) => user.id === resetMatch[1] ? { ...user, mustChangePassword: true } : user);
      return json(route, currentUsers.find((user) => user.id === resetMatch[1]));
    }

    if (method === 'GET' && url.pathname === '/api/v1/admin/tenants') return json(route, currentTenants);
    if (method === 'POST' && url.pathname === '/api/v1/admin/tenants') {
      const b = body as { name?: string; firstAdmin?: { email?: string } } | undefined;
      const newTenant = {
        ...tenant,
        id: `00000000-0000-4000-8000-${String(currentTenants.length + 1).padStart(12, '0')}`,
        name: b?.name ?? 'New tenant',
        slug: (b?.name ?? 'new-tenant').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        status: 'active',
      };
      currentTenants = [...currentTenants, newTenant];
      return json(
        route,
        {
          tenant: newTenant,
          firstAdmin: {
            id: 'new-admin-uid',
            tenantId: newTenant.id,
            email: b?.firstAdmin?.email ?? 'admin@example.test',
            role: 'admin',
            status: 'active',
            mustChangePassword: true,
            createdAt: now,
            updatedAt: now,
          },
        },
        201,
      );
    }
    // Signup links (tenant-signup-links). Declared before the `:tenantId` PATCH
    // match so the literal /invitations segment is never treated as a tenant id.
    if (method === 'GET' && url.pathname === '/api/v1/admin/tenants/invitations') {
      return json(route, currentInvitations);
    }
    if (method === 'POST' && url.pathname === '/api/v1/admin/tenants/invitations') {
      const b = body as { expiresInDays?: number } | undefined;
      const id = `10000000-0000-4000-8000-${String(currentInvitations.length + 1).padStart(12, '0')}`;
      const expiresAt = new Date(Date.now() + (b?.expiresInDays ?? 7) * 86_400_000).toISOString();
      currentInvitations = [
        ...currentInvitations,
        { id, expiresAt, revokedAt: null, createdTenantCount: 0, createdTenants: [], status: 'active', createdAt: now },
      ];
      return json(route, { id, token: `mock-token-${id}`, expiresAt }, 201);
    }
    const revokeMatch = url.pathname.match(/^\/api\/v1\/admin\/tenants\/invitations\/([^/]+)$/);
    if (method === 'DELETE' && revokeMatch) {
      currentInvitations = currentInvitations.map((i) =>
        i.id === revokeMatch[1] ? { ...i, status: 'revoked', revokedAt: now } : i,
      );
      return route.fulfill({ status: 204, body: '' });
    }

    // Public tenant self-signup (tenant-signup-links). A token containing
    // "invalid" is treated as unusable so the error state can be exercised.
    const validateMatch = url.pathname.match(/^\/api\/v1\/signup\/([^/]+)$/);
    if (method === 'GET' && validateMatch) {
      const valid = !validateMatch[1].includes('invalid');
      return json(route, {
        valid,
        expiresAt: valid ? new Date(Date.now() + 7 * 86_400_000).toISOString() : null,
      });
    }
    if (method === 'POST' && url.pathname === '/api/v1/signup') {
      const b = body as { name?: string; firstAdmin?: { email?: string } } | undefined;
      if (currentTenants.some((t) => t.name === b?.name)) {
        return json(route, { error: { code: 'conflict', message: 'A tenant with this name already exists' } }, 409);
      }
      const newTenant = {
        ...tenant,
        id: `20000000-0000-4000-8000-${String(currentTenants.length + 1).padStart(12, '0')}`,
        name: b?.name ?? 'New tenant',
        slug: (b?.name ?? 'new-tenant').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        status: 'active',
      };
      currentTenants = [...currentTenants, newTenant];
      return json(
        route,
        {
          tenant: newTenant,
          firstAdmin: {
            id: 'signup-admin-uid',
            tenantId: newTenant.id,
            email: b?.firstAdmin?.email ?? 'admin@example.test',
            role: 'admin',
            status: 'active',
            mustChangePassword: false,
            createdAt: now,
            updatedAt: now,
          },
        },
        201,
      );
    }

    const tenantMatch = url.pathname.match(/^\/api\/v1\/admin\/tenants\/([^/]+)$/);
    if (method === 'PATCH' && tenantMatch) {
      currentTenants = currentTenants.map((t) =>
        t.id === tenantMatch[1] ? { ...t, ...(body as object) } : t,
      );
      return json(route, currentTenants.find((t) => t.id === tenantMatch[1]));
    }
    if (method === 'DELETE' && tenantMatch) {
      // Soft-delete: the API hides it, so the mock just drops it from the list.
      currentTenants = currentTenants.filter((t) => t.id !== tenantMatch[1]);
      return route.fulfill({ status: 204, body: '' });
    }

    return json(route, { error: { code: 'not_mocked', message: `${method} ${url.pathname} is not mocked` } }, 501);
  });
}

export async function authenticate(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('qassistant:e2e-authenticated', 'true'));
}

/** Pick an option in a shadcn/Radix Select (a combobox trigger + listbox options). */
export async function chooseOption(
  page: Page,
  comboboxName: string | RegExp,
  optionName: string | RegExp,
): Promise<void> {
  await page.getByRole('combobox', { name: comboboxName }).click();
  await page.getByRole('option', { name: optionName }).click();
}

/** Open the sidebar-footer account menu and sign out. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
}
