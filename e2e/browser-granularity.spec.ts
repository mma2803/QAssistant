import { expect, test } from '@playwright/test';
import { authenticate, ids, installMockApi, projects, session } from './fixtures';

test('unauthenticated deep links remain behind the login gate', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/users');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page).toHaveURL(/\/users$/);
});

test('cancelling forced password change signs the user out', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, { mustChangePassword: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('unknown authenticated routes redirect to recordings', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page);
  await page.goto('/not-a-route');
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible();
});

test('admin shell exposes all role-scoped navigation links', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page);
  await page.goto('/sessions');
  for (const link of ['Recordings', 'Project context', 'Productivity', 'Users']) {
    await expect(page.getByRole('link', { name: link })).toBeVisible();
  }
});

test('recordings page renders an empty state', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, {
    handleRequest: async (route, request) => {
      if (request.method === 'GET' && request.pathname === '/api/v1/dashboard/sessions') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null }) });
        return true;
      }
      return false;
    },
  });
  await page.goto('/sessions');
  await expect(page.getByText('No recordings yet.')).toBeVisible();
});

test('recordings page surfaces API errors', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, {
    handleRequest: async (route, request) => {
      if (request.pathname === '/api/v1/dashboard/sessions') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'Recordings unavailable' } }) });
        return true;
      }
      return false;
    },
  });
  await page.goto('/sessions');
  await expect(page.getByText('Recordings unavailable')).toBeVisible();
});

test('recordings page displays pagination availability', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page);
  await page.goto('/sessions');
  await expect(page.getByText('More results available')).toBeVisible();
});

test('cancelling recording deletion sends no DELETE request', async ({ page }) => {
  const deletes: string[] = [];
  await authenticate(page);
  await installMockApi(page, { onRequest: ({ method, pathname }) => method === 'DELETE' && deletes.push(pathname) });
  await page.goto('/sessions');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete' }).click();
  expect(deletes).toEqual([]);
});

test('project context renders no-project state', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, {
    handleRequest: async (route, request) => {
      if (request.pathname === '/api/v1/projects') {
        await route.fulfill({ contentType: 'application/json', body: '[]' });
        return true;
      }
      return false;
    },
  });
  await page.goto('/projects');
  await expect(page.getByText('No active projects.')).toBeVisible();
});

test('project context surfaces project loading errors', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, {
    handleRequest: async (route, request) => {
      if (request.pathname === '/api/v1/projects') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unknown', message: 'Project load failed' } }) });
        return true;
      }
      return false;
    },
  });
  await page.goto('/projects');
  await expect(page.getByText('Project load failed')).toBeVisible();
});

test('metrics page independently surfaces both endpoint failures', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, {
    handleRequest: async (route, request) => {
      if (request.pathname === '/api/v1/dashboard/metrics' || request.pathname === '/api/v1/dashboard/ranking') {
        const message = request.pathname.endsWith('metrics') ? 'Metrics failed' : 'Ranking failed';
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unknown', message } }) });
        return true;
      }
      return false;
    },
  });
  await page.goto('/metrics');
  await expect(page.getByText('Metrics failed')).toBeVisible();
  await expect(page.getByText('Ranking failed')).toBeVisible();
});

test('recording detail surfaces a not-found response', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, {
    handleRequest: async (route, request) => {
      if (request.pathname === `/api/v1/dashboard/sessions/${ids.session}`) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'Recording not found' } }) });
        return true;
      }
      return false;
    },
  });
  await page.goto(`/sessions/${ids.session}`);
  await expect(page.getByText('Recording not found')).toBeVisible();
});

test('recording detail renders empty summary, flags, and generations', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, {
    handleRequest: async (route, request) => {
      if (request.pathname === `/api/v1/dashboard/sessions/${ids.session}`) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ session: { ...session, summary: null }, projectName: 'Checkout', recordedByEmail: 'qa@example.test', durationSeconds: 300, artifacts: [], flags: [], generations: [], comments: [] }),
        });
        return true;
      }
      return false;
    },
  });
  await page.goto(`/sessions/${ids.session}`);
  await expect(page.getByText('No summary yet')).toBeVisible();
  await expect(page.getByText('No flagged selectors.')).toBeVisible();
  await expect(page.getByText('No generations yet.')).toBeVisible();
});

test('recording detail reports truncated replay streams', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, {
    handleRequest: async (route, request) => {
      if (request.pathname.endsWith('/replay')) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ events: [], chunkCount: 2000, truncated: true }) });
        return true;
      }
      return false;
    },
  });
  await page.goto(`/sessions/${ids.session}`);
  await expect(page.getByText(/Showing the first part of a long recording/)).toBeVisible();
});

