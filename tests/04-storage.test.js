import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  KEY_ENV,
  KEY_PSEUDO,
  KEY_REGISTRY,
  SNAPSHOT_PREFIX,
  ATTR_EXT,
  looksLikeEnv,
  looksLikePseudo,
  looksLikeData,
  looksLikeSnapshot,
  classifyFile,
  normalizeRelPath,
  dirOf,
  basenameOf,
  resolveRefPath,
  findEntryByRef,
  isPathUnderDir,
  storeEntries,
  storeFiles,
  idbClear,
  putStored,
  delStored,
  getStoredText,
  getStoredJson,
  hasStoredData,
  requestPersistence,
} from '../src/sections/04-storage.js';

// jsdom's File lacks Blob.text(); classifyFile only uses .name and .text().
const makeFile = (name, content) => ({ name, text: async () => content });

const SNAPSHOT_TEXT = JSON.stringify({
  meta: { source: 'hrm', snapshot: '20260101-1200', crawledAt: '2026-01-01T12:00:00Z', registryVersion: '1', scope: { nodeTypes: [], edgeTypes: [] } },
  schema: { nodeTypes: {}, edgeTypes: {} },
  nodes: [], edges: [],
});

beforeEach(async () => {
  await idbClear();
});

describe('content classifiers', () => {
  it('looksLikeEnv detects DATA_URL and TOOLBAR_/LEGEND_ keys', () => {
    expect(looksLikeEnv({ DATA_URL: './x.json' })).toBe(true);
    expect(looksLikeEnv({ TOOLBAR_FOO: 1 })).toBe(true);
    expect(looksLikeEnv({ LEGEND_BAR: 1 })).toBe(true);
    expect(looksLikeEnv({ other: 1 })).toBe(false);
    expect(looksLikeEnv(null)).toBe(false);
    expect(looksLikeEnv('string')).toBe(false);
  });

  it('looksLikePseudo detects names array and organizationalUnits keys', () => {
    expect(looksLikePseudo({ names: [] })).toBe(true);
    expect(looksLikePseudo({ organizationalUnits: {} })).toBe(true);
    expect(looksLikePseudo({ persons: [] })).toBe(false);
    expect(looksLikePseudo(null)).toBe(false);
  });

  it('looksLikeData still detects the legacy shape (for the rejection hint)', () => {
    expect(looksLikeData({ persons: [] })).toBe(true);
    expect(looksLikeData({ orgs: [] })).toBe(true);
    expect(looksLikeData({ links: [] })).toBe(true);
    expect(looksLikeData({ persons: 'no' })).toBe(false);
    expect(looksLikeData(null)).toBe(false);
  });

  it('looksLikeSnapshot detects the v2 snapshot shape', () => {
    expect(looksLikeSnapshot(JSON.parse(SNAPSHOT_TEXT))).toBe(true);
    expect(looksLikeSnapshot({ persons: [] })).toBe(false);
  });

  it('ATTR_EXT matches tsv/txt/csv case-insensitively', () => {
    expect(ATTR_EXT.test('a.tsv')).toBe(true);
    expect(ATTR_EXT.test('a.TXT')).toBe(true);
    expect(ATTR_EXT.test('a.csv')).toBe(true);
    expect(ATTR_EXT.test('a.json')).toBe(false);
  });
});

describe('classifyFile', () => {
  it('recognizes legacy classes without a storage key (E25/FR-6.7)', async () => {
    const attr = await classifyFile(makeFile('Team.tsv', 'a@b\tX'));
    expect(attr).toMatchObject({ kind: 'attr', key: null, filename: 'Team.tsv' });
    const data = await classifyFile(makeFile('d.json', '{"persons":[]}'));
    expect(data).toMatchObject({ kind: 'data', key: null });
  });

  it('classifies env/pseudo/snapshot/registry JSON by content', async () => {
    expect((await classifyFile(makeFile('e.json', '{"DATA_URL":"x"}'))).kind).toBe('env');
    expect((await classifyFile(makeFile('p.json', '{"names":[]}'))).kind).toBe('pseudo');
    expect((await classifyFile(makeFile('s.json', SNAPSHOT_TEXT))).kind).toBe('snapshot');
    expect((await classifyFile(makeFile('r.json', '{"version":"1","nodeTypes":{},"edgeTypes":{}}'))).kind).toBe('registry');
  });

  it('returns unknown for non-JSON and unrecognized JSON', async () => {
    expect((await classifyFile(makeFile('x.json', 'not json'))).kind).toBe('unknown');
    expect((await classifyFile(makeFile('y.json', '{"foo":1}'))).kind).toBe('unknown');
  });

  it('falls back to "unnamed" when the file has no name', async () => {
    const blobish = { name: '', text: async () => '{"foo":1}' };
    const c = await classifyFile(blobish);
    expect(c.filename).toBe('unnamed');
  });
});

