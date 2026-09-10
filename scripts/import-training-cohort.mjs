#!/usr/bin/env node
// Training cohort intake (PRD E30/AK 15): turns participant lists into an
// EDGE-ENRICHMENT snapshot — empty nodeTypes, edgeTypes ["besuchte"], the
// participants as edgeSources. Such a snapshot creates the delivered cohort
// nodes and closes nothing: no node type is ever treated as a full state.
//
// Note on repeat attendees: "besuchte" runs person -> training, so the
// edgeSources are the PARTICIPANTS, and the snapshot claims full state over
// their outgoing besuchte edges. That does NOT endanger earlier cohorts as
// long as this runs under its own source: withdrawEdge (26-og2-import) only
// closes a fact once the LAST provenance entry is gone, and it can withdraw
// its own source only. Cohorts I..VI carry "legacy-sem" provenance, which
// this source cannot touch. verifyOnTopOfBase asserts that on every run
// instead of trusting the argument.
//
// Deterministic and idempotent like the legacy migration (FR-10.4): no clock,
// no randomness — same inputs + same --at => byte-identical output.
//
// Usage:
//   node scripts/import-training-cohort.mjs --participants <csv> [--participants <csv>…]
//        [--cohort "X - POPM"] --at 2026-09-10T00:00Z
//        [--source safe-trainings] [--base <snapshot.json>] [--out data/trainings]
//        [--create-missing] [--write]
//
// Without --write the script only reports the roster match (dry run). CSV may
// be comma- or semicolon-separated (Excel/CH) and carry a BOM; the cohort can
// come from a column or from --cohort for a single-cohort file.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, fnv1a64 } from '../src/sections/21-og2-util.js';
import { createTenantStore } from '../src/sections/23-og2-store.js';
import { importSnapshot } from '../src/sections/26-og2-import.js';
import { slug, buildPersonIndex, resolveIdentifier, toUnmatchedCsv } from './migrate-legacy.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  source: 'safe-trainings',
  base: 'data/migration/legacy-sem.snapshot-20260612-0000.json',
  out: 'data/trainings',
  registry: 'schema/registry.json',
};

// ---------------------------------------------------------------- CSV

// Minimal RFC4180 reader: quoted fields, doubled quotes, CRLF, BOM. The
// delimiter is whichever of ; or , wins on the header line (Excel on a German
// locale writes semicolons).
export function parseCsv(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const head = clean.slice(0, clean.search(/\r?\n|$/));
  const delim = (head.split(';').length > head.split(',').length) ? ';' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === delim) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

const HEADER_ALIASES = {
  email: ['email', 'e-mail', 'mail', 'mailadresse', 'e-mail-adresse'],
  name: ['name', 'teilnehmer', 'teilnehmerin', 'person', 'label', 'vorname nachname', 'nachname vorname'],
  cohort: ['kohorte', 'cohort', 'klasse', 'training', 'kurs'],
};

function mapHeader(headerRow) {
  const norm = headerRow.map((h) => String(h).trim().toLowerCase());
  const idx = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const at = norm.findIndex((h) => aliases.includes(h));
    if (at >= 0) idx[key] = at;
  }
  return idx;
}

// One roster row: the identifier fed to resolveIdentifier is the e-mail when
// present (E66 join key), the name otherwise (fuzzy fallback).
export function readRoster(text, fallbackCohort) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const idx = mapHeader(rows[0]);
  if (idx.email === undefined && idx.name === undefined) {
    throw new Error('CSV has neither an e-mail nor a name column (expected one of: email, e-mail, mail / name, teilnehmer, person)');
  }
  const out = [];
  for (const r of rows.slice(1)) {
    const email = idx.email !== undefined ? String(r[idx.email] || '').trim() : '';
    const name = idx.name !== undefined ? String(r[idx.name] || '').trim() : '';
    const cohort = idx.cohort !== undefined ? String(r[idx.cohort] || '').trim() : (fallbackCohort || '');
    if (!email && !name) continue;
    if (!cohort) throw new Error(`row without cohort and no --cohort given: ${JSON.stringify(r)}`);
    out.push({ identifier: email || name, email, name, cohort });
  }
  return out;
}

// ---------------------------------------------------------------- model

// Cohort label stays in the established shape ("Kohorte X - POPM"); the id is
// derived from it so a re-run of the same roster is byte-identical.
export function cohortNode(source, cohort) {
  const label = /^kohorte\b/i.test(cohort) ? cohort : `Kohorte ${cohort}`;
  return { id: `${source}:Training:${slug(label)}`, type: 'Training', label, props: {} };
}

export function personNode(source, row) {
  const key = row.email ? slug(row.email) : slug(row.name);
  return {
    id: `${source}:Person:${key}`,
    type: 'Person',
    label: row.name || row.email,
    props: row.email ? { email: row.email } : {},
  };
}

