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
      // Boundary sections: DOM/D3 applicators (dialogs, legends, rendering,
      // simulation, drop/bootstrap orchestration). Logic found in these files
      // must move into an included section, not be tested through the DOM.
      exclude: [
        'src/sections/02-icons.js',
        'src/sections/03-export-dialog.js',
        'src/sections/05-dropzone.js',
        'src/sections/12-legend-org.js',
        'src/sections/13-clusters-simulation.js',
        'src/sections/14-render.js',
        'src/sections/16-legend-attributes.js',
        'src/sections/17-fuzzy-dialog.js',
        'src/sections/18-files-reset.js',
        'src/sections/19-layout-bootstrap.js',
      ],
    },
  },
});
