/**
 * Common page-navigation helpers used across multiple test files.
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const BASE_URL = process.env.E2E_WEB_URL ?? 'http://demo.localhost:3000';

/** Navigate to a path and wait for the React app to settle (no spinner). */
export async function goto(page: Page, path: string) {
  await page.goto(`${BASE_URL}${path}`);
  // Wait for the global loading spinner to disappear (if present)
  await page
    .locator('.animate-spin')
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .catch(() => {/* spinner may not be present at all */});
}

/** Click a navigation item that contains the given text and wait for the URL. */
export async function navTo(page: Page, label: string, urlPattern: RegExp) {
  await page.getByRole('link', { name: label }).first().click();
  await page.waitForURL(urlPattern, { timeout: 20_000 });
}

/** Wait for the page "heading" level 1 to contain the expected text. */
export async function expectHeading(page: Page, text: string | RegExp) {
  await expect(page.getByRole('heading', { level: 1 })).toContainText(text, { timeout: 10_000 });
}

/** Helper that confirms a toast/alert message appears. */
export async function expectToast(page: Page, text: string | RegExp) {
  // react-hot-toast uses div with role="status" or just renders text in a div
  const toast = page.locator('[role="status"]').or(page.locator('.react-hot-toast')).or(page.locator('div').filter({ hasText: text })).first();
  await expect(toast).toBeVisible({ timeout: 8_000 });
}

/** Fill and submit a form field by its label text. */
export async function fillField(page: Page, labelText: string, value: string) {
  await page.getByLabel(labelText, { exact: false }).fill(value);
}

/** Click a button by its visible text. */
export async function clickButton(page: Page, text: string | RegExp) {
  await page.getByRole('button', { name: text }).first().click();
}
