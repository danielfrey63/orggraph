// OrgGraph 2.0 — in-app list intake (PRD E74): turns a plain identifier
// list (e-mails, ids, one per line or TSV/CSV) into an ENRICHMENT snapshot
// the regular import pipeline consumes — nodeTypes [], one edge type, the
// matched members as edgeSources (E30). Every list runs as its own source
// (`liste-<kategorie>`), so a re-imported list is the full state of exactly
// that attribute: a member missing from the list loses the edge, while other
// lists and other sources are never touched (source partition, E37).
//
// Identifier matching happens HERE, before the snapshot exists — never inside
// the import (FR-5.2: node identity is the id alone; `identifiers` are a
// pre-export matching aid, FR-4.2). Exact matches over the registry's
// identifier paths; fuzzy candidates are proposals the user confirms.
//
// DOM-free: shared by the dialog (32) and the unit tests; type names arrive as
// data (NFR-5) — no canonical type name appears in this file.
import { canonicalJson, slug, normalizedDistance, sortedUnique, utcMinuteOf } from './21-og2-util.js';
import { endpointAllows } from './22-og2-registry.js';
import { nodeOpenNow, openExistence, openInterval } from './23-og2-store.js';
import { resolveDisplayLabel } from './28-og2-project.js';
import { resolveRingGroup } from './29-og2-app.js';

// ---- list parsing ---------------------------------------------------------

// Header aliases (lower-case). A first row carrying an identifier alias in
// ANY cell is a header. Identifier priority: a key column (e-mail, id) beats
// a name column wherever it stands; name columns are never attributes.
// With explicit value/category columns the file is the LONG form (one list,
// value/category per row); otherwise every remaining column is its own list
// (WIDE form): boolean columns (WAHR/FALSCH, ja/nein, x/leer …) mean
// membership, text columns mean category + value per row. Without a header
// the columns are positional: [identifier], [identifier, value] or
// [identifier, category, value] (the legacy attribute-TSV shapes).
const LIST_HEADERS = {
  key: ['email', 'e-mail', 'mail', 'mailadresse', 'e-mail-adresse', 'id', 'identifier', 'kennung'],
  name: ['name', 'person', 'teilnehmer', 'teilnehmerin', 'mitglied', 'vorname', 'nachname', 'vorname nachname', 'nachname vorname'],
  value: ['wert', 'value', 'attribut', 'attribute', 'label', 'bezeichnung'],
  category: ['kategorie', 'category', 'klasse', 'kohorte', 'cohort', 'kurs', 'training', 'liste'],
};
const BOOL_TRUE = new Set(['wahr', 'true', 'ja', 'yes', 'x', '1', 'y', 'j']);
const BOOL_FALSE = new Set(['falsch', 'false', 'nein', 'no', '0', '', 'n', '-']);

