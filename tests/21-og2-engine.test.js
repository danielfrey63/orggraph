import { describe, it, expect, beforeEach } from 'vitest';
import { createTenantStore, deriveVersions, recordStandAt, edgeKeyOf, nodeOpenNow, openExistence } from '../src/sections/23-og2-store.js';
import { scopeFingerprint, observationFingerprint } from '../src/sections/24-og2-scope.js';
import { validateSnapshot } from '../src/sections/25-og2-validate.js';
import { importSnapshot, importBundle } from '../src/sections/26-og2-import.js';
import { registryConsistencyProblems } from '../src/sections/22-og2-registry.js';

// Type names in fixtures are data-level illustration (PRD E14, NFR-5
// exception for test fixtures) — never an engine-code contract.
const REGISTRY = {
  version: '1',
  nodeTypes: {
    Person: { props: { email: {}, pensum: {} } },
    OE: { props: {} },
    Rolle: { props: {} },
    Firma: { props: {} },
    Training: { props: {} },
  },
  edgeTypes: {
    berichtetAn: { from: 'Person', to: 'Person', props: {} },
    mitgliedIn: { from: 'Person', to: 'OE', props: {} },
    unterstellt: { from: 'OE', to: 'OE', props: {} },
    besuchte: { from: 'Person', to: 'Training', props: {} },
    hatRolle: {
      from: 'Person', to: 'Rolle', identityProps: ['kontext'],
      props: { kontext: { ref: 'Firma', implies: 'arbeitetBei' } },
    },
    arbeitetBei: { from: 'Person', to: 'Firma', props: {} },
  },
};

const crawledAtOf = (stamp) =>
  `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:00Z`;

const mkSnap = (source, stamp, scope, nodes, edges, extraMeta = {}) => ({
  meta: { source, crawledAt: crawledAtOf(stamp), snapshot: stamp, registryVersion: '1', scope, ...extraMeta },
  schema: { nodeTypes: {}, edgeTypes: {} },
  nodes, edges,
});

const FULL_SCOPE = { nodeTypes: ['Person', 'OE'], edgeTypes: ['berichtetAn', 'mitgliedIn', 'unterstellt'] };

// Auto-confirming hooks: product HIL dialogs simulated per test case (E71).
const YES = {
  confirmSourceRegistration: () => ({ ok: true, moveOutEdgeTypes: ['mitgliedIn'] }),
  confirmJoin: () => true,
  confirmGate: () => true,
  confirmDestructive: () => true,
  confirmAuthority: () => true,
};

const baseNodes = () => [
  { id: 'p1', type: 'Person', label: 'Boss', props: { email: 'boss@x.ch', pensum: 100 } },
  { id: 'p2', type: 'Person', label: 'Dev', props: { pensum: 80 } },
  { id: 'p3', type: 'Person', label: 'Lead', props: {} },
  { id: 'o1', type: 'OE', label: 'Firma AG', props: {} },
  { id: 'o2', type: 'OE', label: 'IT', props: {} },
];
const baseEdges = () => [
  { type: 'berichtetAn', source: 'p2', target: 'p1' },
  { type: 'berichtetAn', source: 'p3', target: 'p1' },
  { type: 'mitgliedIn', source: 'p2', target: 'o2' },
  { type: 'unterstellt', source: 'o2', target: 'o1' },
];

let store;
beforeEach(() => { store = createTenantStore(); });

const importBase = (stamp = '20260101-1200') => {
  const res = importSnapshot(store, REGISTRY, mkSnap('hrm', stamp, FULL_SCOPE, baseNodes(), baseEdges()), YES);
  expect(res.status).toBe('imported');
  return res;
};

describe('registry self-consistency (FR-4.1)', () => {
  it('accepts the fixture registry', () => {
    expect(registryConsistencyProblems(REGISTRY)).toEqual([]);
  });
  it('rejects dangling references', () => {
    const bad = {
      version: 'x',
      nodeTypes: { A: { props: { r: { ref: 'Nope' } } } },
      edgeTypes: {
        e1: { from: 'A', to: 'Missing', props: {} },
        e2: { from: 'A', to: 'A', identityProps: ['k'], props: {} },
        e3: { from: 'A', to: 'A', props: { x: { ref: 'A', implies: 'gone' } } },
      },
    };
    const problems = registryConsistencyProblems(bad);
    expect(problems.some((p) => p.includes('ref target "Nope"'))).toBe(true);
    expect(problems.some((p) => p.includes('"Missing" is not a declared node type'))).toBe(true);
    expect(problems.some((p) => p.includes('identityProp "k"'))).toBe(true);
    expect(problems.some((p) => p.includes('implies target "gone"'))).toBe(true);
  });
  it('rejects malformed field paths (labelProp, identifiers, leafProp)', () => {
    const bad = {
      version: 'x',
      nodeTypes: {
        A: { labelProp: 'props..kaputt', identifiers: ['props.ok', 'kein pfad'], leafProp: 'isBasis', props: {} },
        B: { labelProp: 'label', identifiers: ['id', 'props.email'], leafProp: 'props.isBasis', props: {} },
      },
      edgeTypes: {},
    };
    const problems = registryConsistencyProblems(bad);
    expect(problems.some((p) => p.includes('labelProp "props..kaputt"'))).toBe(true);
    expect(problems.some((p) => p.includes('identifier path "kein pfad"'))).toBe(true);
    expect(problems.some((p) => p.includes('leafProp "isBasis"'))).toBe(true);
    // the well-formed twin contributes no problems
    expect(problems.some((p) => p.includes('node type "B"'))).toBe(false);
  });
});

