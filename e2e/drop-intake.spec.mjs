// Regression for the manual live-test case (E25/FR-6.7, NFR-8): open the
// built single file via file:// (no server, no fetch fallbacks), drag the
// tenant files in (registry + env + a SMALL snapshot fixture), confirm the
// E70 source-registration dialog, and expect a rendered scene after the
// app's self-reload. Also locks the failure modes that used to end silently:
// a clean console under file://, a visible hint for an empty drop, and the
// legacy-v1 env rejection.
import { test, expect } from '@playwright/test';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = pathToFileURL(join(root, 'index.html')).href;

const DROP_FILES = [
  join(root, 'schema/registry.json'),
  join(root, 'e2e/fixtures/fixture-drop-env.json'),
  join(root, 'e2e/fixtures/fixture-snapshot.json'),
];

// dispatch a real DataTransfer drop with the files loaded via a hidden input
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

test('file:// drop intake: registry + env + small snapshot boot into a rendered scene', async ({ page }) => {
  test.setTimeout(120_000);
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', (d) => d.accept()); // E70 source registration

  await page.goto(appUrl);
  // pristine profile: the app asks for files instead of fetching anything
  await expect(page.locator('.dz-overlay')).toBeVisible();
  await expect(page.locator('#status')).toContainText('Drag & Drop');

  await dropFiles(page, DROP_FILES);
  // the app persists the profile, reloads itself, imports the pending
  // snapshot (with the accepted E70 dialog) and renders the start view
  // (fixture: 5 persons, 2 OE hulls)
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 60_000 });
  await expect(page.locator('path.cluster')).toHaveCount(2);
  await expect(page.locator('.dz-overlay')).toBeHidden();

  // NFR-8: the offline single-file mode stays console-clean — no fetch/CORS
  // noise under file:// (ignore favicon lookups some platforms emit)
  const relevant = consoleErrors.filter((t) => !/favicon/i.test(t));
  expect(relevant, `console errors:\n${relevant.join('\n')}`).toEqual([]);
});

test('file:// drop intake: env+snapshot without a registry names the missing piece', async ({ page }) => {
  test.setTimeout(60_000);
  page.on('dialog', (d) => d.accept());
  await page.goto(appUrl);
  await expect(page.locator('.dz-overlay')).toBeVisible();
  await dropFiles(page, [DROP_FILES[1], DROP_FILES[2]]); // env + snapshot only
  // after the self-reload the boot must say WHAT is missing, not the generic hint
  await expect(page.locator('#status')).toContainText('Typ-Registry fehlt', { timeout: 30_000 });
  // dropping the registry afterwards completes the tenant
  await dropFiles(page, [DROP_FILES[0]]);
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 60_000 });
});

test('file:// drop intake: empty and legacy drops never end silently', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(appUrl);
  await expect(page.locator('.dz-overlay')).toBeVisible();

  // empty drop -> explicit hint instead of silence
  await page.evaluate(() => {
    document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  });
  await expect(page.locator('body')).toContainText('Keine lesbaren Dateien', { timeout: 10_000 });

  // legacy v1 env (attribute references) -> rejected with the migration hint
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify({ DATA_URL: './data.json', DATA_ATTRIBUTES_URL: ['./attrs/Team.tsv'] })], 'env.json', { type: 'application/json' }));
    document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator('body')).toContainText('migrate-legacy', { timeout: 10_000 });
});
