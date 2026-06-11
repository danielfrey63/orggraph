import { describe, it, expect, beforeEach } from 'vitest';
import { idOf, processData } from '../src/sections/09-data-load.js';

// processData writes app state into implicit globals (classic-script style).
// Pre-defining them as globalThis properties makes strict-mode assignment
// resolve; this locks in today's behavior ahead of the state refactoring.
const STATE_GLOBALS = [
  'raw', 'byId', 'allNodesUnique', 'parentOf', 'orgParent', 'orgChildren',
  'orgRoots', 'hiddenNodes', 'hiddenByRoot', 'attributeTypes',
  'activeAttributes', 'emptyCategories', 'categorySourceFiles', 'modifiedCategories',
];

beforeEach(() => {
  for (const k of STATE_GLOBALS) globalThis[k] = undefined;
  globalThis.Logger = { log: () => {} };
  globalThis.personAttributes = new Map();
});

describe('idOf', () => {
  it('stringifies plain ids', () => {
    expect(idOf('p-1')).toBe('p-1');
    expect(idOf(42)).toBe('42');
  });

  it('extracts the id from object references', () => {
    expect(idOf({ id: 'o-7' })).toBe('o-7');
    expect(idOf({ id: 9 })).toBe('9');
  });

  it('stringifies null/undefined like String()', () => {
    expect(idOf(null)).toBe('null');
    expect(idOf(undefined)).toBe('undefined');
  });
});

const sample = () => ({
  persons: [
    { id: 'p-1', label: 'Alice' },
    { id: 'p-2', label: 'Bob' },
    { id: null, label: 'dropped' },
  ],
  orgs: [
    { id: 'o-1', label: 'Root Org' },
    { id: 'o-2', label: 'Child Org' },
    { id: 'o-3', label: 'Other Root' },
  ],
  links: [
    { source: 'p-1', target: 'p-2' },
    { source: 'o-1', target: 'o-2' },
    { source: 'p-1', target: 'o-1' },
    { source: 'p-1', target: 'p-2' }, // duplicate
    { source: 'p-1', target: 'p-1' }, // self-loop
    { source: 'p-1', target: 'ghost' }, // unknown target
  ],
});

describe('processData', () => {
  it('builds typed nodes and drops entries without id', () => {
    processData(sample());
    const ids = globalThis.raw.nodes.map((n) => n.id);
    expect(ids).toEqual(['p-1', 'p-2', 'o-1', 'o-2', 'o-3']);
    expect(globalThis.byId.get('p-1').type).toBe('person');
    expect(globalThis.byId.get('o-1').type).toBe('org');
    expect(globalThis.allNodesUnique).toHaveLength(5);
  });

  it('normalizes links: dedupes, drops self-loops and unknown endpoints', () => {
    processData(sample());
    expect(globalThis.raw.links).toEqual([
      { source: 'p-1', target: 'p-2' },
      { source: 'o-1', target: 'o-2' },
      { source: 'p-1', target: 'o-1' },
    ]);
  });

  it('derives the org hierarchy from org->org links only', () => {
    processData(sample());
    expect(globalThis.orgParent.get('o-2')).toBe('o-1');
    expect(globalThis.parentOf.get('o-2')).toBe('o-1');
    expect(Array.from(globalThis.orgChildren.get('o-1'))).toEqual(['o-2']);
    expect(globalThis.orgRoots.sort()).toEqual(['o-1', 'o-3']);
  });

  it('resets hidden state on each load', () => {
    processData(sample());
    expect(globalThis.hiddenNodes.size).toBe(0);
    expect(globalThis.hiddenByRoot.size).toBe(0);
  });

  it('tolerates missing arrays in the input', () => {
    processData({});
    expect(globalThis.raw.nodes).toEqual([]);
    expect(globalThis.raw.links).toEqual([]);
    expect(globalThis.orgRoots).toEqual([]);
  });

  it('coerces numeric ids to strings consistently', () => {
    processData({ persons: [{ id: 1, label: 'N' }], orgs: [], links: [] });
    expect(globalThis.byId.has('1')).toBe(true);
    expect(globalThis.raw.nodes[0].id).toBe('1');
  });

  it('keeps person attributes when at least one attributed person survives', () => {
    globalThis.personAttributes = new Map([['p-1', { Team: 'X' }]]);
    processData(sample());
    expect(globalThis.personAttributes.size).toBe(1);
  });
});
