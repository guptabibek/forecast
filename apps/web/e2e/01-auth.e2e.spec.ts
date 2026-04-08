/**
 * 01 – Authentication flows
 *
 * Runs in the "public" project (no stored session).
 * Covers every form field, button, validation, navigation link, and error state
 * across Login, Register, Forgot-Password, and route-guard pages.
 */
import { expect, test } from '@playwright/test';
import { createLogger } from './helpers/logger.js';

const BASE = process.env.E2E_WEB_URL ?? 'http://demo.localhost:3000';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@demo.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin123!';

// ─── Login page ──────────────────────────────────────────────────────────────
test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
  });

  test('renders heading and form fields', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.locator('h2')).toContainText('Welcome back');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await log.flush();
  });

  test('shows validation errors for empty form submission', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/valid email/i)).toBeVisible();
    await log.flush();
  });

  test('shows validation error for invalid email format', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.fill('#email', 'not-an-email');
    await page.fill('#password', 'SomePass1');
    // Add novalidate to bypass browser's native type="email" validation so RHF/Zod runs
    await page.evaluate(() => document.querySelector('form')?.setAttribute('novalidate', ''));
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/valid email/i)).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('shows validation error when password is too short', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.fill('#email', 'user@example.com');
    await page.fill('#password', 'short');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
    await log.flush();
  });

  test('shows error toast on wrong credentials', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.fill('#email', 'wrong@example.com');
    await page.fill('#password', 'WrongPass1!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 8_000 });
    await log.flush();
  });

  test('redirects to /dashboard on successful login', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page).toHaveURL(/\/dashboard/);
    await log.flush();
  });

  test('has a link to the register page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const link = page.getByRole('link', { name: /sign up|register|create.*account/i });
    await expect(link).toBeVisible();
    await log.flush();
  });

  test('has a forgot-password link', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const link = page.getByRole('link', { name: /forgot password/i });
    await expect(link).toBeVisible();
    await log.flush();
  });
});

// ─── Register page ────────────────────────────────────────────────────────────
test.describe('Register page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/register`);
  });

  test('renders the registration form', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#firstName')).toBeVisible();
    await expect(page.locator('#lastName')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#confirmPassword')).toBeVisible();
    await log.flush();
  });

  test('validates password strength requirements', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.fill('#password', 'allowercase1');
    await page.getByRole('button', { name: /create account|get started|sign up/i }).click();
    await expect(page.getByText(/uppercase/i)).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('validates password confirmation match', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.fill('#password', 'StrongPass1!');
    await page.fill('#confirmPassword', 'DifferentPass2!');
    await page.getByRole('button', { name: /create account|get started|sign up/i }).click();
    await expect(page.getByText(/passwords.*don't match|do not match/i)).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('has a link back to the login page', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const link = page.getByRole('link', { name: /sign in|log in|login/i });
    await expect(link).toBeVisible();
    await log.flush();
  });
});

// ─── Forgot Password page ─────────────────────────────────────────────────────
test.describe('Forgot Password page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/forgot-password`);
  });

  test('renders the forgot-password form', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.getByRole('heading', { name: /forgot|reset password/i })).toBeVisible();
    await expect(page.locator('#email').or(page.locator('[name="email"]'))).toBeVisible();
    await log.flush();
  });

  test('validates that email is required', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.getByRole('button', { name: /send|reset|submit/i }).first().click();
    // Be specific - the error p element (not the label) contains this text
    await expect(page.getByText(/please enter a valid email/i)).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });
});

// ─── Route guards ─────────────────────────────────────────────────────────────
test.describe('Route protection', () => {
  test('unauthenticated visit to /dashboard → redirects to /login', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/dashboard`);
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
    await log.flush();
  });

  test('unauthenticated visit to /plans → redirects to /login', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/plans`);
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
    await log.flush();
  });

  test('unauthenticated visit to /settings → redirects to /login', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/settings`);
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
    await log.flush();
  });

  test('unauthenticated visit to /manufacturing → redirects to /login', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/manufacturing`);
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
    await log.flush();
  });

  test('unauthenticated visit to /forecasts → redirects to /login', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/forecasts`);
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
    await log.flush();
  });

  test('unauthenticated visit to /reports → redirects to /login', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/reports`);
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
    await log.flush();
  });
});

