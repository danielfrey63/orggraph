// Ensure the browser the e2e suite launches is installed before Playwright runs.
// Wired as npm pre-hook of e2e / e2e:acceptance / coverage:e2e: on a fresh
// clone (or after a Playwright upgrade) every spec would otherwise fail with
// "Executable doesn't exist" — 26 red tests for a missing download.
// Idempotent: a present executable is a silent no-op; otherwise the one-time
// `playwright install chromium` runs (it skips builds already on disk).
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const exe = chromium.executablePath();
if (exe && existsSync(exe)) process.exit(0);

console.log(`[e2e] Playwright Chromium missing (${exe || 'unknown path'}) — installing once...`);
execSync('npx playwright install chromium', { stdio: 'inherit' });
