import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadEnvConfig,
  categoryFromUrl,
  loadAttributesFromUrl,
  loadData,
  idOf,
} from '../src/sections/09-data-load.js';
import { loadPseudoData } from '../src/sections/06-pseudo-labels.js';
import { parseAttributeList, findPersonIdsByIdentifier } from '../src/sections/15-ui-apply-search.js';
import { colorForCategoryAttribute } from '../src/sections/08-color-geometry.js';
import { KEY_ENV, KEY_DATA, KEY_PSEUDO } from '../src/sections/04-storage.js';

// In-memory stand-in for the IndexedDB-backed accessors.
let store;

const okJson = (obj) => ({ ok: true, json: async () => obj, text: async () => JSON.stringify(obj) });
const okText = (text) => ({ ok: true, text: async () => text });
const httpError = { ok: false, status: 404, statusText: 'Not Found' };

beforeEach(() => {
  store = new Map();
  globalThis.Logger = { log: () => {} };
  globalThis.KEY_ENV = KEY_ENV;
  globalThis.KEY_DATA = KEY_DATA;
  globalThis.KEY_PSEUDO = KEY_PSEUDO;
  globalThis.getStoredJson = async (k) => store.get(k);
  globalThis.getStoredText = async (k) => store.get(k);
  globalThis.getStoredAttributes = async () => [];
  globalThis.setStatus = () => {};
  globalThis.showTemporaryNotification = () => {};
  globalThis.buildAttributeLegend = () => {};
  globalThis.updateAttributeStats = () => {};
  globalThis.updateAttributeCircles = () => {};
  globalThis.parseAttributeList = parseAttributeList;
  globalThis.findPersonIdsByIdentifier = findPersonIdsByIdentifier;
  globalThis.colorForCategoryAttribute = colorForCategoryAttribute;
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
  // state written by processData
  for (const k of ['raw', 'byId', 'allNodesUnique', 'parentOf', 'orgParent', 'orgChildren', 'orgRoots', 'hiddenNodes', 'hiddenByRoot']) {
    globalThis[k] = undefined;
  }
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

describe('categoryFromUrl', () => {
  it('derives the category from the filename without extension', () => {
    expect(categoryFromUrl('./attributes/Team Rom.tsv')).toBe('Team Rom');
    expect(categoryFromUrl('https://x/y/Roles.txt?v=2#top')).toBe('Roles');
    expect(categoryFromUrl('NoExtension')).toBe('NoExtension');
    expect(categoryFromUrl('.hidden')).toBe('.hidden');
  });
});

describe('loadAttributesFromUrl', () => {
  beforeEach(() => {
    globalThis.raw = { persons: [{ id: 'p-1', label: 'Alice', email: 'alice@x.ch' }] };
  });

  it('matches identifiers, registers composite types and source info', async () => {
    globalThis.fetch = vi.fn(async () => okText('alice@x.ch\tCoach\nghost@x.ch\tPL'));
    const r = await loadAttributesFromUrl('./attr/Team.tsv');
    expect(r).toMatchObject({ loaded: true, matchedCount: 1, unmatchedCount: 1, totalAttributes: 2 });
    expect(globalThis.personAttributes.get('p-1').has('Team::Coach')).toBe(true);
    expect(globalThis.attributeTypes.has('Team::Coach')).toBe(true);
    expect(globalThis.activeAttributes.has('Team::Coach')).toBe(true);
    expect(globalThis.categorySourceFiles.get('Team')).toMatchObject({ filename: 'Team.tsv', format: 'tab' });
  });

  it('registers an empty file as an empty category', async () => {
    globalThis.fetch = vi.fn(async () => okText('\n'));
    const r = await loadAttributesFromUrl('./attr/Empty.txt');
    expect(r).toMatchObject({ loaded: true, isEmpty: true, category: 'Empty' });
    expect(globalThis.emptyCategories.has('Empty')).toBe(true);
  });

  it('reports HTTP failures', async () => {
    const r = await loadAttributesFromUrl('./attr/Missing.tsv');
    expect(r.loaded).toBe(false);
    expect(r.error).toContain('404');
  });

  it('merges attributes into existing person maps', async () => {
    globalThis.personAttributes = new Map([['p-1', new Map([['Old::X', '1']])]]);
    globalThis.fetch = vi.fn(async () => okText('p-1\tCoach'));
    await loadAttributesFromUrl('./attr/Team.tsv');
    const attrs = globalThis.personAttributes.get('p-1');
    expect(attrs.has('Old::X')).toBe(true);
    expect(attrs.has('Team::Coach')).toBe(true);
  });
});

describe('loadData', () => {
  it('uses stored data and processes it', async () => {
    store.set(KEY_DATA, JSON.stringify({ persons: [{ id: 'p-1', label: 'A' }], orgs: [], links: [] }));
    globalThis.personAttributes = new Map();
    expect(await loadData()).toBe(true);
    expect(globalThis.byId.has('p-1')).toBe(true);
  });

  it('falls back to the env DATA_URL', async () => {
    globalThis.envConfig = { DATA_URL: './data.json' };
    globalThis.fetch = vi.fn(async () => okJson({ persons: [{ id: 'p-9', label: 'F' }], orgs: [], links: [] }));
    expect(await loadData()).toBe(true);
    expect(globalThis.byId.has('p-9')).toBe(true);
  });

  it('returns false when no source yields data', async () => {
    expect(await loadData()).toBe(false);
  });

  it('survives corrupt stored JSON by falling back', async () => {
    store.set(KEY_DATA, '{broken');
    globalThis.envConfig = { DATA_URL: './data.json' };
    globalThis.fetch = vi.fn(async () => okJson({ persons: [{ id: 'p-2', label: 'B' }], orgs: [], links: [] }));
    expect(await loadData()).toBe(true);
    expect(globalThis.byId.has('p-2')).toBe(true);
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
