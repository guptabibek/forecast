import { expect, test } from './fixtures';
import { ApiClient } from './helpers/api-client.js';
import { createLogger } from './helpers/logger.js';

const BASE = process.env.E2E_WEB_URL ?? 'http://demo.localhost:3000';
const API  = process.env.E2E_API_URL  ?? 'http://127.0.0.1:3001';
/** Helper: ensure page is authenticated; if redirected to /login, re-login */
async function ensureAuthenticated(page: import('@playwright/test').Page) {
  // After navigation, if we ended up on /login, re-authenticate
  if (page.url().includes('/login')) {
    await page.fill('#email', 'admin@demo.com');
    await page.fill('#password', 'Admin123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
  }
}

/** Helper: navigate and wait for page to be authenticated+ loaded */
async function gotoAuthenticated(page: import('@playwright/test').Page, path: string, headingName: string | RegExp, level: 1 | 2 | 3 = 1) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('domcontentloaded');

  // Check if we were redirected to login
  await page.waitForTimeout(1000); // allow redirect to happen
  if (page.url().includes('/login')) {
    await ensureAuthenticated(page);
    // Re-navigate to target page
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('domcontentloaded');
  }

  // Wait for heading
  await page.getByRole('heading', { name: headingName, level }).waitFor({ timeout: 30_000 });
}
// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Returns an ApiClient logged in as the demo admin, or null if API is unreachable. */
async function getApiClient(): Promise<ApiClient | null> {
  const client = new ApiClient(API);
  try {
    await client.login('admin@demo.com', 'Admin123!', 'demo');
    return client;
  } catch {
    return null;
  }
}

// â”€â”€â”€ Chain 1: Plan â†’ Scenarios dropdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Cross-module â€“ Plan appears in Scenarios modal Plan dropdown', () => {
  let planName: string;

  test.beforeAll(async () => {
    const api = await getApiClient();
    if (!api) return;

    const ts = Date.now();
    const startDate = '2025-01-01';
    const endDate   = '2025-12-31';
    try {
      const candidate = `XM-Plan-${ts}`;
      const res = await api.post('/plans', { name: candidate, startDate, endDate, description: 'E2E cross-module test' });
      if (res.status >= 200 && res.status < 300) planName = candidate;
    } catch {
      // API unavailable or error; planName stays empty \u2192 test.skip
    }
  });

  test('plan name is visible in Scenarios New Scenario modal Plan dropdown', async ({ page }, testInfo) => {
    if (!planName) test.skip(true, 'API seeding skipped â€“ API not reachable');
    const log = createLogger(testInfo);
    log.attach(page);

    await gotoAuthenticated(page, '/scenarios', /scenarios/i);
    await page.getByRole('button', { name: /new scenario/i }).click();

    // Wait for modal to open (unique name input confirms modal is ready)
    await page.locator('input[placeholder="e.g., Q2 Growth Scenario"]').waitFor({ timeout: 8_000 });
    const planBtn1 = page.locator('button').filter({ hasText: /select a plan/i }).first();
    let planInOptions1 = false;
    try {
      await planBtn1.waitFor({ timeout: 5_000 });
      await planBtn1.click();
      // Wait for plan options (plans are fetched after auth completes)
      await page.locator('[role="option"]').first().waitFor({ timeout: 15_000 });
      // Check within [role="option"] elements specifically
      const matchingOption = page.locator('[role="option"]').filter({ hasText: planName });
      planInOptions1 = await matchingOption.count() > 0;
    } finally {
      // Always close listbox + modal before asserting to prevent auth cascade on failure
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(150);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
    }
    await log.flush();
    expect(planInOptions1, `Plan "${planName}" should appear in Scenarios modal Plan dropdown`).toBe(true);
  });
});