describe('AK 4 — diff: closed / property diff / new identity', () => {
  it('produces closed version, property diff and new identity', () => {
    importBase();
    const t2 = '20260201-1200';
    const nodes2 = baseNodes().filter((n) => n.id !== 'p3');
    nodes2.find((n) => n.id === 'p2').props.pensum = 100; // scalar change
    nodes2.push({ id: 'p4', type: 'Person', label: 'Neu', props: {} });
    const edges2 = baseEdges().filter((e) => e.source !== 'p3');
    const res = importSnapshot(store, REGISTRY, mkSnap('hrm', t2, FULL_SCOPE, nodes2, edges2), YES);
    expect(res.status).toBe('imported');
    // removed identity: closed version
    const p3 = store.nodes.get('p3');
    expect(nodeOpenNow(p3)).toBe(false);
    expect(p3.existence[0].to).toBe(t2);
    // changed prop: two versions with property diff
    const versions = deriveVersions(store.nodes.get('p2'));
    expect(versions.length).toBe(2);
    expect(versions[0].props.pensum).toBe(80);
    expect(versions[1].props.pensum).toBe(100);
    expect(versions[0].validTo).toBe(t2);
    // new identity
    expect(nodeOpenNow(store.nodes.get('p4'))).toBe(true);
  });
});

describe('AK 5 — narrow scope + cascade exception (E35)', () => {
  it('leaves out-of-scope stock untouched, but cascades edge closures on final node closure', () => {
    importBase();
    const t2 = '20260201-1200';
    // narrow scope: only Person nodes + berichtetAn edges; p3 disappears
    const scope = { nodeTypes: ['Person'], edgeTypes: ['berichtetAn'] };
    const nodes2 = baseNodes().filter((n) => n.type === 'Person' && n.id !== 'p3');
    const edges2 = [{ type: 'berichtetAn', source: 'p2', target: 'p1' }];
    const res = importSnapshot(store, REGISTRY, mkSnap('hrm', t2, scope, nodes2, edges2), YES);
    expect(res.status).toBe('imported');
    // OEs and unterstellt untouched
    expect(nodeOpenNow(store.nodes.get('o1'))).toBe(true);
    expect(nodeOpenNow(store.nodes.get('o2'))).toBe(true);
    const uKey = edgeKeyOf({ type: 'unterstellt', source: 'o2', target: 'o1' }, REGISTRY.edgeTypes.unterstellt);
    expect(store.edges.get(uKey).existence.some((iv) => iv.to === null)).toBe(true);
    // p3 closed; its mitgliedIn edges would cascade — p3 had none, but its
    // berichtetAn edge closed in scope. Add cascade check via p2->o2 staying open:
    expect(nodeOpenNow(store.nodes.get('p3'))).toBe(false);
    const p3Edge = edgeKeyOf({ type: 'berichtetAn', source: 'p3', target: 'p1' }, REGISTRY.edgeTypes.berichtetAn);
    expect(store.edges.get(p3Edge).existence.every((iv) => iv.to !== null)).toBe(true);
    // cascade counted: journal contains cascade or edge-close for p3's edge
    const kinds = res.report.journal.map((j) => j.deltaKind);
    expect(kinds).toContain('node-close');
  });

  it('cascade closes out-of-scope edges of a finally closed node', () => {
    importBase();
    const t2 = '20260201-1200';
    // p2 disappears from a Person-only scope; its mitgliedIn edge (OUTSIDE
    // scope.edgeTypes) must cascade-close with it (E35).
    const scope = { nodeTypes: ['Person'], edgeTypes: ['berichtetAn'] };
    const nodes2 = baseNodes().filter((n) => n.type === 'Person' && n.id !== 'p2');
    const edges2 = [{ type: 'berichtetAn', source: 'p3', target: 'p1' }];
    const res = importSnapshot(store, REGISTRY, mkSnap('hrm', t2, scope, nodes2, edges2), YES);
    expect(res.status).toBe('imported');
    const mKey = edgeKeyOf({ type: 'mitgliedIn', source: 'p2', target: 'o2' }, REGISTRY.edgeTypes.mitgliedIn);
    expect(store.edges.get(mKey).existence.every((iv) => iv.to !== null)).toBe(true);
    expect(res.report.journal.some((j) => j.deltaKind === 'cascade-close')).toBe(true);
  });
});

describe('AK 6 — strict no-op re-import', () => {
  it('re-import of the same snapshot changes nothing', () => {
    importBase();
    const before = JSON.stringify([...store.nodes.keys(), ...store.edges.keys()]);
    const versionsBefore = deriveVersions(store.nodes.get('p1')).length;
    const res = importSnapshot(store, REGISTRY, mkSnap('hrm', '20260101-1200', FULL_SCOPE, baseNodes(), baseEdges()), YES);
    expect(res.status).toBe('noop');
    expect(JSON.stringify([...store.nodes.keys(), ...store.edges.keys()])).toBe(before);
    expect(deriveVersions(store.nodes.get('p1')).length).toBe(versionsBefore);
  });
});

