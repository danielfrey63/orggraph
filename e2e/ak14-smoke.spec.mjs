// AK 14 — UI interaction inventory (§9.5) on the committed fixture tenant:
// every "Übernehmen"/"Neu" interaction exists and reacts; every "Entfällt"
// element no longer exists. Runs against the v2 boot path (registry via
// REGISTRY_URL, store seeded from the DATA_URL snapshot).
import { test, expect } from '@playwright/test';

const NODE_CIRCLES = 'g.nodes circle:not(.attribute-circle)';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // v2 boot: fixture tenant renders the start view without a start id
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(5, { timeout: 30_000 });
});

test('start view renders nodes, cluster hulls and ring badges', async ({ page }) => {
  await expect(page.locator('path.cluster')).toHaveCount(2);
  await expect(page.locator('circle.attribute-circle').first()).toBeVisible();
  await expect(page.locator('g.links line')).toHaveCount(4);
});

test('Entfällt (E22/E23): direction toggle and apply button do not exist', async ({ page }) => {
  await expect(page.locator('#directionToggle')).toHaveCount(0);
  await expect(page.locator('#apply')).toHaveCount(0);
});

test('Entfällt (§9.3): attribute upload/save/download controls do not exist', async ({ page }) => {
  await expect(page.locator('#loadAttributes')).toHaveCount(0);
  await expect(page.locator('#attributeFileInput')).toHaveCount(0);
  await expect(page.locator('#attributeUploadBtn, #attrUpload, .attr-save-btn, .attr-download-btn')).toHaveCount(0);
});

test('depth stepper re-renders reactively (FR-7.7, FR-8.11)', async ({ page }) => {
  // depth 3 -> 1: only p1 and its direct reports stay visible
  await page.locator('#depthControl .depth-down').click();
  await page.locator('#depthControl .depth-down').click();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(3);
  await page.locator('#depthControl .depth-up').click();
  await page.locator('#depthControl .depth-up').click();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(5);
});

test('leaf filter hides leafProp-marked nodes (FR-8.3)', async ({ page }) => {
  await page.locator('#toggleManagement').click();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(3); // Ben/Lea (isBasis) hidden
  await page.locator('#toggleManagement').click();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(5);
});

test('search combo selects a runtime root (FR-7.6, FR-8.4)', async ({ page }) => {
  const input = page.locator('#comboInput');
  await input.fill('Ben');
  await expect(page.locator('#comboList li').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('#comboList li').first().click();
  // Ben as root, depth 3: nothing reports to Ben -> only Ben visible
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(1);
});

test('AK 97: views legend is the topmost section and switches views (FR-7.5)', async ({ page }) => {
  // the footer view switcher is gone — the views legend replaces it
  await expect(page.locator('#viewSwitcherSelect')).toHaveCount(0);
  const firstSection = page.locator('#legendPane .legend-section').first();
  await expect(firstSection.locator('.legend-title')).toHaveText('Views');
  const rows = page.locator('#viewsLegend .legend-row');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('#viewsLegend .legend-row.active .legend-label-chip')).toHaveText('Start');
  await rows.filter({ hasText: 'Nur Hierarchie' }).click();
  await expect(page.locator('path.cluster')).toHaveCount(0); // no cluster station in that path
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(5);
  await expect(page.locator('#viewsLegend .legend-row.active .legend-label-chip')).toHaveText('Nur Hierarchie');
  await page.locator('#viewsLegend .legend-row').filter({ hasText: 'Start' }).click();
  await expect(page.locator('path.cluster')).toHaveCount(2);
});

test('AK 98: save current scene as a named view, survives reload (FR-7.5a)', async ({ page }) => {
  page.on('dialog', (d) => d.accept('Meine View'));
  // depth 3 -> 1 so the saved view differs from Start
  await page.locator('#depthControl .depth-down').click();
  await page.locator('#depthControl .depth-down').click();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(3);
  await page.locator('#viewsSection .legend-header').hover(); // actions appear on hover
  await page.locator('#saveViewBtn').click({ force: true });
  await expect(page.locator('#viewsLegend .legend-row')).toHaveCount(4);
  await expect(page.locator('#viewsLegend .legend-row.active .legend-label-chip')).toHaveText('Meine View');
  // persisted in env.VIEWS: still there and still active after a reload
  await page.waitForTimeout(700); // let the state write land (debounced 400ms)
  await page.reload();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(3, { timeout: 30_000 });
  await expect(page.locator('#viewsLegend .legend-row')).toHaveCount(4);
  await expect(page.locator('#viewsLegend .legend-row.active .legend-label-chip')).toHaveText('Meine View');
});

