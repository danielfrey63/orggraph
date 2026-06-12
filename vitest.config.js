import { defineConfig } from 'vitest/config';

// Coverage measures the pure logic only. Boundary sections (decision-free
// DOM/D3 applicators per AUFTRAG.md principle 3/4) are excluded from the
// denominator; the exclude list grows as sections are classified.
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
      // Boundary sections: DOM/D3 applicators (dialogs, legends, rendering,
      // simulation, drop/bootstrap orchestration). Logic found in these files
      // must move into an included section, not be tested through the DOM.
      exclude: [
        'src/sections/14-render.js',
      ],
    },
  },
});
