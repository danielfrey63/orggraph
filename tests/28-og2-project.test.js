import { describe, it, expect } from 'vitest';
import { parsePathExpression } from '../src/sections/27-og2-path.js';
import { createTenantStore, createNodeIdentity, createEdgeIdentity, edgeKeyOf, startInterval } from '../src/sections/23-og2-store.js';
import { projectView, projectDiagnosis, resolveAutoRoots, buildLiveIndexes, resolveDisplayLabel, DIAGNOSIS_CAPS } from '../src/sections/28-og2-project.js';

// Type names are fixture data (E14, NFR-5 exception).
const REGISTRY = {
  version: '1',
  nodeTypes: { Person: { props: { pensum: {} } }, OE: {}, Rolle: {}, Firma: {}, Projekt: {} },
  edgeTypes: {
    berichtetAn: { from: 'Person', to: 'Person', props: {} },
    mitgliedIn: { from: 'Person', to: 'OE', props: {} },
    unterstellt: { from: 'OE', to: 'OE', props: {} },
    hatRolle: { from: 'Person', to: 'Rolle', identityProps: ['kontext'], props: { kontext: { ref: 'Firma', implies: 'arbeitetBei' } } },
    arbeitetBei: { from: 'Person', to: 'Firma', props: {} },
    arbeitetAn: { from: 'Person', to: 'Projekt', props: {} },
  },
};

const T0 = '20260101-1200';
const T1 = '20260301-1200';

// Direct store fixtures: identities with open existence from T0 (closed via
// `until`), labels and scalar props as timelines — the import pipeline is
// covered by its own suite; projection reads the store model.
function addNode(store, id, type, label, props = {}, until = null) {
  const identity = createNodeIdentity(id, type);
  identity.existence.push({ from: T0, to: until, source: 'fix', instant: T0, provenance: { fix: T0 } });
  const labelTl = [];
  startInterval(labelTl, T0, label, 'fix');
  identity.timelines.set('label', labelTl);
  for (const [key, value] of Object.entries(props)) {
    const tl = [];
    startInterval(tl, T0, value, 'fix');
    identity.timelines.set(`props.${key}`, tl);
  }
  store.nodes.set(id, identity);
  return identity;
}

function addEdge(store, type, source, target, props = {}, until = null) {
  const decl = REGISTRY.edgeTypes[type];
  const edge = { type, source, target, props };
  const key = edgeKeyOf(edge, decl);
  const identity = createEdgeIdentity(key, type, source, target, props);
  identity.existence.push({ from: T0, to: until, source: 'fix', instant: T0, provenance: { fix: T0 } });
  for (const [k, v] of Object.entries(props)) {
    const tl = [];
    startInterval(tl, T0, v, 'fix');
    identity.timelines.set(`props.${k}`, tl);
  }
  store.edges.set(key, identity);
  return identity;
}

// Org fixture: p1 root, p2/p3 report to p1, p4 reports to p2; OEs o1<-o2
// (o2 unterstellt o1), memberships, roles, project, firm.
function orgStore() {
  const store = createTenantStore();
  addNode(store, 'p1', 'Person', 'Chef', { pensum: 100 });
  addNode(store, 'p2', 'Person', 'Mid', { pensum: 80 });
  addNode(store, 'p3', 'Person', 'Mid2', { pensum: 60 });
  addNode(store, 'p4', 'Person', 'Leaf', { pensum: 40 });
  addNode(store, 'o1', 'OE', 'Root-OE');
  addNode(store, 'o2', 'OE', 'Sub-OE');
  addNode(store, 'r1', 'Rolle', 'Dev');
  addNode(store, 'r2', 'Rolle', 'Lead');
  addNode(store, 'f1', 'Firma', 'Akros');
  addNode(store, 'proj1', 'Projekt', 'Zi');
  addEdge(store, 'berichtetAn', 'p2', 'p1');
  addEdge(store, 'berichtetAn', 'p3', 'p1');
  addEdge(store, 'berichtetAn', 'p4', 'p2');
  addEdge(store, 'unterstellt', 'o2', 'o1');
  addEdge(store, 'mitgliedIn', 'p1', 'o1');
  addEdge(store, 'mitgliedIn', 'p2', 'o2');
  addEdge(store, 'mitgliedIn', 'p3', 'o2');
  addEdge(store, 'mitgliedIn', 'p4', 'o2');
  addEdge(store, 'hatRolle', 'p1', 'r2', { kontext: null });
  addEdge(store, 'hatRolle', 'p2', 'r1', { kontext: 'f1' });
  addEdge(store, 'hatRolle', 'p4', 'r1', { kontext: null });
  addEdge(store, 'arbeitetAn', 'p2', 'proj1');
  addEdge(store, 'arbeitetAn', 'p3', 'proj1');
  addEdge(store, 'arbeitetBei', 'p2', 'f1');
  return store;
}

