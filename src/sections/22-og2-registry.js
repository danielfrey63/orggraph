// OrgGraph 2.0 engine — registry access and self-consistency gate (FR-4.1).
// The registry is data; this module never names a concrete type (NFR-5).
import { isValidInstant } from './21-og2-util.js';

const TYPE_NAME_RE = /^\p{L}[\p{L}\p{N}_]*$/u;

export function isPathSafeTypeName(name) {
  return typeof name === 'string' && TYPE_NAME_RE.test(name);
}

// Endpoint declaration ("*", type name, or array of type names) as a matcher.
export function endpointAllows(endpoint, typeName) {
  if (endpoint === '*') return true;
  if (Array.isArray(endpoint)) return endpoint.includes('*') || endpoint.includes(typeName);
  return endpoint === typeName;
}

export function endpointTypes(endpoint) {
  if (endpoint === '*') return ['*'];
  return Array.isArray(endpoint) ? endpoint : [endpoint];
}

// endpoint A is a subset of endpoint B (for implies compatibility, FR-4.1).
export function endpointSubset(a, b) {
  const bt = endpointTypes(b);
  if (bt.includes('*')) return true;
  const at = endpointTypes(a);
  if (at.includes('*')) return false;
  return at.every((t) => bt.includes(t));
}

// A label/identifier path is well-formed when it is "id", "label" or a
// single-level "props.<key>" path (FR-4.1, FR-4.2b).
export function isWellFormedFieldPath(path) {
  return path === 'id' || path === 'label' || /^props\.[^.]+$/.test(String(path));
}

export function propDeclsOf(typeDecl) {
  return (typeDecl && typeDecl.props) || {};
}

// identityProps in registry declaration order — the order is normative for
// the canonical edge key (FR-6.3, PRD round 7 item 8).
export function identityPropsOf(edgeDecl) {
  return (edgeDecl && edgeDecl.identityProps) || [];
}

// Self-consistency gate over a registry object (FR-4.1). Returns a list of
// human-readable problems; an empty list means the registry is commit-valid.
// This runs IN ADDITION to JSON-Schema validation, which cannot express
// cross-references.
export function registryConsistencyProblems(registry) {
  const problems = [];
  if (!registry || typeof registry !== 'object') return ['registry is not an object'];
  const nodeTypes = registry.nodeTypes || {};
  const edgeTypes = registry.edgeTypes || {};
  if (typeof registry.version !== 'string') problems.push('missing version');

  const nodeTypeExists = (t) => t === '*' || Object.prototype.hasOwnProperty.call(nodeTypes, t);

  for (const [name, decl] of Object.entries(nodeTypes)) {
    if (!isPathSafeTypeName(name)) problems.push(`node type "${name}" is not a path-safe identifier (E58)`);
    checkFieldPaths(name, decl, problems);
    for (const [propName, propDecl] of Object.entries(propDeclsOf(decl))) {
      if (propDecl.ref && !nodeTypeExists(propDecl.ref)) {
        problems.push(`node type "${name}" prop "${propName}": ref target "${propDecl.ref}" is not a declared node type`);
      }
      if (propDecl.implies) {
        problems.push(`node type "${name}" prop "${propName}": implies is edge-only (E63)`);
      }
    }
  }

  for (const [name, decl] of Object.entries(edgeTypes)) {
    if (!isPathSafeTypeName(name)) problems.push(`edge type "${name}" is not a path-safe identifier (E58)`);
    for (const side of ['from', 'to']) {
      for (const t of endpointTypes(decl[side] ?? '*')) {
        if (!nodeTypeExists(t)) problems.push(`edge type "${name}" ${side}: "${t}" is not a declared node type`);
      }
    }
    const decls = propDeclsOf(decl);
    for (const ip of identityPropsOf(decl)) {
      if (!Object.prototype.hasOwnProperty.call(decls, ip)) {
        problems.push(`edge type "${name}": identityProp "${ip}" is not a declared prop of this edge type`);
      }
    }
    for (const [propName, propDecl] of Object.entries(decls)) {
      if (propDecl.ref && !nodeTypeExists(propDecl.ref)) {
        problems.push(`edge type "${name}" prop "${propName}": ref target "${propDecl.ref}" is not a declared node type`);
      }
      if (propDecl.implies) {
        const implied = edgeTypes[propDecl.implies];
        if (!implied) {
          problems.push(`edge type "${name}" prop "${propName}": implies target "${propDecl.implies}" is not a declared edge type`);
        } else {
          // from of the carrier edge must fit the implied edge's from; the
          // ref target type must fit the implied edge's to (FR-4.1).
          if (!endpointSubset(decl.from, implied.from)) {
            problems.push(`edge type "${name}" prop "${propName}": carrier from is not a subset of implied "${propDecl.implies}" from`);
          }
          if (propDecl.ref && !endpointAllows(implied.to, propDecl.ref)) {
            problems.push(`edge type "${name}" prop "${propName}": ref type "${propDecl.ref}" is not allowed as to of implied "${propDecl.implies}"`);
          }
        }
      }
    }
  }
  return problems;
}

/* v8 ignore start */
function checkFieldPaths(name, decl, problems) {
  if (decl.labelProp !== undefined && !isWellFormedFieldPath(decl.labelProp)) {
    problems.push(`node type "${name}": labelProp "${decl.labelProp}" is not a well-formed field path`);
  }
  for (const idPath of decl.identifiers || []) {
    if (!isWellFormedFieldPath(idPath)) {
      problems.push(`node type "${name}": identifier path "${idPath}" is not a well-formed field path`);
    }
  }
}
/* v8 ignore stop */

// Identity-relevant deviation between the snapshot's embedded schema and the
// tenant registry (E38, FR-6.1b): identityProps, from/to endpoints, ref and
// implies of USED types must match exactly; anything else is at most a warning.
export function identityRelevantMismatches(snapshotSchema, registry) {
  const out = [];
  for (const [name, decl] of Object.entries(snapshotSchema.edgeTypes || {})) {
    const reg = (registry.edgeTypes || {})[name];
    if (!reg) continue; // unknown used types are handled by subset validation
    if (JSON.stringify(identityPropsOf(decl)) !== JSON.stringify(identityPropsOf(reg))) {
      out.push(`edge type "${name}": identityProps deviate from tenant registry`);
    }
    for (const side of ['from', 'to']) {
      if (JSON.stringify(endpointTypes(decl[side])) !== JSON.stringify(endpointTypes(reg[side]))) {
        out.push(`edge type "${name}": ${side} endpoints deviate from tenant registry`);
      }
    }
    out.push(...refImpliesMismatches(name, decl, reg));
  }
  for (const [name, decl] of Object.entries(snapshotSchema.nodeTypes || {})) {
    const reg = (registry.nodeTypes || {})[name];
    if (!reg) continue;
    out.push(...refImpliesMismatches(`node type ${name}`, decl, reg));
  }
  return out;
}

function refImpliesMismatches(name, decl, reg) {
  const out = [];
  const declProps = propDeclsOf(decl);
  const regProps = propDeclsOf(reg);
  for (const [propName, p] of Object.entries(declProps)) {
    const r = regProps[propName];
    if (!r) continue;
    if ((p.ref || null) !== (r.ref || null)) out.push(`"${name}" prop "${propName}": ref deviates from tenant registry`);
    if ((p.implies || null) !== (r.implies || null)) out.push(`"${name}" prop "${propName}": implies deviates from tenant registry`);
  }
  return out;
}

export function assertValidStamp(stamp) {
  if (!isValidInstant(stamp)) throw new Error(`invalid snapshot stamp: ${stamp}`);
  return stamp;
}
