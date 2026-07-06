// OrgGraph 2.0 — UI wiring of the v2 data path: boot from the persisted
// tenant store, snapshot import with its confirmation dialogs (product HILs,
// §1.5), translation of stock + projection into the globals the layout/render
// machinery consumes (§9.2), and the reactive apply path (FR-8.11).
import { KEY_STORE, KEY_REGISTRY, getStoredText, getStoredJson, getPendingSnapshots, putStored, delStored, looksLikeRegistry, looksLikeSnapshot } from './04-storage.js';
import { serializeTenantStore, deserializeTenantStore, createOg2State, og2ActiveView, og2Project, og2BuildGlobalsData } from './29-og2-app.js';
import { createTenantStore } from './23-og2-store.js';
import { importSnapshot } from './26-og2-import.js';

let og2 = null;

export function og2Active() {
  return og2 !== null;
}

export function og2State() {
  return og2;
}

/* v8 ignore start */
// Product HIL dialogs (FR-5.7, E46, E69, E70, FR-6.8): plain confirm dialogs
// for now — every decision point is injectable and covered by fixture tests
// at the engine level (E71); these are the interactive counterparts.
function og2UiHooks() {
  const ask = (title, detail) => window.confirm(`${title}\n\n${detail}`);
  return {
    confirmSourceRegistration: (info) => ({
      ok: ask('Neue Quelle registrieren?', `Quelle "${info && info.source}" ist diesem Mandanten unbekannt. Import nur nach bestätigter Registrierung (E70).`),
      moveOutEdgeTypes: [],
    }),
    confirmJoin: (info) => ask('Cross-Source-Join freigeben?', `Erstmaliger Anschluss an bestehende Identitäten (E69):\n${JSON.stringify(info && info.pairs || info || {}, null, 2).slice(0, 800)}`),
    confirmGate: (info) => ask('Plausibilitäts-Gate', `Der Import überschreitet eine 20%-Schwelle (FR-5.7):\n${JSON.stringify(info || {}, null, 2).slice(0, 800)}\nTrotzdem anwenden?`),
    confirmDestructive: (info) => ask('Destruktive Wirkungen bestätigen', `Bestätigungspflichtige Schliessungen (E70/FR-6.8):\n${JSON.stringify(info || {}, null, 2).slice(0, 800)}`),
    confirmAuthority: (info) => ask('Autoritäts-Antrag bestätigen', `Der Snapshot beansprucht Autorität über fremde Quellen (E46):\n${JSON.stringify(info || {}, null, 2).slice(0, 800)}`),
  };
}

