// E77 — tenant export/restore, in-app ZIP writer and hub sync decision.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildZip, crc32 } from '../src/sections/33-og2-zip-writer.js';
import { readZipEntries } from '../src/sections/05-dropzone.js';
import { TENANT_FORMAT, og2TenantManifest, og2TenantManifestOf, og2RestoreTenant } from '../src/sections/34-og2-tenant.js';
import { og2SyncDecision, og2SafeFilename } from '../src/sections/35-og2-sync.js';
import { bytesToBase64, base64ToBytes, normalizeRepoConfig, repoConfigComplete, giteaClient, GiteaError } from '../src/sections/36-og2-gitea.js';
import { KEY_STORE, KEY_STORE_PART_PREFIX, KEY_REGISTRY, KEY_ENV, getStoredText, putStored, idbClear, _resetProfilesCache } from '../src/sections/04-storage.js';
import { createTenantStore } from '../src/sections/23-og2-store.js';
import { serializeTenantStoreParts, deserializeTenantStoreParts } from '../src/sections/29-og2-app.js';
import { importSnapshot } from '../src/sections/26-og2-import.js';

// jsdom's File lacks arrayBuffer(): the reader only needs name + arrayBuffer()
const asFile = (name, data) => ({ name, arrayBuffer: async () => (typeof data === 'string' ? new TextEncoder().encode(data) : data).buffer.slice(0), text: async () => (typeof data === 'string' ? data : new TextDecoder().decode(data)) });

describe('33 — ZIP writer', () => {
  it('crc32 matches the reference value', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });

  it('round-trips through the drop zone reader (deflated and stored entries)', async () => {
    const big = 'x'.repeat(50_000) + JSON.stringify({ a: [1, 2, 3] });
    const bytes = await buildZip([
      { name: 'a/hello.txt', data: 'hällo wörld' },
      { name: 'big.json', data: big },
      { name: 'empty.txt', data: '' },
      { name: 'bin.dat', data: new Uint8Array([0, 255, 1, 254]) },
    ]);
    expect(bytes.length).toBeLessThan(big.length / 4); // compressed
    const entries = await readZipEntries(asFile('t.zip', bytes));
    const byName = Object.fromEntries(entries.map((e) => [e.path, e.file]));
    expect(Object.keys(byName).sort()).toEqual(['a/hello.txt', 'big.json', 'bin.dat', 'empty.txt']);
    expect(await byName['a/hello.txt'].text()).toBe('hällo wörld');
    expect(await byName['big.json'].text()).toBe(big);
    expect(await byName['empty.txt'].text()).toBe('');
    expect(new Uint8Array(await byName['bin.dat'].arrayBuffer())).toEqual(new Uint8Array([0, 255, 1, 254]));
  });
});