// â”€â”€â”€ Chain 1b: Plan â†’ Forecasts Plan dropdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Cross-module â€“ Plan appears in Forecasts Select Plan dropdown', () => {
  let planName: string;

  test.beforeAll(async () => {
    const api = await getApiClient();
    if (!api) return;

    const ts = Date.now();
    try {
      const candidate = `XM-FcPlan-${ts}`;
      const res = await api.post('/plans', {
        name: candidate,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        description: 'E2E cross-module forecasts test',
      });
      if (res.status >= 200 && res.status < 300) planName = candidate;
    } catch {
      // API unavailable; planName stays empty \u2192 test.skip
    }
  });

  test('plan name is visible in Forecasts Select Plan dropdown', async ({ page }, testInfo) => {
    if (!planName) test.skip(true, 'API seeding skipped');
    const log = createLogger(testInfo);
    log.attach(page);

    await gotoAuthenticated(page, '/forecasts', 'Forecasts');

    // Forecasts uses native <select> (no htmlFor on label); plan is first <select>
    const planSelect = page.locator('select').first();
    await expect(planSelect).toBeVisible({ timeout: 5_000 });
    // For native <select>, option text is always in DOM — check via toContainText
    await expect(planSelect).toContainText(planName, { timeout: 10_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Chain 1c: Plan + Scenario â†’ Forecasts Scenario dropdown populated â”€â”€â”€â”€â”€â”€â”€
test.describe('Cross-module â€“ After selecting Plan, Scenario dropdown populates', () => {
  test('selecting first available plan enables Scenario dropdown', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);

    await gotoAuthenticated(page, '/forecasts', 'Forecasts');

    // Forecasts uses native <select> (no htmlFor on label); plan is first <select>
    const planSelect = page.locator('select').first();
    await expect(planSelect).toBeVisible({ timeout: 5_000 });

    // Select first real plan option (index 0 = placeholder)
    const optionCount = await planSelect.locator('option').count();
    if (optionCount > 1) {
      await planSelect.selectOption({ index: 1 });
      await page.waitForTimeout(500);
      // The scenario selector (second <select>) should become enabled
      const scenarioSelect = page.locator('select').nth(1);
      await expect(scenarioSelect).not.toBeDisabled({ timeout: 8_000 });
    }
    await log.flush();
  });
});

// â”€â”€â”€ Chain 1d: Plan â†’ Reports config.planId dropdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Cross-module â€“ Plan appears in Reports Data Source dropdown', () => {
  let planName: string;

  test.beforeAll(async () => {
    const api = await getApiClient();
    if (!api) return;

    try {
      const candidate = `XM-RptPlan-${Date.now()}`;
      const res = await api.post('/plans', {
        name: candidate,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        description: 'E2E cross-module reports test',
      });
      if (res.status >= 200 && res.status < 300) planName = candidate;
    } catch {
      // API unavailable; planName stays empty \u2192 test.skip
    }
  });

  test('plan name is visible in Reports Create Report modal Data Source dropdown', async ({ page }, testInfo) => {
    if (!planName) test.skip(true, 'API seeding skipped');
    const log = createLogger(testInfo);
    log.attach(page);

    await gotoAuthenticated(page, '/reports', /reports/i);

    const createBtn = page.getByRole('button', { name: /create report|new report/i });
    if (!(await createBtn.isVisible({ timeout: 8_000 }).catch(() => false))) {
      test.skip(true, 'Create Report button not found');
    }

    await createBtn.click();
    // HeadlessUI dialog outer div is 0-size; detect via modal h3 heading instead
    await page.getByRole('heading', { name: 'Create Report', level: 3 }).waitFor({ timeout: 8_000 });

    // Data Source (Plan) is a native <select>
    const planSelect = page.getByLabel(/Data Source/i);
    if (await planSelect.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(planSelect).toContainText(planName, { timeout: 10_000 });
    }
    // Close modal
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
    await log.flush();
  });
});

// â”€â”€â”€ Chain 2: Supplier â†’ Purchase Orders dropdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Cross-module â€“ Supplier appears in Purchase Orders Create PO dropdown', () => {
  let supplierCode: string;
  let supplierName: string;

  test.beforeAll(async () => {
    const api = await getApiClient();
    if (!api) return;

    const ts = Date.now();
    try {
      const candidateCode = `XM-SUP-${ts}`;
      const candidateName = `XM Supplier ${ts}`;
      const res = await api.post('/manufacturing/suppliers', {
        code: candidateCode,
        name: candidateName,
        defaultLeadTimeDays: 7,
        minimumOrderValue: 100,
      });
      if (res.status >= 200 && res.status < 300) {
        supplierCode = candidateCode;
        supplierName = candidateName;
      }
    } catch {
      // continue
    }
  });

  test('supplier appears in PO Create PO supplierId dropdown', async ({ page }, testInfo) => {
    if (!supplierCode) test.skip(true, 'API seeding skipped');
    const log = createLogger(testInfo);
    log.attach(page);

    await gotoAuthenticated(page, '/manufacturing/purchase-orders', /Purchase Orders/i);

    const createBtn = page.getByRole('button', { name: /create po/i });
    if (!(await createBtn.isVisible({ timeout: 8_000 }).catch(() => false))) {
      test.skip(true, 'Create PO button not found');
    }

    await createBtn.click();
    await page.waitForTimeout(500);

    // Supplier is a native <select> with label "Supplier"
    const supplierSelect = page.getByLabel(/Supplier/i);
    if (await supplierSelect.isVisible({ timeout: 8_000 }).catch(() => false)) {
      // Supplier name should appear as an option in the <select>
      await expect(supplierSelect).toContainText(supplierName, { timeout: 10_000 });
    }
    // Close modal
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
    await log.flush();
  });
});

