import { test as testBase } from '@playwright/test';
import { addCoverageReport } from 'monocart-reporter';

const test = testBase.extend({
  autoTestFixture: [async ({ page }, use) => {
    const isChromium = test.info().project.name === 'chromium';
    
    // Route env.json to env.example.json for test isolation [SF][TDT]
    await page.route('**/env.json', route => route.fulfill({
      path: 'public/env.example.json',
      contentType: 'application/json'
    }));
    
    if (isChromium) {
      await Promise.all([
        page.coverage.startJSCoverage({ resetOnNavigation: false }),
        page.coverage.startCSSCoverage({ resetOnNavigation: false })
      ]);
    }

    await use('autoTestFixture');

    if (isChromium) {
      const [jsCoverage, cssCoverage] = await Promise.all([
        page.coverage.stopJSCoverage(),
        page.coverage.stopCSSCoverage()
      ]);
      const coverageList = [...jsCoverage, ...cssCoverage];
      await addCoverageReport(coverageList, test.info());
    }
  }, { scope: 'test', auto: true }]
});

export { test };