export function buildCohortSnapshot({ source, at, registry, base, roster, mapping = {}, createMissing = false }) {
  const stamp = `${at.slice(0, 4)}${at.slice(5, 7)}${at.slice(8, 10)}-${at.slice(11, 13)}${at.slice(14, 16)}`;
  const persons = (base.nodes || [])
    .filter((n) => n.type === 'Person')
    .map((n) => ({ id: n.id, label: n.label, email: n.props && n.props.email }));
  const index = buildPersonIndex(persons);

  const nodes = new Map();
  const edges = new Map();
  const participants = new Set();
  const unmatched = [];
  const matches = [];

  for (const row of roster) {
    const training = cohortNode(source, row.cohort);
    nodes.set(training.id, training);

    const res = resolveIdentifier(row.identifier, index, mapping);
    if (res.skipped) continue;
    let personId;
    if (res.person) {
      personId = res.person.id;
      // Visited proof (FR-6.8): every edgeSources id needs a delivered node
      // record. A minimal stub is enough and is the safe form — E61 keeps the
      // person's stored props intact because only delivered values merge. The
      // canonical stored label is reused so a differently spelled roster name
      // cannot rewrite it.
      if (!nodes.has(personId)) {
        nodes.set(personId, { id: personId, type: 'Person', label: res.person.label });
      }
      matches.push({ identifier: row.identifier, person: personId, label: res.person.label, fuzzy: !!res.fuzzy });
    } else if (createMissing) {
      const p = personNode(source, row);
      nodes.set(p.id, p);
      personId = p.id;
      matches.push({ identifier: row.identifier, person: personId, label: p.label, created: true });
    } else {
      unmatched.push({ identifier: row.identifier, category: row.cohort, value: row.name, suggestions: res.suggestions || [] });
      continue;
    }
    participants.add(personId);
    const e = { type: 'besuchte', source: personId, target: training.id };
    edges.set(canonicalJson([e.type, e.source, e.target]), e);
  }

  const usedNodeTypes = [...new Set([...nodes.values()].map((n) => n.type))].sort();
  const schema = { nodeTypes: {}, edgeTypes: { besuchte: registry.edgeTypes.besuchte } };
  for (const t of usedNodeTypes) schema.nodeTypes[t] = registry.nodeTypes[t];

  const snapshot = {
    meta: {
      source,
      crawledAt: at,
      snapshot: stamp,
      registryVersion: registry.version,
      scope: {
        // Enrichment scope (E30): no node type is a full state, so nothing is
        // ever closed; the participants are the visited edge sources.
        nodeTypes: [],
        edgeTypes: ['besuchte'],
        edgeSources: [...participants].sort(),
      },
    },
    schema,
    nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    edges: [...edges.values()].sort((a, b) =>
      canonicalJson([a.type, a.source, a.target]) < canonicalJson([b.type, b.source, b.target]) ? -1 : 1),
  };

  const report = {
    source, at, stamp,
    roster: roster.length,
    matched: matches.filter((m) => !m.created).length,
    fuzzy: matches.filter((m) => m.fuzzy).length,
    created: matches.filter((m) => m.created).length,
    unmatched: unmatched.length,
    cohorts: [...new Set(roster.map((r) => cohortNode(source, r.cohort).label))].sort(),
    edges: snapshot.edges.length,
    matches: matches.sort((a, b) => (a.person < b.person ? -1 : 1)),
    snapshotHash: fnv1a64(canonicalJson(snapshot)),
  };
  return { snapshot, report, unmatched };
}

// End-to-end verification for an ENRICHMENT snapshot. Unlike the migration
// (a first import into an empty tenant) this one only makes sense on top of
// the stock, so the base snapshot is imported first. Beyond the import status
// it asserts the property this whole script exists for: every besuchte edge a
// participant had before is still open afterwards.
export function verifyOnTopOfBase(snapshot, registry, base) {
  const hooks = {
    confirmSourceRegistration: () => ({ ok: true, moveOutEdgeTypes: [] }),
    confirmJoin: () => true,
    confirmGate: () => true,
    confirmDestructive: () => true,
    confirmAuthority: () => true,
  };
  const store = createTenantStore();
  const baseRes = importSnapshot(store, registry, base, hooks);
  if (baseRes.status !== 'imported') return { status: 'base-import-failed', problems: baseRes.errors || baseRes.reason };

  const participants = new Set(snapshot.meta.scope.edgeSources);
  const expected = (base.edges || [])
    .filter((e) => e.type === 'besuchte' && participants.has(e.source))
    .map((e) => canonicalJson([e.source, e.target]));

  const edgesBefore = store.edges.size;
  const res = importSnapshot(store, registry, snapshot, hooks);
  if (res.status !== 'imported') return { status: res.status, problems: res.errors || res.reason };

  // A fact is open when the last interval of its existence timeline has no
  // end (store shape: existence: [{ from, to, provenance }]).
  const isOpen = (e) => Array.isArray(e.existence) && e.existence.length > 0
    && e.existence[e.existence.length - 1].to === null;
  const open = new Set();
  for (const e of store.edges.values()) {
    if (e.type === 'besuchte' && isOpen(e)) open.add(canonicalJson([e.source, e.target]));
  }
  const lost = expected.filter((k) => !open.has(k));
  return {
    status: 'imported',
    newEdges: store.edges.size - edgesBefore,
    storeNodes: store.nodes.size,
    priorEdgesKept: expected.length - lost.length,
    priorEdgesLost: lost.length,
    lostSample: lost.slice(0, 5).map((k) => JSON.parse(k).join(' -> ')),
  };
}