// Boot the v2 tenant: registry + persisted store + pending dropped snapshots.
// Returns true when the v2 path owns this tenant (a registry is present).
// Dev fallback (FR-8.10): with a VIEWS-carrying env, the registry may come
// from REGISTRY_URL (default ./schema/registry.json) and an empty store is
// seeded from DATA_URL, which points at a graph SNAPSHOT in v2.
export async function og2TryBoot() {
  let registry = await getStoredJson(KEY_REGISTRY);
  if (!registry && envConfig && (envConfig.REGISTRY_URL || envConfig.VIEWS)) {
    try {
      const res = await fetch(envConfig.REGISTRY_URL || './schema/registry.json', { cache: 'no-store' });
      if (res.ok) registry = await res.json();
    } catch { /* dev fallback only */ }
  }
  // An empty bootstrap registry (version 0) never activates the v2 path.
  if (!registry || !looksLikeRegistry(registry) || Object.keys(registry.nodeTypes).length === 0) return false;

  let store;
  const storedStore = await getStoredText(KEY_STORE);
  if (storedStore != null) {
    try {
      store = deserializeTenantStore(storedStore);
    } catch (e) {
      console.error('Gespeicherter Tenant-Store ist nicht lesbar:', e);
      setStatus('Tenant-Store beschädigt — bitte Snapshots erneut importieren.');
      store = createTenantStore();
    }
  } else {
    store = createTenantStore();
  }

  // Import snapshots dropped before this boot, with their dialogs (E25).
  const pending = await getPendingSnapshots();
  let imported = 0;
  for (const p of pending) {
    let snapshot = null;
    try { snapshot = JSON.parse(p.text); } catch { /* classified as snapshot, so parseable — defensive */ }
    if (snapshot) {
      const res = importSnapshot(store, registry, snapshot, og2UiHooks());
      if (res.status === 'imported') {
        store = res.store || store;
        imported++;
        showTemporaryNotification(`Snapshot ${p.filename}: importiert`, 3000);
      } else if (res.status === 'noop') {
        showTemporaryNotification(`Snapshot ${p.filename}: bereits importiert`, 4000);
      } else {
        showTemporaryNotification(`Snapshot ${p.filename}: ${res.status}${res.reason ? ' — ' + res.reason : ''}`, 8000);
        console.warn('Snapshot-Import abgelehnt:', p.filename, res);
      }
    }
    await delStored(p.key);
  }
  // Dev fallback: seed an empty store from the env's snapshot URL (FR-8.10).
  if (store.nodes.size === 0 && envConfig && envConfig.DATA_URL) {
    try {
      const res = await fetch(envConfig.DATA_URL, { cache: 'no-store' });
      if (res.ok) {
        const snapshot = await res.json();
        if (looksLikeSnapshot(snapshot)) {
          // The env-configured reference snapshot is operator-shipped tenant
          // configuration: its source registration counts as confirmed by
          // the operator (E70 audit notes the env seed); interactive drops
          // keep their dialogs.
          const seedHooks = {
            confirmSourceRegistration: () => ({ ok: true, moveOutEdgeTypes: [], audit: 'env-seed (DATA_URL)' }),
            confirmJoin: () => true,
            confirmGate: () => true,
            confirmDestructive: () => true,
            confirmAuthority: () => true,
          };
          const imp = importSnapshot(store, registry, snapshot, seedHooks);
          if (imp.status === 'imported') {
            store = imp.store || store;
            imported++;
          } else {
            showTemporaryNotification(`Snapshot (DATA_URL): ${imp.status}${imp.reason ? ' — ' + imp.reason : ''}`, 8000);
          }
        }
      }
    } catch (e) { console.warn('DATA_URL-Snapshot nicht ladbar:', e); }
  }
  if (imported > 0) await putStored(KEY_STORE, serializeTenantStore(store));

  og2 = createOg2State({ store, registry, env: envConfig || {} });
  const rejectedNames = Object.keys(og2.rejectedViews);
  if (rejectedNames.length) {
    // §7 / AK 84: never a silent blank — report each rejected view.
    const lines = rejectedNames.map((n) => `${n}: ${og2.rejectedViews[n].join('; ')}`);
    showTemporaryNotification(`Ungültige View-Konfiguration:\n${lines.join('\n')}`, 10000);
  }
  og2SyncStockGlobals();
  return true;
}

// Fill the stock-shaped globals (raw/byId/…) from the tenant store so the
// search combo, legends and layout membership logic keep working unchanged.
export function og2SyncStockGlobals() {
  const data = og2BuildGlobalsData(og2);
  raw = { nodes: [...data.persons, ...data.orgs], links: data.links, persons: data.persons, orgs: data.orgs };
  byId = new Map(raw.nodes.map(n => [String(n.id), n]));
  allNodesUnique = Array.from(byId.values());
  orgParent = data.orgParent;
  orgChildren = data.orgChildren;
  orgRoots = data.orgRoots;
  parentOf = new Map(data.orgParent);
  hiddenNodes = hiddenNodes || new Set();
  hiddenByRoot = hiddenByRoot || new Map();
}

// Does the active view render without a manual root (own roots or __auto__)?
export function og2HasRenderableView() {
  const view = og2 && og2ActiveView(og2);
  return !!(view && Array.isArray(view.roots) && view.roots.length > 0);
}

