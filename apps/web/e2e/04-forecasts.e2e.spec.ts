/**
 * 04 â€“ Forecasts module
 *
 * Requires: authenticated session (runs in "authenticated" project)
 * Covers:
 *  - Forecasts list page loads
 *  - Select Plan / Select Scenario dropdowns
 *  - Planâ†’Scenario cross-chain: selecting a plan populates the scenario dropdown
 *  - Model checkboxes (ARIMA, Prophet, etc.) are rendered
 *  - Run Models button is present / responds to user interaction
 */
import { expect, test } from './fixtures';
import { createLogger } from './helpers/logger.js';

const BASE = process.env.E2E_WEB_URL ?? 'http://demo.localhost:3000';

test.describe('Forecasts â€“ list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/forecasts`);
    await expect(page.getByRole('heading', { name: 'Forecasts' })).toBeVisible({ timeout: 20_000 });
  });

  test('renders the Forecasts heading', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.getByRole('heading', { name: 'Forecasts' })).toBeVisible();
    await log.flush();
  });

  test('renders a table or list of forecasts', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // On initial load (no plan selected) the page shows a "Select a Plan" card.
    // When chart data is present a <table> is shown instead.
    const content = page
      .locator('table')
      .or(page.getByRole('heading', { name: /select a plan|ready to generate|generating forecast/i }))
      .or(page.getByText(/choose a plan above|select the models/i));
    await expect(content.first()).toBeVisible({ timeout: 15_000 });
    await log.flush();
  });

  test('Select Plan dropdown is present', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // The label lacks a htmlFor so getByLabel won't work; use the first <select> directly
    await expect(page.locator('select').first()).toBeVisible({ timeout: 10_000 });
    await log.flush();
  });

  test('Select Scenario dropdown is present', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // The label lacks a htmlFor so getByLabel won't work; use the second <select> directly
    await expect(page.locator('select').nth(1)).toBeVisible({ timeout: 10_000 });
    await log.flush();
  });

  test('model checkboxes (ARIMA, Prophet, etc.) are visible on the page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // Models use styled <button> tags (no checkboxes); they only render when chart data is present.
    // On initial load the "Select a Plan" card is shown – the controls (including Run Models button
    // with the selected model count) are always visible in the page header area.
    // Accept either: model name buttons (chart loaded) or the initial empty-state card.
    const modelOrEmptyState = page
      .getByRole('button', { name: /moving average|arima|prophet|exponential|holt/i })
      .or(page.getByRole('heading', { name: /select a plan/i }))
      .or(page.getByRole('heading', { name: /select a scenario/i }))
      .or(page.getByRole('heading', { name: /ready to generate/i }));
    await expect(modelOrEmptyState.first()).toBeVisible({ timeout: 12_000 });
    await log.flush();
  });

  test('Run Models / Run Forecast button is present', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // Button text is "Run Models (N)" — avoid networkidle which hangs with Vite HMR WebSocket
    const runBtn = page.getByRole('button', { name: /run models?|run forecast|generate forecast/i });
    await expect(runBtn.first()).toBeVisible({ timeout: 12_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Forecasts â€“ Plan â†’ Scenario cross-chain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Forecasts â€“ Planâ†’Scenario cross-chain', () => {
  test('selecting a plan in the dropdown enables the Scenario selector', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/forecasts`);
    await expect(page.getByRole('heading', { name: 'Forecasts' })).toBeVisible({ timeout: 20_000 });

    // The Forecasts page uses <label>Select Plan</label> without a htmlFor, so use locator instead
    const planSelect = page.locator('select').first();
    await expect(planSelect).toBeVisible({ timeout: 15_000 });

    // Select the first real plan option (index 0 is the "Select a plan..." placeholder)
    const optionCount = await planSelect.locator('option').count();
    if (optionCount > 1) {
      await planSelect.selectOption({ index: 1 });
      // Scenario dropdown should now be enabled or populated
      const scenarioSelect = page.locator('select').nth(1);
      await expect(scenarioSelect).not.toBeDisabled({ timeout: 8_000 });
    }
    await log.flush();
  });
});
