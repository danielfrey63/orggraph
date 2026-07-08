// Repro of the manual live-test sequence (2026-07-08): SEM ZIP -> screenshot
// -> drop the edited env (new views) -> switch to the new view -> switch back
// -> compare the scenes. Diagnostic only, not part of the suites.
import { test, expect } from './base.mjs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = pathToFileURL(join(root, 'index.html')).href;
const OUT = join(root, 'test-results', 'repro-view-switch');

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

async function sceneStats(page) {
  return {
    circles: await page.locator('g.nodes circle:not(.attribute-circle)').count(),
    clusters: await page.locator('path.cluster').count(),
    links: await page.locator('g.links line').count(),
    status: (await page.locator('#status').textContent()) || '',
    activeView: (await page.locator('#viewsLegend .legend-row.active .legend-label-chip').allTextContents()).join(','),
  };
}

test('repro: SEM zip -> env update -> view switch roundtrip', async ({ page }) => {
  test.setTimeout(600_000);
  page.on('dialog', (d) => d.accept());
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, t.slice(0, 300));
    if (/Transition|transitionGraph|og2ApplyFromUI/.test(t)) console.log('[app]', t.slice(0, 220));
  });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));

  // 1) import the SEM tenant ZIP
  await page.goto(appUrl);
  await expect(page.locator('.dz-overlay')).toBeVisible();
  await dropFiles(page, [join(root, 'data/migration/legacy-sem.tenant.zip')]);
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).not.toHaveCount(0, { timeout: 300_000 });
  await page.waitForTimeout(4000); // let the sim settle
  const s1 = await sceneStats(page);
  console.log('SCENE 1 (after ZIP boot):', JSON.stringify(s1));
  await page.screenshot({ path: join(OUT, '1-after-zip.png') });

  // 2) drop the edited env (OrgChart + Teams + TeamCluster); re-enable app logging right
  // after the self-reload's script evaluates (debugMode is a top-level let)
  await page.addInitScript(() => {
    const arm = () => { try { debugMode = true; } catch (_) { setTimeout(arm, 200); } };
    setTimeout(arm, 200);
  });
  await dropFiles(page, [join(root, 'data/migration/legacy-sem.env.json')]);
  // wait for the self-reload (scene empties), then for the re-rendered scene:
  // the env renamed the views, OrgChart is fresh, so the env start root
  // applies (FR-7.5b) and the reference scene must return (432 persons)
  await page.waitForFunction(
    () => document.querySelectorAll('g.nodes circle:not(.attribute-circle)').length === 0,
    null, { timeout: 60_000 },
  );
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(432, { timeout: 120_000 });
  await page.waitForTimeout(2000);
  const s2 = await sceneStats(page);
  console.log('SCENE 2 (after env drop):', JSON.stringify(s2));
  await page.screenshot({ path: join(OUT, '2-after-env.png') });

  // 3) switch to the Teams view: 16 team nodes + 176 members, membership
  // lines drawn (216 imTeam edges), roles as rings, no hulls
  await page.locator('#viewsLegend .legend-row', { hasText: 'Teams' }).first().click();
  await page.waitForTimeout(8000);
  const s3 = await sceneStats(page);
  console.log('SCENE 3 (Teams):', JSON.stringify(s3));
  await page.screenshot({ path: join(OUT, '3-teams.png') });
  expect(s3.circles).toBe(192);
  expect(s3.clusters).toBe(0);
  expect(s3.links).toBe(216);

  // 3b) switch to the TeamCluster view: same scene as hulls — 176 member
  // circles inside 16 team hulls, membership is containment (no lines)
  await page.locator('#viewsLegend .legend-row', { hasText: 'TeamCluster' }).click();
  await page.waitForTimeout(8000);
  const s3b = await sceneStats(page);
  console.log('SCENE 3b (TeamCluster):', JSON.stringify(s3b));
  await page.screenshot({ path: join(OUT, '3b-teamcluster.png') });
  expect(s3b.circles).toBe(176);
  expect(s3b.clusters).toBe(16);
  expect(s3b.links).toBe(0);

  // 3c) switch to the TeamOE view: team nodes + members + role rings, and
  // the members' OEs as nested hulls (45 direct + 14 parents at depth 3)
  await page.locator('#viewsLegend .legend-row', { hasText: 'TeamOE' }).click();
  await page.waitForTimeout(8000);
  const s3c = await sceneStats(page);
  console.log('SCENE 3c (TeamOE):', JSON.stringify(s3c));
  await page.screenshot({ path: join(OUT, '3c-teamoe.png') });
  expect(s3c.circles).toBe(192);
  expect(s3c.clusters).toBe(59);
  expect(s3c.links).toBe(216);

  // 5) switch BACK to the old view (OrgChart): the view context must return
  // the EXACT previous scene — never the __auto__ full projection (AK 101)
  await page.locator('#viewsLegend .legend-row', { hasText: 'OrgChart' }).click();
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(432, { timeout: 60_000 });
  await page.waitForTimeout(2000);
  const s4 = await sceneStats(page);
  console.log('SCENE 4 (back on OrgChart):', JSON.stringify(s4));
  await page.screenshot({ path: join(OUT, '4-back-orgchart.png') });
  expect(s4.clusters).toBe(48);
  expect(s4.links).toBe(431);
});