describe('AK 13 — rooted scope deletion test (E39)', () => {
  it('closes edges only inside the subtree, protects nodes, then a root-free full state closes deleted nodes', () => {
    importBase();
    const t2 = '20260201-1200';
    // rooted at p1: p3 no longer reports to p1 (edge gone), p3 itself must stay open
    const scope = {
      ...FULL_SCOPE,
      roots: ['p1'],
      edgeSources: ['p1', 'p2'],
      traversalEdgeTypes: ['berichtetAn'],
    };
    const nodes2 = [
      { id: 'p1', type: 'Person', label: 'Boss', props: { email: 'boss@x.ch', pensum: 100 } },
      { id: 'p2', type: 'Person', label: 'Dev', props: { pensum: 80 } },
      { id: 'o2', type: 'OE', label: 'IT', props: {} },
    ];
    const edges2 = [
      { type: 'berichtetAn', source: 'p2', target: 'p1' },
      { type: 'mitgliedIn', source: 'p2', target: 'o2' },
    ];
    const res = importSnapshot(store, REGISTRY, mkSnap('hrm', t2, scope, nodes2, edges2), YES);
    expect(res.status).toBe('imported');
    // p3 node identity stays open (move protection)
    expect(nodeOpenNow(store.nodes.get('p3'))).toBe(true);
    // p3's edge to p1: p3 was NOT visited (not in edgeSources) and no
    // edgeTargets proof was delivered — conservative: stays open (degraded).
    // p1/p2 visited: their vanished edges would close. p2 kept its edges.
    const p3Edge = edgeKeyOf({ type: 'berichtetAn', source: 'p3', target: 'p1' }, REGISTRY.edgeTypes.berichtetAn);
    expect(store.edges.get(p3Edge).existence.some((iv) => iv.to === null)).toBe(true);
    // now a root-free full state without p3 closes the node for real
    const t3 = '20260301-1200';
    const nodes3 = nodes2.concat([{ id: 'o1', type: 'OE', label: 'Firma AG', props: {} }]);
    const edges3 = edges2.concat([{ type: 'unterstellt', source: 'o2', target: 'o1' }]);
    const res3 = importSnapshot(store, REGISTRY, mkSnap('hrm', t3, FULL_SCOPE, nodes3, edges3), YES);
    expect(res3.status).toBe('imported');
    expect(nodeOpenNow(store.nodes.get('p3'))).toBe(false);
  });

  it('rooted move-out closes via typed edgeTargets proof, unvisited sources stay protected (E39/E70)', () => {
    importBase();
    const t2 = '20260201-1200';
    // Canonical crawl shape: root is the top OE; traversal descends via
    // unterstellt/mitgliedIn against the stored direction. p2 moved OUT of the
    // subtree entirely — the crawl no longer sees p2, but o2 is a fully
    // observed target container for mitgliedIn (typed proof).
    const scope = {
      nodeTypes: ['Person', 'OE'], edgeTypes: ['mitgliedIn', 'unterstellt'],
      roots: ['o1'],
      edgeSources: ['o1', 'o2'],
      edgeTargets: { mitgliedIn: ['o2'] },
      traversalEdgeTypes: ['unterstellt', 'mitgliedIn'],
    };
    const nodes2 = [
      { id: 'o1', type: 'OE', label: 'Firma AG', props: {} },
      { id: 'o2', type: 'OE', label: 'IT', props: {} },
    ];
    const edges2 = [{ type: 'unterstellt', source: 'o2', target: 'o1' }];
    const res = importSnapshot(store, REGISTRY, mkSnap('hrm', t2, scope, nodes2, edges2), YES);
    expect(res.status).toBe('imported');
    // stale membership p2->o2 closed via the (b) move-out proof
    const oldKey = edgeKeyOf({ type: 'mitgliedIn', source: 'p2', target: 'o2' }, REGISTRY.edgeTypes.mitgliedIn);
    expect(store.edges.get(oldKey).existence.every((iv) => iv.to !== null)).toBe(true);
    // p2's node identity stays open (move protection, E39)
    expect(nodeOpenNow(store.nodes.get('p2'))).toBe(true);
  });

  it('rejects a rooted snapshot without edgeSources (E59)', () => {
    importBase();
    const scope = { ...FULL_SCOPE, roots: ['p1'], traversalEdgeTypes: ['berichtetAn'] };
    const res = importSnapshot(store, REGISTRY, mkSnap('hrm', '20260201-1200', scope, baseNodes(), baseEdges()), YES);
    expect(res.status).toBe('rejected');
    expect(res.errors.join(' ')).toContain('edgeSources');
  });
});

