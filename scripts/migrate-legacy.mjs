#!/usr/bin/env node
// One-time legacy migration (PRD §10, FR-10.1..10.5). Reads the legacy tenant
// data (data.json + attribute TSVs), emits one snapshot per tenant in the v2
// format, and verifies it end-to-end: JSON-Schema validation plus a real
// engine import into a fresh in-memory store.
//
// Deterministic and idempotent (FR-10.4): no clock, no randomness — same
// input + same mapping file => byte-identical output. Direction normalization
// per FR-7.2a, container-node identity per E72 (category + value; empty value
// falls back to the category), ID discipline per E41/E56/E66, timestamps per
// E57 (sourceDate at UTC midnight; original date kept as meta.sourceDate).
//
// Usage: node scripts/migrate-legacy.mjs [--tenant legacy-sem|legacy-sbb-gd|legacy-hrm|all] [--out data/migration]
// Mapping curation (FR-10.4 / HIL-2): <out>/mapping.<source>.json with
// { "<identifier>": "<legacy person id>" | null } — null skips the row deliberately.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson, fnv1a64 } from '../src/sections/21-og2-util.js';
import { createTenantStore } from '../src/sections/23-og2-store.js';
import { importSnapshot } from '../src/sections/26-og2-import.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- helpers

export function slug(text) {
  return String(text)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const normDist = (a, b) => {
  const max = Math.max(a.length, b.length);
  return max ? levenshtein(a, b) / max : 0;
};

// Attribute file parsing: tab-separated with 2 or 3 columns
// ([identifier, value] or [identifier, categoryLabel, value]); lines without
// a tab fall back to a single comma split (legacy "Persönliche Kontakt" form).
// A missing/empty value is kept — E72 falls back to the category.
export function parseAttributeText(text, fileStem) {
  const rows = [];
  let columnCategory = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let parts = raw.includes('\t') ? raw.split('\t') : line.split(/,(.*)/s).slice(0, 2);
    parts = parts.map((p) => p.trim());
    const identifier = parts[0];
    if (!identifier) continue;
    let value;
    if (parts.length >= 3) {
      columnCategory = columnCategory || parts[1] || null;
      value = parts[2] || '';
    } else {
      value = parts[1] || '';
    }
    rows.push({ identifier, value });
  }
  return { category: columnCategory || fileStem, rows };
}

// FR-10.4 identifier resolution: mapping file > exact id > exact email >
// fuzzy (normalized Levenshtein <= 0.3 on email, label, and localpart-as-name).
export function buildPersonIndex(persons) {
  const byId = new Map();
  const byEmail = new Map();
  for (const p of persons) {
    byId.set(p.id, p);
    if (p.email) byEmail.set(String(p.email).toLowerCase(), p);
  }
  return { byId, byEmail, all: persons };
}

export function resolveIdentifier(identifier, index, mapping) {
  if (Object.prototype.hasOwnProperty.call(mapping, identifier)) {
    const target = mapping[identifier];
    if (target === null) return { skipped: true };
    return index.byId.has(target) ? { person: index.byId.get(target) } : { unmatched: true, suggestions: [] };
  }
  if (index.byId.has(identifier)) return { person: index.byId.get(identifier) };
  const lower = identifier.toLowerCase();
  if (index.byEmail.has(lower)) return { person: index.byEmail.get(lower) };
  const asName = lower.split('@')[0].replace(/[._-]+/g, ' ');
  const candidates = [];
  for (const p of index.all) {
    const label = String(p.label || '').toLowerCase();
    const email = String(p.email || '').toLowerCase();
    const d = Math.min(
      email ? normDist(lower, email) : 1,
      label ? normDist(asName, label) : 1,
      label ? normDist(lower, label) : 1,
    );
    if (d <= 0.3) candidates.push({ id: p.id, label: p.label, dist: Number(d.toFixed(3)) });
  }
  candidates.sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : 1));
  // Unambiguous (FR-10.4): the only candidate within threshold, or exactly
  // one perfect-distance hit. Several perfect hits (duplicate persons) and
  // merely-close hits stay unmatched for human curation.
  if (candidates.length === 1) return { person: index.byId.get(candidates[0].id), fuzzy: true };
  if (candidates.length > 1 && candidates[0].dist === 0 && candidates[1].dist > 0) {
    return { person: index.byId.get(candidates[0].id), fuzzy: true };
  }
  return { unmatched: true, suggestions: candidates.slice(0, 3) };
}

