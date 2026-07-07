import { describe, it, expect } from 'vitest';
import { parsePathExpression } from '../src/sections/27-og2-path.js';
import { createTenantStore, createNodeIdentity, createEdgeIdentity, edgeKeyOf, startInterval } from '../src/sections/23-og2-store.js';
import { projectView } from '../src/sections/28-og2-project.js';
import { serializeTenantStore, deserializeTenantStore, serializeTenantStoreParts, deserializeTenantStoreParts, isChunkedStoreHeader, adaptProjection, projectionFingerprint, createOg2State, og2Project, og2BuildGlobalsData, og2PathStructure, og2ResolveAnchorRoot, og2TimeInstants, og2ProjectDiff } from '../src/sections/29-og2-app.js';
import { looksLikeSnapshot, looksLikeRegistry, looksLikeData } from '../src/sections/04-storage.js';

// Type names are fixture data (E14, NFR-5 exception).
const REGISTRY = {
  version: '1',
  nodeTypes: { Person: { labelProp: 'label', props: { pensum: {} } }, OE: {}, Rolle: {} },
  edgeTypes: {
    berichtetAn: { from: 'Person', to: 'Person', props: {} },
    mitgliedIn: { from: 'Person', to: 'OE', props: {} },
    unterstellt: { from: 'OE', to: 'OE', props: {} },
    hatRolle: { from: 'Person', to: 'Rolle', props: {} },
  },
};
const T0 = '20260101-1200';

function addNode(store, id, type, label, props = {}) {
  const identity = createNodeIdentity(id, type);
  identity.existence.push({ from: T0, to: null, source: 'fix', instant: T0, provenance: { fix: T0 } });
  const tl = [];
  startInterval(tl, T0, label, 'fix');
  identity.timelines.set('label', tl);
  for (const [k, v] of Object.entries(props)) {
    const ptl = [];
    startInterval(ptl, T0, v, 'fix');
    identity.timelines.set(`props.${k}`, ptl);
  }
  store.nodes.set(id, identity);
}

function addEdge(store, type, source, target) {
  const edge = { type, source, target, props: {} };
  const key = edgeKeyOf(edge, REGISTRY.edgeTypes[type]);
  const identity = createEdgeIdentity(key, type, source, target, {});
  identity.existence.push({ from: T0, to: null, source: 'fix', instant: T0, provenance: { fix: T0 } });
  store.edges.set(key, identity);
}

function fixtureStore() {
  const store = createTenantStore();
  addNode(store, 'p1', 'Person', 'Chef', { pensum: 100 });
  addNode(store, 'p2', 'Person', 'Mid');
  addNode(store, 'o1', 'OE', 'Root-OE');
  addNode(store, 'o2', 'OE', 'Sub-OE');
  addNode(store, 'r1', 'Rolle', 'Dev');
  addEdge(store, 'berichtetAn', 'p2', 'p1');
  addEdge(store, 'unterstellt', 'o2', 'o1');
  addEdge(store, 'mitgliedIn', 'p1', 'o2');
  addEdge(store, 'mitgliedIn', 'p2', 'o2');
  addEdge(store, 'hatRolle', 'p2', 'r1');
  return store;
}

