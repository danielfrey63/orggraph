// AK 106 (FR-7.9/E78): the hover tooltip carries the relations the view does
// NOT draw, as an indented tree — from the view's own `context` queries, or
// from the queries derived from its path when it declares none. It parks in
// the free upper corner opposite the pointer instead of covering the node.
import { test, expect, autoConfirmDialogs } from './base.mjs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = pathToFileURL(join(root, 'index.html')).href;

const DROP_FILES = [
  join(root, 'schema/registry.json'),
  join(root, 'e2e/fixtures/fixture-context-env.json'),
  join(root, 'e2e/fixtures/fixture-snapshot.json'),
];

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

// Hover the circle whose label matches, and return the tooltip text.
async function hoverNode(page, label) {
  const handle = page.locator('g.nodes g.node').filter({ hasText: label }).first();
  await handle.locator('circle').first().hover({ force: true });
  const tip = page.locator('.cluster-tooltip');
  await expect(tip).toBeVisible();
  return tip;
}

test('hover context: derived sections, declared sections, corner placement', async ({ page }) => {
  test.setTimeout(120_000);
  await autoConfirmDialogs(page); // E70 source registration
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto(appUrl);
  await dropFiles(page, DROP_FILES);
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 60_000 });

  // --- View without `context`: sections derived from the path (E78).
  // Max Mittel sits in "Abteilung A" (below "Direktion") and holds role "Dev".
  let tip = await hoverNode(page, 'Max Mittel');
  let text = await tip.textContent();
  expect(text).toContain('Max Mittel');
  expect(text).toContain('OE:');           // cluster hop → membership section
  expect(text).toContain('• Abteilung A');
  expect(text).toContain('  • Direktion'); // one indent deeper: the upward chain
  expect(text).toContain('Rolle:');        // ring hop → badge section
  expect(text).toContain('• Dev');
  // the anchor self-hop (berichtetAn) is drawn by the view, so it is no section
  expect(text).not.toContain('berichtetAn');

  // --- Corner placement (E78): the free upper corner opposite the pointer,
  // derived from where the hovered node actually sits (the layout is a
  // simulation, so the side must not be assumed).
  const viewport = page.viewportSize();
  const nodeBox = await page.locator('g.nodes g.node').filter({ hasText: 'Max Mittel' }).first().locator('circle').first()
    .boundingBox();
  const pointerX = nodeBox.x + nodeBox.width / 2;
  const box = await tip.boundingBox();
  expect(box.y).toBeLessThan(60); // always the UPPER corner
  if (pointerX > viewport.width / 2) {
    expect(box.x).toBeLessThan(60); // pointer right → tooltip left
  } else {
    expect(box.x + box.width).toBeGreaterThan(viewport.width - 60); // pointer left → tooltip right
  }
  // and it never sits under the pointer
  expect(box.x > pointerX + 40 || box.x + box.width < pointerX - 40).toBe(true);

  // --- View with declared `context`: its own labels, [hidden] contracted.
  await page.locator('#viewsLegend .legend-row').filter({ hasText: 'Eigener Kontext' }).click();
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 30_000 });

  tip = await hoverNode(page, 'Max Mittel');
  text = await tip.textContent();
  expect(text).toContain('Zugehörigkeiten:');
  expect(text).toContain('Team-Kollegen:');
  // colleagues through the shared OE — the OE itself is contracted away
  expect(text).toContain('• Nina Mittel');
  expect(text).toContain('• Ben Blatt');
  expect(text).toContain('• Lea Blatt');
  expect(text).not.toContain('• Max Mittel'); // nobody is their own colleague
  // the OE-anchored query belongs to OE nodes, not to persons
  expect(text).not.toContain('Mitglieder:');

  // --- Pseudo mode (E48/E60): the tooltip is no exception.
  await page.locator('#togglePseudonymization').click();
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 30_000 });
  const pseudoTip = await hoverNode(page, (await page.locator('g.nodes g.node text').first().textContent()).trim());
  const pseudoText = await pseudoTip.textContent();
  expect(pseudoText).not.toContain('Nina Mittel');
  expect(pseudoText).not.toContain('Abteilung A');
});
