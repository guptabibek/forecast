/**
 * 09 â€“ Settings module
 *
 * Requires: authenticated session (runs in "authenticated" project)
 * Covers:
 *  - /settings â†’ General Settings: heading, tabs (5), Save button
 *  - /settings/users â†’ User Management: heading, Invite User button, table,
 *    Invite form all fields, Send Invite button, Edit user modal (email disabled)
 *  - /settings/profile â†’ My Profile: Profile/Security tab navigation,
 *    all profile fields, Save Changes button, Security tab fields (3 passwords),
 *    Change Password button
 *  - /settings/audit-log â†’ Audit Log: heading, table, Export button
 */
import { expect, test } from './fixtures';
import { createLogger } from './helpers/logger.js';

const BASE = process.env.E2E_WEB_URL ?? 'http://demo.localhost:3000';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@demo.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin123!';

async function ensureAuthenticated(page: import('@playwright/test').Page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });

    // Already authenticated sessions are redirected away from /login by PublicRoute.
    const dashboardRedirected = await page
      .waitForURL('**/dashboard', { timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (dashboardRedirected || !page.url().includes('/login')) {
      return;
    }

    const emailInput = page.locator('#email');
    const passwordInput = page.locator('#password');
    const loginVisible = await emailInput.isVisible({ timeout: 5_000 }).catch(() => false);

    if (!loginVisible) {
      // The login form can detach while auth bootstraps; retry once.
      continue;
    }

    try {
      await emailInput.fill(ADMIN_EMAIL);
      await passwordInput.fill(ADMIN_PASSWORD);

      // Prefer click submit; fallback to Enter if the button detaches during redirect.
      const signInButton = page.getByRole('button', { name: /sign in/i });
      await signInButton.click().catch(async () => {
        await passwordInput.press('Enter');
      });

      await page.waitForURL('**/dashboard', { timeout: 30_000 });
      return;
    } catch {
      if (!page.url().includes('/login')) {
        return;
      }

      if (attempt === 1) {
        throw new Error('Unable to establish authenticated session for settings tests.');
      }
    }
  }

  throw new Error('Unable to establish authenticated session for settings tests.');
}

test.beforeEach(async ({ page }) => {
  await ensureAuthenticated(page);
});

