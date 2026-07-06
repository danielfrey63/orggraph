import { describe, it, expect } from 'vitest';
import { parsePathExpression } from '../src/sections/27-og2-path.js';
import { createTenantStore, createNodeIdentity, createEdgeIdentity, edgeKeyOf, startInterval } from '../src/sections/23-og2-store.js';
import { projectView } from '../src/sections/28-og2-project.js';
import {
  serializeTenantStore, deserializeTenantStore,
  looksLikeSnapshot, looksLikeRegistry, looksLikeLegacyData,
  adaptProjection, projectionFingerprint,
} from '../src/sections/29-og2-app.js';

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
    expect(looksLikeLegacyData(legacy)).toBe(true);
    expect(looksLikeLegacyData(snapshot)).toBe(false);
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

  it('fingerprint is stable for identical projections and changes with parameters', () => {
    const store = fixtureStore();
    const parsed = parsePathExpression(PATH);
    const a = adaptProjection(projectView({ store, parsed, roots: ['p1'], depth: 3 }), REGISTRY);
    const b = adaptProjection(projectView({ store, parsed, roots: ['p1'], depth: 3 }), REGISTRY);
    const c = adaptProjection(projectView({ store, parsed, roots: ['p1'], depth: 0 }), REGISTRY);
    expect(projectionFingerprint(a)).toBe(projectionFingerprint(b));
    expect(projectionFingerprint(a)).not.toBe(projectionFingerprint(c));
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