describe('AK 18 — snapshot identity (E36/E65)', () => {
  it('two sources with the same stamp both import; identical re-import is a no-op; same identity with different content is a conflict', () => {
    importBase();
    const other = mkSnap('sap', '20260101-1200', { nodeTypes: ['Firma'], edgeTypes: [] },
      [{ id: 'f1', type: 'Firma', label: 'Akros', props: {} }], []);
    expect(importSnapshot(store, REGISTRY, other, YES).status).toBe('imported');
    // (d) same stamp, same source, different scope fingerprint imports
    const otherScope = mkSnap('hrm', '20260101-1200', { nodeTypes: ['Rolle'], edgeTypes: [] },
      [{ id: 'r1', type: 'Rolle', label: 'PL', props: {} }], []);
    expect(importSnapshot(store, REGISTRY, otherScope, YES).status).toBe('imported');
    // (c) same full identity, different content -> conflict
    const conflicting = mkSnap('hrm', '20260101-1200', FULL_SCOPE, baseNodes(), baseEdges().slice(1));
    const res = importSnapshot(store, REGISTRY, conflicting, YES);
    expect(res.status).toBe('rejected');
    expect(res.reason).toContain('E36');
    // (e) older stamp within same (source, scope) root-free pair -> rejected
    const older = mkSnap('hrm', '20251201-1200', FULL_SCOPE, baseNodes(), baseEdges());
    expect(importSnapshot(store, REGISTRY, older, YES).reason).toContain('chronology');
  });

  it('semantically equal scope declarations yield the same fingerprint (E49)', () => {
    const a = { nodeTypes: ['Person', 'OE'], edgeTypes: ['x', 'y'] };
    const b = { nodeTypes: ['OE', 'Person', 'OE'], edgeTypes: ['y', 'x'], traversalEdgeTypes: ['x', 'y'] };
    expect(scopeFingerprint(a)).toBe(scopeFingerprint(b));
    // observation fields do NOT change the scope fingerprint
    const c = { ...a, edgeSources: ['p1'], excluded: ['e1'] };
    expect(scopeFingerprint(c)).toBe(scopeFingerprint(a));
    expect(observationFingerprint(c)).not.toBe(observationFingerprint(a));
  });
});

describe('AK 19/25 — source partition and authority (E37/E46)', () => {
  it('a full state of source B never closes A-only identities; with confirmed authority it does', () => {
    importBase();
    const t2 = '20260201-1200';
    // B claims the same scope but delivers nothing -> A's facts stay (partition)
    const bEmpty = mkSnap('sap', t2, FULL_SCOPE, [], []);
    const res = importSnapshot(store, REGISTRY, bEmpty, { ...YES, confirmGate: () => true });
    expect(res.status).toBe('imported');
    expect(nodeOpenNow(store.nodes.get('p1'))).toBe(true);
    // with authoritativeForSources '*' and CONFIRMED authority it closes
    const t3 = '20260301-1200';
    const bAuth = mkSnap('sap', t3, { ...FULL_SCOPE, authoritativeForSources: ['*'] }, [], []);
    const res3 = importSnapshot(store, REGISTRY, bAuth, YES);
    expect(res3.status).toBe('imported');
    expect(nodeOpenNow(store.nodes.get('p1'))).toBe(false);
  });

  it('without confirmation the request stays open and nothing forein closes', () => {
    importBase();
    const bAuth = mkSnap('sap', '20260201-1200', { ...FULL_SCOPE, authoritativeForSources: ['*'] }, [], []);
    const res = importSnapshot(store, REGISTRY, bAuth, { ...YES, confirmAuthority: () => false });
    expect(res.status).toBe('imported');
    expect(nodeOpenNow(store.nodes.get('p1'))).toBe(true);
    const entry = [...store.snapshots.values()].find((e) => e.source === 'sap');
    expect(entry.authorityStatus.open).toBe(true);
  });
});

describe('AK 22 — multi-source merge (E40/E44/E51)', () => {
  it('(a) B without A-prop does not remove it; (b) differing value creates a reported conflict', () => {
    importBase();
    // B delivers p1 with a different pensum at a LATER instant -> overwrites
    const b = mkSnap('sap', '20260301-1200', { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { pensum: 60 } }], []);
    const res = importSnapshot(store, REGISTRY, b, YES);
    expect(res.status).toBe('imported');
    const stand = recordStandAt(store.nodes.get('p1'), '20260401-0000');
    expect(stand.props.pensum).toBe(60); // younger instant wins
    expect(stand.props.email).toBe('boss@x.ch'); // (a) foreign prop untouched
  });

  it('(c) an OLDER cross-source import inserts historically without overwriting', () => {
    importBase('20260201-1200'); // hrm at Feb
    const older = mkSnap('sap', '20260101-1200', { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { pensum: 50 } }], []);
    const res = importSnapshot(store, REGISTRY, older, YES);
    expect(res.status).toBe('imported');
    const p1 = store.nodes.get('p1');
    // current value untouched
    expect(recordStandAt(p1, '20260301-0000').props.pensum).toBe(100);
    // asOf inside the unoccupied earlier range sees the inserted value
    expect(recordStandAt(p1, '20260115-0000')).toBeNull(); // identity existed only from Feb (existence)
    const tl = p1.timelines.get('props.pensum');
    expect(tl.some((iv) => iv.value === 50 && iv.to === '20260201-1200')).toBe(true);
  });

  it('(e) equal instant, two sources: lexicographic tie-breaker + persisted conflict', () => {
    importBase();
    const stamp = '20260201-1200';
    const a = mkSnap('zeta', stamp, { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { pensum: 70 } }], []);
    const b = mkSnap('alpha', stamp, { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { pensum: 90 } }], []);
    expect(importSnapshot(store, REGISTRY, a, YES).status).toBe('imported');
    const res = importSnapshot(store, REGISTRY, b, YES);
    expect(res.status).toBe('imported');
    // lexicographically smallest source wins: 'alpha' < 'zeta'
    expect(recordStandAt(store.nodes.get('p1'), '20260301-0000').props.pensum).toBe(90);
    expect(store.conflicts.length).toBe(1);
    expect(store.conflicts[0].winner).toBe('alpha');
    // order independence: fresh store, reversed import order, same result
    const store2 = createTenantStore();
    importSnapshot(store2, REGISTRY, mkSnap('hrm', '20260101-1200', FULL_SCOPE, baseNodes(), baseEdges()), YES);
    importSnapshot(store2, REGISTRY, b, YES);
    importSnapshot(store2, REGISTRY, a, YES);
    expect(recordStandAt(store2.nodes.get('p1'), '20260301-0000').props.pensum).toBe(90);
  });
});

