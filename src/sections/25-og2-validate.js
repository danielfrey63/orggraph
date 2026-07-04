// OrgGraph 2.0 engine — import preflight validation (FR-6.8).
// Runs completely BEFORE any mutation (FR-6.9a). Structural JSON-Schema
// validation happens at dev/test time (ajv, AK 11); this module enforces the
// semantic rules the schema cannot express, against tenant registry + stock.
import { canonicalJson, deepEqual, fnv1a64, isScalar, utcMinuteOf } from './21-og2-util.js';
import { endpointAllows, identityPropsOf, identityRelevantMismatches, propDeclsOf } from './22-og2-registry.js';
import { edgeKeyOf, nodeOpenNow, nodeValidAt } from './23-og2-store.js';
import { computeScopeMembership, crawlKindOf } from './24-og2-scope.js';

// Validate one snapshot against tenant registry and pre-import stock.
// Returns { errors, warnings, degraded, nodesById, edgesByKey, membership }.
export function validateSnapshot(snapshot, registry, store) {
  const errors = [];
  const warnings = [];
  const meta = snapshot.meta || {};
  const scope = meta.scope || {};
  const kind = crawlKindOf(scope);

  // --- meta / stamp consistency (E50, E62) ---
  if (!/^[a-z][a-z0-9-]*$/.test(String(meta.source))) errors.push(`meta.source "${meta.source}" is not a canonical source identifier (E62)`);
  const utcMinute = utcMinuteOf(meta.crawledAt);
  if (utcMinute === null) errors.push(`meta.crawledAt "${meta.crawledAt}" is not RFC3339 with explicit offset (E50)`);
  else if (utcMinute !== meta.snapshot) errors.push(`meta.snapshot "${meta.snapshot}" does not match the UTC minute of crawledAt (${utcMinute}) (E50)`);

  // --- scope structural rules (FR-5.5, E59) ---
  const edgeSources = scope.edgeSources || [];
  if ((kind === 'rooted' || kind === 'enrichment') && edgeSources.length === 0) {
    errors.push(`${kind} snapshot without non-empty scope.edgeSources (E59)`);
  }
  if ((scope.excluded || []).length > 0 && !(scope.traversalEdgeTypes || []).length) {
    errors.push('non-empty scope.excluded requires explicit non-empty traversalEdgeTypes (FR-5.5)');
  }
  let degraded = false;
  if (kind === 'rooted' && !scope.edgeTargets) {
    degraded = true;
    warnings.push('rooted full state without edgeTargets: no move-out detection (degraded import, FR-5.5)');
  }
  if (kind !== 'rooted' && scope.edgeTargets) {
    warnings.push('edgeTargets is ineffective outside rooted snapshots and is ignored (FR-5.5, E65)');
  }

  // --- registry subset: used types and props (FR-3.4, FR-6.8) ---
  const dataset = snapshot.schema || { nodeTypes: {}, edgeTypes: {} };
  const usedNodeTypes = new Set((snapshot.nodes || []).map((n) => n.type));
  const usedEdgeTypes = new Set((snapshot.edges || []).map((e) => e.type));
  for (const t of usedNodeTypes) {
    if (!(registry.nodeTypes || {})[t]) errors.push(`used node type "${t}" is unknown to the tenant registry (FR-6.8)`);
  }
  for (const t of usedEdgeTypes) {
    if (!(registry.edgeTypes || {})[t]) errors.push(`used edge type "${t}" is unknown to the tenant registry (FR-6.8)`);
  }
  for (const t of Object.keys(dataset.nodeTypes || {})) {
    if (!usedNodeTypes.has(t)) warnings.push(`dataset schema declares unused node type "${t}" (ignored, FR-3.4)`);
  }
  for (const t of Object.keys(dataset.edgeTypes || {})) {
    if (!usedEdgeTypes.has(t)) warnings.push(`dataset schema declares unused edge type "${t}" (ignored, FR-3.4)`);
  }

  // Identity-relevant registry skew (E38) — checked before any no-op decision.
  if (meta.registryVersion !== registry.version) {
    const mismatches = identityRelevantMismatches(dataset, registry).filter(
      (m) => [...usedEdgeTypes, ...usedNodeTypes].some((t) => m.includes(`"${t}"`))
    );
    if (mismatches.length) errors.push(...mismatches.map((m) => `registry skew (E38): ${m}`));
    else warnings.push(`snapshot registryVersion "${meta.registryVersion}" differs from tenant "${registry.version}" (non-identity-relevant, imported with warning)`);
  }

  // --- nodes: duplicates, id/type conflicts, props contract ---
  const nodesById = new Map();
  for (const node of snapshot.nodes || []) {
    const prev = nodesById.get(node.id);
    if (prev) {
      if (deepEqual(prev, node)) continue; // identical duplicate -> dedupe
      errors.push(`conflicting duplicate node records for id "${node.id}" (FR-6.8)`);
      continue;
    }
    const stock = store.nodes.get(node.id);
    if (stock && stock.type !== node.type) {
      errors.push(`id "${node.id}" already exists with type "${stock.type}", snapshot delivers "${node.type}" (E66/FR-5.2)`);
    }
    validateProps(node, (registry.nodeTypes || {})[node.type], `node "${node.id}"`, errors);
    nodesById.set(node.id, node);
  }
  // same id, different type WITHIN the snapshot is caught by the duplicate check above
  // (two records with equal id and different type are conflicting duplicates).

  // --- edges: identity, duplicates, endpoints, refs ---
  const nodeScopeTypes = new Set(scope.nodeTypes || []);
  const edgesByKey = new Map();
  const instant = meta.snapshot;
  for (const edge of snapshot.edges || []) {
    const decl = (registry.edgeTypes || {})[edge.type];
    if (!decl) continue; // unknown type already reported
    for (const ip of identityPropsOf(decl)) {
      if ((edge.props || {})[ip] === undefined) {
        errors.push(`edge ${edge.type} ${edge.source}->${edge.target}: missing identityProp "${ip}" (E15/FR-6.8)`);
      }
    }
    const key = edgeKeyOf(edge, decl);
    const prev = edgesByKey.get(key);
    if (prev) {
      if (deepEqual(prev, edge)) continue;
      errors.push(`conflicting duplicate edge records for identity ${key} (FR-6.8)`);
      continue;
    }
    edgesByKey.set(key, edge);
    validateProps(edge, decl, `edge ${key}`, errors);
    for (const [side, endpointDecl] of [['source', decl.from], ['target', decl.to]]) {
      const id = edge[side];
      const endpointErr = endpointValidity(id, endpointDecl, side, edge, nodesById, nodeScopeTypes, store, instant);
      if (endpointErr) errors.push(endpointErr);
    }
    // declared reference props point to existing nodes of the declared type
    const decls = propDeclsOf(decl);
    for (const [propName, pd] of Object.entries(decls)) {
      const v = (edge.props || {})[propName];
      if (pd.ref && v !== undefined && v !== null) {
        const refErr = endpointValidity(v, pd.ref, `ref "${propName}"`, edge, nodesById, nodeScopeTypes, store, instant);
        if (refErr) errors.push(refErr);
      }
    }
  }

  // --- membership + observation proofs (FR-6.8) ---
  const membership = computeScopeMembership(store, scope);
  const deliveredReach = reachViaDeliveredEdges(scope.roots || [], edgesByKey);
  for (const id of edgeSources) {
    const rec = nodesById.get(id);
    if (!rec) { errors.push(`edgeSources id "${id}" has no delivered node record (visited proof, FR-6.8)`); continue; }
    const fromCompatible = (scope.edgeTypes || []).some((t) => {
      const d = (registry.edgeTypes || {})[t];
      return d && endpointAllows(d.from, rec.type);
    });
    if (!fromCompatible) { errors.push(`edgeSources id "${id}": type "${rec.type}" is no valid from-type of any declared edgeType (FR-6.8)`); continue; }
    if (kind === 'rooted') {
      const isRoot = (scope.roots || []).includes(id);
      const reachable = deliveredReach.has(id);
      const moveIn = [...edgesByKey.values()].some((e) => e.source === id && (deliveredReach.has(e.target) || membership.nodeScope.has(e.target)));
      const preImport = membership.nodeScope.has(id);
      if (!isRoot && !reachable && !moveIn && !preImport) {
        errors.push(`edgeSources id "${id}" fails every visited proof (root/reachable/move-in/pre-import scope, FR-6.8)`);
      }
    }
  }
  if (kind === 'rooted' && scope.edgeTargets) {
    for (const [edgeType, ids] of Object.entries(scope.edgeTargets)) {
      if (!(scope.edgeTypes || []).includes(edgeType)) {
        errors.push(`edgeTargets key "${edgeType}" is not in scope.edgeTypes (FR-6.8)`);
        continue;
      }
      const decl = (registry.edgeTypes || {})[edgeType];
      for (const id of ids) {
        const rec = nodesById.get(id);
        if (!rec) { errors.push(`edgeTargets["${edgeType}"] id "${id}" has no delivered node record (FR-6.8)`); continue; }
        if (decl && !endpointAllows(decl.to, rec.type)) {
          errors.push(`edgeTargets["${edgeType}"] id "${id}": type "${rec.type}" is not allowed as to-endpoint of "${edgeType}" (FR-6.8)`);
          continue;
        }
        const proven = (scope.roots || []).includes(id) || deliveredReach.has(id) || membership.nodeScope.has(id);
        if (!proven) errors.push(`edgeTargets["${edgeType}"] id "${id}" fails every observation proof (FR-6.8)`);
      }
    }
  }

  return { errors, warnings, degraded, nodesById, edgesByKey, membership, kind };
}