describe('34 — tenant export and restore', () => {
  const REGISTRY = {
    version: 't1',
    nodeTypes: { Person: { description: 'p', props: { email: { type: 'string' } } } },
    edgeTypes: { kennt: { description: 'k', from: 'Person', to: 'Person' } },
  };
  const YES = { confirmSourceRegistration: () => ({ ok: true, moveOutEdgeTypes: [] }), confirmJoin: () => true, confirmGate: () => true, confirmDestructive: () => true, confirmAuthority: () => true };
  let store;
  beforeEach(async () => {
    await idbClear();
    _resetProfilesCache();
    store = createTenantStore();
    const snap = {
      meta: { source: 'hrm', crawledAt: '2026-09-16T10:00:00Z', snapshot: '20260916-1000', registryVersion: 't1', scope: { nodeTypes: ['Person'], edgeTypes: ['kennt'] } },
      schema: REGISTRY,
      nodes: [{ id: 'hrm:p1', type: 'Person', label: 'Anna', props: { email: 'a@x.ch' } }, { id: 'hrm:p2', type: 'Person', label: 'Bo', props: {} }],
      edges: [{ type: 'kennt', source: 'hrm:p1', target: 'hrm:p2' }],
    };
    const res = importSnapshot(store, REGISTRY, snap, YES);
    expect(res.status).toBe('imported');
    store = res.store || store;
  });

  it('manifest describes the tenant', () => {
    const m = og2TenantManifest({ store, registry: REGISTRY, env: { VIEWS: { Start: {} } } }, { tenant: 'sem', exportedAt: '2026-09-16T12:00:00Z', parts: 1 });
    expect(m).toMatchObject({ format: TENANT_FORMAT, tenant: 'sem', registryVersion: 't1', counts: { nodes: 2, edges: 1, snapshots: 1 }, sources: ['hrm'], lastSnapshot: '20260916-1000', storeParts: 1, views: ['Start'] });
  });

  it('a tenant ZIP restores registry, env and the chunked store 1:1 into the profile', async () => {
    const { header, parts } = serializeTenantStoreParts(store, 400); // force several parts
    expect(parts.length).toBeGreaterThan(1);
    const manifest = og2TenantManifest({ store, registry: REGISTRY, env: { VIEWS: {} } }, { tenant: 'sem', parts: parts.length });
    const bytes = await buildZip([
      { name: 'manifest.json', data: JSON.stringify(manifest) },
      { name: 'registry.json', data: JSON.stringify(REGISTRY) },
      { name: 'env.json', data: JSON.stringify({ VIEWS: { Start: { root: 'hrm:p1' } } }) },
      { name: 'store.json', data: header },
      ...parts.map((p, i) => ({ name: `store.part${i}.json`, data: p })),
    ]);
    // stale extra part in the profile must be removed by the restore
    await putStored(KEY_STORE_PART_PREFIX + 9, '[]');
    await putStored(KEY_STORE, JSON.stringify({ format: 'og2-store-v2', parts: 10, small: {} }));
    const entries = await readZipEntries(asFile('tenant-sem.zip', bytes));
    expect(await og2TenantManifestOf(entries)).toMatchObject({ format: TENANT_FORMAT, tenant: 'sem' });
    expect(await og2TenantManifestOf([{ path: 'x.json', file: asFile('x.json', '{}') }])).toBeNull();
    const restored = await og2RestoreTenant(entries);
    expect(restored.tenant).toBe('sem');
    expect(JSON.parse(await getStoredText(KEY_REGISTRY)).version).toBe('t1');
    expect(JSON.parse(await getStoredText(KEY_ENV)).VIEWS.Start.root).toBe('hrm:p1');
    const head = await getStoredText(KEY_STORE);
    const partTexts = [];
    for (let i = 0; i < JSON.parse(head).parts; i++) partTexts.push(await getStoredText(KEY_STORE_PART_PREFIX + i));
    const back = deserializeTenantStoreParts(head, partTexts);
    expect(back.nodes.size).toBe(2);
    expect(back.edges.size).toBe(1);
    expect(back.nodes.get('hrm:p1').timelines.get('label')).toBeTruthy();
    expect((await getStoredText(KEY_STORE_PART_PREFIX + 9)) ?? null).toBeNull();
  });

  it('an incomplete export is refused before anything is written', async () => {
    const manifest = og2TenantManifest({ store, registry: REGISTRY, env: {} }, { tenant: 'sem', parts: 1 });
    const bytes = await buildZip([{ name: 'manifest.json', data: JSON.stringify(manifest) }, { name: 'registry.json', data: '{}' }]);
    const entries = await readZipEntries(asFile('t.zip', bytes));
    await expect(og2RestoreTenant(entries)).rejects.toThrow(/unvollständig/);
    expect((await getStoredText(KEY_REGISTRY)) ?? null).toBeNull();
  });
});

describe('35 — repo sync decision', () => {
  it('restores only when the repo export is newer than the last synced one', () => {
    expect(og2SyncDecision(null, null)).toMatchObject({ restore: false });
    expect(og2SyncDecision(null, { exportedAt: '2026-09-16T10:00:00Z' })).toMatchObject({ restore: true, reason: 'never synced' });
    expect(og2SyncDecision({ exportedAt: '2026-09-16T10:00:00Z' }, { exportedAt: '2026-09-16T11:00:00Z' })).toMatchObject({ restore: true, reason: 'repo is newer' });
    expect(og2SyncDecision({ exportedAt: '2026-09-16T11:00:00Z' }, { exportedAt: '2026-09-16T11:00:00Z' })).toMatchObject({ restore: false, reason: 'in sync' });
    expect(og2SyncDecision({ exportedAt: '2026-09-16T12:00:00Z' }, { exportedAt: '2026-09-16T11:00:00Z' })).toMatchObject({ restore: false, reason: 'local is newer' });
  });

  it('archived raw file names are flattened and sanitised', () => {
    expect(og2SafeFilename('crawl ../x/Kohorte VIII - LS.txt')).toBe('Kohorte_VIII_-_LS.txt');
    expect(og2SafeFilename('')).toBe('file');
  });
});

