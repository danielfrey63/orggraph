// OrgGraph 2.0 engine — app-side core kept DOM-free: tenant store
// serialization for IndexedDB persistence (FR-8.9), snapshot/file
// classification for the drop pipeline (FR-6.7, E25) and the adapter that
// turns a view projection (§7) into the render structures the layout/render
// machinery consumes (§9.2: algorithms stay, type binding becomes
// declarative — draw kinds follow the render mode, never a type name).
import { canonicalJson } from './21-og2-util.js';
import { colorForRainbowPosition } from './08-color-geometry.js';
import { validateViews, visibleTypesOf } from './27-og2-path.js';
import { projectView, projectDiagnosis, buildLiveIndexes, resolveDisplayLabel } from './28-og2-project.js';

// --- Store serialization (FR-8.9) ------------------------------------------
// The in-memory tenant store uses Maps/Sets; IndexedDB persistence stores one
// JSON-safe document per tenant. The physical layout stays a free
// implementation decision (§14) — this encoding is versioned to allow later
// migration.
const STORE_FORMAT = 'og2-store-v1';

function encodeValue(value) {
  if (value instanceof Map) return { __map__: [...value.entries()].map(([k, v]) => [k, encodeValue(v)]) };
  if (value instanceof Set) return { __set__: [...value.values()] };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = encodeValue(v);
    return out;
  }
  return value;
}

function decodeValue(value) {
  if (value && typeof value === 'object') {
    if (Array.isArray(value.__map__)) return new Map(value.__map__.map(([k, v]) => [k, decodeValue(v)]));
    if (Array.isArray(value.__set__)) return new Set(value.__set__);
    if (Array.isArray(value)) return value.map(decodeValue);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decodeValue(v);
    return out;
  }
  return value;
}

export function serializeTenantStore(store) {
  return JSON.stringify({ format: STORE_FORMAT, store: encodeValue(store) });
}

export function deserializeTenantStore(text) {
  const doc = JSON.parse(text);
  if (!doc || doc.format !== STORE_FORMAT) throw new Error(`unknown store format: ${doc && doc.format}`);
  return decodeValue(doc.store);
}

// Chunked persistence (FR-8.9, NFR-2/AK 37): the single-document encoding
// breaks at the V8 string limit (~512MB) once the reference tenant carries a
// stand series. v2 splits the large collections (nodes/edges/snapshots) into
// byte-bounded part strings; the small store fields travel in the header.
// v1 documents stay readable (boot falls back to deserializeTenantStore).
const STORE_FORMAT_V2 = 'og2-store-v2';
const STORE_PART_BYTES = 32 * 1024 * 1024;

export function serializeTenantStoreParts(store, maxPartBytes = STORE_PART_BYTES) {
  const { nodes, edges, snapshots, ...small } = store;
  const parts = [];
  let current = [];
  let currentBytes = 2;
  const push = (tuple) => {
    const s = JSON.stringify(tuple);
    if (current.length && currentBytes + s.length + 1 > maxPartBytes) {
      parts.push(`[${current.join(',')}]`);
      current = [];
      currentBytes = 2;
    }
    current.push(s);
    currentBytes += s.length + 1;
  };
  for (const [k, v] of nodes) push(['n', k, encodeValue(v)]);
  for (const [k, v] of edges) push(['e', k, encodeValue(v)]);
  for (const [k, v] of snapshots) push(['s', k, encodeValue(v)]);
  if (current.length) parts.push(`[${current.join(',')}]`);
  const header = JSON.stringify({ format: STORE_FORMAT_V2, parts: parts.length, small: encodeValue(small) });
  return { header, parts };
}

export function isChunkedStoreHeader(text) {
  if (typeof text !== 'string' || !text.startsWith('{')) return false;
  try { return JSON.parse(text).format === STORE_FORMAT_V2; } catch { return false; }
}

export function deserializeTenantStoreParts(headerText, partTexts) {
  const doc = JSON.parse(headerText);
  if (!doc || doc.format !== STORE_FORMAT_V2) throw new Error(`unknown store format: ${doc && doc.format}`);
  const store = { nodes: new Map(), edges: new Map(), snapshots: new Map(), ...decodeValue(doc.small) };
  for (const text of partTexts) {
    for (const [kind, k, v] of JSON.parse(text)) {
      (kind === 'n' ? store.nodes : kind === 'e' ? store.edges : store.snapshots).set(k, decodeValue(v));
    }
  }
  return store;
}

