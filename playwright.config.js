import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    }
  ],
  
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['monocart-reporter', {
      name: 'OrgGraph Coverage Report',
      outputFile: './coverage-report/index.html',
      coverage: {
        outputDir: './coverage',
        reports: [
          ['v8'],
          ['lcovonly']
        ]
      }
    }]
  ],
  
  use: {
    headless: true,
    trace: 'on-first-retry',
    baseURL: 'http://localhost:5173',
  },
  
  webServer: {
    command: 'npm run dev:example',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  }
});
