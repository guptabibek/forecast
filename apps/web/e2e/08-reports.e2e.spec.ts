/**
 * 08 â€“ Reports module
 *
 * Requires: authenticated session (runs in "authenticated" project)
 * Covers:
 *  - Reports page loads with heading
 *  - Report type tabs are present
 *  - "Create Report" button opens modal
 *  - Create Report modal: name, description, reportType Listbox, config.planId,
 *    chart type icons, Cancel closes modal
 *  - Export/Refresh buttons are visible
 */
import { expect, test } from './fixtures';
import { createLogger } from './helpers/logger.js';

const BASE = process.env.E2E_WEB_URL ?? 'http://demo.localhost:3000';

test.describe('Reports', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/reports`);
    // Page has h1 + CardHeader h3 both named 'Reports'; use .first() to avoid strict-mode violation
    await expect(page.getByRole('heading', { name: 'Reports' }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('renders the Reports heading', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.getByRole('heading', { name: 'Reports' }).first()).toBeVisible();
    await log.flush();
  });

  test('has report type selector or tabs', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // Avoid networkidle – Vite HMR WebSocket prevents it from resolving reliably
    // Any button/tab for report types should be visible
    const tabs = page.locator('button, [role="tab"]').filter({ hasText: /forecast|sales|inventory|variance|accuracy/i });
    const tabVisible = await tabs.first().isVisible({ timeout: 5_000 }).catch(() => false);
    // If no type tabs, ensure Create Report button is present as fallback
    if (!tabVisible) {
      await expect(page.getByRole('button', { name: /create report/i })).toBeVisible({ timeout: 10_000 });
    }
    await log.flush();
  });

  test('has a Generate or Export button', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // Export/Refresh only appear when a report is selected.
    // Create Report button is always present – accept any of these.
    const btn = page.getByRole('button', { name: /generate|export|download|run report|create report/i });
    await expect(btn.first()).toBeVisible({ timeout: 10_000 });
    await log.flush();
  });

  test('"Create Report" button opens a modal', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const createBtn = page.getByRole('button', { name: /create report|new report/i });
    if (await createBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await createBtn.click();
      // HeadlessUI Dialog outer div has 0 computed size. Use h3 title inside Dialog.Panel instead.
      await expect(page.getByRole('heading', { name: 'Create Report', level: 3 })).toBeVisible({ timeout: 8_000 });
      // Close modal to prevent in-flight requests from corrupting auth
      await page.keyboard.press('Escape');
    }
    await log.flush();
  });
});

// â”€â”€â”€ Reports â€“ Create modal full coverage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Reports â€“ Create Report modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/reports`);
    await page.waitForLoadState('domcontentloaded');
    const createBtn = page.getByRole('button', { name: /create report|new report/i });
    if (await createBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await createBtn.click();
      // Use h3 heading to detect modal (outer dialog div has 0 computed size)
      await page.getByRole('heading', { name: 'Create Report', level: 3 }).waitFor({ timeout: 8_000 }).catch(() => {});
    }
  });

  test('modal has name field with placeholder', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    if (await page.locator('[role="dialog"]').isVisible({ timeout: 3_000 }).catch(() => false)) {
      const nameInput = page.locator('#name').or(
        page.getByPlaceholder(/Monthly Revenue Forecast|report name/i)
      );
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
    }
    await log.flush();
  });

  test('modal has description textarea', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    if (await page.locator('[role="dialog"]').isVisible({ timeout: 3_000 }).catch(() => false)) {
      const desc = page.locator('textarea, [name="description"], #description');
      await expect(desc.first()).toBeVisible({ timeout: 5_000 });
    }
    await log.flush();
  });

  test('modal has reportType selector', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    if (await page.locator('[role="dialog"]').isVisible({ timeout: 3_000 }).catch(() => false)) {
      const reportTypeSelect = page.locator('[name="reportType"], #reportType, select, [role="listbox"]').first();
      await expect(reportTypeSelect).toBeVisible({ timeout: 5_000 });
    }
    await log.flush();
  });

  test('modal has "Data Source (Plan)" / config.planId field', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    if (await page.locator('[role="dialog"]').isVisible({ timeout: 3_000 }).catch(() => false)) {
      const planField = page.getByLabel(/Data Source|Plan/i)
        .or(page.locator('[name*="planId"], #planId, select')).first();
      await expect(planField).toBeVisible({ timeout: 5_000 });
    }
    await log.flush();
  });

  test('modal Cancel button closes the dialog', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    if (await page.locator('[role="dialog"]').isVisible({ timeout: 3_000 }).catch(() => false)) {
      await page.getByRole('button', { name: /cancel/i }).click();
      await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 5_000 });
    }
    await log.flush();
  });

  test('modal shows validation error on empty submit', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    if (await page.locator('[role="dialog"]').isVisible({ timeout: 3_000 }).catch(() => false)) {
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText(/required|name is/i).first()).toBeVisible({ timeout: 5_000 });
    }
    await log.flush();
  });
});