// --- Projection → render adapter (§9.2) ------------------------------------
// The layout/render machinery works on: draw nodes (simulated graph nodes),
// draw links between them, cluster nodes with a parent relation and a
// member assignment, and ring badge maps per host node. All of it derives
// from the projection's render modes — no type names involved (NFR-5).
//
// Returns {
//   drawNodes: [{ id, kind:'node', type, label, level, props, stand }],
//   drawLinks: [{ source, target, edgeType, derived }],
//   clusters:  [{ id, type, label, level }],
//   clusterParent: Map(clusterId -> parentClusterId),
//   memberOfCluster: Map(drawNodeId -> [clusterId]),
//   ringsByHost: Map(hostId -> Map('<Type>::<label>' -> { color, node })),
//   ringGroups: Map('<Type>::<label>' -> { type, label, color, count }),
//   footer: { ...projection counters + flags },
// }
export function adaptProjection(projection, registry) {
  const nodeTypes = (registry && registry.nodeTypes) || {};
  const drawNodes = [];
  const clusters = [];
  const kindOf = new Map();
  for (const entry of projection.nodes.values()) {
    const label = resolveDisplayLabel(nodeTypes[entry.type], entry.stand);
    if (entry.render === 'cluster') {
      clusters.push({ id: entry.id, type: entry.type, label, level: entry.order });
      kindOf.set(entry.id, 'cluster');
    } else {
      drawNodes.push({ id: entry.id, kind: 'node', type: entry.type, label, level: entry.order, props: (entry.stand && entry.stand.props) || {}, stand: entry.stand });
      kindOf.set(entry.id, 'node');
    }
  }

  const drawLinks = [];
  const clusterParent = new Map();
  const memberOfCluster = new Map();
  const addMember = (nodeId, clusterId) => {
    const list = memberOfCluster.get(nodeId);
    if (list) { if (!list.includes(clusterId)) list.push(clusterId); }
    else memberOfCluster.set(nodeId, [clusterId]);
  };
  const routeEdge = (source, target, edgeType, derived) => {
    const sk = kindOf.get(source);
    const tk = kindOf.get(target);
    if (sk === 'node' && tk === 'node') drawLinks.push({ source, target, edgeType, derived: !!derived });
    else if (sk === 'node' && tk === 'cluster') addMember(source, target);
    else if (sk === 'cluster' && tk === 'node') addMember(target, source);
    else if (sk === 'cluster' && tk === 'cluster' && !clusterParent.has(source)) clusterParent.set(source, target);
  };
  for (const edge of projection.edges) routeEdge(edge.source, edge.target, edge.type, false);
  for (const edge of projection.derivedEdges) routeEdge(edge.source, edge.target, edge.via, true);

  // Ring badges (E21): grouped per host under the composite key
  // "<Type>::<resolved label>". Colors follow the long rainbow palette (E13,
  // FR-4.2a): one spectral sweep laid once across the ordered list of ALL
  // attributes — groups sorted, labels sorted within their group — so groups
  // occupy distinct spectral bands while labels of one group sit on adjacent
  // hues. The order is sorted, so the palette is deterministic per scene.
  const ringsByHost = new Map();
  const ringGroups = new Map();
  const resolvedRings = [];
  const labelsByType = new Map();
  for (const ring of projection.rings) {
    if (!kindOf.has(ring.host)) continue;
    const label = resolveDisplayLabel(nodeTypes[ring.type], ring.stand) ?? ring.node;
    resolvedRings.push({ ring, label });
    if (!labelsByType.has(ring.type)) labelsByType.set(ring.type, new Set());
    labelsByType.get(ring.type).add(label);
  }
  const ordinalOf = new Map();
  const orderedKeys = [];
  for (const type of [...labelsByType.keys()].sort()) {
    for (const label of [...labelsByType.get(type)].sort()) orderedKeys.push(`${type}::${label}`);
  }
  orderedKeys.forEach((key, i) => ordinalOf.set(key, i));
  for (const { ring, label } of resolvedRings) {
    const key = `${ring.type}::${label}`;
    const color = colorForRainbowPosition(ordinalOf.get(key) || 0, orderedKeys.length);
    let hostMap = ringsByHost.get(ring.host);
    if (!hostMap) { hostMap = new Map(); ringsByHost.set(ring.host, hostMap); }
    hostMap.set(key, { color, node: ring.node });
    const group = ringGroups.get(key);
    if (group) group.count++;
    else ringGroups.set(key, { type: ring.type, label, color, count: 1 });
  }

  return {
    drawNodes,
    drawLinks,
    clusters,
    clusterParent,
    memberOfCluster,
    ringsByHost,
    ringGroups,
    footer: {
      visibleNodes: projection.counters.visibleNodes,
      visibleEdges: projection.counters.visibleEdges,
      clusterCount: clusters.length,
      ringGroupCount: ringGroups.size,
      truncated: projection.truncated,
      skipped: projection.skipped,
      cappedBeforeFilter: projection.cappedBeforeFilter,
      notEvaluable: projection.notEvaluable,
      autoEmpty: projection.autoEmpty,
    },
  };
}