describe('store serialization (FR-8.9)', () => {
  it('round-trips a populated tenant store including Maps, Sets and nesting', () => {
    const store = fixtureStore();
    store.sourceBook.set('src-a', { registeredAt: T0, harvestSpecVersion: 'v1', moveOutEdgeTypes: new Set(['mitgliedIn']), specless: false });
    store.joinGrants.add('a b c');
    store.baselines.set('src-a {}', { destructive: 3, denominator: 10 });
    store.precedence.push('src-a');
    const text = serializeTenantStore(store);
    expect(typeof text).toBe('string');
    const back = deserializeTenantStore(text);
    expect(back.nodes).toBeInstanceOf(Map);
    expect(back.nodes.size).toBe(store.nodes.size);
    expect(back.nodes.get('p1').timelines).toBeInstanceOf(Map);
    expect(back.nodes.get('p1').timelines.get('label')[0].value).toBe('Chef');
    expect(back.sourceBook.get('src-a').moveOutEdgeTypes).toBeInstanceOf(Set);
    expect(back.sourceBook.get('src-a').moveOutEdgeTypes.has('mitgliedIn')).toBe(true);
    expect(back.joinGrants.has('a b c')).toBe(true);
    expect(back.precedence).toEqual(['src-a']);
    // deterministic: serialize(deserialize(x)) === x
    expect(serializeTenantStore(back)).toBe(text);
  });

  it('rejects unknown formats', () => {
    expect(() => deserializeTenantStore(JSON.stringify({ format: 'nope', store: {} }))).toThrow(/unknown store format/);
  });

  it('v2 chunked layout round-trips and splits by byte budget (NFR-2/AK 37)', () => {
    const store = fixtureStore();
    store.sourceBook.set('src-a', { registeredAt: T0, harvestSpecVersion: 'v1', moveOutEdgeTypes: new Set(['mitgliedIn']), specless: false });
    store.precedence.push('src-a');
    store.snapshots.set('k1', { importKey: 'k1', stamp: T0, journal: [], confirmations: { nodes: [], edges: [], props: [] } });
    // tiny budget forces one part per entry — no giant strings ever
    const { header, parts } = serializeTenantStoreParts(store, 8);
    expect(isChunkedStoreHeader(header)).toBe(true);
    expect(parts.length).toBe(store.nodes.size + store.edges.size + store.snapshots.size);
    const back = deserializeTenantStoreParts(header, parts);
    expect(back.nodes.get('p1').timelines.get('label')[0].value).toBe('Chef');
    expect(back.sourceBook.get('src-a').moveOutEdgeTypes.has('mitgliedIn')).toBe(true);
    expect(back.precedence).toEqual(['src-a']);
    expect(back.snapshots.get('k1').stamp).toBe(T0);
    // default budget: everything fits into one part; v1 docs are not chunked headers
    expect(serializeTenantStoreParts(store).parts.length).toBe(1);
    expect(isChunkedStoreHeader(serializeTenantStore(store))).toBe(false);
  });
});

describe('file classification (FR-6.7, E25)', () => {
  it('recognizes snapshots, registries and legacy data distinctly', () => {
    const snapshot = { meta: { source: 's', snapshot: '20260101-1200' }, schema: {}, nodes: [], edges: [] };
    const registry = { version: '1', nodeTypes: {}, edgeTypes: {} };
    const legacy = { persons: [], orgs: [], links: [] };
    expect(looksLikeSnapshot(snapshot)).toBe(true);
    expect(looksLikeSnapshot(registry)).toBe(false);
    expect(looksLikeSnapshot(legacy)).toBe(false);
    expect(looksLikeRegistry(registry)).toBe(true);
    expect(looksLikeRegistry(snapshot)).toBe(false);
    expect(looksLikeData(legacy)).toBe(true);
    expect(looksLikeData(snapshot)).toBe(false);
  });
});

