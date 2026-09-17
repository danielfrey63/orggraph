// E77 — the tenant repo loop end to end against a Gitea API mock (node http:
// contents listing/read, raw, POST contents with sha checks, CORS for the
// file:// origin). Browser 1 binds an empty profile, drops the fixture tenant,
// imports and pushes (age-encrypted in the browser); node decrypts the pushed
// export with the same identity; browser 2 binds a fresh profile and pulls.
import { test, expect, autoConfirmDialogs } from './base.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = pathToFileURL(join(root, 'index.html')).href;
const DROP_FILES = [join(root, 'schema/registry.json'), join(root, 'e2e/fixtures/fixture-drop-env.json'), join(root, 'e2e/fixtures/fixture-snapshot.json')];
const TOKEN = 'test-token';
let server, port, files, commits;

// vendor/age.min.js as a node global (same code the app inlines)
const ageLib = new Function(readFileSync(join(root, 'vendor/age.min.js'), 'utf8') + ';return age;')();

async function dropFiles(page, list) {
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.id = '__drop_input__'; input.style.display = 'none';
    document.body.appendChild(input);
  });
  await page.setInputFiles('#__drop_input__', list);
  await page.evaluate(() => {
    const input = document.getElementById('__drop_input__');
    const dt = new DataTransfer();
    for (const f of input.files) dt.items.add(f);
    input.remove();
    document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
}

// ---- Gitea mock -----------------------------------------------------------------
function giteaMock() {
  files = new Map(); commits = [];
  let seq = 0;
  const sha = () => `sha${++seq}`;
  const cors = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
  };
  const json = (res, status, obj) => { cors(res); res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
    if (req.headers.authorization !== `token ${TOKEN}`) return json(res, 401, { message: 'token required' });
    const m = /^\/api\/v1\/repos\/o\/r(\/.*)?$/.exec(url.pathname);
    if (!m) return json(res, 404, { message: 'not found' });
    const rest = decodeURIComponent(m[1] || '');
    if (!rest) return json(res, 200, { full_name: 'o/r', private: true });
    if (req.method === 'GET' && rest.startsWith('/contents')) {
      const path = rest.slice('/contents'.length).replace(/^\/+|\/+$/g, '');
      if (files.has(path)) { const f = files.get(path); return json(res, 200, { name: path.split('/').pop(), path, sha: f.sha, type: 'file', size: f.bytes.length, encoding: 'base64', content: Buffer.from(f.bytes).toString('base64') }); }
      const prefix = path ? path + '/' : '';
      const listing = [...files.entries()].filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map(([p, f]) => ({ name: p.split('/').pop(), path: p, sha: f.sha, type: 'file', size: f.bytes.length }));
      const dirs = new Set([...files.keys()].filter((p) => p.startsWith(prefix) && p.slice(prefix.length).includes('/')).map((p) => p.slice(prefix.length).split('/')[0]));
      for (const d of dirs) listing.push({ name: d, path: prefix + d, sha: 'tree', type: 'dir', size: 0 });
      if (!listing.length && path) return json(res, 404, { message: 'not found' });
      return json(res, 200, listing);
    }
    if (req.method === 'GET' && rest.startsWith('/raw/')) {
      const f = files.get(rest.slice(5));
      if (!f) return json(res, 404, { message: 'not found' });
      cors(res); res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(Buffer.from(f.bytes));
    }
    if (req.method === 'POST' && rest === '/contents') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const opts = JSON.parse(body);
        for (const f of opts.files) {
          const existing = files.get(f.path);
          if (f.operation === 'update' && (!existing || existing.sha !== f.sha)) return json(res, 422, { message: `sha does not match for ${f.path}` });
          if (f.operation === 'create' && existing) return json(res, 422, { message: `already exists: ${f.path}` });
        }
        const out = [];
        for (const f of opts.files) { const s = sha(); files.set(f.path, { bytes: new Uint8Array(Buffer.from(f.content, 'base64')), sha: s }); out.push({ path: f.path, sha: s }); }
        commits.push({ message: opts.message, files: opts.files.map((f) => f.path) });
        return json(res, 201, { commit: { sha: `c${commits.length}`, html_url: `http://x/c${commits.length}` }, files: out });
      });
      return;
    }
    return json(res, 404, { message: 'not found' });
  });
}

