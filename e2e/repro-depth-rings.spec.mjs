// Repro of the live-test finding (2026-07-08, AK 103): SEM ZIP boot at depth
// 3, then deepen to 4 and 5. Before the fix, the 8 env-hidden subtrees burned
// the E67 cap budget inside the projection (capped at depth 4 with only 1017
// visible persons, Kohorte-I stuck at 5). With hidden subtrees excluded from
// the projection, depth 4 shows the full uncapped scene: 1585 persons, 152
// hulls, Kohorte-I 18/19; depth 5 caps honestly at 2000.
import { test, expect } from '@playwright/test';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = pathToFileURL(join(root, 'index.html')).href;
const OUT = join(root, 'test-results', 'repro-depth-rings');

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

async function waitStable(page, minCount, timeoutMs) {
  // the scene builds level by level (BFS animation) — wait until the circle
  // count stops changing for 3 consecutive seconds AND exceeds minCount
  await page.waitForFunction((min) => {
    const n = document.querySelectorAll('g.nodes circle:not(.attribute-circle)').length;
    if (n < min) { window.__stab = null; return false; }
    if (!window.__stab || window.__stab.n !== n) { window.__stab = { n, t: Date.now() }; return false; }
    return Date.now() - window.__stab.t > 3000;
  }, minCount, { timeout: timeoutMs });
}

async function sceneStats(page) {
  const kohorteRow = page.locator('#attributeLegend .legend-row', { hasText: 'Kohorte I - POPM' });
  return {
    depth: await page.locator('#depth').inputValue(),
    circles: await page.locator('g.nodes circle:not(.attribute-circle)').count(),
    clusters: await page.locator('path.cluster').count(),
    links: await page.locator('g.links line').count(),
    badges: await page.locator('circle.attribute-circle').count(),
    kohorteI: (await kohorteRow.count()) ? (await kohorteRow.first().textContent()).trim() : '(row not found)',
    footerVisible: (await page.locator('#stats-visible').textContent()).trim(),
    capped: await page.locator('#stats-capped').isVisible() ? (await page.locator('#stats-capped').textContent()).trim() : 'not capped',
  };
}

test('repro: deepen OrgChart to 4 and 5 — do Kohorte-I ring badges follow?', async ({ page }) => {
  test.setTimeout(900_000);
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text().slice(0, 300));
  });

  await page.goto(appUrl);
  await expect(page.locator('.dz-overlay')).toBeVisible();
  await dropFiles(page, [join(root, 'data/migration/legacy-sem.tenant.zip')]);
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(432, { timeout: 300_000 });
  await page.waitForTimeout(2000);
  console.log('DEPTH 3:', JSON.stringify(await sceneStats(page)));
  await page.screenshot({ path: join(OUT, 'depth-3.png') });

  // depth 3 -> 4: full scene, no capping, Kohorte-I rings follow (AK 103)
  await page.locator('#depthControl .depth-up').click();
  await waitStable(page, 1400, 300_000);
  const d4 = await sceneStats(page);
  console.log('DEPTH 4:', JSON.stringify(d4));
  await page.screenshot({ path: join(OUT, 'depth-4.png') });
  expect(d4.circles).toBe(1585);
  expect(d4.clusters).toBe(152);
  expect(d4.kohorteI).toContain('(18)');
  expect(d4.capped).toBe('not capped');

  // depth 4 -> 5: the cap fires honestly (2000 visible incl. hulls)
  await page.locator('#depthControl .depth-up').click();
  await waitStable(page, 1400, 300_000);
  const d5 = await sceneStats(page);
  console.log('DEPTH 5:', JSON.stringify(d5));
  await page.screenshot({ path: join(OUT, 'depth-5.png') });
  expect(d5.circles).toBe(1818);
  expect(d5.capped).toContain('gekappt');
});
