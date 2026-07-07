// AK 1 counting clarification (PRD §13): the reference numbers 793 edges /
// 69 ring groups come from the v1 footer of PRD-Reference-Screenshot.png.
// This script reproduces the v1 counting semantics on the ORIGINAL legacy
// dataset (data/SEM, git-ignored) with the v1 traversal that still lives in
// src/sections/11-graph-core.js, compares it edge-by-edge with the v2 engine
// projection on the migrated snapshot, and derives the v1 ring-group count
// from the attribute TSVs. Read-only analysis; exits gracefully when the
// local reference data is absent.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTenantStore } from '../src/sections/23-og2-store.js';
import { importSnapshot } from '../src/sections/26-og2-import.js';
import { parsePathExpression } from '../src/sections/27-og2-path.js';
import { projectView } from '../src/sections/28-og2-project.js';
import { idOf } from '../src/sections/09-data-load.js';
import { computeSubgraph, collectReportSubtree, recomputeHiddenNodes } from '../src/sections/11-graph-core.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const semDir = join(repoRoot, 'data/SEM');
const migrationDir = join(repoRoot, 'data/migration');
const ROOT_V1 = 'p-4889730';
const DEPTH = 3;
const NS = 'legacy-sem:';

const START_VIEW_PATH = 'Person (<--berichtetAn-- Person, --mitgliedIn--> OE[cluster] --unterstellt--> OE[cluster], --hatRolle--> Rolle[ring], --imTeam--> Team[ring], --besuchte--> Training[ring], --imGremium--> Gremium[ring], --arbeitetAn--> Projekt[ring], --hatKontakt--> Kontaktart[ring])';

function bail(msg) { console.log(msg); process.exit(0); }