// ---------------------------------------------------------------- core

// E72: container node identity = category + value; empty value falls back to
// the category. Returns a stable node (id per E41/E56, source-namespaced).
export function containerNodeOf(source, type, category, value, categoryProp) {
  const val = String(value || '').trim();
  const id = val
    ? `${source}:${type}:${slug(category)}--${slug(val)}`
    : `${source}:${type}:${slug(category)}`;
  const node = { id, type, label: val || category, props: {} };
  if (categoryProp) node.props[categoryProp] = category;
  return node;
}

export function migrateTenant({ source, cfg, registry, data, attributes, mapping = {} }) {
  const nodes = new Map(); // id -> node
  const edges = new Map(); // canonical key -> edge
  const report = {
    source,
    input: { persons: data.persons.length, orgs: data.orgs.length, links: data.links.length },
    links: { berichtetAn: 0, mitgliedIn: 0, unterstellt: 0, orgToPersonFlipped: 0, dropped: 0 },
    categories: {},
    unmatchedTotal: 0,
    warnings: [],
  };
  const unmatched = [];

  const nid = (origId) => `${source}:${origId}`;
  const addNode = (node) => {
    const existing = nodes.get(node.id);
    if (existing) return existing;
    nodes.set(node.id, node);
    return node;
  };
  const addEdge = (edge) => {
    const kontext = edge.props && 'kontext' in edge.props ? edge.props.kontext : undefined;
    const key = canonicalJson([edge.type, edge.source, edge.target, kontext === undefined ? null : ['k', kontext]]);
    if (!edges.has(key)) edges.set(key, edge);
  };

  // Persons and orgs (FR-10.3). Only registry-declared props are carried.
  for (const p of data.persons) {
    const props = {};
    if (p.email) props.email = p.email;
    if (typeof p.isBasis === 'boolean') props.isBasis = p.isBasis;
    addNode({ id: nid(p.id), type: 'Person', label: p.label, props });
  }
  for (const o of data.orgs) {
    addNode({ id: nid(o.id), type: 'OE', label: o.label, props: {} });
  }

  // Links with direction normalization (FR-7.2a): legacy P->P is
  // manager->report and legacy OE->OE is parent->child — both inverted;
  // legacy P->OE keeps its direction.
  const pSet = new Set(data.persons.map((p) => p.id));
  const oSet = new Set(data.orgs.map((o) => o.id));
  for (const l of data.links) {
    const sP = pSet.has(l.source), tP = pSet.has(l.target);
    const sO = oSet.has(l.source), tO = oSet.has(l.target);
    if (sP && tP) {
      addEdge({ type: 'berichtetAn', source: nid(l.target), target: nid(l.source) });
      report.links.berichtetAn++;
    } else if (sO && tO) {
      addEdge({ type: 'unterstellt', source: nid(l.target), target: nid(l.source) });
      report.links.unterstellt++;
    } else if (sP && tO) {
      addEdge({ type: 'mitgliedIn', source: nid(l.source), target: nid(l.target) });
      report.links.mitgliedIn++;
    } else if (sO && tP) {
      addEdge({ type: 'mitgliedIn', source: nid(l.target), target: nid(l.source) });
      report.links.mitgliedIn++;
      report.links.orgToPersonFlipped++;
    } else {
      report.links.dropped++;
    }
  }

  // Attribute categories per mapping configuration (FR-10.2/10.3, E72).
  const index = buildPersonIndex(data.persons);
  const applyRoleFact = (personNodeId, category, value, kontextId) => {
    const rolle = addNode(containerNodeOf(source, 'Rolle', category, value));
    addEdge({ type: 'hatRolle', source: personNodeId, target: rolle.id, props: { kontext: kontextId } });
  };

  for (const att of attributes) {
    const catCfg = cfg.categories[att.configKey ?? att.category];
    const stat = { rows: att.rows.length, matched: 0, fuzzy: 0, skipped: 0, unmatched: 0 };
    report.categories[att.category] = stat;
    if (!catCfg) {
      report.warnings.push(`category "${att.category}": no mapping configuration — all rows skipped`);
      stat.skipped = att.rows.length;
      continue;
    }
    for (const row of att.rows) {
      const res = resolveIdentifier(row.identifier, index, mapping);
      if (res.skipped) { stat.skipped++; continue; }
      if (res.unmatched) {
        stat.unmatched++;
        report.unmatchedTotal++;
        unmatched.push({ identifier: row.identifier, category: att.category, value: row.value, suggestions: res.suggestions });
        continue;
      }
      stat.matched++;
      if (res.fuzzy) stat.fuzzy++;
      const personId = nid(res.person.id);
      const value = String(row.value || '').trim();
      if (catCfg.treatment === 'property') {
        if (!value) { stat.skipped++; stat.matched--; continue; }
        const parsed = catCfg.valueType === 'number' ? Number(value.replace(',', '.')) : value;
        if (catCfg.valueType === 'number' && !Number.isFinite(parsed)) {
          report.warnings.push(`category "${att.category}": non-numeric value "${value}" for ${row.identifier} skipped`);
          stat.skipped++; stat.matched--;
          continue;
        }
        nodes.get(personId).props[catCfg.prop] = parsed;
      } else if (catCfg.treatment === 'role') {
        applyRoleFact(personId, att.category, value, null);
      } else if (catCfg.treatment === 'contextRole') {
        const firma = addNode({ id: `${source}:Firma:${slug(att.category)}`, type: 'Firma', label: att.category, props: {} });
        applyRoleFact(personId, att.category, value, firma.id);
      } else if (catCfg.treatment === 'node') {
        const container = addNode(containerNodeOf(source, catCfg.type, att.category, value, catCfg.categoryProp));
        addEdge({ type: catCfg.edge, source: personId, target: container.id });
      } else {
        report.warnings.push(`category "${att.category}": unknown treatment "${catCfg.treatment}"`);
      }
    }
  }

  // Tenant-specific person role field (legacy-hrm: persons[].role).
  if (cfg.personRoleField) {
    const { field, category } = cfg.personRoleField;
    let count = 0;
    for (const p of data.persons) {
      const value = String(p[field] || '').trim();
      if (!value) continue;
      applyRoleFact(nid(p.id), category, value, null);
      count++;
    }
    report.categories[category] = { rows: count, matched: count, fuzzy: 0, skipped: 0, unmatched: 0 };
  }

  // Snapshot assembly (FR-10.2, E57): deterministic stamps from sourceDate.
  const stamp = `${cfg.sourceDate.replace(/-/g, '')}-0000`;
  const usedNodeTypes = [...new Set([...nodes.values()].map((n) => n.type))].sort();
  const usedEdgeTypes = [...new Set([...edges.values()].map((e) => e.type))].sort();
  const schema = { nodeTypes: {}, edgeTypes: {} };
  for (const t of usedNodeTypes) schema.nodeTypes[t] = registry.nodeTypes[t] ?? {};
  for (const t of usedEdgeTypes) schema.edgeTypes[t] = registry.edgeTypes[t] ?? {};

  const snapshot = {
    meta: {
      source,
      crawledAt: `${cfg.sourceDate}T00:00:00Z`,
      snapshot: stamp,
      registryVersion: registry.version,
      sourceDate: cfg.sourceDate,
      sourceDateOrigin: 'latest mtime of the tenant legacy inputs (E57 provenance)',
      scope: { nodeTypes: usedNodeTypes, edgeTypes: usedEdgeTypes },
    },
    schema,
    nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    edges: [...edges.values()].sort((a, b) =>
      canonicalJson([a.type, a.source, a.target]) < canonicalJson([b.type, b.source, b.target]) ? -1 : 1),
  };
  report.output = {
    nodes: snapshot.nodes.length,
    edges: snapshot.edges.length,
    nodesByType: countBy(snapshot.nodes, (n) => n.type),
    edgesByType: countBy(snapshot.edges, (e) => e.type),
  };
  report.snapshotHash = fnv1a64(canonicalJson(snapshot));
  return { snapshot, unmatched, report };
}

