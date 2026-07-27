import { expect, test } from '@playwright/test';
import { authenticate, installMockApi } from './fixtures';

test('signs in and signs out through the dashboard shell', async ({ page }) => {
  const requests: string[] = [];
  await installMockApi(page, { onRequest: ({ method, pathname }) => requests.push(`${method} ${pathname}`) });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password').fill('temporary-password');
  await page.getByLabel('Tenant (leave blank for super-admin)').fill('tenant-acme');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible();
  await expect(page.getByText('Acme QA')).toBeVisible();
  expect(requests).toContain('GET /api/v1/auth/me');

  await page.getByRole('button', { name: 'Sign out' }).click();
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
