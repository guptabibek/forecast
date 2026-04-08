/**
 * GLOBAL SETUP
 * Runs once before any "authenticated" project tests.
 * Logs in as admin@demo.com and persists the browser storage state so that
 * every subsequent authenticated test gets a pre-logged-in browser context.
 *
 * Credentials are read from env vars so CI can override them:
 *   E2E_ADMIN_EMAIL    (default: admin@demo.com)
 *   E2E_ADMIN_PASSWORD (default: Admin123!)
 */
import { expect, test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const authFilePath = path.resolve(dirname, '../playwright/.auth/user.json');

const BASE_URL = process.env.E2E_WEB_URL ?? 'http://demo.localhost:3000';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@demo.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin123!';

setup('authenticate as admin', async ({ page }) => {
  // Ensure the auth directory exists
  fs.mkdirSync(path.dirname(authFilePath), { recursive: true });

  await page.goto(`${BASE_URL}/login`);
  await expect(page.locator('h2')).toContainText('Welcome back');

  await page.fill('#email', ADMIN_EMAIL);
  await page.fill('#password', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');

  // Wait until we are on the dashboard
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  await expect(page).toHaveURL(/\/dashboard/);

  // Persist cookies + localStorage so other tests can reuse the session
  await page.context().storageState({ path: authFilePath });
});
