/**
 * Test Template - Kopiere diese Datei und benenne sie um
 * 
 * Namenskonvention: [feature].spec.js
 * Beispiele:
 *   - search.spec.js
 *   - navigation.spec.js
 *   - depth-control.spec.js
 *   - legend.spec.js
 */
import { test } from './fixtures.js';

test.describe('Feature Name', () => {
  
  test.beforeEach(async ({ page }) => {
    // Seite laden (verwendet baseURL aus Config)
    await page.goto('/');
    await page.waitForSelector('#graph', { timeout: 10000 });
  });

  test('test case 1', async ({ page }) => {
    // Dein aufgezeichneter Code hier
    await page.waitForTimeout(100); // Placeholder - ersetzen
  });

  test('test case 2', async ({ page }) => {
    // Weiterer Test
    await page.waitForTimeout(100); // Placeholder - ersetzen
  });

});
