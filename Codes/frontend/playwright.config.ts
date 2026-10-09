import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the Vite dev server (which proxies /api to the FastAPI backend on :8140).
 * Browsers come from the default cache (~/.cache/ms-playwright); @playwright/test 1.62.0
 * matches the cached chromium-1234 build, so no download is needed.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /screenshots\.spec\.ts/ },
    { name: 'shots', use: { ...devices['Desktop Chrome'] }, testMatch: /screenshots\.spec\.ts/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 60_000 },
});
