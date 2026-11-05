// E77 — tenant repo sync: the pull that restores a newer export before boot,
// the push that commits the encrypted tenant ZIP, and the raw archive. Only
// the pure decision function was covered before (28.9% of the section), so
// everything that actually talks to the repo or to age was untested.
//
// No crypto double: the real age-encryption library is wired to globalThis
// exactly as the deliverable wires vendor/age.min.js, so what the pull
// decrypts is what the encrypter produced. The HTTP boundary is a fake Gitea
// backed by an in-memory file map — the client in 36-og2-gitea.js runs for
// real, including base64, shas and the one-commit-many-files body.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as ageLib from 'age-encryption';
import {
  og2RepoConfig, og2RepoConfigRaw, og2SaveRepoConfig, og2SyncPull, og2SyncPush,
  og2SyncPushSoon, og2SyncArchiveRaw, og2AgeEncrypt, og2AgeDecrypt,
  og2AgeRecipientOf, og2AgeGenerateIdentity,
} from '../src/sections/35-og2-sync.js';
import { bytesToBase64 } from '../src/sections/36-og2-gitea.js';
import { buildZip } from '../src/sections/33-og2-zip-writer.js';
import { og2TenantManifest } from '../src/sections/34-og2-tenant.js';
import { createTenantStore } from '../src/sections/23-og2-store.js';
import { importSnapshot } from '../src/sections/26-og2-import.js';
import { serializeTenantStoreParts } from '../src/sections/29-og2-app.js';
import {
  KEY_REPO, KEY_SYNC, KEY_REGISTRY, KEY_ENV, KEY_STORE,
  getStoredText, putStored, idbClear, _resetProfilesCache,
} from '../src/sections/04-storage.js';

const BINDING = { base: 'https://git.example.ch', owner: 'daniel', repo: 'orggraph-sem', token: 'tok' };
const API = '/api/v1/repos/daniel/orggraph-sem';
const enc = new TextEncoder();
const dec = new TextDecoder();

// --- fake Gitea over the real client ----------------------------------------
function fakeGitea(initial = {}) {
  const files = new Map(Object.entries(initial).map(([p, v]) => [p, typeof v === 'string' ? enc.encode(v) : v]));
  const commits = [];
  const calls = [];
  let failWith = null;
  const sha = (path) => `sha-${path.replace(/[^a-z0-9]/gi, '-')}-${files.get(path).length}`;
  const entry = (path) => ({ name: path.split('/').pop(), path, sha: sha(path), type: 'file', size: files.get(path).length });
  const body = (payload) => ({
    status: 200,
    ok: true,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  });
  const notFound = { status: 404, ok: false, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };

  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push(`${method} ${String(url)}`);
    if (failWith) throw new Error(failWith);
    const u = new URL(String(url));
    const path = decodeURIComponent(u.pathname);
    if (path.startsWith(`${API}/raw/`)) {
      const rel = path.slice(`${API}/raw/`.length);
      return files.has(rel) ? body(files.get(rel)) : notFound;
    }
    if (path.startsWith(`${API}/contents`)) {
      const rel = path.slice(`${API}/contents`.length).replace(/^\//, '');
      if (method === 'POST') {
        const payload = JSON.parse(init.body);
        for (const f of payload.files) {
          const bytes = Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0));
          files.set(f.path, bytes);
        }
        commits.push({ message: payload.message, paths: payload.files.map((f) => f.path), ops: payload.files.map((f) => f.operation) });
        return body({ commit: { sha: `commit-${commits.length}`, html_url: 'https://git.example.ch/c' }, files: payload.files.map((f) => ({ path: f.path, sha: 'new' })) });
      }
      if (files.has(rel)) return body({ sha: sha(rel), content: bytesToBase64(files.get(rel)), type: 'file' });
      const inDir = [...files.keys()].filter((p) => (rel ? p.startsWith(`${rel}/`) : !p.includes('/')));
      if (rel === '' || inDir.length) return body(inDir.map(entry));
      return notFound;
    }
    return notFound;
  };
  return { files, commits, calls, fetchImpl, breakWith: (msg) => { failWith = msg; } };
}