// ---- v1 side: stock globals exactly like the removed processData ----------
function buildV1Globals(data) {
  const persons = (data.persons || []).filter(p => p && p.id).map(p => ({ ...p, id: String(p.id), type: 'person', kind: 'node' }));
  const orgs = (data.orgs || []).filter(o => o && o.id).map(o => ({ ...o, id: String(o.id), type: 'org', kind: 'cluster' }));
  const nodes = [...persons, ...orgs];
  const idSet = new Set(nodes.map(n => n.id));
  const seen = new Set();
  const links = [];
  for (const l of data.links || []) {
    const s = idOf(l && l.source), t = idOf(l && l.target);
    if (!idSet.has(s) || !idSet.has(t) || s === t) continue;
    const key = `${s}>${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: s, target: t });
  }
  globalThis.raw = { nodes, links, persons, orgs };
  globalThis.byId = new Map(nodes.map(n => [n.id, n]));
  globalThis.allNodesUnique = nodes.slice();
  globalThis.idOf = idOf;
  globalThis.drawKindOf = (n) => (n && n.kind) || (n && n.type === 'org' ? 'cluster' : 'node');
  const orgIds = new Set(orgs.map(o => o.id));
  globalThis.parentOf = new Map();
  globalThis.orgParent = new Map();
  globalThis.orgChildren = new Map();
  const hasParent = new Set();
  for (const l of links) {
    if (!orgIds.has(l.source) || !orgIds.has(l.target)) continue;
    globalThis.parentOf.set(l.target, l.source);
    globalThis.orgParent.set(l.target, l.source);
    if (!globalThis.orgChildren.has(l.source)) globalThis.orgChildren.set(l.source, new Set());
    globalThis.orgChildren.get(l.source).add(l.target);
    hasParent.add(l.target);
  }
  globalThis.orgRoots = [...orgIds].filter(id => !hasParent.has(id));
  globalThis.hiddenNodes = new Set();
  globalThis.hiddenByRoot = new Map();
  globalThis.managementEnabled = false;
  globalThis.currentHiddenCount = 0;
  globalThis.allHiddenTemporarilyVisible = false;
  globalThis.temporarilyVisibleRoots = new Set();
  globalThis.attributeFocusEnabled = false;
  globalThis.attributeFocusHiddenNodes = new Set();
  globalThis.personAttributes = new Map();
  globalThis.Logger = { log: () => {} };
}

function main() {
  if (!existsSync(semDir) || !existsSync(migrationDir)) {
    bail('local SEM reference (data/SEM + data/migration) absent on this machine — nothing to clarify');
  }

  // ---- (1) v1 edge counting on the original dataset ----
  const v1data = JSON.parse(readFileSync(join(semDir, 'data.json'), 'utf8'));
  buildV1Globals(v1data);
  const modes = {};
  for (const mode of ['both', 'down', 'up']) {
    const sub = computeSubgraph(ROOT_V1, DEPTH, mode);
    modes[mode] = { nodes: sub.nodes.length, links: sub.links.length, sub };
  }
  console.log('v1 computeSubgraph on data/SEM/data.json, root', ROOT_V1, 'depth', DEPTH);
  for (const [m, r] of Object.entries(modes)) console.log(`  mode=${m}: nodes=${r.nodes} links=${r.links}`);

  // The reference screenshot ran with the env's LEGEND_HIDDEN_ROOTS_DEFAULT:
  // reproduce the EXACT scene of PRD-Reference-Screenshot.png.
  const env = JSON.parse(readFileSync(join(semDir, 'env.json'), 'utf8'));
  const hiddenRoots = env.LEGEND_HIDDEN_ROOTS_DEFAULT || [];
  globalThis.hiddenByRoot = new Map();
  for (const rid of hiddenRoots) {
    if (globalThis.byId.has(String(rid))) globalThis.hiddenByRoot.set(String(rid), collectReportSubtree(String(rid)));
  }
  recomputeHiddenNodes();
  const refSub = computeSubgraph(ROOT_V1, DEPTH, String(env.TOOLBAR_DIRECTION_DEFAULT || 'both'));
  const refPersons = refSub.nodes.filter(n => n.type === 'person').length;
  const refOrgs = refSub.nodes.filter(n => n.type === 'org').length;
  console.log(`\nreference scene (dir=${env.TOOLBAR_DIRECTION_DEFAULT}, ${hiddenRoots.length} hidden roots): nodes=${refSub.nodes.length} (${refPersons} persons + ${refOrgs} orgs), links=${refSub.links.length}`);
  console.log('  -> AK 1 footer expectation was 487 nodes / 793 edges');

  // ---- (2) v2 engine projection on the migrated snapshot ----
  const snapFile = readdirSync(migrationDir).find((f) => /^legacy-sem\.snapshot-.*\.json$/.test(f));
  if (!snapFile) bail('no migrated legacy-sem snapshot — run scripts/migrate-legacy.mjs');
  const registry = JSON.parse(readFileSync(join(repoRoot, 'schema/registry.json'), 'utf8'));
  const snapshot = JSON.parse(readFileSync(join(migrationDir, snapFile), 'utf8'));
  const store = createTenantStore();
  const yes = { confirmSourceRegistration: () => ({ ok: true, moveOutEdgeTypes: [] }), confirmJoin: () => true, confirmGate: () => true, confirmDestructive: () => true, confirmAuthority: () => true };
  const res = importSnapshot(store, registry, snapshot, yes);
  if (res.status !== 'imported') { console.error('import failed:', res.reason); process.exit(1); }
  const projection = projectView({ store, parsed: parsePathExpression(START_VIEW_PATH), roots: [NS + ROOT_V1], depth: DEPTH });

  // visible engine edges as v1-shaped (source>target with stripped namespace)
  const engineEdges = new Set();
  for (const e of projection.edges) {
    engineEdges.add(`${String(e.source).replace(NS, '')}>${String(e.target).replace(NS, '')}`);
  }
  for (const d of projection.derivedEdges || []) {
    engineEdges.add(`${String(d.source).replace(NS, '')}>${String(d.target).replace(NS, '')}`);
  }

  // v1 'both' edge set, plus orientation-insensitive comparison: legacy
  // stored manager->report and parent->child, migration inverted both.
  const v1Edges = new Set(modes.both.sub.links.map(l => `${idOf(l.source)}>${idOf(l.target)}`));
  const flip = (k) => k.split('>').reverse().join('>');
  const onlyV1 = [...v1Edges].filter(k => !engineEdges.has(k) && !engineEdges.has(flip(k)));
  const onlyEngine = [...engineEdges].filter(k => !v1Edges.has(k) && !v1Edges.has(flip(k)));
  console.log(`\nedge sets: v1(both)=${v1Edges.size}, engine=${engineEdges.size}`);
  console.log(`only in v1 (${onlyV1.length}):`);
  for (const k of onlyV1.slice(0, 30)) {
    const [s, t] = k.split('>');
    const sn = globalThis.byId.get(s), tn = globalThis.byId.get(t);
    console.log(`  ${k}  [${sn?.type}:${sn?.label ?? '?'} -> ${tn?.type}:${tn?.label ?? '?'}]`);
  }
  console.log(`only in engine (${onlyEngine.length}):`);
  for (const k of onlyEngine.slice(0, 30)) console.log(`  ${k}`);

  // ---- (3) ring groups: v1 attributeTypes from the TSVs ----
  const attrDir = join(semDir, 'attributes');
  const v1Groups = new Set();
  if (existsSync(attrDir)) {
    for (const f of readdirSync(attrDir).filter(f => /\.(tsv|txt|csv)$/i.test(f))) {
      const category = f.replace(/\.[^.]+$/, '');
      const text = readFileSync(join(attrDir, f), 'utf8');
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const parts = line.includes('\t') ? line.split('\t') : line.split(',');
        if (parts.length < 2) continue;
        v1Groups.add(`${category}::${parts[1].trim()}`);
      }
    }
  }
  // v2 stock ring groups: distinct (type, label) of ring-capable target nodes
  const RING_TYPES = new Set(['Rolle', 'Team', 'Training', 'Gremium', 'Projekt', 'Kontaktart']);
  const v2Groups = new Set();
  for (const n of store.nodes.values()) {
    if (!RING_TYPES.has(n.type)) continue;
    const label = n.timelines.get('label');
    const open = label && label[label.length - 1];
    v2Groups.add(`${n.type}::${open ? open.value : n.id}`);
  }
  console.log(`\nring groups: v1 TSVs=${v1Groups.size}, v2 stock=${v2Groups.size} (reference footer: 69)`);
  const gOnlyV2 = [...v2Groups].filter(g => ![...v1Groups].some(v => v.split('::')[1] === g.split('::')[1]));
  const gOnlyV1 = [...v1Groups].filter(g => ![...v2Groups].some(v => v.split('::')[1] === g.split('::')[1]));
  console.log(`value-level: only v2 (${gOnlyV2.length}):`, gOnlyV2.slice(0, 15));
  console.log(`value-level: only v1 (${gOnlyV1.length}):`, gOnlyV1.slice(0, 15));
}

main();
