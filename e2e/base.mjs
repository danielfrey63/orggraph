// Shared Playwright test base: when E2E_COVERAGE=1, Chromium V8 coverage is
// collected per test (surviving in-page reloads) and dumped as raw JSON to
// coverage-e2e/ (OUTSIDE coverage/ — vitest wipes that directory on every
// run), where scripts/merge-e2e-coverage.mjs folds it into the index.html
// lcov record. Without the env flag this is a zero-cost pass-through.
import { test as base, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'coverage-e2e');
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

// Auto-confirm the app's HIL dialogs (E76: own modal, no browser confirm) —
// an init script survives the app's self-reload after a tenant drop. Call
// BEFORE page.goto. Tests that assert on a dialog must not use it.
export async function autoConfirmDialogs(page) {
  await page.addInitScript(() => {
    const clickPrimary = () => {
      const btn = document.querySelector('#og2ConfirmDialog .btn-primary');
      if (btn && !btn.dataset.autoConfirmed) { btn.dataset.autoConfirmed = '1'; btn.click(); }
    };
    const start = () => new MutationObserver(clickPrimary).observe(document.body, { childList: true, subtree: true });
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  });
}

export { expect };
