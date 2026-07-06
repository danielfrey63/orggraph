// OrgGraph 2.0 engine — view projection (§7): BFS along the parsed path
// expression with visible-station ordering (FR-7.2), implicit transitive
// self-hops, hidden contraction with provenance (FR-7.1a/FR-7.8), ring
// attachment (E21), declarative filters applied after traversal and before
// contraction (FR-7.8), hard render caps (E67) and the capped diagnosis
// projection (§7, AK 53). Type-agnostic (NFR-5): every type comes from the
// path AST and the tenant registry.
import { instantCompare } from './21-og2-util.js';
import { nodeValidAt, edgeValidAt, recordStandAt, valueAt } from './23-og2-store.js';

// Virtual "now" for open-interval reads; every real stamp sorts below it.
const MAX_INSTANT = '99991231-2359';

// Hard caps (E67). Configured views get conservative upper bounds well above
// the acceptance scene (AK 1: 487/793); the diagnosis projection keeps the
// tighter §7 guideline values.
export const VIEW_CAPS = { nodes: 2000, edges: 6000 };
export const DIAGNOSIS_CAPS = { nodes: 500, edges: 1500 };

// --- Live indexes ----------------------------------------------------------

// Build deterministic adjacency over identities valid at `asOf` (default:
// open now). Edges index only types used by the projection when `edgeTypes`
// is given; neighbor lists are sorted by canonical edge key (deterministic
// truncation, E67).
export function buildLiveIndexes(store, asOf, edgeTypes) {
  const at = asOf || MAX_INSTANT;
  const nodes = new Map();
  for (const [id, identity] of store.nodes) {
    if (nodeValidAt(identity, at)) nodes.set(id, identity);
  }
  const bySource = new Map();
  const byTarget = new Map();
  const push = (map, key, edge) => {
    const list = map.get(key);
    if (list) list.push(edge); else map.set(key, [edge]);
  };
  for (const edge of store.edges.values()) {
    if (edgeTypes && !edgeTypes.has(edge.type)) continue;
    if (!edgeValidAt(edge, at)) continue;
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    push(bySource, edge.source, edge);
    push(byTarget, edge.target, edge);
  }
  for (const list of bySource.values()) list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const list of byTarget.values()) list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { at, nodes, bySource, byTarget };
}

function edgeTypesOfPath(root) {
  const types = new Set();
  const walk = (node) => { for (const hop of node.hops) { types.add(hop.edgeType); walk(hop.target); } };
  walk(root);
  return types;
}

// --- __auto__ roots (FR-7.1) ----------------------------------------------

// Roots of the tree spanned by the anchor self-hop, following the HOP
// orientation: descent hop `<--E--` (traversal against storage direction)
// => anchor nodes WITHOUT an outgoing E edge; `--E-->` => without incoming.
// Returns { roots, empty } — empty=true is the data-driven zero-root case
// (AK 85): the caller must show the "no automatic roots" hint, never render
// an unexplained blank.
export function resolveAutoRoots(parsed, idx) {
  const selfHop = parsed.hops.find((hop) => hop.selfHop);
  if (!selfHop) return { roots: [], empty: true };
  const roots = [];
  for (const [id, identity] of idx.nodes) {
    if (identity.type !== parsed.type) continue;
    const list = (selfHop.dir === '<--' ? idx.bySource : idx.byTarget).get(id) || [];
    if (!list.some((edge) => edge.type === selfHop.edgeType)) roots.push(id);
  }
  roots.sort();
  return { roots, empty: roots.length === 0 };
}

// --- Filters (FR-7.8) ------------------------------------------------------

// Scalar semantics: a missing value satisfies no operator (conservative —
// filtered projections never show a node whose value is unknown).
function scalarOp(op, actual, value) {
  if (actual === undefined) return false;
  switch (op) {
    case 'eq': case 'refEq': return actual === value;
    case 'neq': return actual !== value;
    case 'in': case 'refIn': return Array.isArray(value) && value.includes(actual);
    case 'exists': return true;
    case 'gte': return typeof actual === typeof value && actual >= value;
    case 'lte': return typeof actual === typeof value && actual <= value;
    default: return false;
  }
}

