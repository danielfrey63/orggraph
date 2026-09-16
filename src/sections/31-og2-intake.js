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

// ---- identifier fingerprint ---------------------------------------------------

const EMAIL_RE = /^[\w.+-]+@([\w-]+\.)+[\w-]{2,}$/i;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Generalize REAL identifier values into a few anchored regexes: every
// value containing "@" contributes to the e-mail pattern; the others are
// grouped by their literal prefix (letters/punctuation before the variable
// part, e.g. "p-" of "p-4889730") and the character class of the rest
// ("\d+", "[A-Za-z0-9]+", "[\w.-]+"). A group needs two values, and a
// pattern without any literal anchor that would match arbitrary words is
// dropped — patterns decide which COLUMN holds identifiers, never a single
// row's assignment (that stays exact or user-confirmed).
export function derivePatterns(values) {
  const vals = [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))];
  // one group per literal prefix; the rest widens to the broadest class seen
  // (digits ⊂ alphanumerics ⊂ word characters), so "p-4889730" and
  // "p-20J5K845J" yield ONE pattern ^p-[A-Za-z0-9]+$
  const CLASSES = ['\\d+', '[A-Za-z0-9]+', '[\\w.-]+'];
  const groups = new Map(); // prefix -> { rank, n }
  let emails = 0;
  for (const v of vals) {
    if (v.includes('@')) { emails++; continue; }
    const m = /^(?:[^\p{N}]*?[^\p{L}\p{N}]|\p{L}+(?=\p{N}))/u.exec(v);
    const prefix = m ? m[0] : '';
    const rest = v.slice(prefix.length);
    const rank = /^\d+$/.test(rest) ? 0 : /^[A-Za-z0-9]+$/.test(rest) ? 1 : 2;
    const g = groups.get(prefix) || { rank: 0, n: 0 };
    g.rank = Math.max(g.rank, rank);
    g.n++;
    groups.set(prefix, g);
  }
  const out = [];
  if (emails >= 2) out.push(EMAIL_RE.source);
  for (const [prefix, g] of groups) {
    if (g.n < 2) continue;
    if (!prefix && g.rank > 0) continue; // no anchor: would match any word
    out.push(`^${escapeRe(prefix)}${CLASSES[g.rank]}$`);
  }
  return out.sort();
}

// Fingerprint of the open identities of `type`: exact values (id, id tail
// without the source namespace, identifier props — lower-cased) and the
// patterns derived from them. Used to find the identifier column of a
// table without relying on header names.
export function buildIdentifierFingerprint(store, registry, type) {
  const decl = (registry.nodeTypes || {})[type] || {};
  const paths = (decl.identifiers || []).map((p) => /^props\.([^.]+)$/.exec(String(p))).filter(Boolean).map((m) => m[1]);
  const exact = new Set();
  const raw = [];
  for (const identity of store.nodes.values()) {
    if (identity.type !== type || !nodeOpenNow(identity)) continue;
    const tail = identity.id.includes(':') ? identity.id.slice(identity.id.lastIndexOf(':') + 1) : identity.id;
    exact.add(identity.id.toLowerCase());
    exact.add(tail.toLowerCase());
    raw.push(tail);
    for (const p of paths) {
      const v = openPropOf(identity, p);
      if (typeof v === 'string' && v) { exact.add(v.toLowerCase()); raw.push(v); }
    }
  }
  const patterns = derivePatterns(raw).map((src) => new RegExp(src, 'i'));
  const hit = (cell) => {
    const v = String(cell ?? '').trim();
    if (!v) return null;
    if (exact.has(v.toLowerCase())) return 'exact';
    return patterns.some((re) => re.test(v)) ? 'pattern' : null;
  };
  return { type, exact, patterns, hit, empty: exact.size === 0 };
}

// Score every column of a cell matrix: exact hits count fully, pattern hits
// half, over the non-empty cells. Returns the columns sorted best first.
export function scoreColumns(matrix, fingerprint) {
  const width = Math.max(0, ...matrix.map((r) => r.length));
  const out = [];
  for (let col = 0; col < width; col++) {
    let nonEmpty = 0, exact = 0, pattern = 0;
    for (const row of matrix) {
      const v = String(row[col] ?? '').trim();
      if (!v) continue;
      nonEmpty++;
      const h = fingerprint.hit(v);
      if (h === 'exact') exact++; else if (h === 'pattern') pattern++;
    }
    out.push({ col, nonEmpty, exact, pattern, score: nonEmpty ? (exact + 0.5 * pattern) / nonEmpty : 0 });
  }
  return out.sort((a, b) => b.score - a.score || b.exact - a.exact || a.col - b.col);
}

// ---- list parsing ---------------------------------------------------------------

