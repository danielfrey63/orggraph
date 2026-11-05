import { defineConfig } from 'vitest/config';

// Coverage measures every section (src/sections/**) AND the script layer
// (build.js, the coverage post-processors, scripts/*.mjs) — no file-level
// exclusions. A few decision-free DOM/D3 applicators carry function-level
// /* v8 ignore */ markers instead.
//
// The script layer used to be outside the include list, which made its gaps
// invisible: the e2e coverage merge mismapped every line for months and the
// index.html remap aborted on every run, both unnoticed. Scripts that only
// run against local, git-ignored reference data (the AK/NFR measurements)
// stay in the denominator on purpose — they are honestly uncovered, not
// exempt.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/sections/**/*.js', 'scripts/**/*.mjs', 'build.js', 'remap-coverage.js', 'verify.js'],
      thresholds: { lines: 80 },
      // Everything in the include list is counted — no file-level exclusions.
      exclude: [],
    },
  },
});