// --- App view state (FR-7.5/7.6/7.7, §7) ------------------------------------
// One state object per tenant session: validated views, active view, runtime
// overrides (roots/depth/time). Views come from env.VIEWS; zero valid views
// => diagnosis projection plus a per-view rejection report (§7, AK 84).

export function createOg2State({ store, registry, env }) {
  const rawViews = (env && env.VIEWS) || null;
  const { valid, rejected, anyValid } = rawViews ? validateViews(rawViews, registry) : { valid: {}, rejected: {}, anyValid: false };
  return {
    store,
    registry,
    env: env || {},
    views: valid,
    rejectedViews: rejected,
    activeViewName: anyValid ? Object.keys(valid)[0] : null,
    runtimeRoots: null,   // search/context-menu override (FR-7.6), null = view roots
    runtimeDepth: null,   // toolbar override (FR-7.7), null = view depth
    asOf: null,           // time slice (FR-8.6), null = now
  };
}

export function og2ActiveView(state) {
  return state.activeViewName ? state.views[state.activeViewName] : null;
}

// Project the current state: active view path (or the capped diagnosis
// projection when no valid view exists) with runtime overrides applied.
// Returns { projection, adapted, mode: 'view'|'diagnosis', sub } where sub is
// the draw-ready subgraph for the layout machinery: nodes carry
// { id, label, type (registry), kind ('node'|'cluster'), level }.
export function og2Project(state) {
  const view = og2ActiveView(state);
  if (!view) {
    const projection = projectDiagnosis({
      store: state.store,
      roots: state.runtimeRoots || [],
      depth: state.runtimeDepth ?? 3,
      asOf: state.asOf,
    });
    const nodeTypes = state.registry.nodeTypes || {};
    const nodes = [...projection.nodes.values()].map((n) => ({
      id: n.id, kind: 'node', type: n.type, level: n.order,
      label: resolveDisplayLabel(nodeTypes[n.type], n.stand),
    }));
    return {
      projection, mode: 'diagnosis', adapted: null,
      sub: { nodes, links: projection.edges.map((e) => ({ source: e.source, target: e.target })) },
    };
  }
  const projection = projectView({
    store: state.store,
    parsed: view.parsed,
    roots: state.runtimeRoots || view.roots || [],
    depth: state.runtimeDepth ?? view.depth ?? null,
    asOf: state.asOf,
    filters: view.filters || {},
  });
  const adapted = adaptProjection(projection, state.registry);
  const nodes = [
    ...adapted.drawNodes.map((n) => ({ id: n.id, kind: 'node', type: n.type, label: n.label, level: n.level, props: n.props })),
    ...adapted.clusters.map((c) => ({ id: c.id, kind: 'cluster', type: c.type, label: c.label, level: c.level })),
  ];
  const links = adapted.drawLinks.map((l) => ({ source: l.source, target: l.target, derived: l.derived }));
  return { projection, adapted, mode: 'view', sub: { nodes, links } };
}

// Cluster/member path structure of a parsed view: which node types render as
// cluster, which edge types connect cluster→cluster (hull hierarchy) and
// node→cluster (membership) — all read from the path AST, never hardcoded.
export function og2PathStructure(parsed) {
  const renderOfType = new Map();
  const clusterEdgeTypes = new Set();
  const allEdgeTypes = new Set();
  const walk = (node) => {
    if (!renderOfType.has(node.type)) renderOfType.set(node.type, node.render);
    for (const hop of node.hops) {
      allEdgeTypes.add(hop.edgeType);
      if (node.render === 'cluster' && hop.target.render === 'cluster') clusterEdgeTypes.add(hop.edgeType);
      walk(hop.target);
    }
  };
  walk(parsed);
  const clusterTypes = new Set([...renderOfType.entries()].filter(([, r]) => r === 'cluster').map(([t]) => t));
  return { renderOfType, clusterTypes, clusterEdgeTypes, allEdgeTypes };
}