// A real, importable tenant export: ZIP of manifest/registry/env/store.
async function tenantZipBytes(exportedAt) {
  const REGISTRY = {
    version: 't1',
    nodeTypes: { Person: { description: 'p', props: { email: { type: 'string' } } } },
    edgeTypes: { kennt: { description: 'k', from: 'Person', to: 'Person' } },
  };
  const YES = { confirmSourceRegistration: () => ({ ok: true, moveOutEdgeTypes: [] }), confirmJoin: () => true, confirmGate: () => true, confirmDestructive: () => true, confirmAuthority: () => true };
  let store = createTenantStore();
  const res = importSnapshot(store, REGISTRY, {
    meta: { source: 'hrm', crawledAt: '2026-09-16T10:00:00Z', snapshot: '20260916-1000', registryVersion: 't1', scope: { nodeTypes: ['Person'], edgeTypes: ['kennt'] } },
    schema: REGISTRY,
    nodes: [{ id: 'hrm:p1', type: 'Person', label: 'Anna', props: { email: 'a@x.ch' } }, { id: 'hrm:p2', type: 'Person', label: 'Bo', props: {} }],
    edges: [{ type: 'kennt', source: 'hrm:p1', target: 'hrm:p2' }],
  }, YES);
  store = res.store || store;
  const { header, parts } = serializeTenantStoreParts(store);
  const manifest = og2TenantManifest({ store, registry: REGISTRY, env: { VIEWS: { Start: { root: 'hrm:p1' } } } }, { tenant: 'sem', exportedAt, parts: parts.length });
  return buildZip([
    { name: 'manifest.json', data: JSON.stringify(manifest) },
    { name: 'registry.json', data: JSON.stringify(REGISTRY) },
    { name: 'env.json', data: JSON.stringify({ VIEWS: { Start: { root: 'hrm:p1' } } }) },
    { name: 'store.json', data: header },
    ...parts.map((p, i) => ({ name: `store.part${i}.json`, data: p })),
  ]);
}

let identity;
let recipient;
let errors;

beforeEach(async () => {
  await idbClear();
  _resetProfilesCache();
  globalThis.age = ageLib;
  identity = await og2AgeGenerateIdentity();
  recipient = await og2AgeRecipientOf(identity);
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errors.mockRestore();
  delete globalThis.fetch;
  delete globalThis.age;
  vi.useRealTimers();
});

describe('35 — the binding lives in the profile', () => {
  it('normalises on save and hands out only a complete binding', async () => {
    expect(await og2RepoConfig()).toBeNull();
    const saved = await og2SaveRepoConfig({ base: 'https://git.example.ch/daniel/orggraph-sem.git/', token: 'tok', identity });
    expect(saved).toMatchObject({ base: 'https://git.example.ch', owner: 'daniel', repo: 'orggraph-sem', branch: 'main' });
    expect(await og2RepoConfig()).toMatchObject({ owner: 'daniel', repo: 'orggraph-sem', token: 'tok' });
  });

  it('keeps an incomplete binding readable but refuses to use it', async () => {
    await putStored(KEY_REPO, JSON.stringify({ base: 'https://git.example.ch', owner: 'daniel' })); // no repo, no token
    expect(await og2RepoConfig()).toBeNull();
    expect(await og2RepoConfigRaw()).toMatchObject({ owner: 'daniel' });
  });

  it('unbinding drops the sync marker as well', async () => {
    await og2SaveRepoConfig({ ...BINDING, identity });
    await putStored(KEY_SYNC, JSON.stringify({ exportedAt: '2026-09-16T10:00:00Z' }));
    expect(await og2SaveRepoConfig(null)).toBeNull();
    expect((await getStoredText(KEY_REPO)) ?? null).toBeNull();
    expect((await getStoredText(KEY_SYNC)) ?? null).toBeNull();
  });
});

describe('35 — age wrappers', () => {
  it('encrypts for a recipient and decrypts with its identity', async () => {
    const sealed = await og2AgeEncrypt(enc.encode('Grüezi'), [recipient]);
    expect(dec.decode(sealed.slice(0, 20))).toContain('age-encryption.org');
    expect(dec.decode(await og2AgeDecrypt(sealed, identity))).toBe('Grüezi');
  });

  it('a foreign identity cannot open it', async () => {
    const sealed = await og2AgeEncrypt(enc.encode('secret'), [recipient]);
    const other = await og2AgeGenerateIdentity();
    await expect(og2AgeDecrypt(sealed, other)).rejects.toThrow();
  });

  it('says so when the library is missing instead of failing obscurely', async () => {
    delete globalThis.age;
    await expect(og2AgeEncrypt(enc.encode('x'), [recipient])).rejects.toThrow(/age-Bibliothek fehlt/);
    await expect(og2AgeDecrypt(new Uint8Array([1]), identity)).rejects.toThrow(/age-Bibliothek fehlt/);
    expect(await og2AgeRecipientOf(identity)).toBeNull();
  });
});