function splitDelimited(line, delim) {
  if (delim === '\t') return line.split('\t');
  const out = [];
  let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

function detectDelimiter(line) {
  if (line.includes('\t')) return '\t';
  const semi = line.split(';').length, comma = line.split(',').length;
  if (semi > 1 && semi >= comma) return ';';
  if (comma > 1) return ',';
  return null;
}

// Parse a list file into lists [{ category, kind, rows: [{ identifier,
// value, category? }] }]. `fileStem` (file name without extension) is the
// default category, like the legacy attribute files whose name was the
// category (README v1). kind: 'list' (long form / no header), 'boolean'
// (membership column) or 'value' (text column) — wide files yield one list
// per attribute column.
export function parseListText(text, fileStem = '') {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) return { lists: [], delimiter: null, header: false };
  const delimiter = detectDelimiter(lines[0]);
  const cells = (l) => (delimiter ? splitDelimited(l, delimiter) : [l]).map((c) => c.trim());
  const headerCells = cells(lines[0]);
  const first = headerCells.map((c) => c.toLowerCase());
  const find = (aliases) => { const i = first.findIndex((h) => aliases.includes(h)); return i >= 0 ? i : null; };
  const keyCol = find(LIST_HEADERS.key);
  const nameCol = find(LIST_HEADERS.name);
  const header = keyCol !== null || nameCol !== null;
  const body = lines.slice(header ? 1 : 0).map(cells);

  const longForm = (cols, category) => {
    const rows = [];
    for (const c of body) {
      const identifier = c[cols.identifier] || '';
      if (!identifier) continue;
      const row = { identifier, value: cols.value !== null ? (c[cols.value] || '') : '' };
      if (cols.category !== null && c[cols.category]) row.category = c[cols.category];
      rows.push(row);
    }
    return { lists: [{ category, kind: 'list', rows }], delimiter, header };
  };

  if (!header) {
    const width = headerCells.length;
    const cols = { identifier: 0, value: width === 2 ? 1 : width >= 3 ? 2 : null, category: width >= 3 ? 1 : null };
    return longForm(cols, fileStem);
  }

  const identifier = keyCol ?? nameCol; // key column beats a name column
  const valueCol = find(LIST_HEADERS.value);
  const categoryCol = find(LIST_HEADERS.category);
  if (valueCol !== null || categoryCol !== null) {
    return longForm({ identifier, value: valueCol, category: categoryCol }, fileStem);
  }

  // Wide form: every column that is neither the identifier nor a name is an
  // attribute of its own; the header text is the category.
  const lists = [];
  const isName = (i) => LIST_HEADERS.name.includes(first[i]) || LIST_HEADERS.key.includes(first[i]);
  for (let col = 0; col < headerCells.length; col++) {
    if (col === identifier || isName(col) || !headerCells[col]) continue;
    const values = body.map((c) => (c[col] || '').toLowerCase());
    const boolean = values.every((v) => BOOL_TRUE.has(v) || BOOL_FALSE.has(v)) && values.some((v) => BOOL_TRUE.has(v));
    const rows = [];
    body.forEach((c, i) => {
      const id = c[identifier] || '';
      if (!id) return;
      if (boolean) { if (BOOL_TRUE.has(values[i])) rows.push({ identifier: id, value: '' }); }
      else if (c[col]) rows.push({ identifier: id, value: c[col] });
    });
    lists.push({ category: headerCells[col], kind: boolean ? 'boolean' : 'value', rows });
  }
  // a header with only identifier/name columns is a plain member list
  if (!lists.length) lists.push({ category: fileStem, kind: 'list', rows: body.filter((c) => c[identifier]).map((c) => ({ identifier: c[identifier], value: '' })) });
  return { lists, delimiter, header };
}

// ---- identity resolution ----------------------------------------------------

function openLabelOf(identity) {
  const tl = identity.timelines.get('label');
  const open = tl ? openInterval(tl) : null;
  return open ? open.value : undefined;
}

function openPropOf(identity, name) {
  const tl = identity.timelines.get(`props.${name}`);
  const open = tl ? openInterval(tl) : null;
  return open ? open.value : undefined;
}

// Resolver over the OPEN identities of `type` (FR-10.4 semantics in-app):
// exact hit on id or any registry identifier path (case-insensitive) — an
// identifier value shared by several identities is ambiguous, never a silent
// pick; otherwise fuzzy candidates (normalized Levenshtein <= threshold on
// label, identifier values and the e-mail local part read as a name), one
// unambiguous candidate becomes a PROPOSAL (status 'fuzzy'), several stay
// 'ambiguous', none 'unmatched'.
export function buildIdentityResolver(store, registry, type, { threshold = 0.3 } = {}) {
  const decl = (registry.nodeTypes || {})[type] || {};
  const paths = (decl.identifiers || []).map((p) => /^props\.([^.]+)$/.exec(String(p))).filter(Boolean).map((m) => m[1]);
  const persons = [];
  const exact = new Map();     // lower-cased key -> id | false (ambiguous)
  const put = (key, id) => {
    const k = String(key).trim().toLowerCase();
    if (!k) return;
    const prev = exact.get(k);
    if (prev === undefined) exact.set(k, id);
    else if (prev !== id) exact.set(k, false);
  };
  for (const identity of store.nodes.values()) {
    if (identity.type !== type || !nodeOpenNow(identity)) continue;
    const label = openLabelOf(identity);
    const idents = [];
    for (const p of paths) {
      const v = openPropOf(identity, p);
      if (typeof v === 'string' && v) { idents.push(v); put(v, identity.id); }
    }
    put(identity.id, identity.id);
    persons.push({ id: identity.id, label: label === undefined ? identity.id : String(label), idents });
  }
  const byId = new Map(persons.map((p) => [p.id, p]));
  const resolve = (identifier) => {
    const raw = String(identifier || '').trim();
    const lower = raw.toLowerCase();
    if (!lower) return { status: 'unmatched', candidates: [] };
    const hit = exact.get(lower);
    if (typeof hit === 'string') return { status: 'exact', id: hit, label: byId.get(hit).label, candidates: [] };
    const asName = lower.split('@')[0].replace(/[._-]+/g, ' ');
    const candidates = [];
    for (const p of persons) {
      const label = p.label.toLowerCase();
      let d = Math.min(normalizedDistance(asName, label), normalizedDistance(lower, label));
      for (const v of p.idents) d = Math.min(d, normalizedDistance(lower, v.toLowerCase()));
      if (d <= threshold) candidates.push({ id: p.id, label: p.label, dist: Number(d.toFixed(3)) });
    }
    candidates.sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : 1));
    if (hit === false) return { status: 'ambiguous', candidates: candidates.slice(0, 5) };
    if (candidates.length === 1 || (candidates.length > 1 && candidates[0].dist === 0 && candidates[1].dist > 0)) {
      return { status: 'fuzzy', id: candidates[0].id, label: candidates[0].label, candidates: candidates.slice(0, 5) };
    }
    return { status: candidates.length ? 'ambiguous' : 'unmatched', candidates: candidates.slice(0, 5) };
  };
  return { resolve, persons, labelOf: (id) => (byId.get(id) || {}).label };
}

