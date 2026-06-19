import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  KEY_ENV,
  KEY_DATA,
  KEY_PSEUDO,
  ATTR_PREFIX,
  ATTR_EXT,
  looksLikeEnv,
  looksLikePseudo,
  looksLikeData,
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
  getStoredAttributes,
  getStoredAttrMatches,
  mergeStoredAttrMatches,
  hasStoredData,
  requestPersistence,
} from '../src/sections/04-storage.js';

// jsdom's File lacks Blob.text(); classifyFile only uses .name and .text().
const makeFile = (name, content) => ({ name, text: async () => content });

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

  it('looksLikeData detects persons/orgs/links arrays', () => {
    expect(looksLikeData({ persons: [] })).toBe(true);
    expect(looksLikeData({ orgs: [] })).toBe(true);
    expect(looksLikeData({ links: [] })).toBe(true);
    expect(looksLikeData({ persons: 'no' })).toBe(false);
    expect(looksLikeData(null)).toBe(false);
  });

  it('ATTR_EXT matches tsv/txt/csv case-insensitively', () => {
    expect(ATTR_EXT.test('a.tsv')).toBe(true);
    expect(ATTR_EXT.test('a.TXT')).toBe(true);
    expect(ATTR_EXT.test('a.csv')).toBe(true);
    expect(ATTR_EXT.test('a.json')).toBe(false);
  });
});