// ---------------------------------------------------------------- cli

function parseArgs(argv) {
  const args = { participants: [], ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--participants') args.participants.push(argv[++i]);
    else if (a === '--cohort') args.cohort = argv[++i];
    else if (a === '--at') args.at = argv[++i];
    else if (a === '--source') args.source = argv[++i];
    else if (a === '--base') args.base = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--registry') args.registry = argv[++i];
    else if (a === '--create-missing') args.createMissing = true;
    else if (a === '--write') args.write = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.participants.length) throw new Error('--participants <csv> is required');
  if (!args.at) throw new Error('--at <RFC3339, e.g. 2026-09-10T00:00Z> is required (no clock: the run must stay reproducible)');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(args.at)) {
    throw new Error(`--at must be RFC3339 with explicit offset or Z (E50): ${args.at}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Accept both cwd-relative and repo-relative paths; fail with the path the
  // user typed rather than a mangled join.
  const abs = (p) => {
    if (existsSync(p)) return p;
    const inRepo = join(repoRoot, p);
    if (existsSync(inRepo)) return inRepo;
    throw new Error(`file not found: ${p}`);
  };
  const registry = JSON.parse(readFileSync(abs(args.registry), 'utf8'));
  const base = JSON.parse(readFileSync(abs(args.base), 'utf8'));
  const mappingPath = join(repoRoot, args.out, `mapping.${args.source}.json`);
  const mapping = existsSync(mappingPath) ? JSON.parse(readFileSync(mappingPath, 'utf8')) : {};

  const roster = args.participants.flatMap((p) => readRoster(readFileSync(abs(p), 'utf8'), args.cohort));
  const { snapshot, report, unmatched } = buildCohortSnapshot({
    source: args.source, at: args.at, registry, base, roster, mapping, createMissing: !!args.createMissing,
  });

  // Schema first, then a real engine import into a fresh store.
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const { default: addFormats } = await import('ajv-formats');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const f of ['registry.schema.json', 'snapshot.schema.json']) {
    ajv.addSchema(JSON.parse(readFileSync(join(repoRoot, 'schema', f), 'utf8')), f);
  }
  const validate = ajv.getSchema('snapshot.schema.json');
  report.schemaValid = validate(snapshot);
  if (!report.schemaValid) report.schemaErrors = validate.errors.slice(0, 10);

  console.log(JSON.stringify({ ...report, matches: undefined }, null, 2));
  if (unmatched.length) {
    console.log(`\n${unmatched.length} unmatched participant(s) — curate ${args.out}/mapping.${args.source}.json or pass --create-missing:`);
    for (const u of unmatched.slice(0, 20)) {
      const s = u.suggestions.map((x) => `${x.label} (${x.id}, d=${x.dist})`).join(' | ') || 'no close match';
      console.log(`  ${u.identifier}  ->  ${s}`);
    }
  }

  if (!args.write) {
    console.log('\nDry run — nothing written. Re-run with --write once the roster looks right.');
    return;
  }
  if (!report.schemaValid) throw new Error('refusing to write: snapshot fails schema validation');

  // Verify BEFORE writing: a snapshot that would drop a prior attendance
  // must not reach the disk in the first place.
  report.verify = verifyOnTopOfBase(snapshot, registry, base);
  console.log(`\nimport verification: ${JSON.stringify(report.verify)}`);
  if (report.verify.status !== 'imported') throw new Error('refusing to write: engine import failed');
  if (report.verify.priorEdgesLost > 0) {
    throw new Error(`refusing to write: ${report.verify.priorEdgesLost} prior attendance(s) would be closed — ${report.verify.lostSample.join(', ')}`);
  }

  const outDir = join(repoRoot, args.out);
  mkdirSync(outDir, { recursive: true });
  const snapPath = join(outDir, `${args.source}.snapshot-${snapshot.meta.snapshot}.json`);
  const payload = JSON.stringify(snapshot, null, 2) + '\n';
  // Desired state: only touch a file when its content actually differs.
  const put = (p, s) => { if (!existsSync(p) || readFileSync(p, 'utf8') !== s) writeFileSync(p, s); };
  put(snapPath, payload);
  put(join(outDir, `${args.source}.report.json`), JSON.stringify(report, null, 2) + '\n');
  put(join(outDir, `${args.source}.unmatched.csv`), toUnmatchedCsv(unmatched));
  console.log(`written: ${snapPath}`);
}

if (process.argv[1] && process.argv[1].endsWith('import-training-cohort.mjs')) {
  main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
