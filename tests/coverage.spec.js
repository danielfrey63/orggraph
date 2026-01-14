import { test } from './fixtures.js';

test.describe('Coverage Tests', () => {
  test('complete user journey', async ({ page }) => {
    // Verwende baseURL aus Config statt hartkodiertem Port
    await page.goto('/');
    
    // Warten auf App-Initialisierung (SVG-Element statt #org-chart)
    await page.waitForSelector('#graph', { timeout: 10000 });
    
    // Warten auf Datenladung
    await page.waitForTimeout(2000);
    
    // Grundlegende Interaktionen durchführen
    await page.click('#comboInput');
    await page.fill('#comboInput', 'test');
    await page.press('#comboInput', 'Escape');
    
    // Controls testen
    await page.click('.depth-up');
    await page.click('.depth-down');
    
    // Mindestens 3 Sekunden für Coverage-Sammlung
    await page.waitForTimeout(3000);
  });
});
