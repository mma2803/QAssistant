import { expect, test } from '@playwright/test';
import { authenticate, ids, installMockApi } from './fixtures';

test('reviews a recording and exercises the code-generation workflow', async ({ page }) => {
  const requests: Array<{ method: string; pathname: string; body?: unknown }> = [];
  await authenticate(page);
  await installMockApi(page, { onRequest: (request) => requests.push(request) });
  await page.goto(`/sessions/${ids.session}`);

  await expect(page.getByRole('heading', { name: 'Recording' })).toBeVisible();
  await expect(page.getByText('The tester completed checkout')).toBeVisible();
  await expect(page.getByText('1 DOM chunk(s) captured.')).toBeVisible();
  await expect(page.getByAltText('screenshot 1')).toBeVisible();
  await expect(page.getByText('[data-testid=success]')).toBeVisible();
  await expect(page.getByText('Assert the receipt number.')).toBeVisible();

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('approved', { exact: true })).toBeVisible();
  // Integration is read-only in the dashboard: only the MCP client (which owns
  // the Git push) reports an integration outcome, so there is no Integrate
  // button here.
  await expect(page.getByText('Ready to integrate', { exact: true })).toBeVisible();

  await page.getByLabel('Comment to steer the next generation').fill('Use the visible receipt number.');
  await page.getByLabel('Target version (optional)').selectOption(ids.generation);
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.getByLabel('Comment to steer the next generation')).toHaveValue('');

  await page.getByRole('button', { name: 'Regenerate with comments' }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ZIP' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('session.zip');

  for (const expected of [
    `GET /api/v1/dashboard/sessions/${ids.session}`,
    `GET /api/v1/dashboard/sessions/${ids.session}/replay`,
    `GET /api/v1/dashboard/sessions/${ids.session}/artifacts/${ids.artifact}`,
    `POST /api/v1/generations/${ids.generation}/approve`,
    `POST /api/v1/sessions/${ids.session}/comments`,
    `POST /api/v1/sessions/${ids.session}/regenerate`,
    `POST /api/v1/sessions/${ids.session}/generate`,
    `GET /api/v1/sessions/${ids.session}/export`,
  ]) {
    expect(requests.map(({ method, pathname }) => `${method} ${pathname}`)).toContain(expected);
  }
  expect(requests).toContainEqual(expect.objectContaining({
    method: 'POST',
    pathname: `/api/v1/sessions/${ids.session}/comments`,
    body: { body: 'Use the visible receipt number.', generatedTestId: ids.generation },
  }));
});
