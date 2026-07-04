// OrgGraph 2.0 engine — scope canonicalization, fingerprints (E36/E49/E65)
// and scope membership on the pre-import stock (FR-5.5a).
import { canonicalJson, fnv1a64, sortedUnique } from './21-og2-util.js';
import { edgeOpenNow, nodeOpenNow } from './23-og2-store.js';

export function crawlKindOf(scope) {
  if (Array.isArray(scope.roots) && scope.roots.length > 0) return 'rooted';
  if ((scope.nodeTypes || []).length === 0 && (scope.edgeTypes || []).length > 0) return 'enrichment';
  return 'full';
}

// Declarative scope fingerprint (E49): defaults applied, set arrays sorted
// and deduplicated, observation fields (edgeSources/edgeTargets/excluded) and
// the pure trust request (authoritativeForSources) left OUT.
export function scopeFingerprint(scope) {
  const canonical = {
    nodeTypes: sortedUnique(scope.nodeTypes || []),
    edgeTypes: sortedUnique(scope.edgeTypes || []),
    roots: sortedUnique(scope.roots || []),
    traversalEdgeTypes: sortedUnique(
      scope.traversalEdgeTypes && scope.traversalEdgeTypes.length ? scope.traversalEdgeTypes : scope.edgeTypes || []
    ),
  };
  return fnv1a64(canonicalJson(canonical));
}

// Observation fingerprint (E36/E65): sorted, deduplicated edgeSources and
// excluded; edgeTargets as a typed map with sorted keys and per-type sorted,
// deduplicated id lists. Crawl-kind aware: edgeTargets only counts for rooted
// snapshots — where it is ineffective it is normalized to empty before
// fingerprinting (an ineffective field must not change the import identity).
export function observationFingerprint(scope) {
  const rooted = crawlKindOf(scope) === 'rooted';
  const targets = {};
  if (rooted && scope.edgeTargets) {
    for (const k of Object.keys(scope.edgeTargets).sort()) targets[k] = sortedUnique(scope.edgeTargets[k]);
  }
  const canonical = {
    edgeSources: sortedUnique(scope.edgeSources || []),
    excluded: sortedUnique(scope.excluded || []),
    edgeTargets: targets,
  };
  return fnv1a64(canonicalJson(canonical));
}

// Full import identity (FR-6.9): (source, stamp, scope fp, observation fp).
export function importKeyOf(meta) {
  return canonicalJson([meta.source, meta.snapshot, scopeFingerprint(meta.scope), observationFingerprint(meta.scope)]);
}

export function traversalTypesOf(scope) {
  return scope.traversalEdgeTypes && scope.traversalEdgeTypes.length ? scope.traversalEdgeTypes : scope.edgeTypes || [];
}

// Downward reachability over OPEN stock edges of the given types, against the
// stored edge direction (target -> source, FR-7.2a/FR-5.5a). Returns the set
// of reached node ids including the start ids themselves.
export function reachDownward(store, startIds, edgeTypeList) {
  const types = new Set(edgeTypeList);
  const childrenOf = new Map(); // target id -> [source ids] over open edges
  for (const edge of store.edges.values()) {
    if (!types.has(edge.type)) continue;
    if (!edgeOpenNow(edge)) continue;
    if (!childrenOf.has(edge.target)) childrenOf.set(edge.target, []);
    childrenOf.get(edge.target).push(edge.source);
  }
  const seen = new Set();
  const queue = [...startIds];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const child of childrenOf.get(id) || []) if (!seen.has(child)) queue.push(child);
  }
  return seen;
}

// Excluded area (FR-5.5a(3), E43): excluded roots plus everything reachable
// downward from them over stock edges of the traversal types. Deliberately
// conservative — multi-parent nodes stay excluded even when reachable via an
// intact parent.
export function excludedArea(store, scope) {
  const roots = scope.excluded || [];
  if (!roots.length) return new Set();
  return reachDownward(store, roots, traversalTypesOf(scope));
}

// Scope membership on the pre-import stock (FR-5.5a). Returns
// { kind, nodeScope, excludedSet, nodeDeletionCandidatesAllowed }.
export function computeScopeMembership(store, scope) {
  const kind = crawlKindOf(scope);
  const excludedSet = excludedArea(store, scope);
  const nodeTypeSet = new Set(scope.nodeTypes || []);
  const nodeScope = new Set();
  if (kind === 'rooted') {
    const reach = reachDownward(store, scope.roots, traversalTypesOf(scope));
    for (const id of reach) {
      const node = store.nodes.get(id);
      if (node && nodeOpenNow(node) && nodeTypeSet.has(node.type) && !excludedSet.has(id)) nodeScope.add(id);
    }
  } else {
    for (const node of store.nodes.values()) {
      if (nodeOpenNow(node) && nodeTypeSet.has(node.type) && !excludedSet.has(node.id)) nodeScope.add(node.id);
    }
  }
  return {
    kind,
    nodeScope,
    excludedSet,
    // Move protection (E39): with roots, nodes are never deletion candidates.
    nodeDeletionCandidatesAllowed: kind === 'full',
  };
}

// Edge deletion candidates on the pre-import stock (FR-5.5a(2)).
// moveOutCapable: (edgeType) => boolean from the source book (E70); entries
// for non-capable types are ignored (handled by the caller via warnings).
export function edgeDeletionCandidates(store, scope, membership, moveOutCapable) {
  const edgeTypeSet = new Set(scope.edgeTypes || []);
  const edgeSources = new Set(scope.edgeSources || []);
  const targets = scope.edgeTargets || {};
  const out = new Map(); // key -> edge identity
  for (const [key, edge] of store.edges) {
    if (!edgeTypeSet.has(edge.type)) continue;
    if (!edge.existence.some((iv) => iv.to === null)) continue; // only open DIRECT contributions are closure candidates (E52)
    if (membership.excludedSet.has(edge.source)) continue;
    if (membership.kind === 'full') {
      if (membership.nodeScope.has(edge.source)) out.set(key, edge);
      continue;
    }
    // rooted and enrichment: (a) visited source
    if (edgeSources.has(edge.source)) { out.set(key, edge); continue; }
    if (membership.kind !== 'rooted') continue;
    // rooted: (b) source in pre-import node scope AND target listed under this
    // edge type in edgeTargets AND the type is registered move-out capable.
    const listed = Array.isArray(targets[edge.type]) && targets[edge.type].includes(edge.target);
    if (listed && membership.nodeScope.has(edge.source) && moveOutCapable(edge.type)) out.set(key, edge);
  }
  return out;
}
