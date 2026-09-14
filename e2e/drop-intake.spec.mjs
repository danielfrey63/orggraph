// Regression for the manual live-test case (E25/FR-6.7, NFR-8): open the
// built single file via file:// (no server, no fetch fallbacks), drag the
// tenant files in (registry + env + a SMALL snapshot fixture), confirm the
// E70 source-registration dialog, and expect a rendered scene after the
// app's self-reload. Also locks the failure modes that used to end silently:
// a clean console under file://, a visible hint for an empty drop, and the
// legacy-v1 env rejection.
import { test, expect } from './base.mjs';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { buildZip } from '../scripts/package-tenants.mjs';

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
  // pristine profile: the app asks for files instead of fetching anything,
  // and the drop zone names the three required tenant files
  await expect(page.locator('.dz-overlay')).toBeVisible();
  await expect(page.locator('.dz-text')).toContainText('registry.json');
  await expect(page.locator('.dz-text')).toContainText('env.json');
  await expect(page.locator('.dz-text')).toContainText('Snapshot');
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

test('file:// drop intake: one tenant ZIP boots the whole tenant (FR-6.7)', async ({ page }) => {
  test.setTimeout(60_000);
  page.on('dialog', (d) => d.accept());
  // small on-the-fly ZIP from the same fixtures, written like package-tenants
  const zip = buildZip(DROP_FILES.map((f) => ({ name: f.split(/[\/]/).pop(), data: readFileSync(f) })));
  const zipPath = join(mkdtempSync(join(tmpdir(), 'og2-zip-')), 'tenant.zip');
  writeFileSync(zipPath, zip);

  await page.goto(appUrl);
  await expect(page.locator('.dz-overlay')).toBeVisible();
  await dropFiles(page, [zipPath]);
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 60_000 });
  await expect(page.locator('path.cluster')).toHaveCount(2);
});

test('file:// drop intake: env-only re-drop updates the ACTIVE tenant, no phantom profile (FR-8.9, AK 100)', async ({ page }) => {
  test.setTimeout(120_000);
  page.on('dialog', (d) => d.accept());
  await page.goto(appUrl);
  await expect(page.locator('.dz-overlay')).toBeVisible();
  await dropFiles(page, DROP_FILES);
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 60_000 });

  // edit the env like a user would: replace the VIEWS, drop ONLY the env
  const env = JSON.parse(readFileSync(DROP_FILES[1], 'utf8'));
  const start = env.VIEWS['Start'];
  env.VIEWS = { 'Alles': start, 'Flach': { ...start, depth: 1 } };
  const envPath = join(mkdtempSync(join(tmpdir(), 'og2-env-')), 'fixture-drop-env.json');
  writeFileSync(envPath, JSON.stringify(env));
  await dropFiles(page, [envPath]);

  // after the self-reload the SAME tenant renders with the new views —
  // never the trapped empty-profile drop zone (live-test finding 2026-07-08)
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 60_000 });
  await expect(page.locator('.dz-overlay')).toBeHidden();
  await expect(page.locator('#viewsLegend .legend-row')).toHaveCount(2);
  await expect(page.locator('#viewsLegend .legend-row').filter({ hasText: 'Alles' })).toHaveCount(1);
  const profileCount = await page.evaluate(() => listProfiles().then((l) => l.length));
  expect(profileCount).toBe(1); // no phantom profile
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

test('file:// drop intake: an identifier list opens the intake dialog and imports as ring attribute (E74)', async ({ page }) => {
  test.setTimeout(120_000);
  page.on('dialog', (d) => d.accept()); // E70 source registration, E69 join
  await page.goto(appUrl);
  await expect(page.locator('.dz-overlay')).toBeVisible();
  await dropFiles(page, DROP_FILES);
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 60_000 });

  // a plain e-mail list on the running tenant: no reload, the dialog opens
  const listPath = join(mkdtempSync(join(tmpdir(), 'og2-list-')), 'Newsletter.txt');
  writeFileSync(listPath, 'vera@example.org\nmax@example.org\nunknown@nowhere.org\n');
  await dropFiles(page, [listPath]);
  const dialog = page.locator('#listIntakeDialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.locator('.modal-summary')).toContainText('2 exakt');
  await expect(dialog.locator('.modal-summary')).toContainText('2 werden importiert');
  await expect(dialog.locator('select.modal-input').first()).toHaveValue('hatAttribut');
  // the active view lacks the ring hop → the extension offer is visible and on
  const extend = dialog.locator('.modal-check').first();
  await expect(extend).toBeVisible();
  await expect(extend).toContainText('hatAttribut');

  await dialog.locator('button.btn-primary').click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  // rings for the two matched persons, in place (no reload); the legend
  // groups by category (groupProp), the fixture's own role/team rings stay
  await expect(page.locator('g.nodes circle.attribute-circle[data-attribute="Newsletter::Newsletter"]')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator('#attributeLegend')).toContainText('Newsletter (2)');
  // the parked list is consumed
  const pending = await page.evaluate(() => getPendingLists().then((l) => l.length));
  expect(pending).toBe(0);
});

test('file:// drop intake: a wide Excel-style table yields one dialog per attribute column (E74)', async ({ page }) => {
  test.setTimeout(120_000);
  page.on('dialog', (d) => d.accept());
  await page.goto(appUrl);
  await expect(page.locator('.dz-overlay')).toBeVisible();
  await dropFiles(page, DROP_FILES);
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 60_000 });

  // Name/Nachname/E-Mail/Besucht/Rolle — the e-mail column is the key, the
  // boolean column is a membership, the text column category + value
  const csvPath = join(mkdtempSync(join(tmpdir(), 'og2-wide-')), 'export.csv');
  writeFileSync(csvPath, [
    'Name;Nachname;E-Mail;Besucht;Rolle',
    'Vera;Chefin;vera@example.org;WAHR;Sektionsleiter',
    'Max;Mittel;MAX@example.org;FALSCH;',
    'Nina;Mittel;nina@example.org;WAHR;AG',
    'Ben;Blatt;ben@example.org;FALSCH;',
  ].join('\r\n'));
  await dropFiles(page, [csvPath]);
  const dialog = page.locator('#listIntakeDialog');

  // 1/2: Besucht — two true rows
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.locator('h2')).toContainText('«Besucht» (1/2)');
  await expect(dialog.locator('.modal-summary')).toContainText('2 Zeilen · 2 exakt');
  await dialog.locator('button.btn-primary').click();

  // 2/2: Rolle — values from the file, the value field is locked
  await expect(dialog.locator('h2')).toContainText('«Rolle» (2/2)', { timeout: 30_000 });
  await expect(dialog.locator('.modal-summary')).toContainText('2 Zeilen · 2 exakt');
  await expect(dialog.locator('input.modal-input').nth(1)).toBeDisabled();
  await dialog.locator('button.btn-primary').click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await expect(page.locator('g.nodes circle.attribute-circle[data-attribute="Besucht::Besucht"]')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator('g.nodes circle.attribute-circle[data-attribute="Rolle::AG"]')).toHaveCount(1);
  await expect(page.locator('g.nodes circle.attribute-circle[data-attribute="Rolle::Sektionsleiter"]')).toHaveCount(1);
  const pending = await page.evaluate(() => getPendingLists().then((l) => l.length));
  expect(pending).toBe(0);
});
