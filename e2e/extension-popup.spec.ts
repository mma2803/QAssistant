import { expect, test, type Page } from '@playwright/test';
import { ids, projects, session } from './fixtures';

const popupUrl = 'http://127.0.0.1:4174/src/popup/index.html';

interface PopupScenario {
  signedIn: boolean;
  role?: 'admin' | 'qa-engineer' | 'super-admin';
  mustChangePassword?: boolean;
  email?: string;
  active?: boolean;
}

async function installChromeMock(page: Page, initial: PopupScenario): Promise<void> {
  await page.addInitScript(
    ({ scenario, fixtureProjects, fixtureSession, fixtureIds }) => {
      let state = { ...scenario };
      const calls: Array<{ type: string; [key: string]: unknown }> = [];
      const activeSession = {
        session: fixtureSession,
        project: fixtureProjects[0],
        screenshotEnabled: true,
        domChunksUploaded: 2,
        screenshotsUploaded: 1,
        flagsRecorded: 1,
      };

      Object.defineProperty(window, '__popupCalls', { get: () => calls });
      const chromeApi = (window as unknown as { chrome?: Record<string, unknown> }).chrome ?? {};
      chromeApi.runtime = {
        sendMessage: async (message: { payload: { type: string; [key: string]: unknown } }) => {
              const payload = message.payload;
              calls.push(payload);
              switch (payload.type) {
                case 'auth:getState':
                  return {
                    ok: true,
                    data: {
                      signedIn: state.signedIn,
                      email: state.email ?? null,
                      role: state.role ?? null,
                      tenantId: state.signedIn ? fixtureIds.tenant : null,
                      mustChangePassword: state.mustChangePassword ?? false,
                    },
                  };
                case 'auth:signIn':
                  state = {
                    signedIn: true,
                    email: String(payload.email),
                    role: 'qa-engineer',
                    mustChangePassword: false,
                  };
                  return { ok: true, data: state };
                case 'auth:completePasswordChange':
                  state.mustChangePassword = false;
                  return { ok: true, data: state };
                case 'auth:signOut':
                  state = { signedIn: false };
                  return { ok: true, data: null };
                case 'projects:list':
                  return { ok: true, data: fixtureProjects };
                case 'session:getActive':
                  return { ok: true, data: state.active ? activeSession : null };
                case 'session:start':
                  state.active = true;
                  return { ok: true, data: fixtureSession };
                case 'session:stop':
                  state.active = false;
                  return { ok: true, data: fixtureSession };
                default:
                  return { ok: false, error: { code: 'not_mocked', message: payload.type } };
              }
        },
      };
      (window as unknown as { chrome: Record<string, unknown> }).chrome = chromeApi;
    },
    { scenario: initial, fixtureProjects: projects, fixtureSession: session, fixtureIds: ids },
  );
}

test('extension popup signs in and validates credentials locally', async ({ page }) => {
  await installChromeMock(page, { signedIn: false });
  await page.goto(popupUrl);

  await expect(page.getByText('QAssistant')).toBeVisible();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter your email and password')).toBeVisible();

  await page.getByLabel('Email').fill('qa@example.test');
  await page.getByLabel('Password').fill('temporary-password');
  await page.getByLabel('Tenant').fill('tenant-acme');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible();
});

test('extension popup enforces and completes password change', async ({ page }) => {
  await installChromeMock(page, {
    signedIn: true,
    role: 'qa-engineer',
    mustChangePassword: true,
    email: 'qa@example.test',
  });
  await page.goto(popupUrl);

  await expect(page.getByText('You must set a new password')).toBeVisible();
  await page.getByLabel('New password').fill('short');
  await page.getByLabel('Confirm').fill('short');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByText(/at least 8 characters/i)).toBeVisible();

  await page.getByLabel('New password').fill('New-password-123');
  await page.getByLabel('Confirm').fill('New-password-123');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible();
});

test('extension popup starts and stops a recording with frozen context', async ({ page }) => {
  await installChromeMock(page, {
    signedIn: true,
    role: 'qa-engineer',
    email: 'qa@example.test',
  });
  await page.goto(popupUrl);

  await expect(page.getByLabel('Project')).toHaveValue(ids.project);
  await expect(page.getByLabel('Capture screenshots')).toBeChecked();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByText('Enter a Jira ID or a non-empty description')).toBeVisible();

  await page.getByLabel('Description').fill('Verify checkout success.');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByText('Recording', { exact: true })).toBeVisible();
  await expect(page.getByText('2', { exact: true })).toBeVisible();
  await expect(page.getByText(/Flag hotkey: Alt\+Shift\+F/)).toBeVisible();

  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible();

  const calls = await page.evaluate(() =>
    (window as unknown as { __popupCalls: Array<Record<string, unknown>> }).__popupCalls,
  );
  expect(calls).toContainEqual(expect.objectContaining({
    type: 'session:start',
    projectId: ids.project,
    description: 'Verify checkout success.',
    screenshotEnabled: true,
  }));
  expect(calls).toContainEqual(expect.objectContaining({ type: 'session:stop' }));
});

test('extension popup blocks super-admin capture', async ({ page }) => {
  await installChromeMock(page, {
    signedIn: true,
    role: 'super-admin',
    email: 'ops@example.test',
  });
  await page.goto(popupUrl);
  await expect(page.getByText('Super-admins cannot record sessions')).toBeVisible();
});
