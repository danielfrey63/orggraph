import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { registryConsistencyProblems } from '../../src/sections/22-og2-registry.js';

// AK 11 harness: every artifact class validates against its JSON Schema;
// the registry additionally passes the self-consistency check (FR-4.1).
const schemaDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema');
const load = (name) => JSON.parse(readFileSync(join(schemaDir, name), 'utf8'));

let ajv, validateRegistry, validateSnapshot, validateAnalysis, validateSpec, validateView;

beforeAll(() => {
  ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const f of ['registry.schema.json', 'snapshot.schema.json', 'analysis.schema.json', 'harvest-spec.schema.json', 'view.schema.json']) {
    ajv.addSchema(load(f), f);
  }
  validateRegistry = ajv.getSchema('registry.schema.json');
  validateSnapshot = ajv.getSchema('snapshot.schema.json');
  validateAnalysis = ajv.getSchema('analysis.schema.json');
  validateSpec = ajv.getSchema('harvest-spec.schema.json');
  validateView = ajv.getSchema('view.schema.json');
});

describe('AK 11 — schema compilation and repo artifacts', () => {
  it('all five schemas compile', () => {
    expect(validateRegistry).toBeTypeOf('function');
    expect(validateSnapshot).toBeTypeOf('function');
    expect(validateAnalysis).toBeTypeOf('function');
    expect(validateSpec).toBeTypeOf('function');
    expect(validateView).toBeTypeOf('function');
  });

  it('schema/registry.json validates and is self-consistent', () => {
    const registry = load('registry.json');
    expect(validateRegistry(registry), JSON.stringify(validateRegistry.errors)).toBe(true);
    expect(registryConsistencyProblems(registry)).toEqual([]);
  });

  it('schema/registry.example.json validates and is self-consistent', () => {
    const example = load('registry.example.json');
    expect(validateRegistry(example), JSON.stringify(validateRegistry.errors)).toBe(true);
    expect(registryConsistencyProblems(example)).toEqual([]);
  });
});

describe('AK 11 — snapshot schema constraints', () => {
  const validSnapshot = () => ({
    meta: {
      source: 'hrm', crawledAt: '2026-01-01T12:00:00Z', snapshot: '20260101-1200',
      registryVersion: '1',
      scope: { nodeTypes: ['Person'], edgeTypes: ['berichtetAn'] },
    },
    schema: { nodeTypes: { Person: {} }, edgeTypes: { berichtetAn: { from: 'Person', to: 'Person' } } },
    nodes: [{ id: 'p1', type: 'Person', label: 'X', props: { pensum: 80 } }],
    edges: [{ type: 'berichtetAn', source: 'p1', target: 'p1' }],
  });

  it('accepts a minimal valid snapshot', () => {
    const s = validSnapshot();
    expect(validateSnapshot(s), JSON.stringify(validateSnapshot.errors)).toBe(true);
  });

  it('rejects rooted snapshots without edgeSources (E59)', () => {
    const s = validSnapshot();
    s.meta.scope.roots = ['p1'];
    expect(validateSnapshot(s)).toBe(false);
    s.meta.scope.edgeSources = ['p1'];
    expect(validateSnapshot(s)).toBe(true);
  });

  it('rejects non-empty excluded without traversalEdgeTypes (FR-5.5)', () => {
    const s = validSnapshot();
    s.meta.scope.excluded = ['p9'];
    expect(validateSnapshot(s)).toBe(false);
    s.meta.scope.traversalEdgeTypes = ['berichtetAn'];
    expect(validateSnapshot(s)).toBe(true);
  });

  it('rejects a flat edgeTargets id list — typed map required (E70)', () => {
    const s = validSnapshot();
    s.meta.scope.roots = ['p1'];
    s.meta.scope.edgeSources = ['p1'];
    s.meta.scope.edgeTargets = ['o1'];
    expect(validateSnapshot(s)).toBe(false);
    s.meta.scope.edgeTargets = { berichtetAn: ['p1'] };
    expect(validateSnapshot(s), JSON.stringify(validateSnapshot.errors)).toBe(true);
  });

  it('rejects offsetless crawledAt (E50) and non-scalar props (FR-4.5)', () => {
    const s1 = validSnapshot();
    s1.meta.crawledAt = '2026-01-01T12:00:00';
    expect(validateSnapshot(s1)).toBe(false);
    const s2 = validSnapshot();
    s2.nodes[0].props = { tags: ['a', 'b'] };
    expect(validateSnapshot(s2)).toBe(false);
    const s3 = validSnapshot();
    s3.nodes[0].props = { nested: { x: 1 } };
    expect(validateSnapshot(s3)).toBe(false);
  });

  it('rejects validity fields on snapshot records (E20)', () => {
    const s = validSnapshot();
    s.nodes[0].validFrom = '20260101-1200';
    expect(validateSnapshot(s)).toBe(false);
  });
});

describe('AK 11 — registry schema constraints', () => {
  it('rejects implies on node-type props (E63) and ref+type combination', () => {
    const badImplies = {
      version: '1',
      nodeTypes: { A: { props: { x: { ref: 'A', implies: 'e' } } } },
      edgeTypes: { e: { from: 'A', to: 'A' } },
    };
    expect(validateRegistry(badImplies)).toBe(false);
    const badRefType = {
      version: '1',
      nodeTypes: { A: { props: { x: { ref: 'A', type: 'string' } } } },
      edgeTypes: {},
    };
    expect(validateRegistry(badRefType)).toBe(false);
  });

  it('rejects non-path-safe type names (E58)', () => {
    const bad = { version: '1', nodeTypes: { 'Kaputter Name': {} }, edgeTypes: {} };
    expect(validateRegistry(bad)).toBe(false);
  });
});

describe('AK 11 — view schema', () => {
  it('validates a VIEWS object and rejects an empty one', () => {
    const views = { Start: { path: 'Person <--berichtetAn-- Person', roots: ['__auto__'], depth: 3 } };
    expect(validateView(views), JSON.stringify(validateView.errors)).toBe(true);
    expect(validateView({})).toBe(false);
  });

  it('enforces filter value rules (FR-7.8)', () => {
    const mk = (filter) => ({ V: { path: 'Person', roots: ['p1'], filters: { nodes: [filter] } } });
    expect(validateView(mk({ type: 'Person', prop: 'pensum', op: 'gte', value: 80 }))).toBe(true);
    expect(validateView(mk({ type: 'Person', prop: 'pensum', op: 'exists', value: 1 }))).toBe(false);
    expect(validateView(mk({ type: 'Person', prop: 'pensum', op: 'exists' }))).toBe(true);
    expect(validateView(mk({ type: 'Person', prop: 'pensum', op: 'in', value: [] }))).toBe(false);
    expect(validateView(mk({ type: 'Person', prop: 'kontext', op: 'refIn', value: ['f1'] }))).toBe(true);
  });
});
