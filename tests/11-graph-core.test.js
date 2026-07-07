import { describe, it, expect, beforeEach } from 'vitest';
import { idOf, drawKindOf } from '../src/sections/09-data-load.js';
import {
  buildAdjacency,
  computeSubgraph,
  recomputeHiddenNodes,
  recomputeAttributeFocusHidden,
  isNodeTemporarilyVisible,
  collectReportSubtree,
} from '../src/sections/11-graph-core.js';

// Cross-section references resolve via globals in the built classic script;
// tests reproduce that contract (see tests/09-data-load.test.js).
const STATE_GLOBALS = [
  'raw', 'byId', 'allNodesUnique', 'parentOf', 'orgParent', 'orgChildren',
  'orgRoots', 'hiddenNodes', 'hiddenByRoot', 'attributeTypes',
  'activeAttributes', 'emptyCategories', 'categorySourceFiles', 'modifiedCategories',
];

// Org chart: p1 -> p2, p1 -> p3, p3 -> p4 (persons); o1 -> o2 (orgs);
// p2 is a member of o2; p4 is a basis person (no reports).
const sample = () => ({
  persons: [
    { id: 'p1', label: 'Boss' },
    { id: 'p2', label: 'Dev' },
    { id: 'p3', label: 'Lead' },
    { id: 'p4', label: 'Junior', isBasis: true },
  ],
  orgs: [
    { id: 'o1', label: 'Company' },
    { id: 'o2', label: 'Team' },
  ],
  links: [
    { source: 'p1', target: 'p2' },
    { source: 'p1', target: 'p3' },
    { source: 'p3', target: 'p4' },
    { source: 'o1', target: 'o2' },
    { source: 'p2', target: 'o2' },
  ],
});

beforeEach(() => {
  for (const k of STATE_GLOBALS) globalThis[k] = undefined;
  globalThis.Logger = { log: () => {} };
  globalThis.idOf = idOf;
  globalThis.drawKindOf = drawKindOf;
  globalThis.personAttributes = new Map();
  globalThis.managementEnabled = false;
  globalThis.currentHiddenCount = 0;
  globalThis.allHiddenTemporarilyVisible = false;
  globalThis.temporarilyVisibleRoots = new Set();
  globalThis.attributeFocusEnabled = false;
  globalThis.attributeFocusHiddenNodes = new Set();
  globalThis.attributeFocusSeeds = new Set();
  globalThis.hiddenCategories = new Set();
  applySample(sample());
});

// Local stock-globals builder (mirrors og2SyncStockGlobals): the legacy
// processData intake was torn down with the v1 data path (§9.3/E25).
function applySample(data) {
  const persons = data.persons.map(p => ({ ...p, id: String(p.id), type: 'person', kind: 'node' }));
  const orgs = data.orgs.map(o => ({ ...o, id: String(o.id), type: 'org', kind: 'cluster' }));
  const nodes = [...persons, ...orgs];
  const links = data.links.map(l => ({ source: String(l.source), target: String(l.target) }));
  globalThis.raw = { nodes, links, persons, orgs };
  globalThis.byId = new Map(nodes.map(n => [n.id, n]));
  globalThis.allNodesUnique = nodes.slice();
  const orgIds = new Set(orgs.map(o => o.id));
  globalThis.parentOf = new Map();
  globalThis.orgParent = new Map();
  globalThis.orgChildren = new Map();
  const hasParent = new Set();
  for (const l of links) {
    if (!orgIds.has(l.source) || !orgIds.has(l.target)) continue;
    globalThis.parentOf.set(l.target, l.source);
    globalThis.orgParent.set(l.target, l.source);
    if (!globalThis.orgChildren.has(l.source)) globalThis.orgChildren.set(l.source, new Set());
    globalThis.orgChildren.get(l.source).add(l.target);
    hasParent.add(l.target);
  }
  globalThis.orgRoots = [...orgIds].filter(id => !hasParent.has(id));
  globalThis.hiddenNodes = new Set();
  globalThis.hiddenByRoot = new Map();
}

const ids = (result) => result.nodes.map((n) => n.id).sort();

describe('buildAdjacency', () => {
  it('builds an undirected adjacency map', () => {
    const adj = buildAdjacency([{ source: 'a', target: 'b' }]);
    expect(Array.from(adj.get('a'))).toEqual(['b']);
    expect(Array.from(adj.get('b'))).toEqual(['a']);
  });

  it('accepts object endpoints via idOf', () => {
    const adj = buildAdjacency([{ source: { id: 'x' }, target: { id: 'y' } }]);
    expect(adj.get('x').has('y')).toBe(true);
  });
});

