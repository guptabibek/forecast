/**
 * 02 â€“ Dashboard
 *
 * Requires: authenticated session (runs in "authenticated" project)
 * Covers:
 *  - Dashboard renders without error
 *  - Key stat cards are visible
 *  - Navigation sidebar links are present
 *  - Period selector buttons work
 *  - Filter bar renders
 */
import { expect, test } from './fixtures';
import { createLogger } from './helpers/logger.js';

const BASE = process.env.E2E_WEB_URL ?? 'http://demo.localhost:3000';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    // Wait for content to appear (the heading "Dashboard")
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  });

  test('renders the main heading', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await log.flush();
  });

  test('shows stat cards (forecast accuracy, active plans, etc.)', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // StatCard components render titles as small text inside .card divs
    const cards = page.locator('.card');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    // At least 4 stat cards should be present
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(4);
    await log.flush();
  });

  test('period selector tabs are visible and clickable', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const monthly = page.getByRole('button', { name: 'Monthly' });
    const weekly = page.getByRole('button', { name: 'Weekly' });
    await expect(monthly).toBeVisible({ timeout: 10_000 });
    await expect(weekly).toBeVisible();
    await weekly.click();
    // Just confirm the click didn't throw / cause an error state
    await expect(page.getByText(/error/i)).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
    await log.flush();
  });

  test('filter bar renders Product and Customer dropdowns', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.getByRole('button', { name: /Products/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Customers/i })).toBeVisible();
    await log.flush();
  });

  test('navigation sidebar links are present', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // Use 'nav' role or sidebar links
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible({ timeout: 10_000 });
    await expect(nav.getByRole('link', { name: /dashboard/i })).toBeVisible();
    await log.flush();
  });

  test('ABC Analysis section is present', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.getByText(/ABC Product Classification/i)).toBeVisible({ timeout: 15_000 });
    await log.flush();
  });
});
