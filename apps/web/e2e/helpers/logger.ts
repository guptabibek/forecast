/**
 * Shared runtime-error logger for all E2E tests.
 *
 * Usage in a test file:
 *   import { createLogger } from './helpers/logger.js';
 *   const log = createLogger(testInfo);          // inside a test()
 *   log.attach(page);                            // start capturing
 *   ... test body ...
 *   await log.flush();                           // write/attach artifact
 */
import type { Page, TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const ERRORS_LOG = path.resolve(dirname, '../../test-results/e2e/runtime-errors.ndjson');

export interface RuntimeError {
  timestamp: string;
  type: 'page-error' | 'console-error' | 'request-failed';
  message: string;
  url?: string;
}

export interface TestLogger {
  attach: (page: Page) => void;
  flush: () => Promise<void>;
}

export function createLogger(testInfo: TestInfo): TestLogger {
  const errors: RuntimeError[] = [];

  return {
    attach(page: Page) {
      page.on('pageerror', (err) =>
        errors.push({
          timestamp: new Date().toISOString(),
          type: 'page-error',
          message: err.message,
        })
      );

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          errors.push({
            timestamp: new Date().toISOString(),
            type: 'console-error',
            message: msg.text(),
          });
        }
      });

      page.on('requestfailed', (req) =>
        errors.push({
          timestamp: new Date().toISOString(),
          type: 'request-failed',
          url: req.url(),
          message: req.failure()?.errorText ?? 'unknown',
        })
      );
    },

    async flush() {
      const entry = {
        test: testInfo.title,
        project: testInfo.project.name,
        status: testInfo.status,
        errors,
      };

      // Append to global NDJSON log
      fs.mkdirSync(path.dirname(ERRORS_LOG), { recursive: true });
      fs.appendFileSync(ERRORS_LOG, JSON.stringify(entry) + '\n', 'utf-8');

      // Attach errors as artifact so the HTML report also shows them
      if (errors.length > 0) {
        await testInfo.attach('runtime-errors', {
          body: JSON.stringify(errors, null, 2),
          contentType: 'application/json',
        });
      }
    },
  };
}