describe('36 — Gitea contents client', () => {
  it('base64 round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array(1000).map((_, i) => (i * 37) & 255);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(bytesToBase64(new TextEncoder().encode('hällo'))).toBe(Buffer.from('hällo').toString('base64'));
    expect(new TextDecoder().decode(base64ToBytes('aMOkbGxv'))).toBe('hällo');
  });

  it('normalises the binding (full repo URL, owner/repo string, .git suffix)', () => {
    expect(normalizeRepoConfig({ base: 'https://git.x.ch/daniel/orggraph-sem.git/', token: 't' })).toMatchObject({ base: 'https://git.x.ch', owner: 'daniel', repo: 'orggraph-sem', branch: 'main' });
    expect(normalizeRepoConfig({ base: 'https://git.x.ch/', owner: 'daniel/orggraph-sem', token: 't' })).toMatchObject({ owner: 'daniel', repo: 'orggraph-sem' });
    expect(repoConfigComplete({ base: 'https://git.x.ch', owner: 'a', repo: 'b', token: 't' })).toBe(true);
    expect(repoConfigComplete({ base: 'https://git.x.ch', owner: 'a', repo: 'b' })).toBe(false);
  });

  it('reads listings/text/raw and commits several files in ONE server-side commit', async () => {
    const calls = [];
    const fetchMock = async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
      const json = (obj, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(obj), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
      if (url.endsWith('/contents/?ref=main')) return json([{ name: 'manifest.json', path: 'manifest.json', sha: 'm1', type: 'file', size: 10 }]);
      if (url.includes('/contents/manifest.json')) return json({ sha: 'm1', content: Buffer.from('{"exportedAt":"x"}').toString('base64'), encoding: 'base64' });
      if (url.includes('/contents/missing.json')) return json({ message: 'not found' }, 404);
      if (url.includes('/raw/tenant.zip.age')) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer };
      if (url.endsWith('/contents') && init.method === 'POST') return json({ commit: { sha: 'c9', html_url: 'https://git/c9' }, files: [{ path: 'manifest.json', sha: 'm2' }] });
      return json({ message: 'boom' }, 500);
    };
    const c = giteaClient({ base: 'https://git.x.ch', owner: 'daniel', repo: 'orggraph-sem', token: 'tok' }, fetchMock);
    expect(await c.list('')).toEqual([{ name: 'manifest.json', path: 'manifest.json', sha: 'm1', type: 'file', size: 10 }]);
    expect(await c.readText('manifest.json')).toEqual({ sha: 'm1', text: '{"exportedAt":"x"}' });
    expect(await c.readText('missing.json')).toBeNull();
    expect(await c.readBytes('tenant.zip.age')).toEqual(new Uint8Array([9, 8, 7]));
    const commit = await c.commit([{ path: 'manifest.json', data: '{}', sha: 'm1' }, { path: 'tenant.zip.age', data: new Uint8Array([1, 2]) }], 'sem: export');
    expect(commit).toMatchObject({ sha: 'c9', url: 'https://git/c9' });
    const post = calls.find((x) => x.method === 'POST');
    expect(post.url).toBe('https://git.x.ch/api/v1/repos/daniel/orggraph-sem/contents');
    expect(post.headers.Authorization).toBe('token tok');
    expect(post.body).toMatchObject({ branch: 'main', message: 'sem: export', files: [
      { operation: 'update', path: 'manifest.json', sha: 'm1', content: Buffer.from('{}').toString('base64') },
      { operation: 'create', path: 'tenant.zip.age', content: Buffer.from([1, 2]).toString('base64') },
    ] });
    await expect(c.readText('boom.json')).rejects.toBeInstanceOf(GiteaError);
    const dead = giteaClient({ base: 'https://git.x.ch', owner: 'a', repo: 'b', token: 't' }, async () => { throw new TypeError('Failed to fetch'); });
    await expect(dead.list('')).rejects.toThrow(/CORS/);
  });
});