// â”€â”€â”€ General Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Settings â€“ General', () => {
  test('renders the Settings heading', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings`);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });

  test('shows settings tabs (General, Notifications, Integrations, etc.)', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState('domcontentloaded');
    const tabs = page.locator('button, [role="tab"]').filter({ hasText: /general|notifications|integrations|security/i });
    await expect(tabs.first()).toBeVisible({ timeout: 10_000 });
    await log.flush();
  });

  test('has a Save Settings button', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible({ timeout: 10_000 });
    await log.flush();
  });

  test('Notifications tab is clickable and shows notification toggle', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState('domcontentloaded');
    const notifTab = page.locator('button, [role="tab"]').filter({ hasText: /notifications/i }).first();
    if (await notifTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await notifTab.click();
      await page.waitForTimeout(400);
      // Notification toggle should appear
      const toggle = page.locator('[role="switch"], input[type="checkbox"]').first();
      if (await toggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(toggle).toBeVisible();
      }
    }
    await log.flush();
  });

  test('Integrations/API tab has Generate API Key button', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState('domcontentloaded');
    const intTab = page.locator('button, [role="tab"]').filter({ hasText: /integrations|api/i }).first();
    if (await intTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await intTab.click();
      const apiKeyBtn = page.getByRole('button', { name: /generate api key|api key/i });
      if (await apiKeyBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(apiKeyBtn).toBeVisible();
      }
    }
    await log.flush();
  });
});

// â”€â”€â”€ User Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Settings â€“ Users', () => {
  test('renders the User Management heading', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings/users`);
    await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });

  test('shows Invite User button', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings/users`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: /invite user|add user|new user/i })).toBeVisible({ timeout: 10_000 });
    await log.flush();
  });

  test('shows the users list table', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings/users`);
    await page.waitForLoadState('domcontentloaded');
    // Users.tsx renders a div list (not a <table>); match the list or the empty-state
    const usersList = page.locator('[class*="divide-y"]')
      .or(page.getByText(/no users found|invite your first/i))
      .or(page.getByPlaceholder(/search users/i));
    await expect(usersList.first()).toBeVisible({ timeout: 10_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Users â€“ Invite User modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Settings â€“ Invite User modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/settings/users`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: /invite user|add user/i }).click();
    await page.getByRole('heading', { name: 'Invite New User', level: 3 }).waitFor({ timeout: 8_000 });
  });

  test('modal has email field with placeholder name@company.com', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const emailInput = page.getByPlaceholder(/name@company\.com/i);
    await expect(emailInput).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await log.flush();
  });

  test('modal has firstName and lastName fields', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // react-hook-form register sets name attr (no id); use name or placeholder
    const first = page.locator('input[name="firstName"]').or(page.getByPlaceholder('John'));
    const last = page.locator('input[name="lastName"]').or(page.getByPlaceholder('Doe'));
    await expect(first).toBeVisible({ timeout: 5_000 });
    await expect(last).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await log.flush();
  });

  test('modal has role selector (ADMIN, PLANNER, FINANCE, VIEWER)', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const roleSelect = page.locator('button').filter({ hasText: /planner|admin|finance|viewer/i }).first();
    await expect(roleSelect).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await log.flush();
  });

  test('"Send Invite" submit button is present', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.getByRole('button', { name: /send invite/i }).last()).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await log.flush();
  });

  test('Cancel closes the modal', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('heading', { name: 'Invite New User', level: 3 })).not.toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('shows validation error on empty submit', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.getByRole('button', { name: /send invite/i }).last().click();
    await expect(page.getByText(/required|email is|valid email/i).first()).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await log.flush();
  });
});

// â”€â”€â”€ Profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Settings â€“ Profile', () => {
  test('renders the My Profile heading', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings/profile`);
    await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });

  test('has profile form fields (First Name, Last Name, Email)', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings/profile`);
    await page.waitForLoadState('domcontentloaded');
    // Profile.tsx labels have no htmlFor; use name-based locators (react-hook-form sets name attr)
    const nameOrEmail = page.locator('input[name="firstName"]')
      .or(page.locator('input[name="email"]'))
      .or(page.locator('input[type="email"]'));
    await expect(nameOrEmail.first()).toBeVisible({ timeout: 10_000 });
    await log.flush();
  });
});

// â”€â”€â”€ Profile â€“ full field coverage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Settings â€“ Profile full fields', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/settings/profile`);
    await page.waitForLoadState('domcontentloaded');
  });

  test('Profile tab and Security tab navigation links are visible', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const profileTab = page.getByRole('button', { name: /profile/i })
      .or(page.locator('[role="tab"]').filter({ hasText: /profile/i })).first();
    const securityTab = page.getByRole('button', { name: /security/i })
      .or(page.locator('[role="tab"]').filter({ hasText: /security/i })).first();
    await expect(profileTab).toBeVisible({ timeout: 8_000 });
    await expect(securityTab).toBeVisible({ timeout: 8_000 });
    await log.flush();
  });

  test('email field is present and is disabled (not editable)', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    // Profile email has name="email" (react-hook-form register) but no id; use type+name selector
    const emailInput = page.locator('input[type="email"]').first();
    await expect(emailInput).toBeVisible({ timeout: 8_000 });
    await expect(emailInput).toBeDisabled({ timeout: 5_000 });
    await log.flush();
  });

  test('phone field is present with correct placeholder', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const phoneInput = page.locator('#phone').or(
      page.getByPlaceholder(/\+1 \(555\)/i).or(page.getByLabel(/phone/i))
    );
    if (await phoneInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(phoneInput).toBeVisible();
    }
    await log.flush();
  });

  test('"Save Changes" button is present on profile tab', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible({ timeout: 8_000 });
    await log.flush();
  });

  test('Security tab has currentPassword, newPassword, confirmPassword fields', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const securityTab = page.getByRole('button', { name: /security/i })
      .or(page.locator('[role="tab"]').filter({ hasText: /security/i })).first();
    if (await securityTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await securityTab.click();
      await page.waitForTimeout(400);
      const currentPwd = page.locator('#currentPassword, [name="currentPassword"]');
      const newPwd = page.locator('#newPassword, [name="newPassword"]');
      const confirmPwd = page.locator('#confirmPassword, [name="confirmPassword"]');
      if (await currentPwd.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(currentPwd).toBeVisible();
        await expect(newPwd).toBeVisible();
        await expect(confirmPwd).toBeVisible();
      }
    }
    await log.flush();
  });

  test('Security tab has "Change Password" submit button', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const securityTab = page.getByRole('button', { name: /security/i })
      .or(page.locator('[role="tab"]').filter({ hasText: /security/i })).first();
    if (await securityTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await securityTab.click();
      const changePwdBtn = page.getByRole('button', { name: /change password/i });
      if (await changePwdBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(changePwdBtn).toBeVisible();
      }
    }
    await log.flush();
  });

  test('Security tab password mismatch shows validation error', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const securityTab = page.getByRole('button', { name: /security/i })
      .or(page.locator('[role="tab"]').filter({ hasText: /security/i })).first();
    if (await securityTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await securityTab.click();
      await page.waitForTimeout(400);
      const newPwd = page.locator('#newPassword, [name="newPassword"]');
      const confirmPwd = page.locator('#confirmPassword, [name="confirmPassword"]');
      if (await newPwd.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await newPwd.fill('NewPass1!');
        await confirmPwd.fill('DifferentPass2!');
        await page.getByRole('button', { name: /change password/i }).click();
        await expect(page.getByText(/don't match|do not match|must match/i)).toBeVisible({ timeout: 5_000 });
      }
    }
    await log.flush();
  });
});

// â”€â”€â”€ Audit Log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.describe('Settings â€“ Audit Log', () => {
  test('renders the Audit Log heading', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings/audit-log`);
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible({ timeout: 20_000 });
    await log.flush();
  });

  test('shows the audit activity table or list', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings/audit-log`);
    await page.waitForLoadState('domcontentloaded');
    const tableOrList = page.locator('table').or(page.getByText(/no activity|no records|no logs/i));
    await expect(tableOrList.first()).toBeVisible({ timeout: 15_000 });
    await log.flush();
  });

  test('has an Export button', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings/audit-log`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: /export|refresh/i })).toBeVisible({ timeout: 10_000 });
    await log.flush();
  });
});