// Parse a list file into lists [{ category, kind, rows: [{ identifier,
// value, category? }] }]. `fileStem` (file name without extension) is the
// default category, like the legacy attribute files whose name was the
// category (README v1). kind: 'list' (long form / no header), 'boolean'
// (membership column) or 'value' (text column) — wide files yield one list
// per attribute column. With a `fingerprint` (buildIdentifierFingerprint)
// the identifier column is the one whose cells look like known identifiers
// (exact values or derived patterns); header aliases only break ties. The
// result reports the detection (`detected`) for the dialog.
export function parseListText(text, fileStem = '', fingerprint = null) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) return { lists: [], delimiter: null, header: false, detected: null };
  const delimiter = detectDelimiter(lines[0]);
  const cells = (l) => (delimiter ? splitDelimited(l, delimiter) : [l]).map((c) => c.trim());
  const matrix = lines.map(cells);
  const headerCells = matrix[0];
  const first = headerCells.map((c) => c.toLowerCase());
  const find = (aliases) => { const i = first.findIndex((h) => aliases.includes(h)); return i >= 0 ? i : null; };
  const keyCol = find(LIST_HEADERS.key);
  const nameCol = find(LIST_HEADERS.name);
  const aliasHeader = keyCol !== null || nameCol !== null;

  // Fingerprint detection: best-scoring column with at least two hits and
  // half of its cells recognized; the first row is a header when its cell
  // in that column is no identifier while the column otherwise is.
  let detected = null;
  if (fingerprint && !fingerprint.empty) {
    const best = scoreColumns(matrix, fingerprint)[0];
    if (best && best.exact + best.pattern >= 2 && best.score >= 0.5) {
      const firstHit = fingerprint.hit(headerCells[best.col]);
      const isHeader = aliasHeader || !firstHit;
      // report the data cells only (the header cell is no identifier)
      const headerCell = isHeader && String(headerCells[best.col] || '').trim() ? 1 : 0;
      detected = { column: best.col, header: isHeader, label: headerCells[best.col], exact: best.exact, pattern: best.pattern, nonEmpty: best.nonEmpty - headerCell };
    }
  }
  const header = detected ? detected.header : aliasHeader;
  const body = matrix.slice(header ? 1 : 0);
  const identifier = detected ? detected.column : (keyCol ?? nameCol ?? 0); // key column beats a name column

  const longForm = (cols, category) => {
    const rows = [];
    for (const c of body) {
      const id = c[cols.identifier] || '';
      if (!id) continue;
      const row = { identifier: id, value: cols.value !== null ? (c[cols.value] || '') : '' };
      if (cols.category !== null && c[cols.category]) row.category = c[cols.category];
      rows.push(row);
    }
    return { lists: [{ category, kind: 'list', rows }], delimiter, header, detected };
  };

  if (!header) {
    const width = headerCells.length;
    let cols;
    if (identifier === 0) cols = { identifier: 0, value: width === 2 ? 1 : width >= 3 ? 2 : null, category: width >= 3 ? 1 : null };
    else cols = { identifier, value: width >= 2 ? (identifier === 1 ? 0 : 1) : null, category: null };
    return longForm(cols, fileStem);
  }

  const valueCol = find(LIST_HEADERS.value);
  const categoryCol = find(LIST_HEADERS.category);
  if (valueCol !== null || categoryCol !== null) {
    return longForm({ identifier, value: valueCol, category: categoryCol }, fileStem);
  }

  // Wide form: every column that is neither the identifier nor a name is an
  // attribute of its own; the header text is the category — except for a
  // single Ja/Nein column, whose membership the FILE names (the file is the
  // subject "Kohorte VII", the header only the predicate "Besucht"; live-test
  // 2026-09-16). Several Ja/Nein columns keep their headers as categories.
  const lists = [];
  const isName = (i) => LIST_HEADERS.name.includes(first[i]) || LIST_HEADERS.key.includes(first[i]);
  const columns = [];
  for (let col = 0; col < headerCells.length; col++) {
    if (col === identifier || isName(col) || !headerCells[col]) continue;
    const values = body.map((c) => (c[col] || '').toLowerCase());
    const boolean = values.every((v) => BOOL_TRUE.has(v) || BOOL_FALSE.has(v)) && values.some((v) => BOOL_TRUE.has(v));
    columns.push({ col, values, boolean });
  }
  const singleBoolean = columns.filter((c) => c.boolean).length === 1;
  for (const { col, values, boolean } of columns) {
    const rows = [];
    body.forEach((c, i) => {
      const id = c[identifier] || '';
      if (!id) return;
      if (boolean) { if (BOOL_TRUE.has(values[i])) rows.push({ identifier: id, value: '' }); }
      else if (c[col]) rows.push({ identifier: id, value: c[col] });
    });
    lists.push({ category: boolean && singleBoolean ? fileStem : headerCells[col], kind: boolean ? 'boolean' : 'value', rows });
  }
  // a header with only identifier/name columns is a plain member list
  if (!lists.length) lists.push({ category: fileStem, kind: 'list', rows: body.filter((c) => c[identifier]).map((c) => ({ identifier: c[identifier], value: '' })) });
  return { lists, delimiter, header, detected };
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
// exact hit on id, on the id tail without its source namespace (the raw
// key a source export carries, e.g. "p-4889730") or any registry identifier
// path (case-insensitive) — an identifier value shared by several
// identities is ambiguous, never a silent pick; otherwise fuzzy candidates (normalized Levenshtein <= threshold on
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
    if (identity.id.includes(':')) put(identity.id.slice(identity.id.lastIndexOf(':') + 1), identity.id);
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
      // idents: the stored identifier values, so the dialog can show WHY a
      // 100 % name match is still only a proposal (e.g. another e-mail domain)
      if (d <= threshold) candidates.push({ id: p.id, label: p.label, dist: Number(d.toFixed(3)), idents: p.idents.slice() });
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
