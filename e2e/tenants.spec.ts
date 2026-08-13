import { expect, test } from '@playwright/test';
import { authenticate, installMockApi } from './fixtures';

test('super-admin manages tenants: list, create, and toggle status', async ({ page }) => {
  const requests: Array<{ method: string; pathname: string; body?: unknown }> = [];
  await authenticate(page);
  await installMockApi(page, { role: 'super-admin', onRequest: (r) => requests.push(r) });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  await expect(page.getByText('Acme QA')).toBeVisible();
  await expect(page.getByText('acme-qa')).toBeVisible();

  // Super-admin only sees the Tenants nav link -- no tenant-scoped screens.
  await expect(page.getByRole('link', { name: 'Tenants' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Recordings' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Add tenant' }).click();
  await page.getByLabel('Tenant name').fill('Globex Corp');
  await page.getByLabel('First admin email').fill('owner@globex.test');
  await page.getByLabel('First admin initial password').fill('Temporary-password-1');
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByText('Globex Corp')).toBeVisible();
  expect(requests).toContainEqual(
    expect.objectContaining({
      method: 'POST',
      pathname: '/api/v1/admin/tenants',
      body: {
        name: 'Globex Corp',
        firstAdmin: { email: 'owner@globex.test', password: 'Temporary-password-1' },
      },
    }),
  );

  const acmeRow = page.getByRole('row', { name: /Acme QA/ });
  await acmeRow.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  await expect(acmeRow.getByText('inactive', { exact: true })).toBeVisible();
  expect(requests).toContainEqual(
    expect.objectContaining({
      method: 'PATCH',
      pathname: `/api/v1/admin/tenants/00000000-0000-4000-8000-000000000001`,
      body: { status: 'inactive' },
    }),
  );
});

test('super-admin creates a reusable signup link, then sees it listed', async ({ page }) => {
  const requests: Array<{ method: string; pathname: string; body?: unknown }> = [];
  await authenticate(page);
  await installMockApi(page, { role: 'super-admin', onRequest: (r) => requests.push(r) });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Signup links' })).toBeVisible();

  await page.getByRole('button', { name: 'Create signup link' }).click();
  await page.getByLabel('Expires in (days)').fill('14');
  await page.getByRole('button', { name: 'Generate link' }).click();

  // The generated URL is shown exactly once, pointing at the public /signup route.
  await expect(page.locator('input[readonly]')).toHaveValue(/\/signup\/mock-token-/);
  expect(requests).toContainEqual(
    expect.objectContaining({
      method: 'POST',
      pathname: '/api/v1/admin/tenants/invitations',
      body: { expiresInDays: 14 },
    }),
  );

  await page.getByRole('button', { name: 'Done' }).click();
  // The link now appears in the Signup links table as active.
  await expect(page.getByRole('row', { name: /active/ }).last()).toBeVisible();
});

test('super-admin deletes a tenant (soft-delete) via confirmation', async ({ page }) => {
  const requests: Array<{ method: string; pathname: string }> = [];
  await authenticate(page);
  await installMockApi(page, { role: 'super-admin', onRequest: (r) => requests.push(r) });
  await page.goto('/');

  const acmeRow = page.getByRole('row', { name: /Acme QA/ });
  await expect(acmeRow).toBeVisible();
  await acmeRow.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();

  // A confirmation dialog appears; confirm the delete.
  await expect(page.getByRole('heading', { name: 'Delete tenant' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();

  // The row is gone and the DELETE request was issued.
  await expect(page.getByText('Acme QA')).toHaveCount(0);
  expect(requests).toContainEqual(
    expect.objectContaining({
      method: 'DELETE',
      pathname: '/api/v1/admin/tenants/00000000-0000-4000-8000-000000000001',
    }),
  );
});