// ---- model helpers ------------------------------------------------------------

// Canonical source id of a list (E62 pattern ^[a-z][a-z0-9-]*$): the prefix
// guarantees the leading letter even for numeric categories.
export function listSourceId(category) {
  return `liste-${slug(category) || 'ohne-name'}`;
}

// E72: container node identity = category + value; an empty value falls
// back to the category (node = the category itself). Source-namespaced
// fallback id per E41/E56. Shared with the legacy migration.
export function containerNodeOf(source, type, category, value, categoryProp) {
  const val = String(value || '').trim();
  const id = val
    ? `${source}:${type}:${slug(category)}--${slug(val)}`
    : `${source}:${type}:${slug(category)}`;
  const node = { id, type, label: val || category, props: {} };
  if (categoryProp) node.props[categoryProp] = category;
  return node;
}

function groupPropName(typeDecl) {
  const m = typeDecl && typeDecl.groupProp ? /^props\.([^.]+)$/.exec(String(typeDecl.groupProp)) : null;
  return m ? m[1] : null;
}

// Members whose open edges of `edgeType` carry this source's provenance —
// they were visited by an earlier list of the same source and must stay in
// edgeSources so that leaving the list closes the edge (full-state semantics).
export function priorEdgeSources(store, source, edgeType) {
  const out = new Set();
  for (const edge of store.edges.values()) {
    if (edge.type !== edgeType) continue;
    const open = openExistence(edge);
    if (open && open.provenance && Object.prototype.hasOwnProperty.call(open.provenance, source)) out.add(edge.source);
  }
  return [...out].sort();
}

// Edge types a list of `memberType` members can carry: from allows the
// member type, to is exactly one type. `hasGroup` marks targets whose type
// groups the legend by a property (category + value lists, E74).
export function listEdgeTypes(registry, memberType) {
  const out = [];
  for (const [edgeType, decl] of Object.entries(registry.edgeTypes || {})) {
    if (!endpointAllows(decl.from, memberType) || typeof decl.to !== 'string' || decl.to === '*') continue;
    const targetDecl = (registry.nodeTypes || {})[decl.to] || {};
    out.push({ edgeType, targetType: decl.to, groupProp: groupPropName(targetDecl) });
  }
  return out.sort((a, b) => (a.edgeType < b.edgeType ? -1 : 1));
}

// Open target nodes of `type` as dialog choices: { id, label, group } with the
// group resolved like the ring legend (type name or groupProp value).
export function existingTargets(store, registry, type) {
  const decl = (registry.nodeTypes || {})[type] || {};
  const out = [];
  for (const identity of store.nodes.values()) {
    if (identity.type !== type || !nodeOpenNow(identity)) continue;
    const stand = { label: openLabelOf(identity), props: {} };
    for (const [prop, tl] of identity.timelines) {
      if (!prop.startsWith('props.')) continue;
      const open = openInterval(tl);
      if (open) stand.props[prop.slice(6)] = open.value;
    }
    const label = resolveDisplayLabel(decl, stand);
    out.push({ id: identity.id, label: label === undefined ? identity.id : String(label), group: resolveRingGroup(type, decl, stand) });
  }
  return out.sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : a.label < b.label ? -1 : 1));
}

// ---- snapshot builder ----------------------------------------------------------

