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
  await page.getByLabel('First admin initial password').fill('temporary-password');
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByText('Globex Corp')).toBeVisible();
  expect(requests).toContainEqual(
    expect.objectContaining({
      method: 'POST',
      pathname: '/api/v1/admin/tenants',
      body: {
        name: 'Globex Corp',
        firstAdmin: { email: 'owner@globex.test', password: 'temporary-password' },
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
