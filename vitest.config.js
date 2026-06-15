import { defineConfig } from 'vitest/config';

// Coverage measures all 19 sections (src/sections/**) — no file-level
// exclusions. A few decision-free DOM/D3 applicators carry function-level
// /* v8 ignore */ markers instead.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/sections/**/*.js'],
      thresholds: { lines: 80 },
      // All 19 sections are counted — no file-level exclusions remain.
      exclude: [],
    },
  },
});