function nodePasses(filters, identity, stand) {
  for (const f of filters) {
    if (f.type !== identity.type) continue;
    const actual = f.prop === 'label' ? (stand && stand.label) : (stand ? stand.props[f.prop] : undefined);
    if (!scalarOp(f.op, actual, f.value)) return false;
  }
  return true;
}

function edgePasses(filters, edge, at) {
  for (const f of filters) {
    if (f.type !== edge.type) continue;
    let actual = (edge.identityProps || {})[f.prop];
    if (actual === undefined) {
      const tl = edge.timelines.get(`props.${f.prop}`);
      const iv = tl ? valueAt(tl, at) : null;
      actual = iv ? iv.value : undefined;
    }
    if (actual === null) actual = undefined; // explicit null = no context value
    if (!scalarOp(f.op, actual, f.value)) return false;
  }
  return true;
}

// --- View projection (FR-7.1a/FR-7.2/FR-7.3) -------------------------------

// projectView({ store, parsed, roots, depth, asOf, filters, caps }) →
// { nodes: Map(id → {id, type, render, order, stand}),
//   edges: [{key, type, source, target}],
//   derivedEdges: [{source, target, via, provenance: [paths]}],
//   rings: [{host, node, type, edgeKey}],
//   truncated, skipped, cappedBeforeFilter, notEvaluable, autoEmpty,
//   counters: {visibleNodes, visibleEdges, ringNodes, hiddenVisited} }
export function projectView(options) {
  const { store, parsed, depth = null, asOf = null, filters = {}, caps = VIEW_CAPS } = options;
  const idx = options.idx || buildLiveIndexes(store, asOf, edgeTypesOfPath(parsed));
  const at = idx.at;

  let roots = options.roots || [];
  let autoEmpty = false;
  if (roots.includes('__auto__')) {
    const auto = resolveAutoRoots(parsed, idx);
    roots = auto.roots;
    autoEmpty = auto.empty;
  }

  // Number AST nodes for visited keys (a node id may recur at different path
  // positions; each (node, position) pair expands at most once).
  const astIds = new Map();
  (function number(node) { astIds.set(node, astIds.size); for (const hop of node.hops) number(hop.target); })(parsed);

  const visible = new Map();        // id -> { id, type, render, order, stand, identity }
  const hiddenSeen = new Map();     // id -> { identity, stand } (filterable, never rendered)
  const primaryEdges = new Map();   // edge.key -> { edge, from, to }
  const derived = new Map();        // `${from}→${to}` -> { source, target, paths: [] }
  const rings = [];                 // { host, node, type, edgeKey, identity, stand }
  const ringSeen = new Set();
  const pushRing = (ring) => {
    const key = `${ring.host} ${ring.node} ${ring.edgeKey}`;
    if (ringSeen.has(key)) return;
    ringSeen.add(key);
    rings.push(ring);
  };
  let truncated = false;
  let skipped = 0;                  // lower-bound counter of dropped candidates (E67)
  let hiddenVisited = 0;

  const isVisibleRender = (render) => render === 'node' || render === 'cluster';
  const standOf = (identity) => recordStandAt(identity, at);

  const admitVisible = (identity, render, order) => {
    const existing = visible.get(identity.id);
    if (existing) {
      if (order < existing.order) existing.order = order; // flattest order wins (E5)
      return existing;
    }
    if (visible.size >= caps.nodes) { truncated = true; skipped++; return null; }
    const entry = { id: identity.id, type: identity.type, render, order, stand: standOf(identity), identity };
    visible.set(identity.id, entry);
    return entry;
  };

  const admitEdge = (edge) => {
    if (primaryEdges.has(edge.key)) return true;
    if (primaryEdges.size + derived.size >= caps.edges) { truncated = true; skipped++; return false; }
    primaryEdges.set(edge.key, edge);
    return true;
  };

  const admitDerived = (fromId, toId, viaEdgeType, path) => {
    const key = `${fromId} ${toId} ${viaEdgeType}`;
    let entry = derived.get(key);
    if (!entry) {
      if (primaryEdges.size + derived.size >= caps.edges) { truncated = true; skipped++; return; }
      entry = { source: fromId, target: toId, via: viaEdgeType, paths: [] };
      derived.set(key, entry);
    }
    entry.paths.push(path);
  };

  // 0-1 BFS: hops into visible stations cost 1 order, hops into hidden/ring
  // stations cost 0 — a deque keeps expansion in flattest-order-first
  // sequence so the first admission is the flattest order (FR-7.2).
  const queue = [];
  const visited = new Set();
  const enqueue = (state, cost) => { if (cost === 0) queue.unshift(state); else queue.push(state); };

  for (const rootId of [...roots].sort()) {
    const identity = idx.nodes.get(rootId);
    if (!identity || identity.type !== parsed.type) continue;
    const render = parsed.render === 'ring:prev' || parsed.render === 'ring:next' ? 'node' : parsed.render;
    if (isVisibleRender(render)) {
      const entry = admitVisible(identity, render, 0);
      if (!entry) continue;
      enqueue({ id: rootId, ast: parsed, order: 0, lastVisible: rootId, segment: null }, 1);
    } else {
      hiddenSeen.set(rootId, { identity, stand: standOf(identity) });
      enqueue({ id: rootId, ast: parsed, order: 0, lastVisible: null, segment: { hidden: [rootId], edges: [], nextRings: [] } }, 1);
    }
    visited.add(`${rootId}|${astIds.get(parsed)}`);
  }

  while (queue.length) {
    const state = queue.shift();
    for (const hop of state.ast.hops) {
      const list = (hop.dir === '<--' ? idx.byTarget : idx.bySource).get(state.id) || [];
      for (const edge of list) {
        if (edge.type !== hop.edgeType) continue;
        const otherId = hop.dir === '<--' ? edge.source : edge.target;
        const other = idx.nodes.get(otherId);
        if (!other || other.type !== hop.target.type) continue;

        const targetAst = hop.selfHop ? state.ast : hop.target;
        const render = hop.selfHop ? (isVisibleRender(state.ast.render) ? state.ast.render : 'node') : hop.target.render;
        const visitKey = `${otherId}|${astIds.get(targetAst)}`;

        if (render === 'ring:prev' || render === 'ring:next') {
          // Ring stations are attachments (FR-7.3): no order, no depth use,
          // no drawn edge. ring:prev anchors at the nearest preceding visible
          // station; ring:next waits for the next visible station (E21).
          const stand = standOf(other);
          if (render === 'ring:prev') {
            if (state.lastVisible !== null) pushRing({ host: state.lastVisible, node: otherId, type: other.type, edgeKey: edge.key, identity: other, stand });
          }
          if (visited.has(visitKey)) continue;
          visited.add(visitKey);
          const seg = state.segment ? { hidden: [...state.segment.hidden], edges: [...state.segment.edges, edge.key], nextRings: [...state.segment.nextRings] } : { hidden: [], edges: [edge.key], nextRings: [] };
          seg.hidden.push(otherId);
          hiddenSeen.set(otherId, { identity: other, stand });
          if (render === 'ring:next') seg.nextRings.push({ node: otherId, type: other.type, edgeKey: edge.key, identity: other, stand });
          enqueue({ id: otherId, ast: targetAst, order: state.order, lastVisible: state.lastVisible, segment: seg }, 0);
          continue;
        }

        if (render === 'hidden') {
          if (visited.has(visitKey)) continue;
          visited.add(visitKey);
          hiddenVisited++;
          if (hiddenVisited > caps.nodes * 10) { truncated = true; continue; } // runaway guard
          hiddenSeen.set(otherId, { identity: other, stand: standOf(other) });
          const seg = state.segment ? { hidden: [...state.segment.hidden, otherId], edges: [...state.segment.edges, edge.key], nextRings: [...state.segment.nextRings] } : { hidden: [otherId], edges: [edge.key], nextRings: [] };
          enqueue({ id: otherId, ast: targetAst, order: state.order, lastVisible: state.lastVisible, segment: seg }, 0);
          continue;
        }

        // Visible target (node/cluster): order +1, bounded by depth (FR-7.7).
        // A target already in the scene stays reachable as a cross-link even
        // past the depth budget — the edge is drawn, order never changes
        // (FR-7.2: cross-links have no order effect).
        const newOrder = state.order + 1;
        if (depth !== null && newOrder > depth && !visible.has(otherId)) continue;
        const entry = visible.get(otherId) || admitVisible(other, render, newOrder);
        if (!entry) continue; // capped — never traverse past the cap (E67)

        if (state.segment && state.segment.edges.length) {
          // Contraction (FR-7.1a): connect the last visible station directly;
          // provenance carries hidden nodes and primary edges of the path.
          // A walk back to its own visible origin is no relation (no self loop).
          if (state.lastVisible !== null && state.lastVisible !== otherId) {
            admitDerived(state.lastVisible, otherId, hop.edgeType, { hidden: [...state.segment.hidden], edges: [...state.segment.edges, edge.key] });
          }
        } else if (state.lastVisible !== null || visible.has(state.id)) {
          if (!admitEdge(edge)) continue;
        }
        for (const pending of (state.segment ? state.segment.nextRings : [])) {
          pushRing({ host: otherId, ...pending });
        }
        if (visited.has(visitKey)) continue; // cross-link: edge drawn, no re-expansion
        visited.add(visitKey);
        enqueue({ id: otherId, ast: targetAst, order: newOrder, lastVisible: otherId, segment: null }, 1);
      }
    }
  }

  // --- Filters: after traversal, before contraction (FR-7.8) ---------------
  const nodeFilters = filters.nodes || [];
  const edgeFilters = filters.edges || [];
  const filtersActive = nodeFilters.length > 0 || edgeFilters.length > 0;

  const keptNodes = new Map();
  for (const [id, entry] of visible) {
    if (nodePasses(nodeFilters, entry.identity, entry.stand)) keptNodes.set(id, entry);
  }
  const hiddenKept = new Set();
  for (const [id, info] of hiddenSeen) {
    if (nodePasses(nodeFilters, info.identity, info.stand)) hiddenKept.add(id);
  }
  const edgeKeep = (edge) => keptNodes.has(edge.source) && keptNodes.has(edge.target) && edgePasses(edgeFilters, edge, at);
  const keptEdges = [];
  const keptEdgeKeys = new Set();
  for (const edge of primaryEdges.values()) {
    if (edgeKeep(edge)) { keptEdges.push({ key: edge.key, type: edge.type, source: edge.source, target: edge.target }); keptEdgeKeys.add(edge.key); }
  }
  // A derived edge survives only while at least one fully unfiltered
  // contraction path carries it (FR-7.8, AK 60).
  const allEdgesByKey = new Map();
  for (const list of idx.bySource.values()) for (const edge of list) allEdgesByKey.set(edge.key, edge);
  const keptDerived = [];
  for (const entry of derived.values()) {
    if (!keptNodes.has(entry.source) || !keptNodes.has(entry.target)) continue;
    const paths = entry.paths.filter((path) =>
      path.hidden.every((hid) => keptNodes.has(hid) || hiddenKept.has(hid)) &&
      path.edges.every((key) => { const e = allEdgesByKey.get(key); return e && edgePasses(edgeFilters, e, at); })
    );
    if (paths.length) keptDerived.push({ source: entry.source, target: entry.target, via: entry.via, derived: true, provenance: paths });
  }
  const keptRings = rings.filter((ring) =>
    keptNodes.has(ring.host) && nodePasses(nodeFilters, ring.identity, ring.stand) &&
    (() => { const e = allEdgesByKey.get(ring.edgeKey); return !e || edgePasses(edgeFilters, e, at); })()
  );

  for (const entry of keptNodes.values()) delete entry.identity;
  const ringGroups = new Set(keptRings.map((r) => r.node));
  const empty = keptNodes.size === 0;

  return {
    nodes: keptNodes,
    edges: keptEdges,
    derivedEdges: keptDerived,
    rings: keptRings.map(({ host, node, type, edgeKey, stand }) => ({ host, node, type, edgeKey, stand })),
    truncated,
    skipped,
    autoEmpty,
    resolvedRoots: roots,
    // AK 63: a capped projection with active filters must never look complete;
    // a capped-and-filtered EMPTY result is "not evaluable", never "no hits".
    cappedBeforeFilter: truncated && filtersActive,
    notEvaluable: truncated && filtersActive && empty,
    counters: {
      visibleNodes: keptNodes.size,
      visibleEdges: keptEdges.length + keptDerived.length,
      ringNodes: keptRings.length,
      ringGroups: ringGroups.size,
      hiddenVisited,
    },
  };
}