test('comment action remains disabled for whitespace-only input', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page);
  await page.goto(`/sessions/${ids.session}`);
  const add = page.getByRole('button', { name: 'Add comment' });
  await expect(add).toBeDisabled();
  await page.getByLabel('Comment to steer the next generation').fill('   ');
  await expect(add).toBeDisabled();
});

test('user creation stays disabled until inputs are valid', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page);
  await page.goto('/users');
  const create = page.getByRole('button', { name: 'Create' });
  await expect(create).toBeDisabled();
  await page.getByLabel('Email').fill('new@example.test');
  await page.getByLabel('Initial password').fill('short');
  await expect(create).toBeDisabled();
  await page.getByLabel('Initial password').fill('long-enough-password');
  await expect(create).toBeEnabled();
});

test('user creation surfaces backend conflicts', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, {
    handleRequest: async (route, request) => {
      if (request.method === 'POST' && request.pathname === '/api/v1/users') {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'conflict', message: 'User already exists' } }) });
        return true;
      }
      return false;
    },
  });
  await page.goto('/users');
  await page.getByLabel('Email').fill('qa@example.test');
  await page.getByLabel('Initial password').fill('long-enough-password');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('User already exists')).toBeVisible();
});

test('disabled users expose an Enable action', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, {
    handleRequest: async (route, request) => {
      if (request.method === 'GET' && request.pathname === '/api/v1/users') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: ids.qa, tenantId: ids.tenant, email: 'disabled@example.test', role: 'qa-engineer', status: 'disabled', mustChangePassword: false, createdAt: '2026-06-14T10:00:00.000Z', updatedAt: '2026-06-14T10:00:00.000Z' }]) });
        return true;
      }
      return false;
    },
  });
  await page.goto('/users');
  await expect(page.getByRole('button', { name: 'Enable' })).toBeVisible();
});

test('navigation links switch dashboard screens without reload', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page);
  await page.goto('/sessions');
  await page.getByRole('link', { name: 'Project context' }).click();
  await expect(page.getByRole('heading', { name: 'Project context' })).toBeVisible();
  await page.getByRole('link', { name: 'Productivity' }).click();
  await expect(page.getByRole('heading', { name: 'Productivity' })).toBeVisible();
});

test('project selection changes displayed base URL and screenshot default', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page);
  await page.goto('/projects');
  await page.getByLabel('Project').selectOption(ids.project2);
  await expect(page.getByText(projects[1]!.baseUrl)).toBeVisible();
  await expect(page.getByText('off', { exact: true })).toBeVisible();
});

test('recordings omit empty filters from the initial request', async ({ page }) => {
  const searches: string[] = [];
  await authenticate(page);
  await installMockApi(page, {
    onRequest: ({ pathname, search }) => {
      if (pathname === '/api/v1/dashboard/sessions') searches.push(search);
    },
  });
  await page.goto('/sessions');
  await expect.poll(() => searches.length).toBeGreaterThan(0);
  expect(searches[0]).not.toContain('projectId=');
  expect(searches[0]).not.toContain('status=');
});

test('qa engineers are redirected away from the productivity deep link', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, { role: 'qa-engineer' });
  await page.goto('/metrics');
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible();
});

test('qa engineers are redirected away from the users deep link', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, { role: 'qa-engineer' });
  await page.goto('/users');
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByText('Showing only the recordings you captured.')).toBeVisible();
});

test('recording detail surfaces replay loading failures independently', async ({ page }) => {
  await authenticate(page);
  await installMockApi(page, {
    handleRequest: async (route, request) => {
      if (request.pathname.endsWith('/replay')) {
        await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'bad_gateway', message: 'Replay unavailable' } }) });
        return true;
      }
      return false;
    },
  });
  await page.goto(`/sessions/${ids.session}`);
  await expect(page.getByText('Replay unavailable')).toBeVisible();
  await expect(page.getByText('The tester completed checkout and observed the confirmation.')).toBeVisible();
});

test('cancelling a password reset sends no reset request', async ({ page }) => {
  const resets: string[] = [];
  await authenticate(page);
  await installMockApi(page, {
    onRequest: ({ method, pathname }) => {
      if (method === 'POST' && pathname.endsWith('/reset-password')) resets.push(pathname);
    },
  });
  await page.goto('/users');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect.poll(() => resets.length).toBe(0);
});