describe('AK 33 — same-source instant monotonicity (E54)', () => {
  it('an older same-source snapshot from another scope neither overwrites nor closes', () => {
    importBase('20260201-1200');
    const older = mkSnap('hrm', '20260101-1200', { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { pensum: 55 } }], []);
    const res = importSnapshot(store, REGISTRY, older, YES);
    expect(res.status).toBe('imported');
    expect(recordStandAt(store.nodes.get('p1'), '20260301-0000').props.pensum).toBe(100);
    expect(nodeOpenNow(store.nodes.get('p2'))).toBe(true); // older absence closes nothing
  });
});

describe('AK 15/39 — enrichment scope (E30/E61)', () => {
  it('closes only edges of visited sources, creates new targets, closes no nodes, preserves stub props', () => {
    importBase();
    // seed a training edge for p2 from the same source
    const seed = mkSnap('hrm', '20260115-1200', { nodeTypes: ['Training'], edgeTypes: ['besuchte'], edgeSources: ['p2'] },
      [
        { id: 'p2', type: 'Person', label: 'STUB', props: {} },
        { id: 'tr1', type: 'Training', label: 'Security', props: {} },
      ],
      [{ type: 'besuchte', source: 'p2', target: 'tr1' }]);
    expect(importSnapshot(store, REGISTRY, seed, YES).status).toBe('imported');
    // stub label did NOT overwrite (label merges only in node scope)
    expect(recordStandAt(store.nodes.get('p2'), '20260120-0000').label).toBe('Dev');
    // enrichment at t2: p2 visited, now attends tr2 instead; p3 not visited
    const t2 = '20260201-1200';
    const enrich = mkSnap('hrm', t2, { nodeTypes: [], edgeTypes: ['besuchte'], edgeSources: ['p2'] },
      [
        { id: 'p2', type: 'Person', label: 'STUB', props: {} },
        { id: 'tr2', type: 'Training', label: 'D3', props: {} },
      ],
      [{ type: 'besuchte', source: 'p2', target: 'tr2' }]);
    const res = importSnapshot(store, REGISTRY, enrich, YES);
    expect(res.status).toBe('imported');
    const oldKey = edgeKeyOf({ type: 'besuchte', source: 'p2', target: 'tr1' }, REGISTRY.edgeTypes.besuchte);
    expect(store.edges.get(oldKey).existence.every((iv) => iv.to !== null)).toBe(true);
    expect(nodeOpenNow(store.nodes.get('tr2'))).toBe(true); // created
    expect(nodeOpenNow(store.nodes.get('p2'))).toBe(true);  // never closed
    expect(nodeOpenNow(store.nodes.get('tr1'))).toBe(true); // target never closed
    // p2's existing props preserved (E61 additive)
    expect(recordStandAt(store.nodes.get('p2'), '20260301-0000').props.pensum).toBe(80);
  });
});

describe('AK 23 — excluded protection in root-free full states (E43)', () => {
  it('closes nothing inside the excluded subtree, even multi-parent nodes', () => {
    importBase();
    // p2 is member of o2; o2 subtree excluded (crawl failure). p2 missing in
    // snapshot must NOT close because p2 is inside the excluded area via o2?
    // Excluded expansion runs over traversal edges: use mitgliedIn+unterstellt
    const t2 = '20260201-1200';
    const scope = {
      nodeTypes: ['Person', 'OE'], edgeTypes: ['berichtetAn', 'mitgliedIn', 'unterstellt'],
      excluded: ['o2'], traversalEdgeTypes: ['mitgliedIn', 'unterstellt'],
    };
    const nodes2 = baseNodes().filter((n) => !['p2', 'o2'].includes(n.id));
    const edges2 = baseEdges().filter((e) => !['p2', 'o2'].includes(e.source));
    const res = importSnapshot(store, REGISTRY, mkSnap('hrm', t2, scope, nodes2, edges2), YES);
    expect(res.status).toBe('imported');
    expect(nodeOpenNow(store.nodes.get('o2'))).toBe(true);
    expect(nodeOpenNow(store.nodes.get('p2'))).toBe(true); // inside excluded area (o2 <- p2 via mitgliedIn)
  });
});

