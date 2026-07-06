// AK 1 early indicator (PRD §13, E71): engine-side projection counts of the
// start view on the migrated SEM reference dataset — root "Vincenzo Mascioli",
// depth 3, expectation 487 visible nodes / 793 visible edges / 69 ring groups
// against PRD-Reference-Screenshot.png (v1.27.14). The hard Playwright check
// on SVG layers lands with stage 5; this script is the loop's continuous
// early measurement on the development environment (AK 10 note).
// Reads local data/migration output (git-ignored) — exits gracefully when the
// migration has not been run on this machine.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTenantStore } from '../src/sections/23-og2-store.js';
import { importSnapshot } from '../src/sections/26-og2-import.js';
import { parsePathExpression, validateView } from '../src/sections/27-og2-path.js';
import { projectView } from '../src/sections/28-og2-project.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = join(repoRoot, 'data/migration');

// The start view is tenant configuration (FR-7.4, E14 fixture): the concrete
// type names come from the HIL-1 registry commit; the projection semantics
// (three hops, cluster ancestors, role ring) are normative.
const START_VIEW = {
  path: 'Person (<--berichtetAn-- Person, --mitgliedIn--> OE[cluster] --unterstellt--> OE[cluster], --hatRolle--> Rolle[ring], --imTeam--> Team[ring], --besuchte--> Training[ring], --imGremium--> Gremium[ring], --arbeitetAn--> Projekt[ring], --hatKontakt--> Kontaktart[ring])',
  roots: ['__auto__'],
  depth: 3,
};
const ROOT_LABEL = 'Vincenzo Mascioli';
const EXPECTED = { nodes: 487, edges: 793, ringGroups: 69 };

function main() {
  if (!existsSync(migrationDir)) {
    console.log('no data/migration output on this machine — run scripts/migrate-legacy.mjs first');
    process.exit(0);
  }
  const snapFile = readdirSync(migrationDir).find((f) => /^legacy-sem\.snapshot-.*\.json$/.test(f));
  if (!snapFile) {
    console.log('no legacy-sem snapshot in data/migration — run scripts/migrate-legacy.mjs first');
    process.exit(0);
  }
  const registry = JSON.parse(readFileSync(join(repoRoot, 'schema/registry.json'), 'utf8'));
  const snapshot = JSON.parse(readFileSync(join(migrationDir, snapFile), 'utf8'));

  const validation = validateView(START_VIEW, registry);
  if (!validation.ok) {
    console.error('start view invalid against tenant registry:', validation.errors);
    process.exit(1);
  }

  const store = createTenantStore();
  const hooks = {
    confirmSourceRegistration: () => ({ ok: true, moveOutEdgeTypes: [] }),
    confirmJoin: () => true,
    confirmGate: () => true,
    confirmDestructive: () => true,
    confirmAuthority: () => true,
  };
  const t0 = performance.now();
  const res = importSnapshot(store, registry, snapshot, hooks);
  const importMs = Math.round(performance.now() - t0);
  if (res.status !== 'imported') {
    console.error('reference import failed:', res.status, res.reason ?? '');
    process.exit(1);
  }

  const rootRecord = snapshot.nodes.find((n) => n.label === ROOT_LABEL);
  if (!rootRecord) {
    console.error(`root "${ROOT_LABEL}" not found in the reference snapshot`);
    process.exit(1);
  }

  const parsed = parsePathExpression(START_VIEW.path);
  const t1 = performance.now();
  const projection = projectView({
    store: res.store ?? store,
    parsed,
    roots: [rootRecord.id],
    depth: START_VIEW.depth,
  });
  const projectMs = Math.round(performance.now() - t1);

  const byRender = { node: 0, cluster: 0 };
  const byType = {};
  for (const entry of projection.nodes.values()) {
    byRender[entry.render] = (byRender[entry.render] || 0) + 1;
    byType[entry.type] = (byType[entry.type] || 0) + 1;
  }
  const edgesByType = {};
  for (const e of projection.edges) edgesByType[e.type] = (edgesByType[e.type] || 0) + 1;

  console.log(`import: ${importMs}ms (${store.nodes.size} nodes / ${store.edges.size} edges), projection: ${projectMs}ms`);
  console.log(`root: ${rootRecord.id} (${ROOT_LABEL}), depth ${START_VIEW.depth}`);
  console.log(`visible nodes total: ${projection.counters.visibleNodes} — by render ${JSON.stringify(byRender)}, by type ${JSON.stringify(byType)}`);
  console.log(`visible edges: ${projection.counters.visibleEdges} — by type ${JSON.stringify(edgesByType)} + ${projection.derivedEdges.length} derived`);
  console.log(`ring badges: ${projection.counters.ringNodes}, ring groups (distinct ring nodes): ${projection.counters.ringGroups}`);
  console.log(`truncated: ${projection.truncated} (skipped >= ${projection.skipped})`);
  console.log(`reference (AK 1, SVG layers): ${EXPECTED.nodes} nodes / ${EXPECTED.edges} edges / ${EXPECTED.ringGroups} ring groups`);
  const nodeLayer = byRender.node || 0;
  console.log(`indicator node layer (render=node): ${nodeLayer} vs ${EXPECTED.nodes} -> ${nodeLayer === EXPECTED.nodes ? 'MATCH' : 'diff ' + (nodeLayer - EXPECTED.nodes)}`);
  console.log(`indicator ring groups: ${projection.counters.ringGroups} vs ${EXPECTED.ringGroups} -> ${projection.counters.ringGroups === EXPECTED.ringGroups ? 'MATCH' : 'diff ' + (projection.counters.ringGroups - EXPECTED.ringGroups)}`);
}

main();
