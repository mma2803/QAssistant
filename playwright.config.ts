import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'on',
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer: [
    {
      command: 'npm run dev --workspace @qassistant/dashboard -- --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        VITE_E2E_AUTH: 'true',
      },
    },
    {
      command: 'npm run build --workspace @qassistant/extension && npm run preview --workspace @qassistant/extension -- --host 127.0.0.1 --port 4174',
      url: 'http://127.0.0.1:4174/src/popup/index.html',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