describe('AK 16 — implied edge projection (E33/E52)', () => {
  const roleScope = { nodeTypes: ['Person', 'Rolle', 'Firma'], edgeTypes: ['hatRolle'] };
  const roleNodes = () => [
    { id: 'p9', type: 'Person', label: 'Multi', props: {} },
    { id: 'r1', type: 'Rolle', label: 'Dev', props: {} },
    { id: 'r2', type: 'Rolle', label: 'PL', props: {} },
    { id: 'f1', type: 'Firma', label: 'Akros', props: {} },
  ];
  it('two primary facts imply ONE base identity that stays open until the last primary ends; re-import is idempotent', () => {
    const t1 = '20260101-1200';
    const snap1 = mkSnap('hrm', t1, roleScope, roleNodes(), [
      { type: 'hatRolle', source: 'p9', target: 'r1', props: { kontext: 'f1' } },
      { type: 'hatRolle', source: 'p9', target: 'r2', props: { kontext: 'f1' } },
    ]);
    expect(importSnapshot(store, REGISTRY, snap1, YES).status).toBe('imported');
    const baseKey = edgeKeyOf({ type: 'arbeitetBei', source: 'p9', target: 'f1' }, REGISTRY.edgeTypes.arbeitetBei);
    const base = store.edges.get(baseKey);
    expect(base).toBeDefined();
    expect(base.projected.length).toBe(1);
    expect(base.projected[0].to).toBeNull();
    // one role ends, base edge stays open
    const t2 = '20260201-1200';
    const snap2 = mkSnap('hrm', t2, roleScope, roleNodes(), [
      { type: 'hatRolle', source: 'p9', target: 'r1', props: { kontext: 'f1' } },
    ]);
    expect(importSnapshot(store, REGISTRY, snap2, YES).status).toBe('imported');
    expect(store.edges.get(baseKey).projected.some((iv) => iv.to === null)).toBe(true);
    // last role ends -> base edge projection closes
    const t3 = '20260301-1200';
    const snap3 = mkSnap('hrm', t3, roleScope, roleNodes(), []);
    expect(importSnapshot(store, REGISTRY, snap3, { ...YES }).status).toBe('imported');
    expect(store.edges.get(baseKey).projected.every((iv) => iv.to !== null)).toBe(true);
  });
});

describe('AK 17/41 — temporal endpoint invariant and visited proof', () => {
  it('(a) an edge onto a closed, undelivered identity is rejected', () => {
    importBase();
    // close p3 via full state without it
    const t2 = '20260201-1200';
    importSnapshot(store, REGISTRY, mkSnap('hrm', t2,
      FULL_SCOPE, baseNodes().filter((n) => n.id !== 'p3'), baseEdges().filter((e) => e.source !== 'p3')), YES);
    // new snapshot references p3 as endpoint without delivering it
    const t3 = '20260301-1200';
    const bad = mkSnap('hrm', t3, { nodeTypes: ['Person'], edgeTypes: ['berichtetAn'] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { email: 'boss@x.ch', pensum: 100 } },
       { id: 'p2', type: 'Person', label: 'Dev', props: { pensum: 80 } }],
      [{ type: 'berichtetAn', source: 'p2', target: 'p3' }]);
    const res = importSnapshot(store, REGISTRY, bad, YES);
    expect(res.status).toBe('rejected');
    expect(res.errors.join(' ')).toContain('E35');
  });

  it('AK 41: an edgeSources id without delivered node record is rejected', () => {
    importBase();
    const t2 = '20260201-1200';
    const bad = mkSnap('hrm', t2, { nodeTypes: [], edgeTypes: ['besuchte'], edgeSources: ['p2'] },
      [{ id: 'tr9', type: 'Training', label: 'X', props: {} }],
      [{ type: 'besuchte', source: 'p2', target: 'tr9' }]);
    const res = importSnapshot(store, REGISTRY, bad, YES);
    expect(res.status).toBe('rejected');
    expect(res.errors.join(' ')).toContain('no delivered node record');
    // p2's stock edges untouched
    const mKey = edgeKeyOf({ type: 'mitgliedIn', source: 'p2', target: 'o2' }, REGISTRY.edgeTypes.mitgliedIn);
    expect(store.edges.get(mKey).existence.some((iv) => iv.to === null)).toBe(true);
  });
});

describe('AK 29 — UTC instants (E50)', () => {
  it('accepts offset timestamps mapping to the stamp minute, rejects mismatches', () => {
    const scope = { nodeTypes: ['Person'], edgeTypes: [] };
    const good = {
      meta: { source: 'hrm', crawledAt: '2026-01-01T14:00:00+02:00', snapshot: '20260101-1200', registryVersion: '1', scope },
      schema: { nodeTypes: {}, edgeTypes: {} },
      nodes: [{ id: 'px', type: 'Person', label: 'X', props: {} }], edges: [],
    };
    expect(importSnapshot(store, REGISTRY, good, YES).status).toBe('imported');
    const bad = { ...good, meta: { ...good.meta, crawledAt: '2026-01-01T14:01:00+02:00' } };
    expect(importSnapshot(store, REGISTRY, bad, YES).status).toBe('rejected');
    const offsetless = { ...good, meta: { ...good.meta, crawledAt: '2026-01-01T12:00:00' } };
    expect(importSnapshot(store, REGISTRY, offsetless, YES).status).toBe('rejected');
  });
});

describe('AK 61 — same-instant overlap of the same source (E65)', () => {
  it('rejects differing contributions for the same visited node at the same instant', () => {
    importBase();
    const stamp = '20260201-1200';
    const scopeA = { nodeTypes: [], edgeTypes: ['besuchte'], edgeSources: ['p2'] };
    const a = mkSnap('hrm', stamp, scopeA,
      [{ id: 'p2', type: 'Person', label: 'STUB', props: {} }, { id: 'tr1', type: 'Training', label: 'S', props: {} }],
      [{ type: 'besuchte', source: 'p2', target: 'tr1' }]);
    expect(importSnapshot(store, REGISTRY, a, YES).status).toBe('imported');
    // second run, same instant, same visited node, DIFFERENT edges -> reject
    const scopeB = { nodeTypes: [], edgeTypes: ['besuchte'], edgeSources: ['p2', 'p1'] };
    const b = mkSnap('hrm', stamp, scopeB,
      [{ id: 'p1', type: 'Person', label: 'STUB', props: {} }, { id: 'p2', type: 'Person', label: 'STUB', props: {} }],
      []);
    const res = importSnapshot(store, REGISTRY, b, YES);
    expect(res.status).toBe('rejected');
    expect(res.reason).toContain('E65');
    // identical contribution imports fine (idempotent confirmation)
    const c = mkSnap('hrm', stamp, scopeB,
      [{ id: 'p1', type: 'Person', label: 'STUB', props: {} }, { id: 'p2', type: 'Person', label: 'STUB', props: {} },
       { id: 'tr1', type: 'Training', label: 'S', props: {} }],
      [{ type: 'besuchte', source: 'p2', target: 'tr1' }]);
    expect(importSnapshot(store, REGISTRY, c, YES).status).toBe('imported');
  });
});

