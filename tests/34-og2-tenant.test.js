// E77 — tenant export/restore, in-app ZIP writer and hub sync decision.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildZip, crc32 } from '../src/sections/33-og2-zip-writer.js';
import { readZipEntries } from '../src/sections/05-dropzone.js';
import { TENANT_FORMAT, og2TenantManifest, og2TenantManifestOf, og2RestoreTenant } from '../src/sections/34-og2-tenant.js';
import { og2SyncDecision, og2HubTenantOf } from '../src/sections/35-og2-sync.js';
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

describe('35 — hub sync decision', () => {
  it('restores only when the hub export is newer than the last synced one', () => {
    expect(og2SyncDecision(null, null)).toMatchObject({ restore: false });
    expect(og2SyncDecision(null, { exportedAt: '2026-09-16T10:00:00Z' })).toMatchObject({ restore: true, reason: 'never synced' });
    expect(og2SyncDecision({ exportedAt: '2026-09-16T10:00:00Z' }, { exportedAt: '2026-09-16T11:00:00Z' })).toMatchObject({ restore: true, reason: 'hub is newer' });
    expect(og2SyncDecision({ exportedAt: '2026-09-16T11:00:00Z' }, { exportedAt: '2026-09-16T11:00:00Z' })).toMatchObject({ restore: false, reason: 'in sync' });
    expect(og2SyncDecision({ exportedAt: '2026-09-16T12:00:00Z' }, { exportedAt: '2026-09-16T11:00:00Z' })).toMatchObject({ restore: false, reason: 'local is newer' });
  });

  it('the served tenant comes from /t/<name>/ over http only', () => {
    expect(og2HubTenantOf({ protocol: 'http:', pathname: '/t/sem/' })).toBe('sem');
    expect(og2HubTenantOf({ protocol: 'http:', pathname: '/t/sem/index.html' })).toBe('sem');
    expect(og2HubTenantOf({ protocol: 'http:', pathname: '/' })).toBeNull();
    expect(og2HubTenantOf({ protocol: 'file:', pathname: '/D:/x/t/sem/index.html' })).toBeNull();
    expect(og2HubTenantOf(null)).toBeNull();
  });
});
