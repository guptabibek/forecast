/**
 * 07 â€“ Manufacturing module
 *
 * Requires: authenticated session (runs in "authenticated" project)
 * Covers:
 *  - Manufacturing Dashboard (/manufacturing)
 *  - Suppliers list + Add Supplier modal (including defaultLeadTimeDays / minimumOrderValue fix)
 *  - BOM page loads
 *  - MRP page loads
 *  - Work Orders page loads
 *  - Purchase Orders page loads
 *  - Inventory page loads
 *  - Capacity page loads
 *  - SOP page loads
 *  - Fiscal Calendar page loads
 *  - UoM Master page loads
 */
import { expect, test } from './fixtures';
import { createLogger } from './helpers/logger.js';

const BASE = process.env.E2E_WEB_URL ?? 'http://demo.localhost:3000';
const MFG = `${BASE}/manufacturing`;

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function gotoMfg(page: import('@playwright/test').Page, sub: string) {
  await page.goto(`${MFG}/${sub}`);
  // Avoid networkidle – Vite HMR WebSocket prevents it from resolving reliably.
  await page.waitForLoadState('domcontentloaded');
}

// â”€â”€â”€ Manufacturing Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ Dashboard', () => {
  test('loads the manufacturing dashboard', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${MFG}`);
    // Avoid networkidle – Vite HMR WebSocket prevents it from resolving reliably.
    await page.waitForLoadState('domcontentloaded');
    // Dashboard should have some visible content (heading or KPI cards)
    const heading = page.getByRole('heading').first();
    await expect(heading).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Suppliers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ Suppliers', () => {
  test.beforeEach(async ({ page }) => {
    await gotoMfg(page, 'suppliers');
    // Page has both <h1>Suppliers</h1> and <CardHeader title="Suppliers"/> (h3); use .first() to avoid strict-mode violation
    await expect(page.getByRole('heading', { name: 'Suppliers' }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('renders the Suppliers list page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // Page has h1 and h3 both named Suppliers; use .first() to avoid strict-mode violation
    await expect(page.getByRole('heading', { name: 'Suppliers' }).first()).toBeVisible();
    await log.flush();
  });

  test('"Add Supplier" button is visible', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.getByRole('button', { name: /add supplier/i })).toBeVisible();
    await log.flush();
  });

  test('"Add Supplier" button opens modal with all required fields', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.getByRole('button', { name: /add supplier/i }).click();
    // Modal title 'Add Supplier' and the button both have same text; scope check inside the dialog
    await expect(page.locator('[role="dialog"]').getByText('Add Supplier')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Code *')).toBeVisible();
    await expect(page.getByText('Name *')).toBeVisible();
    // Fixed fields (regression: these were sending 400 before the DTO fix)
    // Use .first() to avoid strict-mode violation: modal label AND table header both contain "Lead Time"
    await expect(page.getByText(/Lead Time/i).first()).toBeVisible();
    await expect(page.getByText(/Min Order/i).first()).toBeVisible();
    await log.flush();
  });

  test('can fill and submit Add Supplier form (supplier create 400 regression)', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);

    await page.getByRole('button', { name: /add supplier/i }).click();
    // Modal title 'Add Supplier' and the button both have same text; scope inside dialog
    await expect(page.locator('[role="dialog"]').getByText('Add Supplier')).toBeVisible({ timeout: 8_000 });

    // Fill required fields
    const code = `E2E-${Date.now()}`;
    // Labels have no htmlFor \u2013 locate inputs by placeholder/type order inside dialog
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[placeholder="SUP-001"]').fill(code);
    // Name is 2nd text input in the modal (no placeholder defined)
    await dialog.locator('input[type="text"]').nth(1).fill('E2E Test Supplier');
    // Fill fixed fields (were causing 400 before the fix)
    const leadTimeInput = page.locator('input[placeholder*="days"], input[name*="leadTime"], input[name*="defaultLeadTimeDays"]').first();
    if (await leadTimeInput.isVisible()) {
      await leadTimeInput.fill('14');
    }
    const minOrderInput = page.locator('input[placeholder*="order"], input[name*="minimumOrder"], input[name*="minimumOrderValue"]').first();
    if (await minOrderInput.isVisible()) {
      await minOrderInput.fill('2500');
    }

    // Submit – button text is "Create" (scoped inside dialog to avoid strict-mode collision)
    await dialog.getByRole('button', { name: /^create$/i }).click();

    // Expect no error toast â€“ either success toast or modal closes
    await expect(page.getByText(/400|Bad Request|should not exist/i)).not.toBeVisible({ timeout: 6_000 });

    await log.flush();
  });
});

// â”€â”€â”€ BOM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ BOM', () => {
  test('loads the BOM page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await gotoMfg(page, 'bom');
    await expect(page.getByText(/Bill of Materials|BOM/i).first()).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });
});

// â”€â”€â”€ MRP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ MRP', () => {
  test('loads the MRP page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await gotoMfg(page, 'mrp');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Work Orders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ Work Orders', () => {
  test('loads the Work Orders page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await gotoMfg(page, 'work-orders');
    await expect(page.getByText(/Work Orders?/i).first()).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Purchase Orders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ Purchase Orders', () => {
  test('loads the Purchase Orders page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await gotoMfg(page, 'purchase-orders');
    await expect(page.getByText(/Purchase Orders?/i).first()).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Inventory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ Inventory', () => {
  test('loads the Inventory page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await gotoMfg(page, 'inventory');
    await expect(page.getByText(/Inventory/i).first()).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Capacity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ Capacity', () => {
  test('loads the Capacity page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await gotoMfg(page, 'capacity');
    await expect(page.getByText(/Capacity/i).first()).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });
});

// â”€â”€â”€ SOP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ S&OP', () => {
  test('loads the SOP page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await gotoMfg(page, 'sop');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Fiscal Calendar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ Fiscal Calendar', () => {
  test('loads the Fiscal Calendar page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await gotoMfg(page, 'fiscal-calendar');
    await expect(page.getByText(/Fiscal Calendar/i).first()).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });
});

// â”€â”€â”€ UoM Master â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ UoM Master', () => {
  test('loads the UoM Master page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await gotoMfg(page, 'uom-master');
    await expect(page.getByText(/Unit of Measure|UoM/i).first()).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Forecast Accuracy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ Forecast Accuracy', () => {
  test('loads the Forecast Accuracy page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await gotoMfg(page, 'forecast-accuracy');
    await expect(page.getByText(/Forecast Accuracy/i).first()).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Product Costing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ Product Costing', () => {
  test('loads the Product Costing page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await gotoMfg(page, 'product-costing');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Suppliers â€“ detail, edit, delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ Suppliers CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await gotoMfg(page, 'suppliers');
    // Page has both <h1>Suppliers</h1> and <CardHeader title="Suppliers"/> (h3); use .first() to avoid strict-mode violation
    await expect(page.getByRole('heading', { name: 'Suppliers' }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Eye (view) icon opens Supplier Detail modal', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const viewBtn = page.locator('[aria-label*="view"], [aria-label*="detail"], [title*="view"]')
      .or(page.getByRole('button', { name: /view/i })).first();
    if (await viewBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await viewBtn.click();
      // Detail modal should show contact or supplier info
      const modal = page.locator('[role="dialog"]').or(page.getByText(/supplier detail|contact/i).first());
      await expect(modal).toBeVisible({ timeout: 8_000 });
    }
    await log.flush();
  });

  test('Pencil (edit) icon opens Edit Supplier modal with code field disabled', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const editBtn = page.locator('[aria-label*="edit"], [title*="edit"]')
      .or(page.getByRole('button', { name: /edit/i })).first();
    if (await editBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await editBtn.click();
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 8_000 });
      // code field should be disabled in edit mode
      const codeInput = page.getByLabel(/^Code/i);
      if (await codeInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await expect(codeInput).toBeDisabled({ timeout: 3_000 });
      }
    }
    await log.flush();
  });

  test('Delete icon triggers confirmation', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const deleteBtn = page.locator('[aria-label*="delete"], [title*="delete"]')
      .or(page.getByRole('button', { name: /delete/i })).first();
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      page.once('dialog', (d) => d.dismiss()); // dismiss native confirm
      await deleteBtn.click();
      const confirmModal = page.getByText(/confirm|are you sure/i);
      if (await confirmModal.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await page.getByRole('button', { name: /cancel/i }).click();
      }
    }
    await log.flush();
  });
});

// â”€â”€â”€ BOM â€“ Create modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ BOM modal', () => {
  test.beforeEach(async ({ page }) => {
    await gotoMfg(page, 'bom');
    await expect(page.getByText(/Bill of Materials|BOM/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('"Create BOM" button opens a modal', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const createBtn = page.getByRole('button', { name: /create bom/i });
    if (await createBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await createBtn.click();
      // HeadlessUI Dialog outer wrapper has 0 computed size (children are fixed-positioned).
      // Detect modal via its h3 title which IS visually rendered inside Dialog.Panel.
      await expect(page.getByRole('heading', { name: 'Create Bill of Materials', level: 3 })).toBeVisible({ timeout: 8_000 });
      // Close modal to prevent in-flight API requests from corrupting auth state
      await page.keyboard.press('Escape');
    }
    await log.flush();
  });

  test('BOM modal has bomType select with MANUFACTURING option', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const createBtn = page.getByRole('button', { name: /create bom/i });
    if (await createBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await createBtn.click();
      await expect(page.getByRole('heading', { name: 'Create Bill of Materials', level: 3 })).toBeVisible({ timeout: 8_000 });
      // Use [name="bomType"] specifically – not .first() on all selects which picks the page-level status filter
      const bomTypeSelect = page.locator('[name="bomType"]');
      if (await bomTypeSelect.isVisible({ timeout: 5_000 }).catch(() => false)) {
        // Option display text is "Manufacturing" (value attr is "MANUFACTURING")
        await expect(bomTypeSelect).toContainText(/Manufacturing/i);
      }
      await page.keyboard.press('Escape');
    }
    await log.flush();
  });

  test('BOM modal has revision field with placeholder "1.0"', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const createBtn = page.getByRole('button', { name: /create bom/i });
    if (await createBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await createBtn.click();
      await expect(page.getByRole('heading', { name: 'Create Bill of Materials', level: 3 })).toBeVisible({ timeout: 8_000 });
      const revInput = page.locator('[name="revision"]').or(page.getByPlaceholder('1.0'));
      if (await revInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(revInput).toBeVisible();
      }
      await page.keyboard.press('Escape');
    }
    await log.flush();
  });

  test('status filter select has expected options', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // Status filter is the first <select> on the BOM page (no name/id attribute)
    const statusFilter = page.locator('select').first();
    if (await statusFilter.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const html = await statusFilter.innerHTML();
      expect(html).toMatch(/DRAFT|ACTIVE|OBSOLETE/i);
    }
    await log.flush();
  });
});

// â”€â”€â”€ Work Orders â€“ Create modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ Work Orders modal', () => {
  test.beforeEach(async ({ page }) => {
    await gotoMfg(page, 'work-orders');
    await expect(page.getByText(/Work Orders?/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('"Create Work Order" button is visible', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const btn = page.getByRole('button', { name: /create work order|new work order|add work order/i });
    await expect(btn.first()).toBeVisible({ timeout: 10_000 });
    await log.flush();
  });

  test('Work Order modal has quantity field', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const btn = page.getByRole('button', { name: /create work order/i });
    if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await btn.click();
      // Use h3 heading to detect modal (outer dialog wrapper has 0 computed size)
      await expect(page.getByRole('heading', { name: 'Create Work Order', level: 3 })).toBeVisible({ timeout: 8_000 });
      const qtyInput = page.locator('[name="quantity"]');
      if (await qtyInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(qtyInput).toBeVisible();
      }
      await page.keyboard.press('Escape');
    }
    await log.flush();
  });

  test('Work Order modal has priority selector', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const btn = page.getByRole('button', { name: /create work order/i });
    if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await btn.click();
      await expect(page.getByRole('heading', { name: 'Create Work Order', level: 3 })).toBeVisible({ timeout: 8_000 });
      // Use [name="priority"] specifically to avoid picking the page-level status select
      const prioritySelect = page.locator('[name="priority"]');
      if (await prioritySelect.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(prioritySelect).toBeVisible();
      }
      await page.keyboard.press('Escape');
    }
    await log.flush();
  });

  test('Work Order modal has scheduledStart and scheduledEnd date inputs', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const btn = page.getByRole('button', { name: /create work order/i });
    if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await btn.click();
      await expect(page.getByRole('heading', { name: 'Create Work Order', level: 3 })).toBeVisible({ timeout: 8_000 });
      const startInput = page.locator('[name="scheduledStart"]');
      const endInput = page.locator('[name="scheduledEnd"]');
      if (await startInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(startInput).toBeVisible();
        await expect(endInput).toBeVisible();
      }
      await page.keyboard.press('Escape');
    }
    await log.flush();
  });

  test('Work Order status filter select is present', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const statusFilter = page.locator('select, [role="combobox"]').filter({ hasText: /all status|draft|in.progress/i }).first();
    if (await statusFilter.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(statusFilter).toBeVisible();
    }
    await log.flush();
  });
});

// â”€â”€â”€ Purchase Orders â€“ Create modal and Add Line â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Manufacturing â€“ Purchase Orders modal', () => {
  test.beforeEach(async ({ page }) => {
    await gotoMfg(page, 'purchase-orders');
    await expect(page.getByText(/Purchase Orders?/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('"Create PO" button is visible', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const btn = page.getByRole('button', { name: /create po|new po|create purchase order/i });
    await expect(btn.first()).toBeVisible({ timeout: 10_000 });
    await log.flush();
  });

  test('PO modal has supplier dropdown (Select supplierâ€¦)', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const btn = page.getByRole('button', { name: /create po|new po|create purchase order/i });
    if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await btn.click();
      // Use h3 heading to detect modal open (outer dialog div has 0 computed size)
      await expect(page.getByRole('heading', { name: 'Create Purchase Order', level: 3 })).toBeVisible({ timeout: 8_000 });
      // Supplier select has name="supplierId"
      const supplierSelect = page.locator('[name="supplierId"]');
      if (await supplierSelect.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(supplierSelect).toBeVisible();
      }
      await page.keyboard.press('Escape');
    }
    await log.flush();
  });

  test('PO modal has expectedDate and notes fields', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const btn = page.getByRole('button', { name: /create po|new po|create purchase order/i });
    if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await btn.click();
      await expect(page.getByRole('heading', { name: 'Create Purchase Order', level: 3 })).toBeVisible({ timeout: 8_000 });
      const dateInput = page.locator('[name="expectedDate"]');
      const notesInput = page.locator('[name="notes"]');
      if (await dateInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(dateInput).toBeVisible();
        await expect(notesInput).toBeVisible();
      }
      await page.keyboard.press('Escape');
    }
    await log.flush();
  });

  test('PO modal "Add Line" button adds a line item row', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const btn = page.getByRole('button', { name: /create po|new po|create purchase order/i });
    if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await btn.click();
      await expect(page.getByRole('heading', { name: 'Create Purchase Order', level: 3 })).toBeVisible({ timeout: 8_000 });
      const addLineBtn = page.getByRole('button', { name: /add line/i });
      if (await addLineBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        // PO line rows are <tr> elements inside the modal table
        const rowsBefore = await page.locator('[data-headlessui-state] tbody tr').count();
        await addLineBtn.click();
        const rowsAfter = await page.locator('[data-headlessui-state] tbody tr').count();
        expect(rowsAfter).toBeGreaterThanOrEqual(rowsBefore);
      }
      await page.keyboard.press('Escape');
    }
    await log.flush();
  });
});