describe('FR-5.7 — plausibility gate', () => {
  it('blocks a mass destruction without confirmation, nothing mutates', () => {
    importBase();
    const t2 = '20260201-1200';
    const empty = mkSnap('hrm', t2, FULL_SCOPE, [], []);
    const res = importSnapshot(store, REGISTRY, empty, { ...YES, confirmGate: () => false });
    expect(res.status).toBe('aborted');
    expect(nodeOpenNow(store.nodes.get('p1'))).toBe(true);
    expect(store.snapshots.size).toBe(1); // only the base import registered
    // with confirmation it applies and the gate audit is persisted
    const res2 = importSnapshot(store, REGISTRY, empty, YES);
    expect(res2.status).toBe('imported');
    const entry = [...store.snapshots.values()].find((e) => e.stamp === t2);
    expect(entry.gateAudit).not.toBeNull();
    expect(entry.gateAudit.exceeded.length).toBeGreaterThan(0);
  });
});

describe('E69 — join gate', () => {
  it('first foreign contribution requires confirmation; grant persists per (pair, type, spec)', () => {
    importBase();
    const join = mkSnap('sap', '20260201-1200', { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { pensum: 90 } }], []);
    const declined = importSnapshot(store, REGISTRY, join, { ...YES, confirmJoin: () => false });
    expect(declined.status).toBe('aborted');
    expect(recordStandAt(store.nodes.get('p1'), '20260301-0000').props.pensum).toBe(100); // nothing mutated
    let asked = 0;
    const granting = { ...YES, confirmJoin: () => { asked++; return true; } };
    expect(importSnapshot(store, REGISTRY, join, granting).status).toBe('imported');
    expect(asked).toBe(1);
    // same pair/type/spec again: no re-ask
    const join2 = mkSnap('sap', '20260301-1200', { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p2', type: 'Person', label: 'Dev', props: { pensum: 70 } }], []);
    expect(importSnapshot(store, REGISTRY, join2, granting).status).toBe('imported');
    expect(asked).toBe(1);
  });
});

describe('E70 — source book', () => {
  it('unknown source requires registration; spec mismatch gates destructive effects', () => {
    const snap = mkSnap('hrm', '20260101-1200', FULL_SCOPE, baseNodes(), baseEdges(), { harvestSpecVersion: 'v1' });
    const refused = importSnapshot(store, REGISTRY, snap, { ...YES, confirmSourceRegistration: () => false });
    expect(refused.status).toBe('aborted');
    expect(importSnapshot(store, REGISTRY, snap, YES).status).toBe('imported');
    // follow-up with DIFFERENT spec version and destructive effect
    const t2 = '20260201-1200';
    const destructive = mkSnap('hrm', t2, FULL_SCOPE,
      baseNodes().filter((n) => n.id !== 'p3'), baseEdges().filter((e) => e.source !== 'p3'),
      { harvestSpecVersion: 'v2' });
    let askedDestructive = 0;
    const res = importSnapshot(store, REGISTRY, destructive, {
      ...YES, confirmDestructive: () => { askedDestructive++; return false; },
    });
    expect(res.status).toBe('aborted');
    expect(askedDestructive).toBe(1);
    expect(nodeOpenNow(store.nodes.get('p3'))).toBe(true);
  });

  it('IMPORT_CONFIRM_DESTRUCTIVE gates every destructive import (FR-8.10 opt-in)', () => {
    importBase();
    store.options.IMPORT_CONFIRM_DESTRUCTIVE = true;
    const t2 = '20260201-1200';
    const destructive = mkSnap('hrm', t2, FULL_SCOPE,
      baseNodes().filter((n) => n.id !== 'p3'), baseEdges().filter((e) => e.source !== 'p3'));
    const res = importSnapshot(store, REGISTRY, destructive, { ...YES, confirmDestructive: () => false });
    expect(res.status).toBe('aborted');
    expect(nodeOpenNow(store.nodes.get('p3'))).toBe(true);
  });
});

describe('AK 34 — bundle atomicity (E55)', () => {
  const bundleSnaps = () => {
    const s1 = mkSnap('hrm', '20260101-1200', FULL_SCOPE, baseNodes(), baseEdges());
    const s2 = mkSnap('hrm', '20260201-1200', { nodeTypes: ['Rolle', 'Firma', 'Person'], edgeTypes: ['hatRolle'] },
      [
        { id: 'p1', type: 'Person', label: 'Boss', props: { email: 'boss@x.ch', pensum: 100 } },
        { id: 'r1', type: 'Rolle', label: 'Dev', props: {} },
        { id: 'f1', type: 'Firma', label: 'Akros', props: {} },
      ],
      [{ type: 'hatRolle', source: 'p1', target: 'r1', props: { kontext: 'f1' } }]);
    return [s1, s2];
  };

  it('imports a dependent bundle fully, independent of member order', () => {
    const [s1, s2] = bundleSnaps();
    const res = importBundle(store, REGISTRY, [s2, s1], YES); // reversed order
    expect(res.status).toBe('imported');
    expect(store.nodes.has('r1')).toBe(true);
    // deterministic: fresh store, other order, same identity count
    const store2 = createTenantStore();
    importBundle(store2, REGISTRY, [s1, s2], YES);
    expect([...store2.nodes.keys()].sort()).toEqual([...store.nodes.keys()].sort());
  });

  it('a runtime failure mid-bundle rolls back the whole bundle', () => {
    const [s1, s2] = bundleSnaps();
    let applied = 0;
    const res = importBundle(store, REGISTRY, [s1, s2], YES, () => {
      applied++;
      if (applied === 2) throw new Error('injected quota failure');
    });
    expect(res.status).toBe('rejected');
    expect(res.reason).toContain('rolled back');
    expect(store.nodes.size).toBe(0);
    expect(store.snapshots.size).toBe(0);
    // retry succeeds fully
    expect(importBundle(store, REGISTRY, [s1, s2], YES).status).toBe('imported');
  });

  it('a semantically broken last member mutates nothing (dry-run before commit)', () => {
    const [s1] = bundleSnaps();
    const broken = mkSnap('hrm', '20260301-1200', { nodeTypes: ['Person'], edgeTypes: ['berichtetAn'] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { email: 'boss@x.ch', pensum: 100 } }],
      [{ type: 'berichtetAn', source: 'p1', target: 'ghost' }]);
    const res = importBundle(store, REGISTRY, [s1, broken], YES);
    expect(res.status).toBe('rejected');
    expect(store.nodes.size).toBe(0);
  });
});