describe('profile-scoped storage roundtrip', () => {
  it('put/get/overwrite/delete work within the active profile', async () => {
    await putStored('k1', 'v1');
    expect(await getStoredText('k1')).toBe('v1');
    await putStored('k1', 'v2');
    expect(await getStoredText('k1')).toBe('v2');
    await delStored('k1');
    expect(await getStoredText('k1')).toBeUndefined();
    expect(await getStoredText('missing')).toBeUndefined();
  });
});

describe('storeFiles (E25/FR-6.7: legacy classes rejected, never stored)', () => {
  it('stores v2 files, rejects legacy ones and reports unknown ones', async () => {
    const result = await storeFiles([
      makeFile('s.json', SNAPSHOT_TEXT),
      makeFile('d.json', '{"persons":[{"id":"p-1","label":"A"}]}'),
      makeFile('Team.tsv', 'a@b\tRole'),
      makeFile('junk.json', 'nope'),
    ]);
    expect(result.stored).toEqual([{ kind: 'snapshot', filename: 's.json' }]);
    expect(result.rejected).toEqual([
      { kind: 'data', filename: 'd.json' },
      { kind: 'attr', filename: 'Team.tsv' },
    ]);
    expect(result.unknown).toEqual(['junk.json']);
    expect(await getStoredText(SNAPSHOT_PREFIX + 's.json')).toContain('20260101-1200');
    // nothing legacy landed in the profile store
    expect(await getStoredText('data')).toBeUndefined();
  });

  it('handles an empty or missing file list', async () => {
    expect(await storeFiles([])).toEqual({ stored: [], unknown: [], missing: [], ignored: [], rejected: [] });
    expect(await storeFiles(null)).toEqual({ stored: [], unknown: [], missing: [], ignored: [], rejected: [] });
  });
});

describe('path helpers', () => {
  it('normalizeRelPath strips ./, resolves .. and unifies backslashes', () => {
    expect(normalizeRelPath('./data.json')).toBe('data.json');
    expect(normalizeRelPath('a/./b/../c.json')).toBe('a/c.json');
    expect(normalizeRelPath('a\\b\\c.txt')).toBe('a/b/c.txt');
    expect(normalizeRelPath('')).toBe('');
    expect(normalizeRelPath(null)).toBe('');
  });

  it('dirOf returns the directory portion or empty string', () => {
    expect(dirOf('a/b/c.json')).toBe('a/b');
    expect(dirOf('c.json')).toBe('');
  });

  it('basenameOf returns the final segment without query/fragment', () => {
    expect(basenameOf('a/b/c.txt?v=1')).toBe('c.txt');
    expect(basenameOf('./Team.tsv#x')).toBe('Team.tsv');
    expect(basenameOf('plain.json')).toBe('plain.json');
  });
});

describe('env reference resolution', () => {
  it('resolveRefPath resolves relative refs against the env location', () => {
    expect(resolveRefPath('pkg/env.json', './data.json')).toBe('pkg/data.json');
    expect(resolveRefPath('env.json', './attrs/Team.tsv')).toBe('attrs/Team.tsv');
    expect(resolveRefPath('pkg/env.json', '../shared/d.json')).toBe('shared/d.json');
  });

  it('resolveRefPath returns null for absolute URLs and empty refs', () => {
    expect(resolveRefPath('env.json', 'https://example.com/d.json')).toBeNull();
    expect(resolveRefPath('env.json', 'data:application/json,{}')).toBeNull();
    expect(resolveRefPath('env.json', '')).toBeNull();
  });

  it('findEntryByRef matches by resolved path first', () => {
    const entries = [{ path: 'pkg/data.json' }, { path: 'other/data.json' }];
    expect(findEntryByRef(entries, 'pkg/env.json', './data.json')).toBe(entries[0]);
  });

  it('findEntryByRef falls back to a unique basename match', () => {
    const entries = [{ path: 'somewhere/else/data.hrm.json' }];
    expect(findEntryByRef(entries, 'env.json', './data.hrm.json')).toBe(entries[0]);
  });

  it('findEntryByRef returns null on ambiguous or absent matches', () => {
    const two = [{ path: 'a/d.json' }, { path: 'b/d.json' }];
    expect(findEntryByRef(two, 'env.json', './d.json')).toBeNull();
    expect(findEntryByRef([], 'env.json', './d.json')).toBeNull();
    expect(findEntryByRef(two, 'env.json', 'https://x/d.json')).toBeNull();
  });
});

