import { expect, test } from '@playwright/test';
import { authenticate, installMockApi } from './fixtures';

test.beforeEach(async ({ page }) => {
  await authenticate(page);
});

test('shows a loading state while recordings are fetched, then renders the list', async ({ page }) => {
  await installMockApi(page, {
    delayMs: (request) =>
      request.method === 'GET' && request.pathname === '/api/v1/dashboard/sessions' ? 700 : undefined,
  });

  await page.goto('/sessions', { waitUntil: 'commit' });

  await expect(page.locator('[data-slot="skeleton"]').first()).toBeVisible();

  await expect(page.locator('[data-slot="skeleton"]').first()).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Checkout' })).toBeVisible();
});

test('shows a loading state while projects are fetched, then renders the project list', async ({ page }) => {
  await installMockApi(page, {
    delayMs: (request) =>
      request.method === 'GET' && request.pathname === '/api/v1/projects' ? 700 : undefined,
  });

  await page.goto('/projects', { waitUntil: 'commit' });

  await expect(page.getByText(/Loading projects/)).toBeVisible();

  await expect(page.getByText(/Loading projects/)).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Project context' })).toBeVisible();
  await expect(page.getByText('https://checkout.example.test')).toBeVisible();
});