describe('computeSubgraph — traversal modes', () => {
  it('returns empty result for an unknown start node', () => {
    expect(computeSubgraph('ghost', 2, 'both')).toEqual({ nodes: [], links: [] });
  });

  it('down: follows reports and suppresses person->org edges', () => {
    const r = computeSubgraph('p1', 2, 'down');
    expect(ids(r)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(ids(r)).not.toContain('o2');
  });

  it('down: respects the depth limit', () => {
    expect(ids(computeSubgraph('p1', 1, 'down'))).toEqual(['p1', 'p2', 'p3']);
  });

  it('up: climbs managers and orgs from a person', () => {
    expect(ids(computeSubgraph('p4', 3, 'up'))).toEqual(['p1', 'p3', 'p4']);
    expect(ids(computeSubgraph('p2', 1, 'up'))).toEqual(['o2', 'p1', 'p2']);
  });

  it('down from an org: descends org tree and pulls members', () => {
    expect(ids(computeSubgraph('o1', 2, 'down'))).toEqual(['o1', 'o2', 'p2']);
  });

  it('annotates nodes with their BFS level', () => {
    const r = computeSubgraph('p1', 2, 'down');
    const byLevel = Object.fromEntries(r.nodes.map((n) => [n.id, n.level]));
    expect(byLevel).toEqual({ p1: 0, p2: 1, p3: 1, p4: 2 });
  });

  it('returns only links between included nodes', () => {
    const r = computeSubgraph('p1', 1, 'down');
    expect(r.links).toEqual([
      { source: 'p1', target: 'p2' },
      { source: 'p1', target: 'p3' },
    ]);
  });

  it('collects leaf orgs of included persons for the legend', () => {
    const r = computeSubgraph('p2', 1, 'up');
    expect(Array.from(r.legendOrgs)).toEqual(['o2']);
    expect(r.legendOrgLevels.get('o2')).toBe(0);
  });
});

describe('computeSubgraph — hidden and management filters', () => {
  it('filters hidden nodes and counts them', () => {
    globalThis.hiddenByRoot = new Map([['p3', new Set(['p3', 'p4'])]]);
    recomputeHiddenNodes();
    const r = computeSubgraph('p1', 3, 'down');
    expect(ids(r)).toEqual(['p1', 'p2']);
    expect(globalThis.currentHiddenCount).toBe(2);
  });

  it('keeps hidden nodes that are temporarily visible', () => {
    globalThis.hiddenByRoot = new Map([['p3', new Set(['p3', 'p4'])]]);
    recomputeHiddenNodes();
    globalThis.allHiddenTemporarilyVisible = true;
    expect(ids(computeSubgraph('p1', 3, 'down'))).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('management filter drops basis persons', () => {
    globalThis.managementEnabled = true;
    const r = computeSubgraph('p1', 3, 'down');
    expect(ids(r)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('hidden-state helpers', () => {
  it('recomputeHiddenNodes aggregates all roots', () => {
    globalThis.hiddenByRoot = new Map([
      ['a', new Set(['x'])],
      ['b', new Set(['y', 'z'])],
    ]);
    recomputeHiddenNodes();
    expect(Array.from(globalThis.hiddenNodes).sort()).toEqual(['x', 'y', 'z']);
  });

  it('isNodeTemporarilyVisible honours per-root and global toggles', () => {
    globalThis.hiddenByRoot = new Map([['r1', new Set(['n1'])]]);
    expect(isNodeTemporarilyVisible('n1')).toBe(false);
    globalThis.temporarilyVisibleRoots.add('r1');
    expect(isNodeTemporarilyVisible('n1')).toBe(true);
    globalThis.temporarilyVisibleRoots.clear();
    globalThis.allHiddenTemporarilyVisible = true;
    expect(isNodeTemporarilyVisible('anything')).toBe(true);
  });
});

describe('collectReportSubtree', () => {
  it('collects the person-only subtree from a root', () => {
    expect(Array.from(collectReportSubtree('p1')).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(Array.from(collectReportSubtree('p3')).sort()).toEqual(['p3', 'p4']);
  });

  it('returns just the root for a leaf person', () => {
    expect(Array.from(collectReportSubtree('p4'))).toEqual(['p4']);
  });
});

describe('recomputeAttributeFocusHidden', () => {
  const focusHidden = () => Array.from(globalThis.attributeFocusHiddenNodes).sort();

  it('keeps attributed persons and their upward path, prunes the rest', () => {
    // attribute on p4: keep p4 + managers p3, p1; prune p2 and both orgs
    globalThis.activeAttributes = new Set(['Team::Coach']);
    globalThis.personAttributes = new Map([['p4', new Map([['Team::Coach', '1']])]]);
    recomputeAttributeFocusHidden();
    expect(focusHidden()).toEqual(['o1', 'o2', 'p2']);
  });

  it('keeps member orgs and their parent orgs of attributed persons', () => {
    // attribute on p2: keep p2, manager p1, member org o2 and its parent o1
    globalThis.activeAttributes = new Set(['Team::Coach']);
    globalThis.personAttributes = new Map([['p2', new Map([['Team::Coach', '1']])]]);
    recomputeAttributeFocusHidden();
    expect(focusHidden()).toEqual(['p3', 'p4']);
  });

  it('hides everything when no attribute is effectively visible', () => {
    globalThis.activeAttributes = new Set();
    globalThis.personAttributes = new Map([['p2', new Map([['Team::Coach', '1']])]]);
    recomputeAttributeFocusHidden();
    expect(focusHidden()).toEqual(['o1', 'o2', 'p1', 'p2', 'p3', 'p4']);
  });

  it('ignores attributes whose category is hidden via the eye toggle', () => {
    globalThis.activeAttributes = new Set(['Team::Coach']);
    globalThis.hiddenCategories = new Set(['Team']);
    globalThis.personAttributes = new Map([['p2', new Map([['Team::Coach', '1']])]]);
    recomputeAttributeFocusHidden();
    expect(focusHidden()).toEqual(['o1', 'o2', 'p1', 'p2', 'p3', 'p4']);
  });

  it('computeSubgraph prunes focus-hidden nodes but keeps the start node', () => {
    globalThis.activeAttributes = new Set(['Team::Coach']);
    globalThis.personAttributes = new Map([['p4', new Map([['Team::Coach', '1']])]]);
    recomputeAttributeFocusHidden();
    globalThis.attributeFocusEnabled = true;
    const result = computeSubgraph('p1', 3, 'down');
    expect(ids(result)).toEqual(['p1', 'p3', 'p4']); // p2 pruned, path to p4 kept
  });

  it('computeSubgraph keeps an attribute-free start node visible', () => {
    globalThis.activeAttributes = new Set();
    globalThis.personAttributes = new Map();
    recomputeAttributeFocusHidden();
    globalThis.attributeFocusEnabled = true;
    const result = computeSubgraph('p1', 3, 'down');
    expect(ids(result)).toEqual(['p1']);
  });

  it('peels ancestors whose attributed descendant is cut off by the depth limit', () => {
    // attribute on p4, but depth 1 only reaches p3 -> p3 must not stay as bare leaf
    globalThis.activeAttributes = new Set(['Team::Coach']);
    globalThis.personAttributes = new Map([['p4', new Map([['Team::Coach', '1']])]]);
    recomputeAttributeFocusHidden();
    globalThis.attributeFocusEnabled = true;
    const result = computeSubgraph('p1', 1, 'down');
    expect(ids(result)).toEqual(['p1']);
  });

  it('drops unattributed nodes on cycles that leaf peeling cannot remove', () => {
    // manager m, attributed person p, org o: m->p, p->o, m->o form a triangle;
    // o has degree 2 (never a leaf) but is a dead end and must disappear
    applySample({
      persons: [{ id: 'm', label: 'Manager' }, { id: 'p', label: 'Person' }],
      orgs: [{ id: 'o', label: 'Org' }],
      links: [
        { source: 'm', target: 'p' },
        { source: 'p', target: 'o' },
        { source: 'm', target: 'o' },
      ],
    });
    globalThis.activeAttributes = new Set(['Team::Coach']);
    globalThis.personAttributes = new Map([['p', new Map([['Team::Coach', '1']])]]);
    recomputeAttributeFocusHidden();
    globalThis.attributeFocusEnabled = true;
    const result = computeSubgraph('m', 3, 'both');
    expect(ids(result)).toEqual(['m', 'p']);
  });

  it('peels managers whose attributed report is dropped by the management filter', () => {
    // p4 is attributed but isBasis -> management filter removes it from the view
    globalThis.activeAttributes = new Set(['Team::Coach']);
    globalThis.personAttributes = new Map([['p4', new Map([['Team::Coach', '1']])]]);
    recomputeAttributeFocusHidden();
    globalThis.attributeFocusEnabled = true;
    globalThis.managementEnabled = true;
    const result = computeSubgraph('p1', 3, 'down');
    expect(ids(result)).toEqual(['p1']);
  });
});
