import { defineConfig } from '@playwright/test';

// Two projects: 'smoke' (AK 14 interaction inventory on the committed
// fixture tenant — always runnable) and 'acceptance' (AK 1 layer counting on
// the migrated SEM reference — skips itself without local migration output).
// Run: npx playwright test --project=smoke | --project=acceptance
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8643',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'node e2e/serve.mjs',
    port: 8643,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'smoke', testMatch: /ak14-smoke\.spec\.mjs|drop-intake\.spec\.mjs/ },
    { name: 'acceptance', testMatch: /ak1-reference\.spec\.mjs/ },
    // ad-hoc live-test reproductions; never part of smoke/acceptance gates
    { name: 'repro', testMatch: /repro-.*\.spec\.mjs/ },
  ],
});
