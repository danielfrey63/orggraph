// NFR early-indicator protocol (AK 10 + AK 37, E71): continuous measurement
// on the development environment. The binding run on the reference machine
// belongs to the end acceptance (HIL-3); this script produces the measured
// protocol the loop maintains along the way.
//
// Measures on the local SEM reference (data/migration, git-ignored):
//   (1) NFR-3 indicator: engine import duration + start-view projection time.
//       HONEST NOTE: the <200ms main-thread-block and <500ms progress
//       criteria are BROWSER criteria; the v2 boot currently runs the
//       62k import as ONE synchronous block — open until async batching.
//   (2) AK 37 (NFR-2): 24 synthetic snapshot stands at ~2% change rate,
//       each import measured against the 30s limit, store growth tracked
//       (serialized byte size as the IndexedDB footprint indicator),
//       final start-view projection measured.
// Deterministic change generator (no randomness): stand i changes nodes
// whose index modulo 50 equals i modulo 50 (= exactly 2%).
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTenantStore } from '../src/sections/23-og2-store.js';
import { importSnapshot } from '../src/sections/26-og2-import.js';
import { parsePathExpression } from '../src/sections/27-og2-path.js';
import { projectView } from '../src/sections/28-og2-project.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = join(repoRoot, 'data/migration');
const NS = 'legacy-sem:';
const ROOT = NS + 'p-4889730';
const STANDS = Number(process.argv.includes('--stands') ? process.argv[process.argv.indexOf('--stands') + 1] : 24);
const START_VIEW_PATH = 'Person (<--berichtetAn-- Person, --mitgliedIn--> OE[cluster] --unterstellt--> OE[cluster], --hatRolle--> Rolle[ring], --imTeam--> Team[ring], --besuchte--> Training[ring], --imGremium--> Gremium[ring], --arbeitetAn--> Projekt[ring], --hatKontakt--> Kontaktart[ring])';

const YES = { confirmSourceRegistration: () => ({ ok: true, moveOutEdgeTypes: [] }), confirmJoin: () => true, confirmGate: () => true, confirmDestructive: () => true, confirmAuthority: () => true };

function storeFootprintBytes(store) {
  // serialized size as the IndexedDB footprint indicator (FR-8.9 layout);
  // summed per identity so huge stores never build one >512MB string.
  const replacer = (k, val) => {
    if (val instanceof Map) return [...val.entries()];
    if (val instanceof Set) return [...val];
    return val;
  };
  let bytes = 0;
  for (const coll of [store.nodes.values(), store.edges.values(), store.snapshots.values()]) {
    for (const item of coll) bytes += Buffer.byteLength(JSON.stringify(item, replacer));
  }
  return bytes;
}

function stampOf(i) {
  // day-per-stand after the migration stamp 20260612
  const d = new Date(Date.UTC(2026, 5, 13 + i));
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-0000`;
}

function syntheticStand(base, i) {
  // ~2% of the nodes (a FIXED cohort, so stand 2+ produces real value
  // changes, not just new properties) get a cycling scalar, deterministic
  const nodes = base.nodes.map((n, idx) => {
    if (n.type !== 'Person' || idx % 50 !== 0) return n;
    return { ...n, props: { ...(n.props || {}), pensum: 50 + ((i + idx) % 50) } };
  });
  const stamp = stampOf(i);
  return {
    ...base,
    meta: { ...base.meta, snapshot: stamp, crawledAt: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T00:00:00Z` },
    nodes,
  };
}