// Build the enrichment snapshot of one list. `resolveId(identifier)` returns
// the member id or null (the dialog has already applied the user's fuzzy
// decisions); `labelOf(id)` yields the canonical stored label reused in the
// visited-proof stubs (E61: a stub never rewrites the label). `priorSources`
// are members of earlier lists of this source (priorEdgeSources).
// `existing` (existingTargets of the target type) lets a chosen value reuse
// the stock's node instead of minting a source-namespaced twin: same group
// and label → same identity (the Rolle concept space is tenant-wide, E73).
// Edges carry every identity prop of the type explicitly as null (E15: an
// omitted identity prop is rejected by the preflight).
export function buildListSnapshot({ source, at, registry, rows, category, value = '', edgeType, memberType, resolveId, labelOf, priorSources = [], existing = [] }) {
  const stamp = utcMinuteOf(at);
  if (!stamp) throw new Error(`at must be RFC3339 with offset or Z (E50): ${at}`);
  const edgeDecl = (registry.edgeTypes || {})[edgeType];
  if (!edgeDecl) throw new Error(`unknown edge type: ${edgeType}`);
  const targetType = edgeDecl.to;
  const categoryProp = groupPropName((registry.nodeTypes || {})[targetType]);
  const identityProps = {};
  for (const p of edgeDecl.identityProps || []) identityProps[p] = null;
  const reuse = new Map();
  for (const t of existing) reuse.set(categoryProp ? `${t.group}::${t.label}` : t.label, t);

  const nodes = new Map();
  const edges = new Map();
  const members = new Set();
  const matched = [];
  const unmatched = [];
  const stub = (id) => {
    if (nodes.has(id)) return;
    const label = labelOf ? labelOf(id) : undefined;
    nodes.set(id, { id, type: memberType, label: label === undefined ? id : String(label) });
  };
  const targetOf = (cat, val) => {
    const fresh = containerNodeOf(source, targetType, cat, val, categoryProp);
    const hit = reuse.get(categoryProp ? `${cat}::${fresh.label}` : fresh.label);
    if (!hit) return fresh;
    return { ...fresh, id: hit.id, label: hit.label };
  };
  for (const row of rows) {
    const id = resolveId(row.identifier);
    if (!id) { unmatched.push({ identifier: row.identifier, value: row.value || '', category: row.category || category }); continue; }
    const container = targetOf(row.category || category, row.value || value);
    nodes.set(container.id, container);
    stub(id);
    members.add(id);
    matched.push({ identifier: row.identifier, id, target: container.id });
    const e = { type: edgeType, source: id, target: container.id };
    if (Object.keys(identityProps).length) e.props = { ...identityProps };
    edges.set(canonicalJson([e.type, e.source, e.target]), e);
  }
  for (const id of priorSources) { stub(id); members.add(id); }

  const usedNodeTypes = sortedUnique([...nodes.values()].map((n) => n.type));
  const schema = { nodeTypes: {}, edgeTypes: { [edgeType]: edgeDecl } };
  for (const t of usedNodeTypes) schema.nodeTypes[t] = (registry.nodeTypes || {})[t] || {};

  const snapshot = {
    meta: {
      source,
      crawledAt: at,
      snapshot: stamp,
      registryVersion: registry.version,
      sourceUrl: `Liste «${category}» (App-Import)`,
      scope: { nodeTypes: [], edgeTypes: [edgeType], edgeSources: [...members].sort() },
    },
    schema,
    nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    edges: [...edges.values()].sort((a, b) =>
      canonicalJson([a.type, a.source, a.target]) < canonicalJson([b.type, b.source, b.target]) ? -1 : 1),
  };
  return { snapshot, matched, unmatched, members: [...members].sort() };
}

// ---- view helper -----------------------------------------------------------------

// Extend a view path by a ring hop for `edgeType` at its first station when
// that station is the member type (E74: a freshly imported list must be
// visible without hand-editing env.json). Returns the new path, or null when
// the hop is already present or the path does not start at the member type;
// the caller validates the result against the registry before applying it.
export function extendPathWithRing(path, memberType, edgeType, targetType) {
  const p = String(path || '').trim();
  if (p.includes(`--${edgeType}-->`)) return null;
  const hop = `--${edgeType}--> ${targetType}[ring]`;
  const head = new RegExp(`^${memberType}(?![\\p{L}\\p{N}_])`, 'u');
  if (!head.test(p)) return null;
  const rest = p.slice(memberType.length).trim();
  if (!rest) return `${memberType} (${hop})`;
  // "Type ( ... )" with the group closing the whole path → append a branch.
  if (rest.startsWith('(') && rest.endsWith(')')) {
    let depth = 0, closesAtEnd = false;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '(') depth++;
      else if (rest[i] === ')') { depth--; if (depth === 0) closesAtEnd = i === rest.length - 1; }
    }
    if (closesAtEnd) return `${memberType} (${rest.slice(1, -1).trim()}, ${hop})`;
  }
  return `${memberType} (${rest}, ${hop})`;
}