describe('35 — pull on boot', () => {
  it('does nothing without a binding', async () => {
    const gitea = fakeGitea();
    globalThis.fetch = gitea.fetchImpl;
    expect(await og2SyncPull()).toEqual({ bound: false });
    expect(gitea.calls).toEqual([]);
  });

  it('reports an empty repo instead of restoring', async () => {
    const gitea = fakeGitea();
    globalThis.fetch = gitea.fetchImpl;
    await og2SaveRepoConfig({ ...BINDING, identity });
    expect(await og2SyncPull()).toMatchObject({ bound: true, restored: false, reason: 'repo has no export' });
  });

  it('restores a newer export: registry, env and store land in the profile', async () => {
    const exportedAt = '2026-09-16T12:00:00Z';
    const sealed = await og2AgeEncrypt(await tenantZipBytes(exportedAt), [recipient]);
    const gitea = fakeGitea({ 'manifest.json': JSON.stringify({ exportedAt, tenant: 'sem' }), 'tenant.zip.age': sealed });
    globalThis.fetch = gitea.fetchImpl;
    await og2SaveRepoConfig({ ...BINDING, identity });

    const res = await og2SyncPull();
    expect(res).toMatchObject({ bound: true, restored: true, reason: 'never synced' });
    expect(JSON.parse(await getStoredText(KEY_REGISTRY)).version).toBe('t1');
    expect(JSON.parse(await getStoredText(KEY_ENV)).VIEWS.Start.root).toBe('hrm:p1');
    expect(JSON.parse(await getStoredText(KEY_STORE)).format).toBe('og2-store-v2');
    expect(JSON.parse(await getStoredText(KEY_SYNC))).toMatchObject({ exportedAt });

    // second pull: the marker now matches, nothing is touched again
    const again = await og2SyncPull();
    expect(again).toMatchObject({ restored: false, reason: 'in sync' });
    // ... unless the caller forces it
    expect(await og2SyncPull({ force: true })).toMatchObject({ restored: true, reason: 'never synced' });
  });

  it('leaves a locally newer tenant alone', async () => {
    const gitea = fakeGitea({ 'manifest.json': JSON.stringify({ exportedAt: '2026-09-16T10:00:00Z' }) });
    globalThis.fetch = gitea.fetchImpl;
    await og2SaveRepoConfig({ ...BINDING, identity });
    await putStored(KEY_SYNC, JSON.stringify({ exportedAt: '2026-09-16T11:00:00Z' }));
    expect(await og2SyncPull()).toMatchObject({ restored: false, reason: 'local is newer' });
    expect(gitea.calls.some((c) => c.includes('/raw/'))).toBe(false);
  });

  it('refuses to restore without an age identity', async () => {
    const gitea = fakeGitea({ 'manifest.json': JSON.stringify({ exportedAt: '2026-09-16T12:00:00Z' }) });
    globalThis.fetch = gitea.fetchImpl;
    await og2SaveRepoConfig(BINDING); // no identity
    expect(await og2SyncPull()).toMatchObject({ bound: true, restored: false, error: expect.stringMatching(/Identität fehlt/) });
  });

  it('survives an unreachable server and says why', async () => {
    const gitea = fakeGitea();
    gitea.breakWith('network down');
    globalThis.fetch = gitea.fetchImpl;
    await og2SaveRepoConfig({ ...BINDING, identity });
    expect(await og2SyncPull()).toMatchObject({ bound: true, restored: false, error: expect.stringMatching(/nicht erreichbar/) });
    expect(errors).toHaveBeenCalled();
  });
});