function main() {
  if (!existsSync(migrationDir)) { console.log('no local SEM reference — run scripts/migrate-legacy.mjs first'); return; }
  const snapFile = readdirSync(migrationDir).find((f) => /^legacy-sem\.snapshot-.*\.json$/.test(f));
  if (!snapFile) { console.log('no migrated legacy-sem snapshot'); return; }
  const registry = JSON.parse(readFileSync(join(repoRoot, 'schema/registry.json'), 'utf8'));
  const base = JSON.parse(readFileSync(join(migrationDir, snapFile), 'utf8'));
  const parsed = parsePathExpression(START_VIEW_PATH);
  const protocol = { startedAt: new Date().toISOString(), machine: process.platform, node: process.version, limits: { importMs: 30_000 }, baseline: {}, stands: [], summary: {} };

  // ---- (1) baseline import + projection (AK 10 indicator) ----
  const store = createTenantStore();
  let t = performance.now();
  const res = importSnapshot(store, registry, base, YES);
  const importMs = Math.round(performance.now() - t);
  if (res.status !== 'imported') { console.error('baseline import failed:', res.reason); process.exit(1); }
  t = performance.now();
  const proj = projectView({ store, parsed, roots: [ROOT], depth: 3 });
  const projectMs = Math.round(performance.now() - t);
  protocol.baseline = {
    importMs, projectMs,
    nodes: store.nodes.size, edges: store.edges.size,
    visibleNodes: proj.counters.visibleNodes, visibleEdges: proj.counters.visibleEdges,
    footprintBytes: storeFootprintBytes(store),
    importUnderLimit: importMs < 30_000,
  };
  console.log(`baseline: import ${importMs}ms (${importMs < 30_000 ? 'OK' : 'LIMIT EXCEEDED'} vs 30s), projection ${projectMs}ms, footprint ${(protocol.baseline.footprintBytes / 1e6).toFixed(1)} MB`);
  console.log('NOTE (NFR-3): <200ms block / <500ms progress are browser criteria — the v2 boot still imports in ONE synchronous block; async batching is OPEN.');

  // ---- (2) AK 37: synthetic stand series (~2% change each) ----
  for (let i = 1; i <= STANDS; i++) {
    const snap = syntheticStand(base, i);
    const t0 = performance.now();
    const r = importSnapshot(store, registry, snap, YES);
    const ms = Math.round(performance.now() - t0);
    if (r.status !== 'imported') { console.error(`stand ${i} failed:`, r.status, r.reason); process.exit(1); }
    const entry = { stand: i, stamp: snap.meta.snapshot, importMs: ms, underLimit: ms < 30_000, counters: r.report.counters, footprintBytes: storeFootprintBytes(store) };
    protocol.stands.push(entry);
    console.log(`stand ${String(i).padStart(2)}: import ${String(ms).padStart(6)}ms ${entry.underLimit ? 'OK' : 'LIMIT EXCEEDED'} — changed ${r.report.counters.f}, footprint ${(entry.footprintBytes / 1e6).toFixed(1)} MB`);
  }

  // final projection responsiveness after the full series (FR-8.1)
  t = performance.now();
  const finalProj = projectView({ store, parsed, roots: [ROOT], depth: 3 });
  const finalProjectMs = Math.round(performance.now() - t);
  protocol.summary = {
    stands: STANDS,
    allUnderLimit: protocol.stands.every((s) => s.underLimit),
    maxImportMs: Math.max(...protocol.stands.map((s) => s.importMs)),
    finalProjectMs,
    finalVisibleNodes: finalProj.counters.visibleNodes,
    finalFootprintBytes: protocol.stands.at(-1).footprintBytes,
    footprintGrowthFactor: +(protocol.stands.at(-1).footprintBytes / protocol.baseline.footprintBytes).toFixed(2),
  };
  console.log(`\nAK 37 summary: ${STANDS} stands, max import ${protocol.summary.maxImportMs}ms (all under 30s: ${protocol.summary.allUnderLimit}), final projection ${finalProjectMs}ms (${finalProj.counters.visibleNodes} visible), footprint x${protocol.summary.footprintGrowthFactor} -> ${(protocol.summary.finalFootprintBytes / 1e6).toFixed(1)} MB`);

  const out = join(migrationDir, 'nfr-protocol.json');
  writeFileSync(out, JSON.stringify(protocol, null, 2));
  console.log(`protocol written: ${out}`);
}

main();
