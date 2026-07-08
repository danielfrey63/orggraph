// OrgGraph 2.0 engine — view path expression parser and registry-aware view
// validation (FR-7.1a, E19). Grammar:
//   view      := node-expr
//   node-expr := Typ [ "[" render "]" ] [ zweige ]
//   zweige    := hop | "(" hop { "," hop } ")"
//   hop       := "<--" Kantentyp "--" node-expr | "--" Kantentyp "-->" node-expr
//   render    := "node" | "cluster" | "hidden" | "ring" [":" ("prev"|"next")]
// Type names are path-safe identifiers (E58); a hop whose target type equals
// its start type is implicitly transitive (the WHOLE surrounding node-expr
// re-applies at the target).
import { endpointAllows, isPathSafeTypeName, propDeclsOf } from './22-og2-registry.js';

const RENDER_MODES = ['node', 'cluster', 'hidden', 'ring', 'ring:prev', 'ring:next'];

class PathSyntaxError extends Error {}

// Parse a path expression into { type, render, hops:[{dir:'<--'|'-->', edgeType, target:nodeExpr, selfHop:boolean}] }.
export function parsePathExpression(path) {
  const tokens = tokenize(String(path));
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (kind) => {
    const tk = next();
    if (!tk || tk.kind !== kind) throw new PathSyntaxError(`expected ${kind} at position ${tk ? tk.at : 'end'} in path`);
    return tk;
  };

  function parseNodeExpr() {
    const typeTk = expect('name');
    const node = { type: typeTk.value, render: 'node', hops: [] };
    if (peek() && peek().kind === '[') {
      next();
      const renderTk = expect('name');
      let render = renderTk.value;
      if (peek() && peek().kind === ':') { next(); render += ':' + expect('name').value; }
      if (!RENDER_MODES.includes(render)) throw new PathSyntaxError(`unknown render mode "${render}"`);
      node.render = render === 'ring' ? 'ring:prev' : render; // [ring] = [ring:prev] (E21)
      expect(']');
    }
    if (peek() && (peek().kind === '(' || peek().kind === '<--' || peek().kind === '--')) {
      if (peek().kind === '(') {
        next();
        node.hops.push(parseHop());
        while (peek() && peek().kind === ',') { next(); node.hops.push(parseHop()); }
        expect(')');
      } else {
        node.hops.push(parseHop());
      }
    }
    for (const hop of node.hops) hop.selfHop = hop.target.type === node.type;
    return node;
  }

  function parseHop() {
    const tk = next();
    if (tk && tk.kind === '<--') {
      const edge = expect('name');
      expect('--');
      return { dir: '<--', edgeType: edge.value, target: parseNodeExpr() };
    }
    if (tk && tk.kind === '--') {
      const edge = expect('name');
      expect('-->');
      return { dir: '-->', edgeType: edge.value, target: parseNodeExpr() };
    }
    throw new PathSyntaxError(`expected hop at position ${tk ? tk.at : 'end'}`);
  }

  const root = parseNodeExpr();
  if (pos !== tokens.length) throw new PathSyntaxError(`unexpected trailing input at position ${tokens[pos].at}`);
  return root;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const NAME_RE = /^\p{L}[\p{L}\p{N}_]*/u;
  while (i < src.length) {
    const rest = src.slice(i);
    if (/^\s/.test(rest)) { i++; continue; }
    if (rest.startsWith('<--')) { tokens.push({ kind: '<--', at: i }); i += 3; continue; }
    if (rest.startsWith('-->')) { tokens.push({ kind: '-->', at: i }); i += 3; continue; }
    if (rest.startsWith('--')) { tokens.push({ kind: '--', at: i }); i += 2; continue; }
    const one = rest[0];
    if (['(', ')', '[', ']', ',', ':'].includes(one)) { tokens.push({ kind: one, at: i }); i++; continue; }
    const m = NAME_RE.exec(rest);
    if (m) { tokens.push({ kind: 'name', value: m[0], at: i }); i += m[0].length; continue; }
    throw new PathSyntaxError(`unexpected character "${one}" at position ${i}`);
  }
  return tokens;
}