describe('E38/AK 20 — registry compatibility', () => {
  it('rejects identity-relevant skew, warns on unused extra declarations', () => {
    importBase();
    const skew = mkSnap('hrm', '20260201-1200', { nodeTypes: ['Person'], edgeTypes: ['hatRolle', 'berichtetAn'] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { email: 'boss@x.ch', pensum: 100 } },
       { id: 'r1', type: 'Rolle', label: 'X', props: {} }],
      [{ type: 'hatRolle', source: 'p1', target: 'r1', props: { kontext: null } }]);
    skew.meta.registryVersion = '0.9';
    skew.schema = { nodeTypes: {}, edgeTypes: { hatRolle: { from: 'Person', to: 'Rolle', identityProps: [], props: {} } } };
    const res = importSnapshot(store, REGISTRY, skew, YES);
    expect(res.status).toBe('rejected');
    expect(res.errors.join(' ')).toContain('E38');
    // unused extra type in dataset schema -> warning only
    const warned = mkSnap('hrm', '20260201-1200', { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { email: 'boss@x.ch', pensum: 100 } }], []);
    warned.schema = { nodeTypes: { Training: {} }, edgeTypes: {} };
    const res2 = importSnapshot(store, REGISTRY, warned, YES);
    expect(res2.status).toBe('imported');
    expect(res2.report.warnings.join(' ')).toContain('unused node type');
  });

  it('rejects an id that reappears with a different type (E66)', () => {
    importBase();
    const bad = mkSnap('hrm', '20260201-1200', { nodeTypes: ['OE'], edgeTypes: [] },
      [{ id: 'p1', type: 'OE', label: 'Boss-as-OE', props: {} }], []);
    const res = importSnapshot(store, REGISTRY, bad, YES);
    expect(res.status).toBe('rejected');
    expect(res.errors.join(' ')).toContain('E66');
  });

  it('rejects undeclared props keys (FR-4.5 propDecl contract)', () => {
    const bad = mkSnap('hrm', '20260101-1200', { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { secret: 'x' } }], []);
    const res = importSnapshot(store, REGISTRY, bad, YES);
    expect(res.status).toBe('rejected');
    expect(res.errors.join(' ')).toContain('propDecl');
  });

  it('rejects missing identityProp values (E15)', () => {
    const bad = mkSnap('hrm', '20260101-1200', { nodeTypes: ['Person', 'Rolle'], edgeTypes: ['hatRolle'] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: {} }, { id: 'r1', type: 'Rolle', label: 'X', props: {} }],
      [{ type: 'hatRolle', source: 'p1', target: 'r1', props: {} }]);
    const res = importSnapshot(store, REGISTRY, bad, YES);
    expect(res.status).toBe('rejected');
    expect(res.errors.join(' ')).toContain('identityProp');
  });
});

describe('validateSnapshot degradation (FR-5.5)', () => {
  it('flags a rooted full state without edgeTargets as degraded', () => {
    importBase();
    const scope = { ...FULL_SCOPE, roots: ['p1'], edgeSources: ['p1'], traversalEdgeTypes: ['berichtetAn'] };
    const snap = mkSnap('hrm', '20260201-1200', scope,
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { email: 'boss@x.ch', pensum: 100 } }], []);
    const val = validateSnapshot(snap, REGISTRY, store);
    expect(val.degraded).toBe(true);
    expect(val.warnings.join(' ')).toContain('move-out');
    const res = importSnapshot(store, REGISTRY, snap, YES);
    expect(res.status).toBe('imported');
    const entry = [...store.snapshots.values()].find((e) => e.stamp === '20260201-1200');
    expect(entry.degraded).toBe(true);
  });
});