test('AK 99: session state survives a reload (FR-8.14)', async ({ page }) => {
  // deselect one cluster, let the debounced state write land, reload
  const firstRow = page.locator('#legend .legend-row').first();
  await firstRow.waitFor();
  const before = await page.locator('path.cluster').count();
  await firstRow.click();
  await page.waitForTimeout(500);
  const afterDeselect = await page.locator('path.cluster').count();
  expect(afterDeselect).toBeLessThan(before);
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(5, { timeout: 30_000 });
  await expect(page.locator('path.cluster')).toHaveCount(afterDeselect, { timeout: 15_000 });
  // now change the depth and reload again: the depth is restored too
  await page.locator('#depthControl .depth-down').click();
  await page.locator('#depthControl .depth-down').click();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(3);
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(3, { timeout: 30_000 });
  await expect(page.locator('#depthControl .depth-value')).toHaveText('1');
});

test('toolbar toggles exist and stay operable (§9.4)', async ({ page }) => {
  for (const id of ['#toggleHierarchy', '#toggleLabels', '#fit', '#toggleSimulation', '#togglePseudonymization', '#debugBtn']) {
    await expect(page.locator(id)).toHaveCount(1);
  }
  await page.locator('#toggleLabels').click();
  await page.locator('#toggleHierarchy').click();
  await page.locator('#fit').click();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(5); // still rendered
});

