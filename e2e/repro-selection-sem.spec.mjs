// Repro of the live-test finding (2026-09-14) on the migrated SEM tenant:
// does selecting a single Team ring row highlight its members? Prints the
// badge/dimming state with everything on (boot default) and after clearing
// all rings first.
import { test, expect } from './base.mjs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = pathToFileURL(join(root, 'index.html')).href;

async function dropFiles(page, files) {
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.id = '__drop_input__';
    input.style.display = 'none';
    document.body.appendChild(input);
  });
  await page.setInputFiles('#__drop_input__', files);
  await page.evaluate(() => {
    const input = document.getElementById('__drop_input__');
    const dt = new DataTransfer();
    for (const f of input.files) dt.items.add(f);
    input.remove();
    document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
}

async function state(page) {
  return page.evaluate(() => ({
    nodes: document.querySelectorAll('g.nodes circle:not(.attribute-circle)').length,
    dimmed: document.querySelectorAll('g.nodes .node.attr-dimmed').length,
    withAttributes: document.querySelectorAll('g.nodes .node.has-attributes').length,
    badges: document.querySelectorAll('circle.attribute-circle').length,
    teamBadges: document.querySelectorAll('circle.attribute-circle[data-attribute^="Team::"]').length,
    activeAttributes: typeof activeAttributes !== 'undefined' ? activeAttributes.size : null,
    attributeTypes: typeof attributeTypes !== 'undefined' ? attributeTypes.size : null,
    hiddenCategories: typeof hiddenCategories !== 'undefined' ? [...hiddenCategories] : null,
    hulls: document.querySelectorAll('path.cluster').length,
    allowedOrgs: typeof allowedOrgs !== 'undefined' ? allowedOrgs.size : null,
  }));
}

test('repro SEM: Team ring row selection with everything on vs. nothing on', async ({ page }) => {
  test.setTimeout(600_000);
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
  await page.goto(appUrl);
  await expect(page.locator('.dz-overlay')).toBeVisible();
  await dropFiles(page, [join(root, 'data/migration/legacy-sem.tenant.zip')]);
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(432, { timeout: 300_000 });
  await page.waitForTimeout(2000);
  console.log('BOOT', JSON.stringify(await state(page)));

  const teamRows = page.locator('#attributeLegend .legend-row[data-attribute-color]').filter({ has: page.locator('[title*="Team ::"]') });
  console.log('team rows:', await teamRows.count());
  const firstTeam = teamRows.first();
  console.log('first team row:', (await firstTeam.textContent()).trim());

  // everything on (boot default): toggle the row off and on again
  await firstTeam.click();
  await page.waitForTimeout(500);
  console.log('ALL ON, TEAM OFF', JSON.stringify(await state(page)));
  await firstTeam.click();
  await page.waitForTimeout(500);
  console.log('ALL ON, TEAM ON', JSON.stringify(await state(page)));

  // nothing on, then only this team row
  await page.locator('#toggleAllAttributes').click();
  await page.waitForTimeout(500);
  console.log('ALL OFF', JSON.stringify(await state(page)));
  await page.locator('#attributeLegend .legend-row[data-attribute-color]').filter({ has: page.locator('[title*="Team ::"]') }).first().click();
  await page.waitForTimeout(500);
  console.log('ALL OFF, TEAM ON', JSON.stringify(await state(page)));
});