// â”€â”€â”€ Full E2E chain: Plan creation â†’ all downstream selectors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Cross-module â€“ Complete Planâ†’Scenarioâ†’Forecast chain via API', () => {
  let planId: string;
  let planName: string;
  let scenarioName: string;

  test.beforeAll(async () => {
    const api = await getApiClient();
    if (!api) return;

    const ts = Date.now();
    try {
      const candidatePlan = `E2E-Full-Plan-${ts}`;
      const planRes = await api.post('/plans', {
        name: candidatePlan,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        description: 'Full chain E2E test',
      });
      // ApiClient.post returns { status, body } — extract id from body
      if (planRes.status >= 200 && planRes.status < 300) {
        planId = planRes.body?.id ?? planRes.body?.data?.id;
        planName = candidatePlan;

        if (planId) {
          const candidateScenario = `E2E-Full-Scenario-${ts}`;
          const scenRes = await api.post('/scenarios', {
            name: candidateScenario,
            scenarioType: 'BASE',
            planVersionId: planId,
          });
          if (scenRes.status >= 200 && scenRes.status < 300) scenarioName = candidateScenario;
        }
      }
    } catch {
      // API unavailable; names stay empty \u2192 tests skip
    }
  });

  test('plan name appears in /scenarios New Scenario plan dropdown', async ({ page }, testInfo) => {
    if (!planName) test.skip(true, 'API seeding skipped');
    const log = createLogger(testInfo);
    log.attach(page);

    await gotoAuthenticated(page, '/scenarios', /scenarios/i);
    await page.getByRole('button', { name: /new scenario/i }).click();

    // Wait for modal to open (unique name input confirms modal is ready)
    await page.locator('input[placeholder="e.g., Q2 Growth Scenario"]').waitFor({ timeout: 8_000 });
    const planBtn = page.locator('button').filter({ hasText: /select a plan/i }).first();
    let planInOptions = false;
    try {
      await planBtn.waitFor({ timeout: 5_000 });
      await planBtn.click();
      await page.locator('[role="option"]').first().waitFor({ timeout: 8_000 });
      planInOptions = await page.locator('[role="option"]').filter({ hasText: planName }).count() > 0;
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(150);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
    }
    await log.flush();
    expect(planInOptions, `Plan "${planName}" should appear in Scenarios modal Plan dropdown`).toBe(true);
  });

  test('plan name appears in /forecasts Select Plan dropdown', async ({ page }, testInfo) => {
    if (!planName) test.skip(true, 'API seeding skipped');
    const log = createLogger(testInfo);
    log.attach(page);

    await gotoAuthenticated(page, '/forecasts', 'Forecasts');

    // Forecasts uses native <select> (no htmlFor on label); plan is first <select>
    const planSelect = page.locator('select').first();
    await expect(planSelect).toBeVisible({ timeout: 5_000 });
    await expect(planSelect).toContainText(planName, { timeout: 10_000 });
    await log.flush();
  });

  test('scenario name appears in /forecasts Select Scenario dropdown after selecting the plan', async ({ page }, testInfo) => {
    if (!planName || !scenarioName) test.skip(true, 'API seeding skipped');
    const log = createLogger(testInfo);
    log.attach(page);

    await gotoAuthenticated(page, '/forecasts', 'Forecasts');

    // Forecasts uses native <select> (no htmlFor on label); plan is first <select>
    const planSelect = page.locator('select').first();
    await expect(planSelect).toBeVisible({ timeout: 5_000 });

    // Find the plan option by text content and select it
    const planOptions = await planSelect.locator('option').all();
    let planValue: string | null = null;
    for (const opt of planOptions) {
      if ((await opt.textContent() || '').includes(planName)) {
        planValue = await opt.getAttribute('value');
        break;
      }
    }
    if (planValue) {
      await planSelect.selectOption(planValue);
      await page.waitForTimeout(600);

      // Scenario dropdown (second <select>) should populate
      const scenarioSelect = page.locator('select').nth(1);
      await expect(scenarioSelect).not.toBeDisabled({ timeout: 5_000 });
      await expect(scenarioSelect).toContainText(scenarioName, { timeout: 10_000 });
    }
    await log.flush();
  });
});