// Tenant-stock translation for the legacy-shaped globals the layout/render
// machinery consumes (§9.2): search domain (FR-8.4: ALIVE identities of the
// visible path types with resolved labels), cluster stock with its hierarchy,
// and the live edge list of the path's edge types. Diagnosis mode covers all
// registry types (§7).
export function og2BuildGlobalsData(state) {
  const view = og2ActiveView(state);
  const nodeTypes = state.registry.nodeTypes || {};
  const types = view ? visibleTypesOf(view.parsed) : new Set(Object.keys(nodeTypes));
  const structure = view ? og2PathStructure(view.parsed) : { clusterTypes: new Set(), clusterEdgeTypes: new Set(), allEdgeTypes: null };
  const idx = buildLiveIndexes(state.store, state.asOf, structure.allEdgeTypes ? structure.allEdgeTypes : undefined);

  const persons = [];
  const orgs = [];
  for (const identity of idx.nodes.values()) {
    if (!types.has(identity.type)) continue;
    const decl = nodeTypes[identity.type] || {};
    const stand = og2StandOf(state, identity);
    const isCluster = structure.clusterTypes.has(identity.type);
    const entry = { id: identity.id, type: identity.type, kind: isCluster ? 'cluster' : 'node', label: resolveDisplayLabel(decl, stand), props: stand.props };
    for (const path of decl.identifiers || []) {
      const m = /^props\.([^.]+)$/.exec(path);
      if (m && stand && stand.props[m[1]] !== undefined) entry[m[1]] = stand.props[m[1]];
    }
    (isCluster ? orgs : persons).push(entry);
  }

  const links = [];
  const orgParent = new Map();
  const orgChildren = new Map();
  const clusterIds = new Set(orgs.map((o) => o.id));
  for (const list of idx.bySource.values()) {
    for (const edge of list) {
      links.push({ source: edge.source, target: edge.target });
      // stored direction: child/member -> parent/container (FR-7.2a)
      if (structure.clusterEdgeTypes.has(edge.type) && clusterIds.has(edge.source) && clusterIds.has(edge.target)) {
        orgParent.set(edge.source, edge.target);
        if (!orgChildren.has(edge.target)) orgChildren.set(edge.target, new Set());
        orgChildren.get(edge.target).add(edge.source);
      }
    }
  }
  const orgRoots = orgs.filter((o) => !orgParent.has(o.id)).map((o) => o.id);
  return { persons, orgs, links, orgParent, orgChildren, orgRoots };
}

// --- Time navigation (FR-8.6, §5) -------------------------------------------

// Distinct snapshot instants of the tenant, ascending. Time navigation
// activates from two stands on (AK 50); the default asOf is the youngest.
export function og2TimeInstants(state) {
  const instants = new Set();
  for (const entry of state.store.snapshots.values()) {
    if (entry && typeof entry.stamp === 'string') instants.add(entry.stamp);
  }
  return [...instants].sort();
}

// Diff projection (§5, AK 4): project the active view at T1 and T2 and
// classify identities — added (only T2), removed (only T1), changed (both,
// differing stand). The drawn scene is T2 plus the removed elements, each
// entry carrying diffClass; counters feed the footer (FR-8.12).
export function og2ProjectDiff(state, t1, t2) {
  const at = (asOf) => og2Project({ ...state, asOf, diff: null });
  const p1 = at(t1);
  const p2 = at(t2);
  const standKey = (n) => canonicalJson({ label: n.label, props: n.props || {} });

  const nodes1 = new Map(p1.sub.nodes.map((n) => [String(n.id), n]));
  const nodes2 = new Map(p2.sub.nodes.map((n) => [String(n.id), n]));
  const nodes = [];
  let added = 0, removed = 0, changed = 0;
  for (const [id, n2] of nodes2) {
    const n1 = nodes1.get(id);
    if (!n1) { added++; nodes.push({ ...n2, diffClass: 'diff-new' }); }
    else if (standKey(n1) !== standKey(n2)) { changed++; nodes.push({ ...n2, diffClass: 'diff-changed', before: { label: n1.label, props: n1.props } }); }
    else nodes.push(n2);
  }
  for (const [id, n1] of nodes1) {
    if (!nodes2.has(id)) { removed++; nodes.push({ ...n1, diffClass: 'diff-removed' }); }
  }

  const linkKey = (l) => `${l.source}>${l.target}`;
  const links1 = new Map(p1.sub.links.map((l) => [linkKey(l), l]));
  const links2 = new Map(p2.sub.links.map((l) => [linkKey(l), l]));
  const links = [];
  for (const [key, l2] of links2) {
    links.push(links1.has(key) ? l2 : { ...l2, diffClass: 'diff-new' });
    if (!links1.has(key)) added++;
  }
  for (const [key, l1] of links1) {
    if (!links2.has(key)) { removed++; links.push({ ...l1, diffClass: 'diff-removed' }); }
  }

  return {
    ...p2,
    sub: { nodes, links },
    diff: { t1, t2, added, removed, changed },
  };
}