// v2 apply path (FR-8.11): read runtime overrides, project, translate, hand
// over to the existing transition/render machinery, refresh legends/footer.
export function og2ApplyFromUI(triggerSource = 'unknown') {
  if (!og2) return;
  Logger.log(`[UI] og2ApplyFromUI triggered by: ${triggerSource}`);

  const depthEl = document.querySelector(INPUT_DEPTH_ID);
  const depth = depthEl ? parseInt(depthEl.value, 10) : NaN;
  og2.runtimeDepth = Number.isFinite(depth) ? depth : og2.runtimeDepth;

  // Combo/context-menu roots (FR-7.6): the combo keeps writing the v1
  // globals; they override the view roots for this session.
  const comboRoots = Array.isArray(selectedRootIds) && selectedRootIds.length > 0
    ? selectedRootIds.slice()
    : (currentSelectedId ? [String(currentSelectedId)] : null);
  og2.runtimeRoots = comboRoots || og2.runtimeRoots;

  const res = og2Project(og2);
  const projection = res.projection;

  // Leaf filter (FR-8.3, leafProp capability) and hidden subtrees (FR-8.7)
  // prune the drawn subgraph after projection.
  const nodeTypes = og2.registry.nodeTypes || {};
  const isLeafHidden = (n) => {
    if (!managementEnabled || n.kind !== 'node') return false;
    const leafPath = (nodeTypes[n.type] || {}).leafProp;
    const m = leafPath && /^props\.([^.]+)$/.exec(leafPath);
    return !!(m && n.props && n.props[m[1]] === true);
  };
  const dropped = new Set();
  for (const n of res.sub.nodes) {
    if (hiddenNodes.has(String(n.id)) || isLeafHidden(n)) dropped.add(String(n.id));
  }
  const sub = {
    nodes: res.sub.nodes.filter(n => !dropped.has(String(n.id))),
    links: res.sub.links.filter(l => !dropped.has(String(l.source)) && !dropped.has(String(l.target))),
  };
  currentHiddenCount = dropped.size;

  // Ring globals for the badge renderer and ring legend (FR-8.2).
  if (res.adapted) {
    const nextTypes = new Map();
    const nextByHost = new Map();
    for (const [host, ringMap] of res.adapted.ringsByHost) {
      const perHost = new Map();
      for (const [key, entry] of ringMap) {
        perHost.set(key, '');
        if (!nextTypes.has(key)) nextTypes.set(key, entry.color);
      }
      nextByHost.set(String(host), perHost);
    }
    for (const key of nextTypes.keys()) {
      if (!attributeTypes.has(key)) activeAttributes.add(key); // new groups start visible
    }
    for (const key of [...activeAttributes]) {
      if (!nextTypes.has(key)) activeAttributes.delete(key);
    }
    personAttributes = nextByHost;
    attributeTypes = nextTypes;
  }

  // Cluster scope: hull roots = projected cluster nodes (FR-8.2).
  const scopeOrgs = new Set(sub.nodes.filter(n => n.kind === 'cluster').map(n => String(n.id)));
  allowedOrgs = new Set(scopeOrgs);

  // Truncation hints (E67, FR-8.1/AK 63) — explicit, never silent.
  if (projection.notEvaluable) {
    setStatus('Nicht auswertbar — Projektion vor Filterung gekappt (Roots/Tiefe einschränken).');
  } else if (projection.cappedBeforeFilter) {
    setStatus(`Gekappt vor Filterung — Ergebnis möglicherweise unvollständig (mindestens ${projection.skipped} weitere).`);
  } else if (projection.truncated) {
    setStatus(`Projektion gekappt — Tiefe, Filter oder Roots einschränken (mindestens ${projection.skipped} weitere).`);
  } else if (projection.autoEmpty) {
    setStatus('Keine automatischen Wurzeln bestimmbar (Zyklus-Verdacht) — bitte Root über die Suche wählen.');
  } else if (res.mode === 'diagnosis' && projection.needsRoot) {
    setStatus('Keine View-Konfiguration — Diagnoseansicht: bitte Root über die Suche wählen.');
  }

  const roots = (og2.runtimeRoots && og2.runtimeRoots.length ? og2.runtimeRoots : projection.resolvedRoots) || [];
  const oldSubgraph = currentSubgraph;
  currentSubgraph = sub;
  const transitionId = ++lastTransitionId;
  transitionGraph(oldSubgraph, sub, roots, transitionId).then(() => {
    if (transitionId !== lastTransitionId) return;
    updateFooterStats(sub);
    applyLegendScope(scopeOrgs);
  });
  buildAttributeLegend();
  updateHiddenLegendTitle();
  lastRenderRoots = roots.slice();
  lastRenderDepth = og2.runtimeDepth;
}
/* v8 ignore stop */