// --- Diagnosis projection (§7, AK 53) --------------------------------------

// No VIEWS (or zero valid views): all registry types, neighborhood BFS over
// every edge type in BOTH directions, no ordering semantics, hard caps with a
// visible truncation hint. Without a root nothing is rendered.
export function projectDiagnosis(options) {
  const { store, roots = [], depth = null, asOf = null, caps = DIAGNOSIS_CAPS } = options;
  const idx = options.idx || buildLiveIndexes(store, asOf);
  if (!roots.length) return { nodes: new Map(), edges: [], truncated: false, skipped: 0, needsRoot: true, counters: { visibleNodes: 0, visibleEdges: 0 } };

  const nodes = new Map();
  const edges = new Map();
  let truncated = false;
  let skipped = 0;
  const queue = [];
  for (const id of [...roots].sort()) {
    const identity = idx.nodes.get(id);
    if (!identity || nodes.has(id)) continue;
    nodes.set(id, { id, type: identity.type, order: 0, stand: recordStandAt(identity, idx.at) });
    queue.push({ id, order: 0 });
  }
  while (queue.length) {
    const state = queue.shift();
    if (depth !== null && state.order >= depth) continue;
    const neighbors = [
      ...(idx.bySource.get(state.id) || []).map((e) => ({ edge: e, other: e.target })),
      ...(idx.byTarget.get(state.id) || []).map((e) => ({ edge: e, other: e.source })),
    ];
    for (const { edge, other } of neighbors) {
      const identity = idx.nodes.get(other);
      if (!identity) continue;
      if (!nodes.has(other)) {
        if (nodes.size >= caps.nodes) { truncated = true; skipped++; continue; }
        nodes.set(other, { id: other, type: identity.type, order: state.order + 1, stand: recordStandAt(identity, idx.at) });
        queue.push({ id: other, order: state.order + 1 });
      }
      if (!edges.has(edge.key)) {
        if (edges.size >= caps.edges) { truncated = true; skipped++; continue; }
        edges.set(edge.key, { key: edge.key, type: edge.type, source: edge.source, target: edge.target });
      }
    }
  }
  return {
    nodes,
    edges: [...edges.values()],
    truncated,
    skipped,
    needsRoot: false,
    counters: { visibleNodes: nodes.size, visibleEdges: edges.size },
  };
}

// --- Display label resolution (FR-4.2b) ------------------------------------

// labelProp may point at "label" or a scalar props path; a missing or
// non-scalar value falls back to the canonical label (import warns, FR-6.8).
export function resolveDisplayLabel(typeDecl, stand) {
  if (!stand) return undefined;
  const path = (typeDecl && typeDecl.labelProp) || 'label';
  if (path === 'label') return stand.label;
  const m = /^props\.([^.]+)$/.exec(path);
  if (m) {
    const v = stand.props[m[1]];
    if (v !== undefined && v !== null && typeof v !== 'object') return v;
  }
  return stand.label;
}