const countBy = (items, keyOf) => {
  const out = {};
  for (const it of items) out[keyOf(it)] = (out[keyOf(it)] || 0) + 1;
  return out;
};

// End-to-end verification: real engine import into a fresh store (FR-6.8
// preflight + merge + gate all run). The migration is a first import into an
// empty tenant, so every gate hook simply confirms (E71 fixture pattern).
export function verifyByImport(snapshot, registry) {
  const store = createTenantStore();
  const hooks = {
    confirmSourceRegistration: () => ({ ok: true, moveOutEdgeTypes: [] }),
    confirmJoin: () => true,
    confirmGate: () => true,
    confirmDestructive: () => true,
    confirmAuthority: () => true,
  };
  const res = importSnapshot(store, registry, snapshot, hooks);
  return {
    status: res.status,
    problems: res.problems || res.reason || null,
    storeNodes: store.nodes.size,
    storeEdges: store.edges.size,
  };
}

export function toUnmatchedCsv(unmatched) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ['identifier,category,value,suggestions'];
  for (const u of unmatched) {
    const sugg = u.suggestions.map((s) => `${s.id} (${s.label}, d=${s.dist})`).join(' | ');
    lines.push([u.identifier, u.category, u.value, sugg].map(esc).join(','));
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- env fixture

// Deliverable env.json of a migrated tenant (FR-7.4, E14 fixture): the start
// view reproduces today's active rendering — person hierarchy, OE cluster
// ancestors, and every migrated person-attached relation as a ring. The type
// names come from the tenant registry commit, never from engine code (NFR-5).
// A legacy GRAPH_START_ID_DEFAULT is carried over (namespaced when needed).
export function buildTenantEnv({ source, registry, snapshot, legacyEnv }) {
  const usedEdgeTypes = new Set(snapshot.edges.map((e) => e.type));
  const structuralHops = ['berichtetAn', 'mitgliedIn', 'unterstellt'];
  const ringHops = [];
  for (const [name, decl] of Object.entries(registry.edgeTypes)) {
    if (!usedEdgeTypes.has(name) || structuralHops.includes(name)) continue;
    if (decl.from !== 'Person') continue;
    // arbeitetBei is the projected base edge of hatRolle (FR-4.8) — the role
    // ring already represents that fact; no separate company ring in v1.
    if (name === 'arbeitetBei') continue;
    ringHops.push(`--${name}--> ${decl.to}[ring]`);
  }
  ringHops.sort();
  const path = `Person (<--berichtetAn-- Person, --mitgliedIn--> OE[cluster] --unterstellt--> OE[cluster]${ringHops.length ? ', ' + ringHops.join(', ') : ''})`;

  const env = {
    VIEWS: {
      Start: { path, roots: ['__auto__'], depth: 3 },
    },
  };
  const legacyStart = legacyEnv && legacyEnv.GRAPH_START_ID_DEFAULT;
  if (legacyStart != null) {
    const nodeIds = new Set(snapshot.nodes.map((n) => n.id));
    const mapId = (v) => (nodeIds.has(String(v)) ? String(v) : nodeIds.has(`${source}:${v}`) ? `${source}:${v}` : null);
    const mapped = (Array.isArray(legacyStart) ? legacyStart : [legacyStart]).map(mapId).filter(Boolean);
    if (mapped.length) env.GRAPH_START_ID_DEFAULT = Array.isArray(legacyStart) ? mapped : mapped[0];
  }
  for (const key of ['TOOLBAR_DEPTH_DEFAULT', 'TOOLBAR_MANAGEMENT_ACTIVE', 'TOOLBAR_PSEUDO_ACTIVE', 'TOOLBAR_PSEUDO_PASSWORD', 'TOOLBAR_LABELS_DEFAULT']) {
    if (legacyEnv && legacyEnv[key] !== undefined) env[key] = legacyEnv[key];
  }
  return env;
}

// ---------------------------------------------------------------- CLI

async function main() {
  const args = process.argv.slice(2);
  const argOf = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const tenantArg = argOf('--tenant', 'all');
  const outDir = join(repoRoot, argOf('--out', 'data/migration'));
  mkdirSync(outDir, { recursive: true });

  const config = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'migrate-legacy.config.json'), 'utf8'));
  const registry = JSON.parse(readFileSync(join(repoRoot, 'schema/registry.json'), 'utf8'));
  if (registry.version !== config.registryVersion) {
    console.error(`registry version mismatch: config expects ${config.registryVersion}, schema/registry.json has ${registry.version}`);
    process.exit(1);
  }

  // JSON-Schema validation (AK 11 harness reuse) is optional at run time:
  // ajv is a devDependency; fail hard if it is missing rather than skipping.
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const { default: addFormats } = await import('ajv-formats');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const f of ['registry.schema.json', 'snapshot.schema.json']) {
    ajv.addSchema(JSON.parse(readFileSync(join(repoRoot, 'schema', f), 'utf8')), f);
  }
  const validateSnapshotSchema = ajv.getSchema('snapshot.schema.json');

  const tenants = tenantArg === 'all' ? Object.keys(config.tenants) : [tenantArg];
  let failed = false;
  for (const source of tenants) {
    const cfg = config.tenants[source];
    if (!cfg) { console.error(`unknown tenant: ${source}`); process.exit(1); }
    const dir = join(repoRoot, cfg.dir);
    const data = JSON.parse(readFileSync(join(dir, cfg.dataFile), 'utf8'));

    const attributes = [];
    if (cfg.attributesDir) {
      const attDir = join(dir, cfg.attributesDir);
      for (const file of readdirSync(attDir).filter((f) => /\.(tsv|csv)$/i.test(f)).sort()) {
        const stem = basename(file, extname(file));
        const parsed = parseAttributeText(readFileSync(join(attDir, file), 'utf8'), stem);
        // Config lookup key is the file stem (stable); the E72 category string
        // is the column category when the file carries one, else the stem.
        attributes.push({ ...parsed, configKey: cfg.categories[stem] ? stem : parsed.category });
      }
    }

    const mappingPath = join(outDir, `mapping.${source}.json`);
    const mapping = existsSync(mappingPath) ? JSON.parse(readFileSync(mappingPath, 'utf8')) : {};

    const { snapshot, unmatched, report } = migrateTenant({ source, cfg, registry, data, attributes, mapping });

    report.verify = { schemaValid: validateSnapshotSchema(snapshot) };
    if (!report.verify.schemaValid) {
      report.verify.schemaErrors = validateSnapshotSchema.errors.slice(0, 10);
      failed = true;
    } else {
      const t0 = performance.now();
      report.verify.import = verifyByImport(snapshot, registry);
      report.verify.importMs = Math.round(performance.now() - t0);
      if (report.verify.import.status !== 'imported') failed = true;
    }

    writeFileSync(join(outDir, `${source}.snapshot-${snapshot.meta.snapshot}.json`), JSON.stringify(snapshot, null, 2) + '\n');
    writeFileSync(join(outDir, `${source}.unmatched.csv`), toUnmatchedCsv(unmatched));
    writeFileSync(join(outDir, `${source}.report.json`), JSON.stringify(report, null, 2) + '\n');

    // Deliverable tenant env with the start view (FR-7.4).
    let legacyEnv = null;
    const legacyEnvPath = join(dir, 'env.json');
    if (existsSync(legacyEnvPath)) {
      try { legacyEnv = JSON.parse(readFileSync(legacyEnvPath, 'utf8')); } catch { /* optional */ }
    }
    const env = buildTenantEnv({ source, registry, snapshot, legacyEnv });
    writeFileSync(join(outDir, `${source}.env.json`), JSON.stringify(env, null, 2) + '\n');

    console.log(`\n=== ${source} ===`);
    console.log(`input:  ${report.input.persons} persons, ${report.input.orgs} orgs, ${report.input.links} links`);
    console.log(`output: ${report.output.nodes} nodes ${JSON.stringify(report.output.nodesByType)}`);
    console.log(`        ${report.output.edges} edges ${JSON.stringify(report.output.edgesByType)}`);
    console.log(`links:  ${JSON.stringify(report.links)}`);
    console.log(`unmatched rows: ${report.unmatchedTotal} -> ${source}.unmatched.csv`);
    for (const w of report.warnings) console.log(`WARN: ${w}`);
    console.log(`verify: schema=${report.verify.schemaValid} import=${report.verify.import?.status ?? 'skipped'} (${report.verify.importMs ?? '-'}ms, store: ${report.verify.import?.storeNodes ?? '-'} nodes / ${report.verify.import?.storeEdges ?? '-'} edges)`);
    console.log(`hash:   ${report.snapshotHash}`);
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
