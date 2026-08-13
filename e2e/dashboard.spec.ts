import { expect, test } from '@playwright/test';
import { authenticate, chooseOption, ids, installMockApi } from './fixtures';

test.beforeEach(async ({ page }) => {
  await authenticate(page);
});

test('browses, filters, exports, and deletes recordings', async ({ page }) => {
  const requests: Array<{ method: string; pathname: string; search: string }> = [];
  await installMockApi(page, { onRequest: (request) => requests.push(request) });
  await page.goto('/sessions');

  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Checkout', exact: true })).toBeVisible();
  await chooseOption(page, 'Project', 'Checkout');
  await chooseOption(page, 'Status', 'Completed');
  await expect.poll(() => requests.some((request) => request.pathname === '/api/v1/dashboard/sessions' && request.search.includes(`projectId=${ids.project}`) && request.search.includes('status=completed'))).toBe(true);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Export ZIP' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('session.zip');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect.poll(() => requests.filter((request) => request.method === 'DELETE').length).toBe(1);
});

test('shows project context and renders escaped markdown', async ({ page }) => {
  // The "no overview written" placeholder only renders on the read-only
  // (qa-engineer) branch of ProjectsPage; the admin branch shows an editable
  // textarea. The rendered markdown lives under the "Knowledge hub" tab.
  await installMockApi(page, { role: 'qa-engineer' });
  await page.goto('/projects');

  await expect(page.getByRole('heading', { name: 'Project context' })).toBeVisible();
  await page.getByRole('tab', { name: 'Knowledge hub' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await expect(page.getByText('Use data-testid selectors.')).toBeVisible();
  await chooseOption(page, 'Project', 'Billing');
  await expect(page.getByText('No knowledge-hub overview has been written')).toBeVisible();
});

test('shows admin productivity metrics and directional ranking', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/metrics');

  await expect(page.getByRole('heading', { name: 'Productivity' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'qa@example.test' }).first()).toBeVisible();
  await expect(page.getByText(/directional/i)).toBeVisible();
  await expect(page.getByText(/raw wall-clock/i).first()).toBeVisible();
});

test('restricts a QA engineer to role-appropriate routes', async ({ page }) => {
  await installMockApi(page, { role: 'qa-engineer' });
  await page.goto('/sessions');

  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Productivity' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);

  await page.goto('/users');
  await expect(page).toHaveURL(/\/overview$/);
});
