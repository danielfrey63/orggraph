import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadEnvConfig,
  loadData,
  idOf,
} from '../src/sections/09-data-load.js';
import { loadPseudoData } from '../src/sections/06-pseudo-labels.js';
import { KEY_ENV, KEY_PSEUDO, ATTR_EXT } from '../src/sections/04-storage.js';

// In-memory stand-in for the IndexedDB-backed accessors.
let store;

const okJson = (obj) => ({ ok: true, json: async () => obj, text: async () => JSON.stringify(obj) });
const okText = (text) => ({ ok: true, text: async () => text });
const httpError = { ok: false, status: 404, statusText: 'Not Found' };

beforeEach(() => {
  // error-path tests intentionally trigger app-side console output
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  store = new Map();
  globalThis.Logger = { log: () => {} };
  globalThis.KEY_ENV = KEY_ENV;
  globalThis.KEY_PSEUDO = KEY_PSEUDO;
  globalThis.ATTR_EXT = ATTR_EXT;
  globalThis.getStoredJson = async (k) => store.get(k);
  globalThis.getStoredText = async (k) => store.get(k);
  globalThis.setStatus = () => {};
  globalThis.showTemporaryNotification = () => {};
  globalThis.buildAttributeLegend = () => {};
  globalThis.updateAttributeStats = () => {};
  globalThis.updateAttributeCircles = () => {};
  globalThis.notifyAttributeVisibilityChanged = () => {};
  globalThis.idOf = idOf;
  globalThis.envConfig = null;
  globalThis.debugMode = false;
  globalThis.pseudoData = null;
  globalThis.personAttributes = new Map();
  globalThis.attributeTypes = new Map();
  globalThis.activeAttributes = new Set();
  globalThis.emptyCategories = new Set();
  globalThis.categorySourceFiles = new Map();
  globalThis.collapsedCategories = new Set();
  globalThis.fetch = vi.fn(async () => httpError);
  globalThis.og2TryBoot = undefined;
  for (const k of ['raw', 'byId', 'allNodesUnique', 'parentOf', 'orgParent', 'orgChildren', 'orgRoots', 'hiddenNodes', 'hiddenByRoot']) {
    globalThis[k] = undefined;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadEnvConfig', () => {
  it('prefers the stored env and applies the debug flag', async () => {
    store.set(KEY_ENV, { DATA_URL: './d.json', TOOLBAR_DEBUG_ACTIVE: true });
    expect(await loadEnvConfig()).toBe(true);
    expect(globalThis.envConfig.DATA_URL).toBe('./d.json');
    expect(globalThis.debugMode).toBe(true);
  });

  it('falls back to fetching env.json', async () => {
    globalThis.fetch = vi.fn(async () => okJson({ DATA_URL: './fetched.json' }));
    expect(await loadEnvConfig()).toBe(true);
    expect(globalThis.envConfig.DATA_URL).toBe('./fetched.json');
  });

  it('returns false on HTTP error and on fetch failure', async () => {
    expect(await loadEnvConfig()).toBe(false);
    expect(globalThis.envConfig).toBeNull();
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });
    expect(await loadEnvConfig()).toBe(false);
  });
});

describe('loadData (v2-only, §9.3/E25)', () => {
  it('boots the v2 tenant when og2TryBoot succeeds', async () => {
    globalThis.og2TryBoot = async () => true;
    expect(await loadData()).toBe(true);
  });

  it('renders nothing legacy and points to the migration script otherwise', async () => {
    const statuses = [];
    globalThis.setStatus = (s) => statuses.push(s);
    globalThis.og2TryBoot = async () => false;
    expect(await loadData()).toBe(false);
    expect(statuses.some((s) => s.includes('migrate-legacy'))).toBe(true);
  });

  it('reports a failing v2 boot without falling back', async () => {
    globalThis.og2TryBoot = async () => { throw new Error('boom'); };
    expect(await loadData()).toBe(false);
  });
});

describe('loadPseudoData', () => {
  it('prefers stored pseudo data', async () => {
    store.set(KEY_PSEUDO, { names: ['Px'] });
    expect(await loadPseudoData()).toBe(true);
    expect(globalThis.pseudoData.names).toEqual(['Px']);
  });

  it('falls back to fetch and reports missing file', async () => {
    globalThis.fetch = vi.fn(async () => okJson({ names: ['Py'], organizationalUnits1: [] }));
    expect(await loadPseudoData()).toBe(true);
    expect(globalThis.pseudoData.names).toEqual(['Py']);

    globalThis.fetch = vi.fn(async () => httpError);
    globalThis.pseudoData = null;
    expect(await loadPseudoData()).toBe(false);
  });

  it('resets pseudoData on errors', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('boom'); });
    expect(await loadPseudoData()).toBe(false);
    expect(globalThis.pseudoData).toBeNull();
  });
});