// Flatten the parsed tree into stations for attachment/validation walks:
// pre-order [{ type, render, viaHop }].
export function pathStations(root) {
  const out = [];
  const walk = (node, viaHop) => {
    out.push({ type: node.type, render: node.render, viaHop });
    for (const hop of node.hops) {
      if (hop.selfHop) continue; // transitive re-application, not a new station type chain
      walk(hop.target, hop);
    }
  };
  walk(root, null);
  return out;
}

export function visibleTypesOf(root) {
  const types = new Set();
  const walk = (node) => {
    if (node.render !== 'hidden') types.add(node.type);
    for (const hop of node.hops) walk(hop.target);
  };
  walk(root);
  return types;
}

export function allTypesOf(root) {
  const types = new Set();
  const walk = (node) => { types.add(node.type); for (const hop of node.hops) walk(hop.target); };
  walk(root);
  return types;
}

// Registry-aware validation of one view (FR-7.1a): grammar, type existence,
// from/to hop compatibility, __auto__ guard (E45), resolvable ring attachment
// (E21) and filter references (FR-7.8). Returns { ok, errors, parsed }.
export function validateView(view, registry) {
  const errors = [];
  let parsed = null;
  try {
    parsed = parsePathExpression(view.path);
  } catch (err) {
    return { ok: false, errors: [`path grammar: ${err.message}`], parsed: null };
  }

  const nodeTypes = registry.nodeTypes || {};
  const edgeTypes = registry.edgeTypes || {};

  const checkNode = (node, prevVisible) => {
    if (!isPathSafeTypeName(node.type) || !nodeTypes[node.type]) {
      errors.push(`unknown node type "${node.type}" (not in tenant registry)`);
    }
    for (const hop of node.hops) {
      const decl = edgeTypes[hop.edgeType];
      if (!decl) {
        errors.push(`unknown edge type "${hop.edgeType}" (not in tenant registry)`);
      } else {
        // <--E-- B : stored edge points from B (source) to the LEFT node
        // (target); --E--> B : stored edge points from the left node to B.
        const [fromType, toType] = hop.dir === '<--' ? [hop.target.type, node.type] : [node.type, hop.target.type];
        if (nodeTypes[fromType] && !endpointAllows(decl.from, fromType)) {
          errors.push(`hop ${node.type} ${hop.dir}${hop.edgeType}: "${fromType}" is no valid from-type of "${hop.edgeType}"`);
        }
        if (nodeTypes[toType] && !endpointAllows(decl.to, toType)) {
          errors.push(`hop ${node.type} ${hop.dir}${hop.edgeType}: "${toType}" is no valid to-type of "${hop.edgeType}"`);
        }
      }
      // only node/cluster stations count as ring attachment targets (E21)
      checkNode(hop.target, node.render === 'node' || node.render === 'cluster' ? true : prevVisible);
    }
    // ring attachment resolvability (E21): ring:prev needs a preceding
    // visible node station, ring:next a following one. In this tree shape a
    // ring station always follows its parent; ring:prev resolves when any
    // ancestor station is visible ('node'/'cluster'), ring:next when a
    // following visible station exists inside this subtree.
    if (node.render === 'ring:prev' && !prevVisible) {
      errors.push(`ring:prev at "${node.type}" has no preceding visible node station (E21)`);
    }
    if (node.render === 'ring:next') {
      const hasFollowingVisible = node.hops.some(function findVisible(hop) {
        const tNode = hop.target;
        if (tNode.render === 'node' || tNode.render === 'cluster') return true;
        return tNode.hops.some(findVisible);
      });
      if (!hasFollowingVisible) errors.push(`ring:next at "${node.type}" has no following visible node station (E21)`);
    }
  };
  checkNode(parsed, false);

  // __auto__ guard (E45): only allowed with EXACTLY ONE transitive self-hop
  // at the anchor.
  if ((view.roots || []).includes('__auto__')) {
    const selfHops = parsed.hops.filter((hop) => hop.selfHop);
    if (selfHops.length !== 1) {
      errors.push(`"__auto__" requires exactly one transitive self-hop at the anchor, found ${selfHops.length} (E45)`);
    }
  }

  // filter references (FR-7.8): type exists in the path, prop declared in the
  // registry (or "label"); ref operators only on declared reference props.
  const pathTypes = allTypesOf(parsed);
  const filters = view.filters || {};
  for (const [kindKey, typeMap] of [['nodes', nodeTypes], ['edges', edgeTypes]]) {
    for (const f of filters[kindKey] || []) {
      const declHolder = typeMap[f.type];
      if (!declHolder) { errors.push(`filter references unknown ${kindKey.slice(0, -1)} type "${f.type}"`); continue; }
      if (kindKey === 'nodes' && !pathTypes.has(f.type)) errors.push(`node filter type "${f.type}" does not occur in the path`);
      const decls = propDeclsOf(declHolder);
      const declared = f.prop === 'label' || Object.prototype.hasOwnProperty.call(decls, f.prop);
      if (!declared) errors.push(`filter prop "${f.prop}" is not declared for type "${f.type}"`);
      const isRefOp = f.op === 'refEq' || f.op === 'refIn';
      const isRefProp = decls[f.prop] && decls[f.prop].ref;
      if (isRefOp && !isRefProp) errors.push(`filter op "${f.op}" requires a declared reference prop, "${f.prop}" is scalar`);
      if (!isRefOp && isRefProp && f.op !== 'exists') errors.push(`scalar filter op "${f.op}" on reference prop "${f.prop}" — use refEq/refIn`);
    }
  }

  // view defaults (FR-7.5b): declarative start context for a first-time
  // entered view — same shape as the runtime context. Typos never fail
  // silently: unknown keys and wrong types reject the view (AK 84 style).
  if (view.defaults !== undefined) {
    const d = view.defaults;
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      errors.push('defaults must be an object');
    } else {
      const KNOWN = ['attributesOff', 'hiddenCategories', 'attributeFocus', 'clustersOff', 'asOf', 'diff'];
      for (const key of Object.keys(d)) {
        if (!KNOWN.includes(key)) errors.push(`unknown defaults key "${key}" (known: ${KNOWN.join(', ')})`);
      }
      const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
      for (const key of ['attributesOff', 'hiddenCategories', 'clustersOff']) {
        if (d[key] !== undefined && !isStringArray(d[key])) errors.push(`defaults.${key} must be an array of strings`);
      }
      if (d.attributeFocus !== undefined && typeof d.attributeFocus !== 'boolean') {
        errors.push('defaults.attributeFocus must be a boolean');
      }
      if (d.asOf !== undefined && typeof d.asOf !== 'string') {
        errors.push('defaults.asOf must be a snapshot instant string');
      }
      if (d.diff !== undefined && !(d.diff && typeof d.diff === 'object' && typeof d.diff.t1 === 'string' && typeof d.diff.t2 === 'string')) {
        errors.push('defaults.diff must be an object { t1, t2 } of instant strings');
      }
    }
  }

  return { ok: errors.length === 0, errors, parsed };
}

// Validate a whole VIEWS object (FR-7.1a): invalid views are rejected with a
// config error and hidden from the switcher; zero valid views => the app
// behaves as without VIEWS (diagnosis projection) plus a config error report.
export function validateViews(views, registry) {
  const valid = {};
  const rejected = {};
  for (const [name, view] of Object.entries(views || {})) {
    const res = validateView(view, registry);
    if (res.ok) valid[name] = { ...view, parsed: res.parsed };
    else rejected[name] = res.errors;
  }
  return { valid, rejected, anyValid: Object.keys(valid).length > 0 };
}
