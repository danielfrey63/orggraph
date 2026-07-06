// OrgGraph 2.0 engine — app-side core kept DOM-free: tenant store
// serialization for IndexedDB persistence (FR-8.9), snapshot/file
// classification for the drop pipeline (FR-6.7, E25) and the adapter that
// turns a view projection (§7) into the render structures the layout/render
// machinery consumes (§9.2: algorithms stay, type binding becomes
// declarative — draw kinds follow the render mode, never a type name).
import { canonicalJson } from './21-og2-util.js';
import { quantizedHueFromCategory } from './08-color-geometry.js';
import { resolveDisplayLabel } from './28-og2-project.js';

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

// --- File classification (FR-6.7, E25) -------------------------------------

export function looksLikeSnapshot(obj) {
  return !!(obj && obj.meta && typeof obj.meta.source === 'string' && typeof obj.meta.snapshot === 'string'
    && obj.schema && Array.isArray(obj.nodes) && Array.isArray(obj.edges));
}

export function looksLikeRegistry(obj) {
  return !!(obj && typeof obj.version === 'string' && obj.nodeTypes && obj.edgeTypes
    && !obj.meta && !Array.isArray(obj.nodes));
}

// Legacy v1 dataset (persons/orgs/links): recognized ONLY to reject it with
// the migration hint — the app understands snapshots exclusively (§9.3).
export function looksLikeLegacyData(obj) {
  return !!(obj && Array.isArray(obj.persons) && Array.isArray(obj.orgs) && Array.isArray(obj.links));
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
  // "<Type>::<resolved label>" — the same key shape the ring legend and the
  // category hue strategy use (FR-4.2a: ring color from the type name).
  const ringsByHost = new Map();
  const ringGroups = new Map();
  for (const ring of projection.rings) {
    if (!kindOf.has(ring.host)) continue;
    const label = resolveDisplayLabel(nodeTypes[ring.type], ring.stand) ?? ring.node;
    const key = `${ring.type}::${label}`;
    const color = `hsl(${quantizedHueFromCategory(ring.type)}, 70%, 55%)`;
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