test('export dialog opens and closes (FR-8.8)', async ({ page }) => {
  await page.locator('#exportBtn').click();
  const dialog = page.locator('#exportModal');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('profile switcher renders in the footer (FR-8.9)', async ({ page }) => {
  await expect(page.locator('#profileSwitcher')).toHaveCount(1);
});

test('native context menu is suppressed globally (FR-8.7)', async ({ page }) => {
  const prevented = await page.evaluate(() => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(true);
});

test('pseudo mode is fail-closed in the browser (FR-8.5, E48 — AK 27 basis)', async ({ page }) => {
  // fixture tenant ships no pseudo pools: toggling pseudo on must replace
  // EVERY label with the generic '<Typname> N' fallback, never a real name
  await page.locator('#togglePseudonymization').click();
  await page.waitForTimeout(500);
  const labels = await page.locator('g.nodes text.label').allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(label).not.toMatch(/Vera|Max|Nina|Ben|Lea/);
    expect(label).toMatch(/^Person \d+$/);
  }
});

test('AK 93: legend deselection survives a depth change (FR-8.2a)', async ({ page }) => {
  // deselect one cluster by clicking its legend row (the checkbox itself is
  // a hidden styled input)
  const firstRow = page.locator('#legend .legend-row').first();
  await firstRow.waitFor();
  const before = await page.locator('path.cluster').count();
  await firstRow.click();
  await page.waitForTimeout(500);
  const afterDeselect = await page.locator('path.cluster').count();
  expect(afterDeselect).toBeLessThan(before);
  // change the depth: the deselection must survive (no auto re-enable)
  await page.locator('#depthControl .depth-up').click();
  await page.waitForTimeout(800);
  expect(await page.locator('path.cluster').count()).toBe(afterDeselect);
});

test('AK 94: attribute focus prunes the projected scene (FR-8.10a)', async ({ page }) => {
  const circles = page.locator('g.nodes circle:not(.attribute-circle)');
  const before = await circles.count();
  // hide the Team category via its eye toggle, then focus: members whose
  // only badge is a Team ring must disappear together with their branches
  const teamRow = page.locator('#attributeLegend .legend-row', { hasText: 'Team' }).first();
  await teamRow.hover(); // action buttons appear on row hover
  await teamRow.locator('.legend-icon-btn[title*="ausblenden"]').click({ force: true });
  await page.locator('#toggleAttributeFocus').click({ force: true });
  await expect(async () => {
    const focused = await circles.count();
    expect(focused).toBeGreaterThan(0);
    expect(focused).toBeLessThan(before);
  }).toPass({ timeout: 15_000 });
  // toggle off restores the scene (poll: enter transition is animated)
  await page.locator('#toggleAttributeFocus').click({ force: true });
  await expect(circles).toHaveCount(before, { timeout: 15_000 });
});

test('AK 101: view contexts — returning to a view restores its exact scene (FR-7.5b)', async ({ page }) => {
  // set a runtime root in Start (Ben has no reports -> 1 circle)
  const input = page.locator('#comboInput');
  await input.fill('Ben');
  await expect(page.locator('#comboList li').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('#comboList li').first().click();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(1);
  // switch to the other view: renders ITS defaults (all 5 persons)
  await page.locator('#viewsLegend .legend-row').filter({ hasText: 'Nur Hierarchie' }).click();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(5, { timeout: 15_000 });
  // switch back: Start's context (root Ben) returns — not the view defaults
  await page.locator('#viewsLegend .legend-row').filter({ hasText: 'Start' }).click();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(1, { timeout: 15_000 });
});

test('AK 102: env view defaults apply on first entry (FR-7.5b)', async ({ page }) => {
  const before = await page.locator(NODE_CIRCLES).count(); // Start: 5
  // Team-Fokus declares defaults: Team category hidden + attribute focus on
  // -> members whose only ring is a Team badge vanish with their branches
  await page.locator('#viewsLegend .legend-row').filter({ hasText: 'Team-Fokus' }).click();
  await expect(async () => {
    const focused = await page.locator(NODE_CIRCLES).count();
    expect(focused).toBeGreaterThan(0);
    expect(focused).toBeLessThan(before);
  }).toPass({ timeout: 15_000 });
  const focusBtn = page.locator('#toggleAttributeFocus');
  await expect(focusBtn).toHaveClass(/active/);
  // back to Start: its own context is untouched by the defaults of the other view
  await page.locator('#viewsLegend .legend-row').filter({ hasText: 'Start' }).click();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(before, { timeout: 15_000 });
  await expect(focusBtn).not.toHaveClass(/active/);
});

test('AK 89: SVG export in pseudo mode carries no raw tenant value (FR-8.5)', async ({ page }) => {
  // raw values of the fixture tenant: labels, ids, emails, org/team names
  const RAW = ['Vera', 'Max', 'Nina', 'Ben', 'Pia', 'Lea',
    'vera@example.org', 'max@example.org', 'nina@example.org', 'ben@example.org', 'pia@example.org',
    'Chefin', 'Meister', 'Mittel', 'Blatt', 'Neu',
    'Direktion', 'Abteilung A', 'Team Rom'];
  await page.locator('#togglePseudonymization').click();
  await page.waitForTimeout(500);
  await page.locator('#exportBtn').click();
  await page.locator('.format-btn[data-format="svg"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#downloadSvg').click();
  const download = await downloadPromise;
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const svgText = readFileSync(path, 'utf8');
  expect(svgText.length).toBeGreaterThan(1000); // a real scene was exported
  for (const raw of RAW) {
    expect(svgText, `raw tenant value "${raw}" leaked into the export`).not.toContain(raw);
  }
  // interaction-only carriers are stripped as a class, not just by value
  expect(svgText).not.toContain('data-attribute');
});

test('time controls active with two stands; slider slices, diff classifies (FR-8.6, AK 4/50)', async ({ page }) => {
  const slider = page.locator('#timeSlider');
  await expect(slider).toBeEnabled(); // two snapshot stands in the fixture tenant
  // youngest stand: Pia visible, Lea gone
  await expect(page.locator('g.nodes text.label').filter({ hasText: 'Pia Neu' })).toHaveCount(1);
  await expect(page.locator('g.nodes text.label').filter({ hasText: 'Lea Blatt' })).toHaveCount(0);
  // slide to the oldest stand: Lea returns, Pia not yet there
  await slider.fill('0');
  await slider.dispatchEvent('input');
  await expect(page.locator('g.nodes text.label').filter({ hasText: 'Lea Blatt' })).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('g.nodes text.label').filter({ hasText: 'Pia Neu' })).toHaveCount(0);
  // back to youngest, then diff T1->T2
  await slider.fill('1');
  await slider.dispatchEvent('input');
  await page.locator('#diffToggle').click();
  await expect(page.locator('g.nodes g.node.diff-new')).toHaveCount(1, { timeout: 15_000 });   // Pia
  await expect(page.locator('g.nodes g.node.diff-removed')).toHaveCount(1);                     // Lea
  await expect(page.locator('g.nodes g.node.diff-changed')).toHaveCount(1);                     // Max label change
  await expect(page.locator('#stats-diff')).toBeVisible();
  // back to asOf mode
  await page.locator('#diffToggle').click();
  await expect(page.locator('#stats-diff')).toBeHidden();
});
