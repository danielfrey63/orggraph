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

test('view switcher exists and switching views re-projects (FR-7.5, Neu)', async ({ page }) => {
  const sel = page.locator('#viewSwitcherSelect');
  await expect(sel).toHaveCount(1);
  await sel.selectOption('Nur Hierarchie');
  await expect(page.locator('path.cluster')).toHaveCount(0); // no cluster station in that path
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(5);
  await sel.selectOption('Start');
  await expect(page.locator('path.cluster')).toHaveCount(2);
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