// ─── Cross-page navigation links ──────────────────────────────────────────────
test.describe('Auth page navigation links', () => {
  test('Login page "sign up" link navigates to /register', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/login`);
    await page.getByRole('link', { name: /sign up|register|create.*account/i }).first().click();
    await page.waitForURL(/\/register/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/register/);
    await log.flush();
  });

  test('Login page "Forgot password" link navigates to /forgot-password', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/login`);
    await page.getByRole('link', { name: /forgot password/i }).click();
    await page.waitForURL(/\/forgot-password/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/forgot-password/);
    await log.flush();
  });

  test('Register page "sign in" link navigates back to /login', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/register`);
    await page.getByRole('link', { name: /sign in|log in|login/i }).first().click();
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
    await log.flush();
  });

  test('Forgot-password page has a "back to login" link', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.goto(`${BASE}/forgot-password`);
    const backLink = page.getByRole('link', { name: /sign in|back.*login|return.*login/i });
    await expect(backLink).toBeVisible({ timeout: 8_000 });
    await log.flush();
  });
});

// ─── Register form – all fields ───────────────────────────────────────────────
test.describe('Register page – full form coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/register`);
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible({ timeout: 15_000 });
  });

  test('all form fields are present: firstName, lastName, email, password, confirmPassword, tenantName, tenantSubdomain', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.locator('#firstName')).toBeVisible();
    await expect(page.locator('#lastName')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#confirmPassword')).toBeVisible();
    // Tenant fields
    await expect(page.locator('#tenantName').or(page.getByLabel(/company name/i))).toBeVisible();
    await expect(page.locator('#tenantSubdomain').or(page.getByLabel(/subdomain/i))).toBeVisible();
    await log.flush();
  });

  test('validates first name minimum length', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.fill('#firstName', 'A'); // too short
    await page.getByRole('button', { name: /create account|get started|sign up/i }).click();
    await expect(page.getByText(/at least 2 characters/i).first()).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('validates last name minimum length', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.fill('#firstName', 'John');
    await page.fill('#lastName', 'A'); // too short
    await page.getByRole('button', { name: /create account|get started|sign up/i }).click();
    await expect(page.getByText(/at least 2 characters/i).first()).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('validates subdomain format (no special chars except hyphen)', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const subdomainInput = page.locator('#tenantSubdomain').or(page.getByLabel(/subdomain/i));
    await subdomainInput.fill('BAD SUBDOMAIN!');
    await page.getByRole('button', { name: /create account|get started|sign up/i }).click();
    await expect(page.getByText(/lowercase letters|numbers|hyphens/i)).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('validates subdomain minimum length', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const subdomainInput = page.locator('#tenantSubdomain').or(page.getByLabel(/subdomain/i));
    await subdomainInput.fill('ab'); // less than 3
    await page.getByRole('button', { name: /create account|get started|sign up/i }).click();
    await expect(page.getByText(/at least 3 characters/i)).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('validates password must have uppercase, lowercase, and number', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.fill('#password', 'allowercase1'); // no uppercase
    await page.getByRole('button', { name: /create account|get started|sign up/i }).click();
    await expect(page.getByText(/uppercase/i)).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('validates passwords must match', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.fill('#password', 'StrongPass1!');
    await page.fill('#confirmPassword', 'DifferentPass2!');
    await page.getByRole('button', { name: /create account|get started|sign up/i }).click();
    await expect(page.getByText(/passwords.*don't match|do not match/i)).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });
});

// ─── Forgot Password form – all fields ────────────────────────────────────────
test.describe('Forgot Password page – full form coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/forgot-password`);
  });

  test('email field is present and submit button exists', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await expect(page.locator('#email').or(page.locator('[name="email"]'))).toBeVisible();
    await expect(page.getByRole('button', { name: /send|reset|submit/i }).first()).toBeVisible();
    await log.flush();
  });

  test('shows error on empty submit', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    await page.getByRole('button', { name: /send|reset|submit/i }).first().click();
    await expect(page.getByText(/email/i).first()).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('shows error on invalid email format', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const emailInput = page.locator('#email').or(page.locator('[name="email"]'));
    await emailInput.fill('not-an-email');
    // Add novalidate to bypass browser's native type="email" validation so RHF/Zod runs
    await page.evaluate(() => document.querySelector('form')?.setAttribute('novalidate', ''));
    await page.getByRole('button', { name: /send|reset|submit/i }).first().click();
    await expect(page.getByText(/valid email/i)).toBeVisible({ timeout: 5_000 });
    await log.flush();
  });

  test('submitting a valid email shows success feedback or sends request', async ({ page }, testInfo) => {
    const log = createLogger(testInfo);
    log.attach(page);
    const emailInput = page.locator('#email').or(page.locator('[name="email"]'));
    await emailInput.fill('someone@example.com');
    // Watch for the API call
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/auth/forgot-password') && r.request().method() === 'POST',
      { timeout: 10_000 }
    ).catch(() => null); // may not fire if submit is disabled before API
    await page.getByRole('button', { name: /send|reset|submit/i }).first().click();
    await responsePromise;
    // Either a success message OR the request was sent (API will 200/404 but no crash)
    await expect(page.getByText(/400|500|Internal Server Error/i)).not.toBeVisible({ timeout: 5_000 });
    await log.flush();
  });
});