describe('classifyFile', () => {
  it('classifies attribute files by extension', async () => {
    const c = await classifyFile(makeFile('Team.tsv', 'a@b\tX'));
    expect(c).toMatchObject({ kind: 'attr', key: ATTR_PREFIX + 'Team.tsv', filename: 'Team.tsv' });
  });

  it('classifies env/pseudo/data JSON by content', async () => {
    expect((await classifyFile(makeFile('e.json', '{"DATA_URL":"x"}'))).kind).toBe('env');
    expect((await classifyFile(makeFile('p.json', '{"names":[]}'))).kind).toBe('pseudo');
    expect((await classifyFile(makeFile('d.json', '{"persons":[]}'))).kind).toBe('data');
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

describe('storeFiles', () => {
  it('stores classified files and reports unknown ones', async () => {
    const result = await storeFiles([
      makeFile('d.json', '{"persons":[{"id":"p-1","label":"A"}]}'),
      makeFile('Team.tsv', 'a@b\tRole'),
      makeFile('junk.json', 'nope'),
    ]);
    expect(result.stored).toEqual([
      { kind: 'data', filename: 'd.json' },
      { kind: 'attr', filename: 'Team.tsv' },
    ]);
    expect(result.unknown).toEqual(['junk.json']);
    expect(await getStoredText(KEY_DATA)).toContain('p-1');
  });

  it('remembers the original attribute filename alongside the content', async () => {
    await storeFiles([makeFile('My Team.tsv', 'x@y\tZ')]);
    expect(await getStoredText(ATTR_PREFIX + 'My Team.tsv::name')).toBe('My Team.tsv');
  });

  it('handles an empty or missing file list', async () => {
    expect(await storeFiles([])).toEqual({ stored: [], unknown: [], missing: [], ignored: [] });
    expect(await storeFiles(null)).toEqual({ stored: [], unknown: [], missing: [], ignored: [] });
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

  it('lets env.json decide which dataset and attribute files are stored', async () => {
    const result = await storeEntries([
      entry('pkg/env.json', JSON.stringify({
        DATA_URL: './data.hrm.json',
        DATA_ATTRIBUTES_URL: ['./attrs/Team.tsv'],
      })),
      entry('pkg/data.json', '{"persons":[{"id":"p-other"}]}'),
      entry('pkg/data.hrm.json', '{"persons":[{"id":"p-hrm"}]}'),
      entry('pkg/attrs/Team.tsv', 'a@b\tRole'),
      entry('pkg/pseudo.data.json', '{"names":["Alias"]}'),
      entry('pkg/junk.bin', 'garbage'),
    ]);

    expect(result.stored).toEqual([
      { kind: 'env', filename: 'env.json' },
      { kind: 'data', filename: 'data.hrm.json' },
      { kind: 'attr', filename: 'Team.tsv' },
      { kind: 'pseudo', filename: 'pseudo.data.json' },
    ]);
    expect(result.ignored).toEqual(['data.json']);
    expect(result.unknown).toEqual(['junk.bin']);
    expect(result.missing).toEqual([]);
    expect(await getStoredText(KEY_DATA)).toContain('p-hrm');
    expect(await getStoredText(KEY_PSEUDO)).toContain('Alias');
    expect(await getStoredText(ATTR_PREFIX + 'Team.tsv::name')).toBe('Team.tsv');
  });

  it('reports references that are not part of the drop as missing', async () => {
    const result = await storeEntries([
      entry('env.json', JSON.stringify({
        DATA_URL: './data.json',
        DATA_ATTRIBUTES_URL: './Team.tsv',
      })),
    ]);
    expect(result.stored).toEqual([{ kind: 'env', filename: 'env.json' }]);
    expect(result.missing).toEqual(['./data.json', './Team.tsv']);
    expect(await getStoredText(KEY_ENV)).toContain('DATA_URL');
  });

  it('prefers a file named env.json over env variants', async () => {
    const result = await storeEntries([
      entry('pkg/env.sem.json', '{"DATA_URL":"./data.sem.json"}'),
      entry('pkg/env.json', '{"DATA_URL":"./data.json"}'),
      entry('pkg/data.json', '{"persons":[{"id":"p-main"}]}'),
      entry('pkg/data.sem.json', '{"persons":[{"id":"p-sem"}]}'),
    ]);
    expect(result.stored).toContainEqual({ kind: 'env', filename: 'env.json' });
    expect(result.ignored.sort()).toEqual(['data.sem.json', 'env.sem.json']);
    expect(await getStoredText(KEY_DATA)).toContain('p-main');
    expect(await getStoredJson(KEY_ENV)).toEqual({ DATA_URL: './data.json' });
  });

  it('stores unreferenced attribute files additively alongside an env drop', async () => {
    const result = await storeEntries([
      entry('env.json', '{"TOOLBAR_DEPTH_DEFAULT":2}'),
      entry('Extra.csv', 'x@y,Z'),
    ]);
    expect(result.stored).toEqual([
      { kind: 'env', filename: 'env.json' },
      { kind: 'attr', filename: 'Extra.csv' },
    ]);
    expect(result.missing).toEqual([]);
  });

  it('skips entries without a readable text() function', async () => {
    const result = await storeEntries([null, { path: 'x.json' }, entry('d.json', '{"persons":[]}')]);
    expect(result.stored).toEqual([{ kind: 'data', filename: 'd.json' }]);
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

  it('getStoredAttributes lists attr entries with original filenames', async () => {
    await storeFiles([makeFile('A.tsv', 'a@b\tX'), makeFile('B.csv', 'c@d\tY')]);
    const attrs = await getStoredAttributes();
    expect(attrs.map((a) => a.filename).sort()).toEqual(['A.tsv', 'B.csv']);
    expect(attrs.every((a) => a.key.includes(ATTR_PREFIX))).toBe(true);
    expect(attrs.every((a) => typeof a.text === 'string')).toBe(true);
  });

  it('hasStoredData reflects presence of the data key', async () => {
    expect(await hasStoredData()).toBe(false);
    await putStored(KEY_DATA, '{"persons":[]}');
    expect(await hasStoredData()).toBe(true);
  });
});

describe('requestPersistence', () => {
  it('returns false when navigator.storage.persist is unavailable', async () => {
    expect(await requestPersistence()).toBe(false);
  });
});

describe('stored attribute match resolutions', () => {
  it('returns an empty object when nothing is stored', async () => {
    expect(await getStoredAttrMatches()).toEqual({});
  });

  it('merges updates over existing resolutions and round-trips', async () => {
    await mergeStoredAttrMatches({ 'a@x.ch': 'p1', 'b@x.ch': null });
    await mergeStoredAttrMatches({ 'b@x.ch': 'p2', 'c@x.ch': null });
    expect(await getStoredAttrMatches()).toEqual({ 'a@x.ch': 'p1', 'b@x.ch': 'p2', 'c@x.ch': null });
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

describe('storeEntries with DATA_ATTRIBUTES_DIR', () => {
  const entry = (path, content) => ({
    path,
    file: { name: path.split('/').pop(), text: async () => content },
  });

  it('stores every attribute file inside the configured directory', async () => {
    const result = await storeEntries([
      entry('pkg/env.json', JSON.stringify({
        DATA_URL: './data.json',
        DATA_ATTRIBUTES_DIR: './attrs/',
      })),
      entry('pkg/data.json', '{"persons":[]}'),
      entry('pkg/attrs/Team.tsv', 'a@b\tX'),
      entry('pkg/attrs/Roles.txt', 'a@b\tY'),
    ]);
    const attrNames = result.stored.filter(s => s.kind === 'attr').map(s => s.filename).sort();
    expect(attrNames).toEqual(['Roles.txt', 'Team.tsv']);
    expect(result.missing).toEqual([]);
    expect(await getStoredText(ATTR_PREFIX + 'Team.tsv')).toBe('a@b\tX');
  });

  it('combines explicit refs and directories without storing twice', async () => {
    const result = await storeEntries([
      entry('env.json', JSON.stringify({
        DATA_ATTRIBUTES_URL: ['./attrs/Team.tsv'],
        DATA_ATTRIBUTES_DIR: './attrs',
      })),
      entry('attrs/Team.tsv', 'a@b\tX'),
      entry('attrs/Extra.tsv', 'a@b\tY'),
    ]);
    const attrNames = result.stored.filter(s => s.kind === 'attr').map(s => s.filename).sort();
    expect(attrNames).toEqual(['Extra.tsv', 'Team.tsv']);
  });

  it('reports a directory without attribute files as missing', async () => {
    const result = await storeEntries([
      entry('env.json', JSON.stringify({ DATA_ATTRIBUTES_DIR: './attrs' })),
      entry('other/Team.tsv', 'a@b\tX'),
    ]);
    expect(result.missing).toEqual(['./attrs']);
  });
});