describe('projection → render adapter (§9.2)', () => {
  const PATH = 'Person (<--berichtetAn-- Person, --mitgliedIn--> OE[cluster] --unterstellt--> OE[cluster], --hatRolle--> Rolle[ring])';

  it('routes node/cluster/ring render modes into draw structures without type names', () => {
    const projection = projectView({ store: fixtureStore(), parsed: parsePathExpression(PATH), roots: ['p1'], depth: 3 });
    const adapted = adaptProjection(projection, REGISTRY);
    expect(adapted.drawNodes.map((n) => n.id).sort()).toEqual(['p1', 'p2']);
    expect(adapted.drawNodes.every((n) => n.kind === 'node')).toBe(true);
    expect(adapted.drawNodes.find((n) => n.id === 'p1').level).toBe(0);
    expect(adapted.clusters.map((c) => c.id).sort()).toEqual(['o1', 'o2']);
    expect(adapted.clusterParent.get('o2')).toBe('o1');
    expect(adapted.memberOfCluster.get('p1')).toEqual(['o2']);
    expect(adapted.drawLinks).toEqual([{ source: 'p2', target: 'p1', edgeType: 'berichtetAn', derived: false }]);
    // ring badge on p2 with composite key and category-hue color
    const hostRings = adapted.ringsByHost.get('p2');
    expect(hostRings.size).toBe(1);
    const [key, entry] = [...hostRings.entries()][0];
    expect(key).toBe('Rolle::Dev');
    expect(entry.color).toMatch(/^hsl\(/);
    expect(adapted.ringGroups.get('Rolle::Dev').count).toBe(1);
    expect(adapted.footer.visibleNodes).toBe(4);
    expect(adapted.footer.clusterCount).toBe(2);
    expect(adapted.footer.ringGroupCount).toBe(1);
    expect(adapted.footer.truncated).toBe(false);
  });

  it('two-level ring palette: distinct hues between groups, nuances within (FR-4.2a, AK 96)', () => {
    // second role on p1 so one group carries two labels
    const store = fixtureStore();
    addNode(store, 'r2', 'Rolle', 'Lead');
    addEdge(store, 'hatRolle', 'p1', 'r2');
    const projection = projectView({ store, parsed: parsePathExpression(PATH + ''), roots: ['p1'], depth: 3 });
    const adapted = adaptProjection(projection, REGISTRY);
    const hueOf = (c) => Number(String(c).match(/hsl\((\d+)/)[1]);
    const groups = [...adapted.ringGroups.values()].filter((g) => g.type === 'Rolle');
    expect(groups.length).toBe(2);
    const [a, b] = groups.map((g) => g.color);
    expect(a).not.toBe(b);                       // distinguishable within the group
    expect(Math.abs(hueOf(a) - hueOf(b))).toBeLessThanOrEqual(60); // same family
    // deterministic per scene
    const again = adaptProjection(projectView({ store, parsed: parsePathExpression(PATH), roots: ['p1'], depth: 3 }), REGISTRY);
    expect([...again.ringGroups.values()].map((g) => g.color)).toEqual([...adapted.ringGroups.values()].map((g) => g.color));
  });

  it('fingerprint is stable for identical projections and changes with parameters', () => {
    const store = fixtureStore();
    const parsed = parsePathExpression(PATH);
    const a = adaptProjection(projectView({ store, parsed, roots: ['p1'], depth: 3 }), REGISTRY);
    const b = adaptProjection(projectView({ store, parsed, roots: ['p1'], depth: 3 }), REGISTRY);
    const c = adaptProjection(projectView({ store, parsed, roots: ['p1'], depth: 0 }), REGISTRY);
    expect(projectionFingerprint(a)).toBe(projectionFingerprint(b));
    expect(projectionFingerprint(a)).not.toBe(projectionFingerprint(c));
  });

  it('path structure extraction: cluster types, cluster edges, all edge types', () => {
    const { parsed } = { parsed: parsePathExpression(PATH) };
    const s = og2PathStructure(parsed);
    expect([...s.clusterTypes]).toEqual(['OE']);
    expect([...s.clusterEdgeTypes]).toEqual(['unterstellt']);
    expect([...s.allEdgeTypes].sort()).toEqual(['berichtetAn', 'hatRolle', 'mitgliedIn', 'unterstellt']);
  });

  it('derived edges route as draw links flagged derived', () => {
    const projection = projectView({
      store: fixtureStore(),
      parsed: parsePathExpression('Person --mitgliedIn--> OE[hidden] <--mitgliedIn-- Person'),
      roots: ['p1'],
    });
    const adapted = adaptProjection(projection, REGISTRY);
    expect(adapted.drawLinks).toEqual([{ source: 'p1', target: 'p2', edgeType: 'mitgliedIn', derived: true }]);
    expect(adapted.clusters.length).toBe(0);
  });
});

describe('app view state (FR-7.5/7.6/7.7, §7)', () => {
  const PATH = 'Person (<--berichtetAn-- Person, --mitgliedIn--> OE[cluster] --unterstellt--> OE[cluster], --hatRolle--> Rolle[ring])';
  const ENV = { VIEWS: { Start: { path: PATH, roots: ['__auto__'], depth: 3 } } };

  it('validates views, picks the first valid one and projects with __auto__ roots', () => {
    const state = createOg2State({ store: fixtureStore(), registry: REGISTRY, env: ENV });
    expect(state.activeViewName).toBe('Start');
    expect(Object.keys(state.rejectedViews)).toEqual([]);
    const res = og2Project(state);
    expect(res.mode).toBe('view');
    expect(res.sub.nodes.map((n) => n.id).sort()).toEqual(['o1', 'o2', 'p1', 'p2']);
    expect(res.sub.nodes.find((n) => n.id === 'o2').kind).toBe('cluster');
    expect(res.projection.resolvedRoots).toEqual(['p1']);
  });

  it('AK 84 building block: zero valid views => diagnosis mode with per-view reasons', () => {
    const badEnv = { VIEWS: { Kaputt: { path: 'Alien --gibtEsNicht--> Weg', roots: ['x'] } } };
    const state = createOg2State({ store: fixtureStore(), registry: REGISTRY, env: badEnv });
    expect(state.activeViewName).toBe(null);
    expect(state.rejectedViews.Kaputt.length).toBeGreaterThan(0);
    const idle = og2Project(state);
    expect(idle.mode).toBe('diagnosis');
    expect(idle.projection.needsRoot).toBe(true);
    expect(idle.sub.nodes.length).toBe(0); // never a full-graph render
    state.runtimeRoots = ['p1'];
    const res = og2Project(state);
    expect(res.mode).toBe('diagnosis');
    expect(res.sub.nodes.length).toBeGreaterThan(0);
  });

  it('runtime overrides win over view roots/depth (FR-7.6/7.7)', () => {
    const state = createOg2State({ store: fixtureStore(), registry: REGISTRY, env: ENV });
    state.runtimeRoots = ['p2'];
    state.runtimeDepth = 0;
    const res = og2Project(state);
    expect(res.sub.nodes.map((n) => n.id)).toEqual(['p2']);
  });

  it('stock globals translation: search domain, cluster hierarchy, live links', () => {
    const state = createOg2State({ store: fixtureStore(), registry: REGISTRY, env: ENV });
    const data = og2BuildGlobalsData(state);
    // visible path types: Person, OE, Rolle — Person/Rolle as draw nodes, OE as cluster
    expect(data.persons.map((n) => n.id).sort()).toEqual(['p1', 'p2', 'r1']);
    expect(data.orgs.map((n) => n.id).sort()).toEqual(['o1', 'o2']);
    expect(data.orgs.every((o) => o.kind === 'cluster')).toBe(true);
    expect(data.orgParent.get('o2')).toBe('o1');
    expect([...data.orgChildren.get('o1')]).toEqual(['o2']);
    expect(data.orgRoots).toEqual(['o1']);
    expect(data.links.length).toBe(5);
    expect(data.persons.find((n) => n.id === 'p1').label).toBe('Chef');
  });
});

describe('non-anchor search resolution (E64, AK 40)', () => {
  const PATH = 'Person (<--berichtetAn-- Person, --mitgliedIn--> OE[cluster] --unterstellt--> OE[cluster], --hatRolle--> Rolle[ring])';
  const ENV = { VIEWS: { Start: { path: PATH, roots: ['__auto__'], depth: 3 } } };

  it('an anchor-type hit roots itself', () => {
    const state = createOg2State({ store: fixtureStore(), registry: REGISTRY, env: ENV });
    expect(og2ResolveAnchorRoot(state, 'p2')).toMatchObject({ ok: true, root: 'p2', self: true });
  });

  it('a ring-type hit resolves backwards over hatRolle to the nearest person', () => {
    const state = createOg2State({ store: fixtureStore(), registry: REGISTRY, env: ENV });
    const res = og2ResolveAnchorRoot(state, 'r1');
    expect(res.ok).toBe(true);
    expect(res.root).toBe('p2'); // p2 --hatRolle--> r1
  });

  it('a cluster-type hit resolves over mitgliedIn, across the cluster chain when needed', () => {
    const state = createOg2State({ store: fixtureStore(), registry: REGISTRY, env: ENV });
    const direct = og2ResolveAnchorRoot(state, 'o2');
    expect(direct.ok).toBe(true);
    expect(['p1', 'p2'].includes(direct.root)).toBe(true); // members of o2
    // o1 has no direct member in the fixture except via unterstellt chain
    const chained = og2ResolveAnchorRoot(state, 'o1');
    expect(chained.ok).toBe(true);
  });

  it('an unreachable hit reports instead of a silent no-op (AK 40)', () => {
    const store = fixtureStore();
    addNode(store, 'r9', 'Rolle', 'Verwaist');
    const state = createOg2State({ store, registry: REGISTRY, env: ENV });
    const res = og2ResolveAnchorRoot(state, 'r9');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unreachable');
  });

  it('a dead identity is not resolvable', () => {
    const state = createOg2State({ store: fixtureStore(), registry: REGISTRY, env: ENV });
    expect(og2ResolveAnchorRoot(state, 'ghost')).toMatchObject({ ok: false, reason: 'not-alive' });
  });
});

describe('time navigation and diff projection (FR-8.6, §5, AK 4)', () => {
  const T1 = '20260301-1200';
  const ENV = { VIEWS: { Start: { path: 'Person <--berichtetAn-- Person', roots: ['p1'], depth: 3 } } };

  function temporalStore() {
    const store = fixtureStore();
    // px existed from T0 and disappears at T1 (closed identity + edge)
    addNode(store, 'px', 'Person', 'Weg');
    store.nodes.get('px').existence[0].to = T1;
    addEdge(store, 'berichtetAn', 'px', 'p1');
    for (const e of store.edges.values()) {
      if (e.source === 'px') e.existence[0].to = T1;
    }
    // p9 is new from T1 on
    addNode(store, 'p9', 'Person', 'Neu');
    store.nodes.get('p9').existence[0].from = T1;
    addEdge(store, 'berichtetAn', 'p9', 'p1');
    for (const e of store.edges.values()) {
      if (e.source === 'p9') e.existence[0].from = T1;
    }
    // p2 label changes at T1
    const labelTl = store.nodes.get('p2').timelines.get('label');
    labelTl[0].to = T1;
    labelTl.push({ from: T1, to: null, value: 'Mid v2', source: 'fix', instant: T1 });
    // two import registry stands
    store.snapshots.set('k1', { stamp: T0 });
    store.snapshots.set('k2', { stamp: T1 });
    return store;
  }

  it('collects distinct snapshot instants ascending (AK 50 basis)', () => {
    const state = createOg2State({ store: temporalStore(), registry: REGISTRY, env: ENV });
    expect(og2TimeInstants(state)).toEqual([T0, T1]);
    const single = createOg2State({ store: fixtureStore(), registry: REGISTRY, env: ENV });
    expect(og2TimeInstants(single)).toEqual([]);
  });

  it('AK 4: diff classifies added, removed and changed and keeps removed drawable', () => {
    const state = createOg2State({ store: temporalStore(), registry: REGISTRY, env: ENV });
    const res = og2ProjectDiff(state, '20260201-1200', '20260401-1200');
    const byId2 = new Map(res.sub.nodes.map((n) => [n.id, n]));
    expect(byId2.get('p9').diffClass).toBe('diff-new');
    expect(byId2.get('px').diffClass).toBe('diff-removed');
    expect(byId2.get('p2').diffClass).toBe('diff-changed');
    expect(byId2.get('p2').before.label).toBe('Mid');
    expect(byId2.get('p1').diffClass).toBeUndefined();
    expect(res.diff.added).toBeGreaterThanOrEqual(1);
    expect(res.diff.removed).toBeGreaterThanOrEqual(1);
    expect(res.diff.changed).toBe(1);
    // removed edge of px still drawable, flagged
    const removedLinks = res.sub.links.filter((l) => l.diffClass === 'diff-removed');
    expect(removedLinks.some((l) => l.source === 'px')).toBe(true);
  });

  it('asOf slice drives the plain projection (FR-8.6 default youngest)', () => {
    const state = createOg2State({ store: temporalStore(), registry: REGISTRY, env: ENV });
    state.asOf = '20260201-1200';
    const before = og2Project(state);
    expect(before.sub.nodes.some((n) => n.id === 'px')).toBe(true);
    expect(before.sub.nodes.some((n) => n.id === 'p9')).toBe(false);
    state.asOf = null;
    const now = og2Project(state);
    expect(now.sub.nodes.some((n) => n.id === 'px')).toBe(false);
    expect(now.sub.nodes.some((n) => n.id === 'p9')).toBe(true);
  });
});