test.beforeAll(async () => {
  server = giteaMock();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
test.afterAll(() => server && server.close());

async function bind(page, identity, primary) {
  // an empty profile is covered by the drop overlay: its own button opens the dialog
  if (await page.locator('.dz-overlay').isVisible()) await page.locator('.dz-repo').click();
  else await page.locator('#syncStatus').click();
  const dlg = page.locator('#og2RepoDialog');
  await expect(dlg).toBeVisible();
  const inputs = dlg.locator('input.modal-input');
  await inputs.nth(0).fill(`http://127.0.0.1:${port}`);
  await inputs.nth(1).fill('o/r');
  await inputs.nth(3).fill(TOKEN);
  if (identity) await inputs.nth(4).fill(identity);
  else { await dlg.locator('button', { hasText: 'Identität erzeugen' }).click(); identity = await inputs.nth(4).inputValue(); }
  await expect(dlg).toContainText('Öffentlicher Schlüssel (Empfänger): age1');
  await dlg.locator('button', { hasText: 'Verbindung testen' }).click();
  await expect(dlg.locator('.modal-detail')).toContainText('Repo: o/r (privat)');
  await dlg.getByRole('button', { name: primary, exact: true }).click();
  return identity;
}

test('bind → drop → encrypted commit via the contents API; a fresh profile pulls the stand back', async ({ browser }) => {
  test.setTimeout(180_000);

  // 1) browser 1: empty profile, bind the repo (fresh identity), drop the tenant
  const ctx1 = await browser.newContext();
  const page = await ctx1.newPage();
  await autoConfirmDialogs(page);
  await page.goto(appUrl);
  await expect(page.locator('#syncStatus')).toContainText('nicht verbunden');
  const identity = await bind(page, null, 'Speichern');
  await expect(page.locator('#og2RepoDialog')).toBeHidden();
  await dropFiles(page, DROP_FILES);
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 60_000 });
  await expect(page.locator('#syncStatus')).toContainText('committet', { timeout: 30_000 });
  await expect.poll(() => files.has('tenant.zip.age') && files.has('manifest.json') && files.has('config.json'), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => files.has('snapshots/fixture-snapshot.json.age'), { timeout: 20_000 }).toBe(true);
  const manifest = JSON.parse(Buffer.from(files.get('manifest.json').bytes).toString('utf8'));
  expect(manifest).toMatchObject({ format: 'orggraph-tenant-2', counts: { nodes: 10 } });
  expect(JSON.parse(Buffer.from(files.get('config.json').bytes).toString('utf8')).recipients[0]).toMatch(/^age1/);
  expect(commits.some((c) => /import/.test(c.message) && c.files.includes('tenant.zip.age') && c.files.includes('manifest.json'))).toBe(true);
  // the export is really age-encrypted for our identity: decrypt it in node
  const d = new ageLib.Decrypter();
  d.addIdentity(identity);
  const zip = await d.decrypt(files.get('tenant.zip.age').bytes);
  expect(Buffer.from(zip.slice(0, 2)).toString('latin1')).toBe('PK');
  expect(Buffer.from(zip).includes(Buffer.from('manifest.json'))).toBe(true);
  await ctx1.close();

  // 2) browser 2: fresh profile, same identity → "Speichern und abgleichen" pulls and reloads
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(appUrl);
  await expect(page2.locator('.dz-overlay')).toBeVisible();
  await bind(page2, identity, 'Speichern und abgleichen');
  await expect(page2.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 60_000 });
  await expect(page2.locator('.dz-overlay')).toBeHidden();
  await expect(page2.locator('#syncStatus')).toContainText('aktuell', { timeout: 30_000 });
  await ctx2.close();
});
