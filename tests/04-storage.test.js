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
  storeFiles,
  idbGet,
  idbPut,
  idbDelete,
  idbKeys,
  idbClear,
  getStoredText,
  getStoredJson,
  getStoredAttributes,
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

describe('idb roundtrip', () => {
  it('put/get/keys/delete/clear work', async () => {
    await idbPut('k1', 'v1');
    await idbPut('k2', 'v2');
    expect(await idbGet('k1')).toBe('v1');
    expect((await idbKeys()).sort()).toEqual(['k1', 'k2']);
    await idbDelete('k1');
    expect(await idbGet('k1')).toBeUndefined();
    await idbClear();
    expect(await idbKeys()).toEqual([]);
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
    expect(await storeFiles([])).toEqual({ stored: [], unknown: [] });
    expect(await storeFiles(null)).toEqual({ stored: [], unknown: [] });
  });
});

describe('stored accessors', () => {
  it('getStoredText returns undefined for non-string values', async () => {
    await idbPut('obj', { not: 'a string' });
    expect(await getStoredText('obj')).toBeUndefined();
  });

  it('getStoredJson parses stored JSON and tolerates broken JSON', async () => {
    await idbPut(KEY_ENV, '{"DATA_URL":"./d.json"}');
    expect(await getStoredJson(KEY_ENV)).toEqual({ DATA_URL: './d.json' });
    await idbPut(KEY_PSEUDO, '{broken');
    expect(await getStoredJson(KEY_PSEUDO)).toBeUndefined();
    expect(await getStoredJson('missing')).toBeUndefined();
  });

  it('getStoredAttributes lists attr entries with original filenames', async () => {
    await storeFiles([makeFile('A.tsv', 'a@b\tX'), makeFile('B.csv', 'c@d\tY')]);
    const attrs = await getStoredAttributes();
    expect(attrs.map((a) => a.filename).sort()).toEqual(['A.tsv', 'B.csv']);
    expect(attrs.every((a) => a.key.startsWith(ATTR_PREFIX))).toBe(true);
    expect(attrs.every((a) => typeof a.text === 'string')).toBe(true);
  });

  it('hasStoredData reflects presence of the data key', async () => {
    expect(await hasStoredData()).toBe(false);
    await idbPut(KEY_DATA, '{"persons":[]}');
    expect(await hasStoredData()).toBe(true);
  });
});

describe('requestPersistence', () => {
  it('returns false when navigator.storage.persist is unavailable', async () => {
    expect(await requestPersistence()).toBe(false);
  });
});
