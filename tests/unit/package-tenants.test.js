// scripts/package-tenants.mjs builds the one-drop tenant archive (FR-6.7).
// It carries its OWN ZIP writer (Node/zlib) next to the app's in-browser one
// (33-og2-zip-writer), and the whole point of the archive is that the app's
// drop zone reads it and classifies every entry correctly. The script checks
// that at runtime against local, git-ignored migration output — which means
// on any other machine it checks nothing. These tests pin the contract with
// fixtures instead.
import { describe, it, expect } from 'vitest';
import { buildZip } from '../../scripts/package-tenants.mjs';
import { readZipEntries } from '../../src/sections/05-dropzone.js';
import { classifyFile } from '../../src/sections/04-storage.js';

// jsdom's File lacks arrayBuffer(): the reader only needs name + arrayBuffer().
const asFile = (name, bytes) => ({
  name,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

const json = (obj) => Buffer.from(JSON.stringify(obj), 'utf8');

const REGISTRY = { version: '2026-07-05.1', nodeTypes: { Person: {} }, edgeTypes: { besuchte: {} } };
const ENV = { VIEWS: { Start: { root: 'p-1', path: 'Person' } } };
const SNAPSHOT = {
  meta: { source: 'legacy-sem', snapshot: '20260612-0000' },
  schema: 'orggraph-snapshot-2',
  nodes: [],
  edges: [],
};
const PSEUDO = { names: ['Alpha', 'Beta'] };

const readBack = async (files) => {
  const entries = await readZipEntries(asFile('tenant.zip', buildZip(files)));
  const kinds = {};
  for (const entry of entries) kinds[entry.path] = (await classifyFile(entry.file)).kind;
  return { entries, kinds };
};

describe('package-tenants — the drop archive the app has to understand', () => {
  it('classifies every entry of a tenant package as its FR-6.7 kind', async () => {
    const { entries, kinds } = await readBack([
      { name: 'registry.json', data: json(REGISTRY) },
      { name: 'legacy-sem.env.json', data: json(ENV) },
      { name: 'legacy-sem.snapshot-20260612-0000.json', data: json(SNAPSHOT) },
      { name: 'pseudo.data.json', data: json(PSEUDO) },
    ]);
    expect(entries).toHaveLength(4);
    expect(kinds).toEqual({
      'registry.json': 'registry',
      'legacy-sem.env.json': 'env',
      'legacy-sem.snapshot-20260612-0000.json': 'snapshot',
      'pseudo.data.json': 'pseudo',
    });
  });

  it('round-trips content byte for byte, compressed and stored', async () => {
    // A large, highly compressible entry takes the deflate path, a tiny
    // incompressible one the stored path — the reader must handle both.
    const big = Buffer.from('x'.repeat(50_000), 'utf8');
    const small = Buffer.from([0, 255, 1, 254]);
    const umlauts = Buffer.from('Grüezi — ässe und schwümme', 'utf8');
    const bytes = buildZip([
      { name: 'big.txt', data: big },
      { name: 'small.dat', data: small },
      { name: 'nested/umlauts.txt', data: umlauts },
    ]);
    expect(bytes.length).toBeLessThan(big.length / 4); // deflate actually ran
    const entries = await readZipEntries(asFile('t.zip', bytes));
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e.file]));
    expect(Object.keys(byPath).sort()).toEqual(['big.txt', 'nested/umlauts.txt', 'small.dat']);
    const raw = async (p) => Buffer.from(new Uint8Array(await byPath[p].arrayBuffer()));
    expect((await raw('big.txt')).equals(big)).toBe(true);
    expect((await raw('small.dat')).equals(small)).toBe(true);
    expect((await raw('nested/umlauts.txt')).equals(umlauts)).toBe(true);
  });

  it('writes a deterministic archive — same input, same bytes', () => {
    const files = [{ name: 'registry.json', data: json(REGISTRY) }];
    expect(buildZip(files).equals(buildZip(files))).toBe(true);
  });

  it('an empty entry survives (stored, zero length)', async () => {
    const { entries, kinds } = await readBack([{ name: 'empty.json', data: Buffer.alloc(0) }]);
    expect(entries).toHaveLength(1);
    expect(kinds['empty.json']).toBe('unknown');
  });
});
