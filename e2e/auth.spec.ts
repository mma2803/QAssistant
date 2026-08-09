import { expect, test, type Page } from '@playwright/test';
import { authenticate, installMockApi, signOut } from './fixtures';

/**
 * The dashboard dev server used by this suite always runs with
 * VITE_E2E_AUTH=true (see playwright.config.ts), which makes auth-client.ts's
 * signIn()/tryRestoreSession()/getAccessToken() short-circuit through a
 * localStorage marker and never call the real /auth/login or /auth/refresh
 * endpoints (that's what `authenticate()` above relies on). Testing the real
 * network-driven login-failure and dead-session flows therefore requires
 * defeating that bypass: this rewrites the served auth-client.ts module so
 * `isE2EAuthEnabled()` evaluates to false for this page only, restoring the
 * real fetch-based code paths without touching the dev server config or any
 * other test in this file.
 */
async function disableE2EAuthBypass(page: Page): Promise<void> {
  await page.route('**/src/lib/auth-client.ts', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: body.replace('"VITE_E2E_AUTH": "true"', '"VITE_E2E_AUTH": "false"') });
  });
}

test('signs in and signs out through the dashboard shell', async ({ page }) => {
  const requests: string[] = [];
  await installMockApi(page, { onRequest: ({ method, pathname }) => requests.push(`${method} ${pathname}`) });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password').fill('temporary-password');
  await page.getByLabel('Tenant').fill('tenant-acme');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Welcome back 👋' })).toBeVisible();
  await expect(page.getByText('Acme QA')).toBeVisible();
  expect(requests).toContain('GET /api/v1/auth/me');

  await signOut(page);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('enforces and completes the first-login password change', async ({ page }) => {
  const requests: Array<{ method: string; pathname: string; body?: unknown }> = [];
  await authenticate(page);
  await installMockApi(page, { mustChangePassword: true, onRequest: (request) => requests.push(request) });
  await page.goto('/projects');

  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await page.getByLabel('New password').fill('short');
  await page.getByLabel('Confirm password').fill('short');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();

  await page.getByLabel('New password').fill('new-password-123');
  await page.getByLabel('Confirm password').fill('different-password');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByText('Passwords do not match')).toBeVisible();

  await page.getByLabel('Confirm password').fill('new-password-123');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('heading', { name: 'Project context' })).toBeVisible();
  expect(requests).toContainEqual(expect.objectContaining({
    method: 'POST',
    pathname: '/api/v1/auth/complete-password-change',
    body: { newPassword: 'new-password-123' },
  }));
});

test('login failure shows an error banner', async ({ page }) => {
  await disableE2EAuthBypass(page);
  await installMockApi(page, {
    handleRequest: async (route, request) => {
      // No cookie has ever been set in this mock, so a real fresh load has no
      // session to restore; failing refresh here matches AuthRoutesService.refresh's
      // real "Missing refresh token" rejection and keeps us on the sign-in screen
      // instead of racing ahead into the dashboard.
      if (request.method === 'POST' && request.pathname === '/api/v1/auth/refresh') {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'unauthenticated', message: 'Missing refresh token' } }),
        });
        return true;
      }
      if (request.method === 'POST' && request.pathname === '/api/v1/auth/login') {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'unauthenticated', message: 'Invalid credentials' } }),
        });
        return true;
      }
      return false;
    },
  });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByLabel('Tenant').fill('tenant-acme');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText('Invalid credentials')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('a dead session on reload bounces the user back to the sign-in screen', async ({ page }) => {
  // NOTE: this deliberately keeps the VITE_E2E_AUTH bypass enabled (unlike the
  // test above) rather than forcing a real failing /auth/refresh. Writing this
  // test originally surfaced a real bug: refreshAccessToken()'s failure path
  // called setSession(null) unconditionally, notifying onAuthChanged on every
  // call even when the session was already known dead, so a failed refresh
  // could re-trigger bootstrap() -> another refresh attempt with no guard
  // against repeat notifications. Fixed in auth-client.ts's setSession() to
  // only notify on an actual token-state change (see its comment), which cuts
  // the redundant refresh calls dramatically. Some extra calls can still occur
  // around the sign-in/reload transition (plausibly React's dev-mode double
  // effect invocation, not re-verified here), so this test still uses the
  // simpler, fully deterministic bypass marker rather than a real failing
  // refresh, to avoid coupling it to that timing. Under this dev server's
  // bypass, tryRestoreSession()/getAccessToken() resolve via hasE2ESession(),
  // which just reads the 'qassistant:e2e-authenticated' localStorage marker
  // (see auth-client.ts) -- so a "dead session" is faithfully represented here
  // by clearing that marker.
  await installMockApi(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password').fill('temporary-password');
  await page.getByLabel('Tenant').fill('tenant-acme');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back 👋' })).toBeVisible();

  await page.evaluate(() => window.localStorage.removeItem('qassistant:e2e-authenticated'));
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