describe('35 — archiving a raw input', () => {
  it('bootstraps config.json with the own key and commits the encrypted file', async () => {
    const gitea = fakeGitea();
    globalThis.fetch = gitea.fetchImpl;
    await og2SaveRepoConfig({ ...BINDING, identity });

    const commit = await og2SyncArchiveRaw('crawl ../x/Kohorte VIII - LS.txt', 'Zeile 1\nZeile 2\n');
    expect(commit).toMatchObject({ sha: 'commit-1' });
    expect(gitea.commits).toHaveLength(1);
    expect(gitea.commits[0].paths.sort()).toEqual(['config.json', 'snapshots/Kohorte_VIII_-_LS.txt.age']);
    expect(gitea.commits[0].ops).toEqual(['create', 'create']);
    expect(JSON.parse(dec.decode(gitea.files.get('config.json')))).toEqual({ tenant: 'Standard', recipients: [recipient] });
    const sealed = gitea.files.get('snapshots/Kohorte_VIII_-_LS.txt.age');
    expect(dec.decode(await og2AgeDecrypt(sealed, identity))).toBe('Zeile 1\nZeile 2\n');
  });

  it('encrypts for the recipients the repo declares and updates in place', async () => {
    const otherIdentity = await og2AgeGenerateIdentity();
    const otherRecipient = await og2AgeRecipientOf(otherIdentity);
    const gitea = fakeGitea({
      'config.json': JSON.stringify({ tenant: 'sem', recipients: [otherRecipient] }),
      'snapshots/liste.txt.age': new Uint8Array([1, 2, 3]),
    });
    globalThis.fetch = gitea.fetchImpl;
    await og2SaveRepoConfig({ ...BINDING, identity });

    expect(await og2SyncArchiveRaw('liste.txt', 'neu')).toMatchObject({ sha: 'commit-1' });
    expect(gitea.commits[0].paths).toEqual(['snapshots/liste.txt.age']); // no config bootstrap
    expect(gitea.commits[0].ops).toEqual(['update']);                    // existing sha -> update
    const sealed = gitea.files.get('snapshots/liste.txt.age');
    expect(dec.decode(await og2AgeDecrypt(sealed, otherIdentity))).toBe('neu');
    await expect(og2AgeDecrypt(sealed, identity)).rejects.toThrow(); // our own key is NOT a recipient
  });

  it('refuses when neither the repo nor the profile names a recipient', async () => {
    const gitea = fakeGitea({ 'config.json': JSON.stringify({ tenant: 'sem', recipients: [] }) });
    globalThis.fetch = gitea.fetchImpl;
    await og2SaveRepoConfig(BINDING); // no identity
    expect(await og2SyncArchiveRaw('liste.txt', 'x')).toBeNull();
    expect(gitea.commits).toHaveLength(0);
  });

  it('is a no-op without a binding', async () => {
    const gitea = fakeGitea();
    globalThis.fetch = gitea.fetchImpl;
    expect(await og2SyncArchiveRaw('liste.txt', 'x')).toBeNull();
    expect(gitea.calls).toEqual([]);
  });
});

describe('35 — push', () => {
  it('does nothing without a binding', async () => {
    const gitea = fakeGitea();
    globalThis.fetch = gitea.fetchImpl;
    expect(await og2SyncPush()).toBeNull();
    expect(gitea.calls).toEqual([]);
  });

  it('never commits when no tenant is loaded', async () => {
    const gitea = fakeGitea();
    globalThis.fetch = gitea.fetchImpl;
    await og2SaveRepoConfig({ ...BINDING, identity });
    expect(await og2SyncPush('store adopted')).toBeNull();
    expect(gitea.commits).toHaveLength(0);
    expect(errors.mock.calls[0][0]).toBe('[sync] push');
  });

  it('coalesces a burst of changes into one push', async () => {
    const gitea = fakeGitea();
    globalThis.fetch = gitea.fetchImpl;
    await og2SaveRepoConfig({ ...BINDING, identity });
    // Only the debounce timer is faked: the profile store underneath runs on
    // real async plumbing and would deadlock against a fully faked clock.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    og2SyncPushSoon('change 1');
    og2SyncPushSoon('change 2');
    og2SyncPushSoon('change 3');
    await vi.advanceTimersByTimeAsync(2000);
    // the fired push itself awaits the profile store — give it real turns
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(errors.mock.calls.filter((c) => c[0] === '[sync] push')).toHaveLength(1);
  });
});