describe('storeEntries (env-driven folder/zip drops)', () => {
  const entry = (path, content) => ({
    path,
    file: { name: path.split('/').pop(), text: async () => content },
  });

  it('DATA_URL references resolve to snapshots; legacy datasets are rejected', async () => {
    const result = await storeEntries([
      entry('pkg/env.json', JSON.stringify({ DATA_URL: './snap.json' })),
      entry('pkg/snap.json', SNAPSHOT_TEXT),
      entry('pkg/data.json', '{"persons":[{"id":"p-other"}]}'),
      entry('pkg/pseudo.data.json', '{"names":["Alias"]}'),
      entry('pkg/junk.bin', 'garbage'),
    ]);

    expect(result.stored).toEqual([
      { kind: 'env', filename: 'env.json' },
      { kind: 'snapshot', filename: 'snap.json' },
      { kind: 'pseudo', filename: 'pseudo.data.json' },
    ]);
    expect(result.rejected).toEqual([{ kind: 'data', filename: 'data.json' }]);
    expect(result.unknown).toEqual(['junk.bin']);
    expect(result.missing).toEqual([]);
    expect(await getStoredText(SNAPSHOT_PREFIX + 'snap.json')).toContain('20260101-1200');
    expect(await getStoredText(KEY_PSEUDO)).toContain('Alias');
  });

  it('a DATA_URL reference pointing at a legacy dataset is rejected with a hint', async () => {
    const result = await storeEntries([
      entry('pkg/env.json', JSON.stringify({ DATA_URL: './data.json' })),
      entry('pkg/data.json', '{"persons":[{"id":"p-1"}]}'),
    ]);
    expect(result.stored).toEqual([{ kind: 'env', filename: 'env.json' }]);
    expect(result.rejected).toEqual([{ kind: 'data', filename: 'data.json' }]);
    expect(await getStoredText('data')).toBeUndefined();
  });

  it('reports references that are not part of the drop as missing', async () => {
    const result = await storeEntries([
      entry('env.json', JSON.stringify({ DATA_URL: './snap.json' })),
    ]);
    expect(result.stored).toEqual([{ kind: 'env', filename: 'env.json' }]);
    expect(result.missing).toEqual(['./snap.json']);
    expect(await getStoredText(KEY_ENV)).toContain('DATA_URL');
  });

  it('prefers a file named env.json over env variants', async () => {
    const result = await storeEntries([
      entry('pkg/env.sem.json', '{"DATA_URL":"./other.json"}'),
      entry('pkg/env.json', '{"DATA_URL":"./snap.json"}'),
      entry('pkg/snap.json', SNAPSHOT_TEXT),
    ]);
    expect(result.stored).toContainEqual({ kind: 'env', filename: 'env.json' });
    expect(result.ignored).toEqual(['env.sem.json']);
    expect(await getStoredJson(KEY_ENV)).toEqual({ DATA_URL: './snap.json' });
  });

  it('stores registry drops under the registry key', async () => {
    const result = await storeEntries([
      entry('registry.json', '{"version":"1","nodeTypes":{},"edgeTypes":{}}'),
    ]);
    expect(result.stored).toEqual([{ kind: 'registry', filename: 'registry.json' }]);
    expect(await getStoredJson(KEY_REGISTRY)).toMatchObject({ version: '1' });
  });

  it('skips entries without a readable text() function', async () => {
    const result = await storeEntries([null, { path: 'x.json' }, entry('s.json', SNAPSHOT_TEXT)]);
    expect(result.stored).toEqual([{ kind: 'snapshot', filename: 's.json' }]);
  });
});

describe('stored accessors', () => {
  it('getStoredText returns undefined for non-string values', async () => {
    await putStored('obj', { not: 'a string' });
    expect(await getStoredText('obj')).toBeUndefined();
  });

  it('getStoredJson parses stored JSON and tolerates broken JSON', async () => {
    await putStored(KEY_ENV, '{"DATA_URL":"./d.json"}');
    expect(await getStoredJson(KEY_ENV)).toEqual({ DATA_URL: './d.json' });
    await putStored(KEY_PSEUDO, '{broken');
    expect(await getStoredJson(KEY_PSEUDO)).toBeUndefined();
    expect(await getStoredJson('missing')).toBeUndefined();
  });

  it('hasStoredData reflects presence of a v2 configuration (env or registry)', async () => {
    expect(await hasStoredData()).toBe(false);
    await putStored(KEY_ENV, '{"DATA_URL":"./snap.json"}');
    expect(await hasStoredData()).toBe(true);
    await delStored(KEY_ENV);
    await putStored(KEY_REGISTRY, '{"version":"1","nodeTypes":{},"edgeTypes":{}}');
    expect(await hasStoredData()).toBe(true);
  });
});

describe('requestPersistence', () => {
  it('returns false when navigator.storage.persist is unavailable', async () => {
    expect(await requestPersistence()).toBe(false);
  });
});

describe('isPathUnderDir', () => {
  it('matches paths inside the directory only', () => {
    expect(isPathUnderDir('pkg/attrs/Team.tsv', 'pkg/attrs')).toBe(true);
    expect(isPathUnderDir('pkg/attrs/sub/X.tsv', 'pkg/attrs')).toBe(true);
    expect(isPathUnderDir('pkg/other/Team.tsv', 'pkg/attrs')).toBe(false);
    expect(isPathUnderDir('pkg/attrs-2/Team.tsv', 'pkg/attrs')).toBe(false);
  });

  it('treats the empty dir (drop root) as matching everything and null as nothing', () => {
    expect(isPathUnderDir('Team.tsv', '')).toBe(true);
    expect(isPathUnderDir('a/b/Team.tsv', '')).toBe(true);
    expect(isPathUnderDir('Team.tsv', null)).toBe(false);
  });
});
