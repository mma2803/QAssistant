import { expect, test } from '@playwright/test';
import { installMockApi } from './fixtures';

/**
 * Public tenant self-signup page (change: tenant-signup-links). Reached
 * signed-out at /signup/:token — no authenticate() call here on purpose, to
 * prove the page renders for an unauthenticated visitor.
 */

test('redeems a valid signup link into a new tenant', async ({ page }) => {
  const requests: Array<{ method: string; pathname: string; body?: unknown }> = [];
  await installMockApi(page, { onRequest: (r) => requests.push(r) });
  await page.goto('/signup/mock-token-valid');

  await expect(page.getByRole('heading', { name: 'Create your tenant' })).toBeVisible();
  await page.getByLabel('Tenant name').fill('Umbrella Corp');
  await page.getByLabel('Admin email').fill('owner@umbrella.test');
  await page.getByLabel('Admin password').fill('Super-secret-1!');
  await page.getByRole('button', { name: 'Create tenant' }).click();

  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible();
  await expect(page.getByText('umbrella-corp')).toBeVisible();
  expect(requests).toContainEqual(
    expect.objectContaining({
      method: 'POST',
      pathname: '/api/v1/signup',
      body: {
        token: 'mock-token-valid',
        name: 'Umbrella Corp',
        firstAdmin: { email: 'owner@umbrella.test', password: 'Super-secret-1!' },
      },
    }),
  );
});

test('rejects a duplicate tenant name with a clear message', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/signup/mock-token-valid');

  await page.getByLabel('Tenant name').fill('Acme QA'); // already exists in the mock
  await page.getByLabel('Admin email').fill('owner@acme.test');
  await page.getByLabel('Admin password').fill('Super-secret-1!');
  await page.getByRole('button', { name: 'Create tenant' }).click();

  await expect(page.getByText(/tenant with this name already exists/i)).toBeVisible();
});

test('shows an error state for an invalid or expired link', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/signup/invalid-token');

  await expect(page.getByRole('heading', { name: 'Link unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create your tenant' })).toHaveCount(0);
});
