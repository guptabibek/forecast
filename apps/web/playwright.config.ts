import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Frontend URL – subdomain `demo` resolves to 127.0.0.1 via the OS's loopback. */
export const webBaseUrl = process.env.E2E_WEB_URL ?? 'http://demo.localhost:3000';
/** Backend API URL */
export const apiBaseUrl = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';
/** Stored auth state produced by the `setup` project */
export const authStatePath = 'playwright/.auth/user.json';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,           // keep serial so the setup project finishes first
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,                     // single worker to avoid DB race conditions
  outputDir: 'test-results/e2e/artifacts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/e2e/junit.xml' }],
    ['json', { outputFile: 'test-results/e2e/results.json' }],
  ],
  use: {
    baseURL: webBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    // ── 1. One-time login – saves cookies/localStorage to playwright/.auth/user.json ──
    {
      name: 'setup',
      testMatch: '**/global-setup.ts',
      use: { ...devices['Desktop Chrome'] },
    },

    // ── 2. Authenticated flows – reuses stored session ──
    {
      name: 'authenticated',
      testMatch: [
        '**/02-dashboard.e2e.spec.ts',
        '**/03-plans.e2e.spec.ts',
        '**/04-forecasts.e2e.spec.ts',
        '**/05-scenarios.e2e.spec.ts',
        '**/06-data.e2e.spec.ts',
        '**/07-manufacturing.e2e.spec.ts',
        '**/08-reports.e2e.spec.ts',
        '**/09-settings.e2e.spec.ts',
        '**/10-cross-module-integrity.e2e.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath,
      },
      dependencies: ['setup'],
    },

    // ── 3. Public / auth flows – no stored session ──
    {
      name: 'public',
      testMatch: ['**/01-auth.e2e.spec.ts', '**/app-smoke.e2e.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: process.env.E2E_WEB_COMMAND ?? 'npm run dev -- --host 0.0.0.0 --port 3000',
    /** Use plain 127.0.0.1 for the readiness probe; `demo.localhost` also resolves here. */
    url: 'http://127.0.0.1:3000/login',
    cwd: dirname,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
