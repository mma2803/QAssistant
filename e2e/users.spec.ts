import { expect, test } from '@playwright/test';
import { authenticate, ids, installMockApi } from './fixtures';

test('creates, changes, disables, and resets a tenant user', async ({ page }) => {
  const requests: Array<{ method: string; pathname: string; body?: unknown }> = [];
  await authenticate(page);
  await installMockApi(page, { onRequest: (request) => requests.push(request) });
  await page.goto('/users');

  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await page.getByLabel('Email').fill('new.qa@example.test');
  await page.getByLabel('Initial password').fill('temporary-password');
  await page.getByLabel('Role').selectOption('admin');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('cell', { name: 'new.qa@example.test' })).toBeVisible();

  const qaRow = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: 'qa@example.test', exact: true }),
  });
  await qaRow.getByRole('combobox').selectOption('admin');
  await qaRow.getByRole('button', { name: 'Disable' }).click();

  page.once('dialog', (dialog) => dialog.accept('replacement-password'));
  await qaRow.getByRole('button', { name: 'Reset password' }).click();

  expect(requests).toContainEqual(expect.objectContaining({
    method: 'POST',
    pathname: '/api/v1/users',
    body: { email: 'new.qa@example.test', password: 'temporary-password', role: 'admin' },
  }));
  expect(requests).toContainEqual(expect.objectContaining({ method: 'PATCH', pathname: `/api/v1/users/${ids.qa}`, body: { role: 'admin' } }));
  expect(requests).toContainEqual(expect.objectContaining({ method: 'PATCH', pathname: `/api/v1/users/${ids.qa}`, body: { status: 'disabled' } }));
  expect(requests).toContainEqual(expect.objectContaining({ method: 'POST', pathname: `/api/v1/users/${ids.qa}/reset-password`, body: { password: 'replacement-password' } }));
});
