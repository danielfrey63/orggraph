// E77 — the hub loop end to end: tools/hub.py serves the app under
// /t/<tenant>/ with a temporary tenant repo (no remote). A tenant drop imports
// and pushes (encrypted commit in the repo); a fresh browser context then
// boots the tenant from the repo alone. Project 'hub' (python + pyrage + git).
import { test, expect, autoConfirmDialogs } from './base.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DROP_FILES = [join(root, 'schema/registry.json'), join(root, 'e2e/fixtures/fixture-drop-env.json'), join(root, 'e2e/fixtures/fixture-snapshot.json')];
const PORT = 8650 + Math.floor(Math.random() * 200);
const TENANT = 'hubtest';
let tmp, hubConfig, repo, proc;

async function dropFiles(page, files) {
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.id = '__drop_input__'; input.style.display = 'none';
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

test.beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'og2-hub-'));
  hubConfig = join(tmp, 'hub.json');
  repo = join(tmp, 'repo');
  writeFileSync(hubConfig, JSON.stringify({ identity: join(tmp, 'id.txt'), app: root, port: PORT, tenants: {} }));
  const env = { ...process.env, ORGGRAPH_HUB_CONFIG: hubConfig };
  execFileSync('python', [join(root, 'tools/hub.py'), 'init', TENANT, '--repo', repo, '--app', root], { env, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'hub@test'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'hub'], { cwd: repo });
  proc = spawn('python', [join(root, 'tools/hub.py'), 'serve', '--port', String(PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => process.stdout.write(`[hub] ${d}`));
  proc.stderr.on('data', (d) => process.stdout.write(`[hub!] ${d}`));
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/hub`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('hub did not start');
});

test.afterAll(() => { if (proc) proc.kill(); });

test('drop imports the tenant and pushes it into the repo; a fresh browser boots it from the repo', async ({ browser }) => {
  test.setTimeout(180_000);
  const url = `http://127.0.0.1:${PORT}/t/${TENANT}/`;

  // 1) first browser: empty tenant → drop → import → push
  const ctx1 = await browser.newContext();
  const page = await ctx1.newPage();
  await autoConfirmDialogs(page);
  await page.goto(url);
  await expect(page.locator('.dz-overlay')).toBeVisible();
  await expect(page.locator('#syncStatus')).toContainText('kein Export im Repo', { timeout: 20_000 });
  await dropFiles(page, DROP_FILES);
  await expect(page.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 60_000 });
  await expect(page.locator('#syncStatus')).toContainText('committet', { timeout: 30_000 });
  expect(existsSync(join(repo, 'tenant.zip.age'))).toBe(true);
  const manifest = JSON.parse(readFileSync(join(repo, 'manifest.json'), 'utf8'));
  expect(manifest.format).toBe('orggraph-tenant-2');
  expect(manifest.counts.nodes).toBe(10); // 5 persons + OEs + attribute carriers
  expect(manifest.tenant).toBe(TENANT);
  // the raw snapshot the drop carried is archived too
  expect(existsSync(join(repo, 'snapshots', 'fixture-snapshot.json.age'))).toBe(true);
  const log = execFileSync('git', ['log', '--format=%s'], { cwd: repo, encoding: 'utf8' });
  expect(log).toMatch(/hubtest: import/);
  await ctx1.close();

  // 2) fresh browser context (no IndexedDB): boot restores the tenant from the repo
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(url);
  await expect(page2.locator('#syncStatus')).toContainText('übernommen', { timeout: 30_000 });
  await expect(page2.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 60_000 });
  await expect(page2.locator('.dz-overlay')).toBeHidden();
  // a reload with nothing new pulls and reports "aktuell"
  await page2.reload();
  await expect(page2.locator('#syncStatus')).toContainText('aktuell', { timeout: 30_000 });
  await expect(page2.locator('g.nodes circle:not(.attribute-circle)')).toHaveCount(5, { timeout: 60_000 });
  await ctx2.close();
});