const project = (store, path, opts = {}) =>
  projectView({ store, parsed: parsePathExpression(path), ...opts });

describe('FR-7.1b example 1 — transitive self-hop tree', () => {
  it('descends from roots, +1 order per visible level, bounded by depth', () => {
    const res = project(orgStore(), 'Person <--berichtetAn-- Person', { roots: ['p1'], depth: 3 });
    expect([...res.nodes.keys()].sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(res.nodes.get('p1').order).toBe(0);
    expect(res.nodes.get('p2').order).toBe(1);
    expect(res.nodes.get('p4').order).toBe(2);
    expect(res.edges.length).toBe(3);
    const shallow = project(orgStore(), 'Person <--berichtetAn-- Person', { roots: ['p1'], depth: 1 });
    expect([...shallow.nodes.keys()].sort()).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('FR-7.1b example 2 — single hop, no recursion', () => {
  it('one hop per root person; OEs as clusters with order 1', () => {
    const res = project(orgStore(), 'Person --mitgliedIn--> OE[cluster]', { roots: ['p2'] });
    expect([...res.nodes.keys()].sort()).toEqual(['o2', 'p2']);
    expect(res.nodes.get('o2').render).toBe('cluster');
    expect(res.nodes.get('o2').order).toBe(1);
  });
});

describe('FR-7.1b example 3 — self-hop re-applies the whole node-expr', () => {
  it('every person in the tree gets its ring badges, also at max depth', () => {
    const res = project(orgStore(), 'Person (<--berichtetAn-- Person, --hatRolle--> Rolle[ring])', { roots: ['p1'], depth: 1 });
    // depth 1: p1, p2, p3 visible; badges on p1 (r2) and p2 (r1) — p4 outside
    expect([...res.nodes.keys()].sort()).toEqual(['p1', 'p2', 'p3']);
    const hosts = res.rings.map((r) => `${r.host}:${r.node}`).sort();
    expect(hosts).toEqual(['p1:r2', 'p2:r1']);
    // rings never consume depth: badge appears on p2 although p2 is at max depth
    expect(res.rings.some((r) => r.host === 'p2')).toBe(true);
    expect(res.counters.ringGroups).toBe(2);
  });
});

describe('FR-7.1b example 4 — non-person anchor chain', () => {
  it('orders Projekt 0, Person 1, OE 2 without recursion', () => {
    const res = project(orgStore(), 'Projekt <--arbeitetAn-- Person --mitgliedIn--> OE[cluster]', { roots: ['proj1'] });
    expect(res.nodes.get('proj1').order).toBe(0);
    expect(res.nodes.get('p2').order).toBe(1);
    expect(res.nodes.get('p3').order).toBe(1);
    expect(res.nodes.get('o2').order).toBe(2);
    expect(res.nodes.get('o2').render).toBe('cluster');
  });
});

describe('FR-7.1b example 5 — hidden contraction', () => {
  it('colleagues of the same OE are directly connected via derived edges, order 1', () => {
    const res = project(orgStore(), 'Person --mitgliedIn--> OE[hidden] <--mitgliedIn-- Person', { roots: ['p2'] });
    expect(res.nodes.has('o2')).toBe(false);
    expect([...res.nodes.keys()].sort()).toEqual(['p2', 'p3', 'p4']);
    expect(res.nodes.get('p3').order).toBe(1); // hidden station does not count
    expect(res.edges.length).toBe(0);
    const derivedTargets = res.derivedEdges.map((e) => e.target).sort();
    expect(derivedTargets).toEqual(['p3', 'p4']);
    expect(res.derivedEdges[0].derived).toBe(true);
    expect(res.derivedEdges[0].provenance[0].hidden).toEqual(['o2']);
  });
});

describe('FR-7.1b example 6 — attachment skips [hidden]', () => {
  it('ring badges attach to the Firma, not to the hidden person', () => {
    const res = project(orgStore(), 'Firma <--arbeitetBei-- Person[hidden] --hatRolle--> Rolle[ring]', { roots: ['f1'] });
    expect(res.nodes.has('p2')).toBe(false);
    expect(res.rings.length).toBe(1);
    expect(res.rings[0].host).toBe('f1');
    expect(res.rings[0].node).toBe('r1');
  });
});

describe('FR-7.1b example 7 — multi-parent (E5)', () => {
  it('one node instance, both edges drawn, flattest order wins', () => {
    const store = orgStore();
    addNode(store, 'o3', 'OE', 'Second-Parent');
    addEdge(store, 'unterstellt', 'o2', 'o3');
    const res = project(store, 'OE <--unterstellt-- OE', { roots: ['o1', 'o3'] });
    expect(res.nodes.get('o2').order).toBe(1);
    expect([...res.nodes.keys()].filter((id) => id === 'o2').length).toBe(1);
    expect(res.edges.filter((e) => e.source === 'o2').length).toBe(2);
  });
});

describe('cross-links without order effect (FR-7.2)', () => {
  it('a second path to an already-visited node draws the edge, keeps flattest order', () => {
    const store = orgStore();
    addEdge(store, 'berichtetAn', 'p4', 'p1'); // p4 now reports to both p1 and p2
    const res = project(store, 'Person <--berichtetAn-- Person', { roots: ['p1'], depth: 3 });
    expect(res.nodes.get('p4').order).toBe(1); // flattest via direct edge
    expect(res.edges.filter((e) => e.source === 'p4').length).toBe(2);
  });
});

describe('__auto__ roots (FR-7.1, AK 85)', () => {
  it('descent hop: anchors without outgoing edge of the self-hop type', () => {
    const store = orgStore();
    const parsed = parsePathExpression('Person <--berichtetAn-- Person');
    const idx = buildLiveIndexes(store, null, new Set(['berichtetAn']));
    const auto = resolveAutoRoots(parsed, idx);
    expect(auto.roots).toEqual(['p1']);
    expect(auto.empty).toBe(false);
  });

  it('projectView resolves __auto__ and renders the full tree', () => {
    const res = project(orgStore(), 'Person <--berichtetAn-- Person', { roots: ['__auto__'], depth: 6 });
    expect(res.nodes.size).toBe(4);
    expect(res.autoEmpty).toBe(false);
  });

  it('AK 85: fully cyclic self-hop subgraph yields zero roots with hint, never a blank render', () => {
    const store = createTenantStore();
    addNode(store, 'a', 'Person', 'A');
    addNode(store, 'b', 'Person', 'B');
    addEdge(store, 'berichtetAn', 'a', 'b');
    addEdge(store, 'berichtetAn', 'b', 'a');
    const res = project(store, 'Person <--berichtetAn-- Person', { roots: ['__auto__'] });
    expect(res.autoEmpty).toBe(true);
    expect(res.nodes.size).toBe(0);
    // manual root choice via search still works (view stays usable)
    const manual = project(store, 'Person <--berichtetAn-- Person', { roots: ['a'], depth: 2 });
    expect(manual.nodes.size).toBe(2);
  });
});

describe('AK 60 — hidden filter before contraction (FR-7.8)', () => {
  it('filtering the hidden OE removes derived edges that only ran through it', () => {
    const store = orgStore();
    // second, unfiltered OE shared by p2 and p3 only
    addNode(store, 'o9', 'OE', 'Alt-OE');
    addEdge(store, 'mitgliedIn', 'p2', 'o9');
    addEdge(store, 'mitgliedIn', 'p3', 'o9');
    const path = 'Person --mitgliedIn--> OE[hidden] <--mitgliedIn-- Person';
    const noFilter = project(store, path, { roots: ['p2'] });
    expect(noFilter.derivedEdges.map((e) => e.target).sort()).toEqual(['p3', 'p4']);
    const filtered = project(store, path, {
      roots: ['p2'],
      filters: { nodes: [{ type: 'OE', prop: 'label', op: 'neq', value: 'Sub-OE' }] },
    });
    // p2–p4 ran only via o2 (filtered) -> gone; p2–p3 also via o9 -> stays
    expect(filtered.derivedEdges.map((e) => e.target)).toEqual(['p3']);
    expect(filtered.derivedEdges[0].provenance.every((p) => p.hidden.every((h) => h !== 'o2'))).toBe(true);
  });

  it('edge filters remove only the edge; node filters remove node plus edges', () => {
    const res = project(orgStore(), 'Person <--berichtetAn-- Person', {
      roots: ['p1'], depth: 3,
      filters: { nodes: [{ type: 'Person', prop: 'pensum', op: 'gte', value: 60 }] },
    });
    expect(res.nodes.has('p4')).toBe(false); // pensum 40 filtered
    expect(res.edges.some((e) => e.source === 'p4')).toBe(false);
    expect(res.nodes.size).toBe(3);
  });

  it('refEq filter on edge reference prop (FR-7.8)', () => {
    const res = project(orgStore(), 'Person (<--berichtetAn-- Person, --hatRolle--> Rolle[ring])', {
      roots: ['p1'], depth: 3,
      filters: { edges: [{ type: 'hatRolle', prop: 'kontext', op: 'refEq', value: 'f1' }] },
    });
    // only p2's role carries kontext f1; p1/p4 badges are filtered out
    expect(res.rings.length).toBe(1);
    expect(res.rings[0].host).toBe('p2');
  });
});

describe('E67 — hard caps, deterministic truncation (AK 57, AK 63)', () => {
  function starStore(n) {
    const store = createTenantStore();
    addNode(store, 'hub', 'Person', 'Hub');
    for (let i = 0; i < n; i++) {
      addNode(store, `s${String(i).padStart(4, '0')}`, 'Person', `S${i}`, { pensum: i % 100 });
      addEdge(store, 'berichtetAn', `s${String(i).padStart(4, '0')}`, 'hub');
    }
    return store;
  }

  it('stops at the caps with truncation flag and lower-bound counter, never traverses past', () => {
    const store = starStore(50);
    const caps = { nodes: 10, edges: 30 };
    const res = project(store, 'Person <--berichtetAn-- Person', { roots: ['hub'], depth: 6, caps });
    expect(res.truncated).toBe(true);
    expect(res.nodes.size).toBe(10);
    expect(res.skipped).toBeGreaterThan(0);
    // deterministic: same scene, same capped subset every time (AK 57)
    const res2 = project(store, 'Person <--berichtetAn-- Person', { roots: ['hub'], depth: 6, caps });
    expect([...res2.nodes.keys()]).toEqual([...res.nodes.keys()]);
  });

  it('AK 63: capped projection with active filters is flagged; empty result is "not evaluable"', () => {
    const store = starStore(50);
    const caps = { nodes: 10, edges: 30 };
    const flagged = project(store, 'Person <--berichtetAn-- Person', {
      roots: ['hub'], depth: 6, caps,
      filters: { nodes: [{ type: 'Person', prop: 'pensum', op: 'lte', value: 98 }] },
    });
    expect(flagged.cappedBeforeFilter).toBe(true);
    expect(flagged.notEvaluable).toBe(false);
    const empty = project(store, 'Person <--berichtetAn-- Person', {
      roots: ['hub'], depth: 6, caps,
      filters: { nodes: [{ type: 'Person', prop: 'pensum', op: 'gte', value: 99999 }] },
    });
    expect(empty.notEvaluable).toBe(true); // never plain "no hits" under capping
    const uncapped = project(store, 'Person <--berichtetAn-- Person', { roots: ['hub'], depth: 6 });
    expect(uncapped.truncated).toBe(false);
    expect(uncapped.cappedBeforeFilter).toBe(false);
  });
});

describe('AK 53 — diagnosis projection caps', () => {
  it('stops at hard caps on a high-degree root, never renders the whole graph', () => {
    const store = createTenantStore();
    addNode(store, 'hub', 'Person', 'Hub');
    for (let i = 0; i < DIAGNOSIS_CAPS.nodes + 200; i++) {
      const id = `n${String(i).padStart(5, '0')}`;
      addNode(store, id, 'Person', `N${i}`);
      addEdge(store, 'berichtetAn', id, 'hub');
    }
    const res = projectDiagnosis({ store, roots: ['hub'], depth: 6 });
    expect(res.truncated).toBe(true);
    expect(res.nodes.size).toBe(DIAGNOSIS_CAPS.nodes);
    expect(res.edges.length).toBeLessThanOrEqual(DIAGNOSIS_CAPS.edges);
  });

  it('without a root nothing is rendered; BFS runs both directions over all edge types', () => {
    const none = projectDiagnosis({ store: orgStore(), roots: [] });
    expect(none.needsRoot).toBe(true);
    expect(none.nodes.size).toBe(0);
    const res = projectDiagnosis({ store: orgStore(), roots: ['o2'], depth: 1 });
    // o2 neighbors in both directions: o1 (target of unterstellt), p2/p3/p4 (sources of mitgliedIn)
    expect([...res.nodes.keys()].sort()).toEqual(['o1', 'o2', 'p2', 'p3', 'p4']);
  });
});

describe('asOf time slice', () => {
  it('a closed edge is projected at T0 but not after its closure', () => {
    const store = orgStore();
    // close p4's reporting line at T1
    for (const edge of store.edges.values()) {
      if (edge.type === 'berichtetAn' && edge.source === 'p4') edge.existence[0].to = T1;
    }
    const before = project(store, 'Person <--berichtetAn-- Person', { roots: ['p1'], depth: 3, asOf: '20260201-1200' });
    expect(before.nodes.has('p4')).toBe(true);
    const after = project(store, 'Person <--berichtetAn-- Person', { roots: ['p1'], depth: 3 });
    expect(after.nodes.has('p4')).toBe(false);
  });
});

describe('display label resolution (FR-4.2b)', () => {
  it('labelProp path wins, missing or non-scalar value falls back to label', () => {
    expect(resolveDisplayLabel({ labelProp: 'label' }, { label: 'X', props: {} })).toBe('X');
    expect(resolveDisplayLabel({ labelProp: 'props.mail' }, { label: 'X', props: { mail: 'a@b' } })).toBe('a@b');
    expect(resolveDisplayLabel({ labelProp: 'props.missing' }, { label: 'X', props: {} })).toBe('X');
    expect(resolveDisplayLabel({}, { label: 'X', props: {} })).toBe('X');
    expect(resolveDisplayLabel({ labelProp: 'props.mail' }, null)).toBe(undefined);
  });
});