function validateProps(record, typeDecl, label, errors) {
  const decls = propDeclsOf(typeDecl);
  for (const [k, v] of Object.entries(record.props || {})) {
    if (!isScalar(v)) errors.push(`${label}: props.${k} is not a scalar (FR-4.5)`);
    if (typeDecl && !Object.prototype.hasOwnProperty.call(decls, k)) {
      errors.push(`${label}: props key "${k}" is not declared in the tenant registry (propDecl required, FR-4.5/FR-6.8)`);
    }
  }
}

// Endpoint/reference validity at the snapshot instant (E35): the target is
// either a record in the snapshot or exists in the stock with an open version;
// reactivation of a closed identity is scope-bound (node-scope records only) —
// a closed identity delivered merely as out-of-scope stub never reactivates.
function endpointValidity(id, endpointDecl, side, edge, nodesById, nodeScopeTypes, store, instant) {
  const delivered = nodesById.get(id);
  const stock = store.nodes.get(id);
  const describe = `edge ${edge.type} ${edge.source}->${edge.target} ${side} "${id}"`;
  if (delivered) {
    if (!endpointAllows(endpointDecl, delivered.type)) return `${describe}: type "${delivered.type}" violates the endpoint declaration (FR-6.8)`;
    if (stock && !nodeOpenNow(stock) && !nodeValidAt(stock, instant) && !nodeScopeTypes.has(delivered.type)) {
      return `${describe}: closed identity delivered only as out-of-scope stub — reactivation is scope-bound (E61/FR-6.8)`;
    }
    return null;
  }
  if (!stock) return `${describe}: endpoint exists neither in snapshot nor in stock (E35/FR-6.8)`;
  if (!endpointAllows(endpointDecl, stock.type)) return `${describe}: stock type "${stock.type}" violates the endpoint declaration (FR-6.8)`;
  if (!nodeOpenNow(stock) && !nodeValidAt(stock, instant)) return `${describe}: endpoint is not valid at the snapshot instant (E35/FR-6.8)`;
  return null;
}

// Reachability from roots over DELIVERED snapshot edges, against the stored
// direction (target -> source), for the visited/observation proofs (FR-6.8).
function reachViaDeliveredEdges(roots, edgesByKey) {
  const childrenOf = new Map();
  for (const e of edgesByKey.values()) {
    if (!childrenOf.has(e.target)) childrenOf.set(e.target, []);
    childrenOf.get(e.target).push(e.source);
  }
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const child of childrenOf.get(id) || []) if (!seen.has(child)) queue.push(child);
  }
  return seen;
}

export function contentHashOf(snapshot) {
  // Canonical content hash (FR-6.9): factual payload only — schema, nodes,
  // edges, canonically sorted/serialized. Observation fields and trust
  // requests live in the identity key, metadata stays out entirely.
  const nodes = [...(snapshot.nodes || [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  const edges = [...(snapshot.edges || [])].sort((a, b) =>
    canonicalJson([a.type, a.source, a.target, a.props]) < canonicalJson([b.type, b.source, b.target, b.props]) ? -1 : 1
  );
  return fnv1a64(canonicalJson({ schema: snapshot.schema, nodes, edges }));
}
