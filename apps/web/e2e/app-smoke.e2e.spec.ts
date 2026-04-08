import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiBaseUrl = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';
const runtimeErrorsByTestId = new Map<string, Array<Record<string, unknown>>>();
const dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeErrorsLogFile = path.resolve(dirname, '../test-results/e2e/runtime-errors.ndjson');

test.beforeEach(async ({ page }, testInfo) => {
  const errors: Array<Record<string, unknown>> = [];
  runtimeErrorsByTestId.set(testInfo.testId, errors);

  page.on('pageerror', (error) => {
    errors.push({
      type: 'pageerror',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push({
        type: 'console',
        message: message.text(),
        location: message.location(),
        timestamp: new Date().toISOString(),
      });
    }
  });

  page.on('requestfailed', (request) => {
    errors.push({
      type: 'requestfailed',
      url: request.url(),
      method: request.method(),
      failure: request.failure(),
      timestamp: new Date().toISOString(),
    });
  });
});

test.afterEach(async ({}, testInfo) => {
  const runtimeErrors = runtimeErrorsByTestId.get(testInfo.testId) ?? [];
  runtimeErrorsByTestId.delete(testInfo.testId);

  await fs.mkdir(path.dirname(runtimeErrorsLogFile), { recursive: true });
  await fs.appendFile(
    runtimeErrorsLogFile,
    `${JSON.stringify({
      testId: testInfo.testId,
      title: testInfo.title,
      status: testInfo.status,
      expectedStatus: testInfo.expectedStatus,
      durationMs: testInfo.duration,
      retry: testInfo.retry,
      runtimeErrors,
      timestamp: new Date().toISOString(),
    })}\n`,
    'utf8',
  );

  if (runtimeErrors.length > 0) {
    await testInfo.attach('runtime-errors', {
      body: JSON.stringify(runtimeErrors, null, 2),
      contentType: 'application/json',
    });
  }
});

test.describe('Frontend + Backend smoke E2E', () => {
  test('backend health endpoint responds', async ({ request }) => {
    const candidates = [`${apiBaseUrl}/health`, `${apiBaseUrl}/api/v1/health`];
    let healthy = false;

    for (const url of candidates) {
      const response = await request.get(url);
      if (response.ok()) {
        healthy = true;
        break;
      }
    }

    expect(healthy).toBeTruthy();
  });

  test('login UI reaches backend and handles invalid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.locator('#email').fill('wrong.user@example.com');
    await page.locator('#password').fill('WrongPass123!');

    const loginResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/auth/login') && response.request().method() === 'POST',
    );

    await page.getByRole('button', { name: 'Sign in' }).click();
    const loginResponse = await loginResponsePromise;

    expect(loginResponse.status()).toBeGreaterThanOrEqual(400);
    await expect(page.getByText('Invalid email or password')).toBeVisible();
  });

  test('unauthenticated dashboard access redirects to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
