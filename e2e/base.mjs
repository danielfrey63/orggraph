// Shared Playwright test base: when E2E_COVERAGE=1, Chromium V8 coverage is
// collected per test (surviving in-page reloads) and dumped as raw JSON to
// coverage/e2e-raw/, where scripts/merge-e2e-coverage.mjs folds it into the
// index.html lcov record. Without the env flag this is a zero-cost pass-through.
import { test as base, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'coverage', 'e2e-raw');
const collecting = !!process.env.E2E_COVERAGE;
let dumpSeq = 0;

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    if (collecting) {
      try { await page.coverage.startJSCoverage({ resetOnNavigation: false }); } catch { /* non-Chromium */ }
    }
    await use(page);
    if (collecting) {
      try {
        const entries = await page.coverage.stopJSCoverage();
        mkdirSync(OUT, { recursive: true });
        const name = `w${testInfo.workerIndex}-${testInfo.testId || 't'}-${dumpSeq++}.json`;
        writeFileSync(join(OUT, name), JSON.stringify(entries));
      } catch { /* page already closed */ }
    }
  },
});

export { expect };
