// Static server for the e2e harness. Two virtual tenants over the same
// single-file build:
//   /            e2e fixture tenant (committed fixture snapshot + env)
//   /sem/        migrated SEM reference tenant (local data/migration output;
//                the AK-1 spec skips itself when that output is absent)
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT || 8643);

const TYPES = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css' };

function semSnapshotPath() {
  const dir = join(root, 'data/migration');
  if (!existsSync(dir)) return null;
  const file = 'legacy-sem.snapshot-20260612-0000.json';
  return existsSync(join(dir, file)) ? join(dir, file) : null;
}

const routes = () => {
  const map = {
    '/': join(root, 'index.html'),
    '/index.html': join(root, 'index.html'),
    '/env.json': join(root, 'e2e/fixtures/fixture-env.json'),
    '/registry.json': join(root, 'schema/registry.json'),
    '/snapshot.json': join(root, 'e2e/fixtures/fixture-snapshot.json'),
    '/snapshot2.json': join(root, 'e2e/fixtures/fixture-snapshot-2.json'),
    '/sem/': join(root, 'index.html'),
    '/sem/index.html': join(root, 'index.html'),
    '/sem/registry.json': join(root, 'schema/registry.json'),
  };
  const sem = semSnapshotPath();
  if (sem) map['/sem/snapshot.json'] = sem;
  return map;
};

// The SEM tenant env derives from the migration output with harness-local
// URLs; pseudo mode stays off until its generalization lands (FR-8.5 stage).
function semEnv() {
  const envPath = join(root, 'data/migration/legacy-sem.env.json');
  if (!existsSync(envPath)) return null;
  const env = JSON.parse(readFileSync(envPath, 'utf8'));
  env.TOOLBAR_PSEUDO_ACTIVE = false; // app default is ON (fail-safe); AK-1/2 measure the clear reference scene
  delete env.TOOLBAR_PSEUDO_PASSWORD;
  env.REGISTRY_URL = './registry.json';
  env.DATA_URL = './snapshot.json';
  return JSON.stringify(env);
}

createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/sem/env.json') {
    const body = semEnv();
    if (!body) { res.writeHead(404); res.end('no migration output'); return; }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  const file = routes()[url];
  if (!file || !existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`e2e server on http://localhost:${PORT}`));
