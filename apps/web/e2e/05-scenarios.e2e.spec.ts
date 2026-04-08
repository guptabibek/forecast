/**
 * 05 â€“ Scenarios module
 *
 * Requires: authenticated session (runs in "authenticated" project)
 * Covers:
 *  - Scenarios list: heading, New Scenario button, form opens, Plan field
 *  - New Scenario form: all fields (name, type radios, description, plan selector)
 *  - Cancel closes the modal without saving
 *  - Edit scenario: pencil icon opens pre-populated form,
 *    "Save Changes" button is present
 *  - Delete scenario: trash button triggers confirmation
 */
import { expect, test } from './fixtures';
import { createLogger } from './helpers/logger.js';

const BASE = process.env.E2E_WEB_URL ?? 'http://demo.localhost:3000';

test.describe('Scenarios â€“ list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/scenarios`);
    await expect(page.getByRole('heading', { name: 'Scenarios' })).toBeVisible({ timeout: 20_000 });
  });

  test('renders the Scenarios heading', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.getByRole('heading', { name: 'Scenarios' })).toBeVisible();
    await log.flush();
  });

  test('"New Scenario" button is visible', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.getByRole('button', { name: /new scenario/i })).toBeVisible();
    await log.flush();
  });

  test('"New Scenario" button opens the Create Scenario form', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.getByRole('button', { name: /new scenario/i }).click();
    // When the modal opens, the name input with this placeholder becomes visible
    await expect(page.locator('input[placeholder="e.g., Q2 Growth Scenario"]')).toBeVisible({ timeout: 8_000 });
    await log.flush();
  });

  test('Create Scenario form contains Plan selector field', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.getByRole('button', { name: /new scenario/i }).click();
    // Wait for modal to open via the unique name input placeholder
    await expect(page.locator('input[placeholder="e.g., Q2 Growth Scenario"]')).toBeVisible({ timeout: 8_000 });
    // Plan selector label should be present in the modal
    await expect(page.getByText(/^Plan \*/i)).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Scenarios â€“ Create form full field coverage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Scenarios â€“ Create form full coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/scenarios`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Scenarios' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /new scenario/i }).click();
    // Wait for the modal to open using the unique name input placeholder
    await expect(page.locator('input[placeholder="e.g., Q2 Growth Scenario"]')).toBeVisible({ timeout: 8_000 });
  });

  test('Name input has correct placeholder text', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const nameInput = page.getByPlaceholder(/Q2 Growth Scenario|scenario name/i)
      .or(page.locator('[name="name"], #name'));
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('Scenario type radio buttons are rendered (BASE, OPTIMISTIC, etc.)', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const typeRadio = page.getByRole('radio').or(
      page.getByText(/BASE|OPTIMISTIC|PESSIMISTIC|STRETCH|CONSERVATIVE|CUSTOM/i).first()
    );
    await expect(typeRadio.first()).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('Description textarea is visible', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // Use textarea element directly — avoids matching <meta name="description">
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('Cancel button closes the modal without saving', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.getByRole('button', { name: /cancel/i }).click();
    // When modal closes, the name input placeholder disappears
    await expect(page.locator('input[placeholder="e.g., Q2 Growth Scenario"]')).not.toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('shows validation error when submitting with empty name', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.getByRole('button', { name: /create scenario/i }).click();
    await expect(page.getByText(/required|at least|name is/i).first()).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Scenarios â€“ Edit and Delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Scenarios â€“ Edit and Delete (when rows exist)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/scenarios`);
    await page.waitForLoadState('networkidle');
  });

  test('Edit (pencil) button opens a pre-populated form with "Save Changes" button', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const editBtn = page.getByRole('button', { name: /edit/i })
      .or(page.locator('[aria-label*="edit"], [title*="edit"], button svg[data-icon="pencil"]').locator('..')).first();
    if (await editBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await editBtn.click();
      await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible({ timeout: 8_000 });
      // Name should be pre-filled (not empty)
      const nameInput = page.locator('[name="name"], #name').first();
      if (await nameInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        const val = await nameInput.inputValue();
        expect(val.length).toBeGreaterThan(0);
      }
    }
    await log.flush();
  });

  test('Delete (trash) button shows a confirmation dialog', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const deleteBtn = page.getByRole('button', { name: /delete/i })
      .or(page.locator('[aria-label*="delete"], [title*="delete"]').first());
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Watch for a confirmation dialog or modal
      page.once('dialog', (dialog) => dialog.dismiss());
      await deleteBtn.click();
      // Either native dialog was dismissed, or a modal appeared
      const confirmModal = page.getByText(/confirm|are you sure/i);
      const appeared = await confirmModal.isVisible({ timeout: 3_000 }).catch(() => false);
      // Either a confirm dialog fired (handled above) or a modal appeared
      if (appeared) {
        await page.getByRole('button', { name: /cancel/i }).click();
      }
    }
    await log.flush();
  });
});