// Non-anchor search resolution (E64, FR-7.6): a visible hit outside the
// anchor type resolves deterministically BACKWARDS over the path's hops to
// the nearest anchor node, which becomes the temporary root. An unreachable
// hit is reported — never a silent no-op (AK 40).
export function og2ResolveAnchorRoot(state, targetId) {
  const view = og2ActiveView(state);
  if (!view) return { ok: true, root: String(targetId), self: true }; // diagnosis: any node roots
  const structure = og2PathStructure(view.parsed);
  const idx = buildLiveIndexes(state.store, state.asOf, structure.allEdgeTypes);
  const target = idx.nodes.get(String(targetId));
  if (!target) return { ok: false, reason: 'not-alive' };
  const anchorType = view.parsed.type;
  if (target.type === anchorType) return { ok: true, root: String(targetId), self: true };

  // Collect the path's hops as (fromStationType, dir, edgeType, toStationType).
  const hops = [];
  (function walk(node) {
    for (const hop of node.hops) {
      hops.push({ from: node.type, dir: hop.dir, edgeType: hop.edgeType, to: hop.target.type });
      walk(hop.target);
    }
  })(view.parsed);

  // BFS backwards: from a node of a hop's TO-type step to neighbors of the
  // FROM-type via the inverse stored direction. Deterministic neighbor order
  // (sorted edge keys in the index) — the first anchor found is the nearest.
  const queue = [String(targetId)];
  const visited = new Set(queue);
  let guard = 0;
  while (queue.length) {
    if (++guard > 20000) break;
    const currentId = queue.shift();
    const current = idx.nodes.get(currentId);
    if (!current) continue;
    for (const hop of hops) {
      if (hop.to !== current.type) continue;
      // forward '<--E--': stored edge source=to-station, target=from-station
      // => backwards we follow bySource; forward '--E-->' inverts that.
      const list = (hop.dir === '<--' ? idx.bySource : idx.byTarget).get(currentId) || [];
      for (const edge of list) {
        if (edge.type !== hop.edgeType) continue;
        const otherId = hop.dir === '<--' ? edge.target : edge.source;
        const other = idx.nodes.get(otherId);
        if (!other || other.type !== hop.from || visited.has(otherId)) continue;
        if (other.type === anchorType) return { ok: true, root: otherId, via: currentId };
        visited.add(otherId);
        queue.push(otherId);
      }
    }
  }
  return { ok: false, reason: 'unreachable' };
}

function og2StandOf(state, identity) {
  const stand = { label: undefined, props: {} };
  for (const [prop, tl] of identity.timelines) {
    const open = tl.find((iv) => iv.to === null);
    if (!open || open.value === undefined) continue;
    if (prop === 'label') stand.label = open.value;
    else stand.props[prop.replace(/^props\./, '')] = open.value;
  }
  return stand;
}

// Stable content key of a projection for cheap render-skip decisions
// (reactive rendering, FR-8.11: parameter changes re-render; identical
// projections need not).
export function projectionFingerprint(adapted) {
  return canonicalJson({
    n: adapted.drawNodes.map((n) => [n.id, n.level]),
    l: adapted.drawLinks.map((l) => [l.source, l.target, l.edgeType, l.derived]),
    c: adapted.clusters.map((c) => c.id),
    r: [...adapted.ringsByHost.keys()],
  });
}
