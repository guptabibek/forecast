/**
 * Custom Playwright fixtures for authenticated tests.
 *
 * PROBLEM: The API uses refresh-token rotation – each call to POST /auth/refresh
 * revokes the old token and issues a new cookie. Playwright's default `context`
 * fixture is test-scoped, so every test starts with a fresh context loaded from
 * the saved storageState file. When test N uses the refresh token the old token
 * is rotated; test N+1 restores the now-invalid token from the file → 401 →
 * redirect to /login → all subsequent authenticated tests fail.
 *
 * FIX: Override `context` to be worker-scoped. With `workers: 1` (our config)
 * this means all authenticated tests share exactly one browser context. Cookie
 * mutations (rotated refresh token) accumulate in that live context, so every
 * test naturally carries the latest valid token forward.
 */

import { BrowserContext, test as base } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const authStatePath = path.resolve(dirname, '../playwright/.auth/user.json');

export const test = base.extend<
  // Per-test fixtures
  { page: ReturnType<BrowserContext['newPage']> extends Promise<infer P> ? P : never },
  // Worker-level fixtures
  { sharedContext: BrowserContext }
>({
  // ── Worker-scoped context (created once per worker, shared across all tests) ──
  sharedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext({
        storageState: authStatePath,
      });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],

  // Override the built-in `context` to expose the shared context (read-only alias)
  context: async ({ sharedContext }, use) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await use(sharedContext as any);
  },

  // Each test still gets its own Page (isolated tab), but within the shared context
  page: async ({ sharedContext }, use) => {
    const page = await sharedContext.newPage();
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';

