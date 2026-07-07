// OrgGraph 2.0 — UI wiring of the v2 data path: boot from the persisted
// tenant store, snapshot import with its confirmation dialogs (product HILs,
// §1.5), translation of stock + projection into the globals the layout/render
// machinery consumes (§9.2), and the reactive apply path (FR-8.11).
import { KEY_STORE, KEY_STORE_PART_PREFIX, KEY_REGISTRY, KEY_ENV, KEY_UI_STATE, getStoredText, getStoredJson, getPendingSnapshots, putStored, delStored, looksLikeRegistry, looksLikeSnapshot } from './04-storage.js';
import { deserializeTenantStore, serializeTenantStoreParts, deserializeTenantStoreParts, isChunkedStoreHeader, createOg2State, og2ActiveView, og2Project, og2BuildGlobalsData, og2ResolveAnchorRoot, og2TimeInstants, og2ProjectDiff } from './29-og2-app.js';
import { createTenantStore } from './23-og2-store.js';
import { importSnapshotAsync } from './26-og2-import.js';
import { validateViews } from './27-og2-path.js';
import { createLegendRow } from './12-legend-org.js';

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
  const canFetch = typeof location === 'undefined' || location.protocol !== 'file:';
  if (!registry && canFetch && envConfig && (envConfig.REGISTRY_URL || envConfig.VIEWS)) {
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
      if (isChunkedStoreHeader(storedStore)) {
        // v2 chunked layout (FR-8.9): header under KEY_STORE, parts alongside
        const partCount = JSON.parse(storedStore).parts;
        const parts = [];
        for (let i = 0; i < partCount; i++) parts.push(await getStoredText(KEY_STORE_PART_PREFIX + i));
        store = deserializeTenantStoreParts(storedStore, parts);
      } else {
        store = deserializeTenantStore(storedStore); // v1 single document
      }
    } catch (e) {
      console.error('Gespeicherter Tenant-Store ist nicht lesbar:', e);
      setStatus('Tenant-Store beschädigt — bitte Snapshots erneut importieren.');
      store = createTenantStore();
    }
  } else {
    store = createTenantStore();
  }

  // NFR-3: guarantee a painted progress hint before the import starts. The
  // import itself runs batched (importSnapshotAsync yields to the event loop
  // every 2000 entries and at phase boundaries); the residual single blocks
  // are deepClone/validate (~1-2s on the 62k reference) — noted for AK 10.
  const og2YieldPaint = async (message) => {
    setStatus(message);
    await new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
      else setTimeout(resolve, 0);
    });
  };
  // NFR-3 frame yield for the batched import: hand control back to the event
  // loop at every generator checkpoint so paints and input stay live.
  const og2FrameYield = () => new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });

  // Import snapshots dropped before this boot, with their dialogs (E25).
  const pending = await getPendingSnapshots();
  let imported = 0;
  for (const p of pending) {
    let snapshot = null;
    try { snapshot = JSON.parse(p.text); } catch { /* classified as snapshot, so parseable — defensive */ }
    if (snapshot) {
      await og2YieldPaint(`Importiere ${p.filename} …`);
      const res = await importSnapshotAsync(store, registry, snapshot, og2UiHooks(), og2FrameYield);
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
  // Dev fallback: seed an empty store from the env's snapshot URL(s)
  // (FR-8.10; an array imports consecutive stands in order).
  const seedUrls = canFetch && envConfig && envConfig.DATA_URL
    ? (Array.isArray(envConfig.DATA_URL) ? envConfig.DATA_URL : [envConfig.DATA_URL])
    : [];
  if (store.nodes.size === 0) for (const seedUrl of seedUrls) {
    try {
      const res = await fetch(seedUrl, { cache: 'no-store' });
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
          await og2YieldPaint(`Importiere Snapshot (${seedUrl}) …`);
          const imp = await importSnapshotAsync(store, registry, snapshot, seedHooks, og2FrameYield);
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
  if (imported > 0) {
    // v2 chunked persist: parts first, then the header (a reader never sees
    // a header pointing at missing parts); stale surplus parts are removed.
    const prevParts = isChunkedStoreHeader(storedStore) ? JSON.parse(storedStore).parts : 0;
    const { header, parts } = serializeTenantStoreParts(store);
    for (let i = 0; i < parts.length; i++) await putStored(KEY_STORE_PART_PREFIX + i, parts[i]);
    await putStored(KEY_STORE, header);
    for (let i = parts.length; i < prevParts; i++) await delStored(KEY_STORE_PART_PREFIX + i);
  }

  og2 = createOg2State({ store, registry, env: envConfig || {} });
  const rejectedNames = Object.keys(og2.rejectedViews);
  if (rejectedNames.length) {
    // §7 / AK 84: never a silent blank — report each rejected view.
    const lines = rejectedNames.map((n) => `${n}: ${og2.rejectedViews[n].join('; ')}`);
    showTemporaryNotification(`Ungültige View-Konfiguration:\n${lines.join('\n')}`, 10000);
  }
  // FR-8.14: restore the persisted session state before the first render —
  // og2 fields before the stock globals (the combo domain follows the active
  // view), id-dependent parts after them (they filter against byId).
  og2ApplySessionStateEarly();
  og2SyncStockGlobals();
  og2ApplySessionStateLate();
  og2BuildViewsLegend();
  og2BuildTimeControls();
  og2InstallStatePersistence();
  return true;
}

// --- FR-7.5b view contexts + FR-8.14 session state --------------------------
// Every view owns its runtime context (roots, depth, time slice, cluster and
// ring selection, focus). Switching views captures the leaving view's context
// and re-applies the entered view's one; a view entered for the first time
// starts from its definition defaults. The session state persists ALL
// contexts, so returning to a view reproduces its exact last scene — also
// across reloads.

let og2PendingUiState = null;
let og2StateRestored = false;
let og2PersistTimer = null;

export function og2UiStateWasRestored() {
  return og2StateRestored;
}

// True when the restored session carries a context for the ACTIVE view — the
// env start defaults (GRAPH_START_ID_DEFAULT) only apply without one.
export function og2ActiveViewHasContext() {
  return !!(og2StateRestored && og2 && og2.viewContexts && og2.viewContexts[og2.activeViewName]);
}

// v1 session states (flat, pre view-context) convert into one view context.
function og2NormalizeUiState(state) {
  if (!state || typeof state !== 'object') return null;
  if (state.v === 2) return state;
  const ctx = {
    runtimeRoots: state.runtimeRoots || null,
    selectedRootIds: state.selectedRootIds || [],
    currentSelectedId: state.currentSelectedId != null ? String(state.currentSelectedId) : null,
    depth: state.depth,
    asOf: state.asOf || null,
    diff: state.diff || null,
    scopeOrgs: state.scopeOrgs || null,
    allowedOrgs: state.allowedOrgs || [],
    attributesOff: state.attributesOff || [],
    hiddenCategories: state.hiddenCategories || [],
    attributeFocus: !!state.attributeFocus,
  };
  return {
    v: 2,
    activeViewName: state.activeViewName || null,
    viewContexts: state.activeViewName ? { [state.activeViewName]: ctx } : {},
    global: {
      management: state.management,
      labels: state.labels,
      layout: state.layout,
      simulation: state.simulation,
      pseudo: state.pseudo,
      hiddenByRoot: state.hiddenByRoot || [],
    },
  };
}

// Runs right after loadEnvConfig and BEFORE the toolbar default wiring: maps
// the persisted app-wide toggles onto the in-memory env defaults so the
// existing TOOLBAR_* initialization applies them — restored state supersedes
// env start defaults (FR-8.14). The og2 view contexts wait for og2TryBoot.
export async function og2PreloadUiState() {
  let state = null;
  try { state = await getStoredJson(KEY_UI_STATE); } catch { return; }
  state = og2NormalizeUiState(state);
  if (!state) return;
  og2PendingUiState = state;
  if (!envConfig) return;
  const g = state.global || {};
  if (typeof g.management === 'boolean') envConfig.TOOLBAR_MANAGEMENT_ACTIVE = g.management;
  if (typeof g.labels === 'string') envConfig.TOOLBAR_LABELS_ACTIVE = g.labels;
  if (typeof g.layout === 'string') envConfig.TOOLBAR_HIERARCHY_ACTIVE = g.layout === 'hierarchy';
  if (typeof g.simulation === 'boolean') envConfig.TOOLBAR_SIMULATION_ACTIVE = g.simulation;
  // Pseudo restores fail-closed: only ever towards ON — a stored "off" never
  // supersedes the env default or the built-in default "on" (FR-8.5/FR-8.14).
  if (g.pseudo === true) envConfig.TOOLBAR_PSEUDO_ACTIVE = true;
}

// Capture the ACTIVE view's runtime context (FR-7.5b) into og2.viewContexts.
function og2CaptureViewContext() {
  if (!og2 || !og2.activeViewName) return;
  og2.viewContexts = og2.viewContexts || {};
  const depthEl = document.querySelector(INPUT_DEPTH_ID);
  const uiDepth = depthEl ? parseInt(depthEl.value, 10) : NaN;
  og2.viewContexts[og2.activeViewName] = {
    runtimeRoots: og2.runtimeRoots ? og2.runtimeRoots.map(String) : null,
    selectedRootIds: Array.isArray(selectedRootIds) ? selectedRootIds.map(String) : [],
    currentSelectedId: currentSelectedId != null ? String(currentSelectedId) : null,
    depth: Number.isFinite(uiDepth) ? uiDepth : og2.runtimeDepth,
    asOf: og2.asOf,
    diff: og2.diff,
    scopeOrgs: og2.lastScopeOrgs ? [...og2.lastScopeOrgs] : null,
    allowedOrgs: [...allowedOrgs],
    attributesOff: [...attributeTypes.keys()].filter(k => !activeAttributes.has(k)),
    hiddenCategories: [...hiddenCategories],
    attributeFocus: !!attributeFocusEnabled,
  };
}

// Apply a view's stored context — or its definition defaults when the view is
// entered for the first time (FR-7.5b). validateIds=false during the early
// boot restore (byId is not built yet); the late pass re-applies with checks.
function og2ApplyViewContext(name, { validateIds = true } = {}) {
  if (!og2) return;
  const view = name ? og2.views[name] : null;
  const ctx = name && og2.viewContexts ? og2.viewContexts[name] : null;
  const knownId = (id) => !validateIds || (typeof byId !== 'undefined' && byId.has(String(id)));

  // fresh-view defaults (FR-8.2a: all clusters visible, no overrides)
  og2.runtimeRoots = null;
  og2.runtimeDepth = null;
  og2.asOf = null;
  og2.diff = null;
  og2.lastScopeOrgs = null;
  selectedRootIds = [];
  currentSelectedId = null;
  og2.pendingAttributesOff = new Set();
  hiddenCategories = new Set();
  attributeFocusEnabled = false;
  let depth = view && view.depth != null ? view.depth : null;

  if (ctx) {
    const roots = (ctx.runtimeRoots || []).map(String).filter(knownId);
    if (roots.length) og2.runtimeRoots = roots;
    const sel = (ctx.selectedRootIds || []).map(String).filter(knownId);
    if (sel.length) {
      selectedRootIds = sel;
      currentSelectedId = sel[0];
    } else if (ctx.currentSelectedId != null && knownId(ctx.currentSelectedId)) {
      currentSelectedId = String(ctx.currentSelectedId);
    }
    if (Number.isFinite(ctx.depth)) depth = ctx.depth;
    const instants = og2TimeInstants(og2);
    if (ctx.asOf && instants.includes(ctx.asOf) && ctx.asOf !== instants[instants.length - 1]) og2.asOf = ctx.asOf;
    if (ctx.diff && ctx.diff.t1 && ctx.diff.t2 && instants.includes(ctx.diff.t1) && instants.includes(ctx.diff.t2)) {
      og2.diff = { t1: ctx.diff.t1, t2: ctx.diff.t2 };
    }
    if (Array.isArray(ctx.scopeOrgs)) {
      og2.lastScopeOrgs = new Set(ctx.scopeOrgs.map(String));
      allowedOrgs = new Set((ctx.allowedOrgs || []).map(String));
    }
    og2.pendingAttributesOff = new Set((ctx.attributesOff || []).map(String));
    hiddenCategories = new Set((ctx.hiddenCategories || []).map(String));
    attributeFocusEnabled = !!ctx.attributeFocus;
  }

  if (Number.isFinite(depth)) {
    og2.runtimeDepth = depth;
    const depthEl = document.querySelector(INPUT_DEPTH_ID);
    if (depthEl) {
      depthEl.value = depth;
      const display = document.querySelector('#depthControl .depth-value');
      if (display) display.textContent = String(depth);
    }
  }
  const focusBtn = document.getElementById('toggleAttributeFocus');
  if (focusBtn) focusBtn.classList.toggle('active', attributeFocusEnabled);
}

// og2-owned restore parts; unresolvable pieces fall back individually.
function og2ApplySessionStateEarly() {
  const s = og2PendingUiState;
  if (!s || !og2) return;
  og2StateRestored = true;
  og2.viewContexts = (s.viewContexts && typeof s.viewContexts === 'object') ? s.viewContexts : {};
  if (s.activeViewName && og2.views[s.activeViewName]) og2.activeViewName = s.activeViewName;
  og2ApplyViewContext(og2.activeViewName, { validateIds: false });
}

function og2ApplySessionStateLate() {
  const s = og2PendingUiState;
  if (!s || !og2) return;
  og2PendingUiState = null;
  // re-apply the active context with id validation (byId is ready now)
  og2ApplyViewContext(og2.activeViewName, { validateIds: true });
  const g = s.global || {};
  if (Array.isArray(g.hiddenByRoot)) {
    hiddenByRoot = new Map();
    for (const [rootId, ids] of g.hiddenByRoot) {
      if (!byId.has(String(rootId))) continue;
      hiddenByRoot.set(String(rootId), new Set((ids || []).map(String).filter(id => byId.has(id))));
    }
    if (typeof recomputeHiddenNodes === 'function') recomputeHiddenNodes();
  }
}

function og2CollectUiState() {
  if (!og2) return null;
  og2CaptureViewContext();
  return {
    v: 2,
    activeViewName: og2.activeViewName,
    viewContexts: og2.viewContexts || {},
    global: {
      management: !!managementEnabled,
      labels: labelsVisible,
      layout: currentLayoutMode,
      simulation: !!continuousSimulation,
      pseudo: !!pseudonymizationEnabled,
      hiddenByRoot: [...hiddenByRoot.entries()].map(([r, set]) => [r, [...set]]),
    },
  };
}

export async function og2PersistUiStateNow() {
  if (!og2) return;
  if (og2PersistTimer) { clearTimeout(og2PersistTimer); og2PersistTimer = null; }
  const state = og2CollectUiState();
  if (!state) return;
  try {
    await putStored(KEY_UI_STATE, JSON.stringify(state));
  } catch (e) {
    console.warn('UI-State nicht persistierbar:', e);
  }
}

export function og2PersistUiStateSoon() {
  if (!og2) return;
  if (og2PersistTimer) clearTimeout(og2PersistTimer);
  og2PersistTimer = setTimeout(() => { og2PersistTimer = null; og2PersistUiStateNow(); }, 400);
}

function og2InstallStatePersistence() {
  if (og2InstallStatePersistence.done) return;
  og2InstallStatePersistence.done = true;
  // FR-8.14: toggles that do not run through og2ApplyFromUI (labels, layout,
  // simulation, pseudo, legend eyes) still change state — any click/change
  // schedules a debounced snapshot; the debounce runs after their handlers.
  document.addEventListener('click', () => og2PersistUiStateSoon());
  document.addEventListener('change', () => og2PersistUiStateSoon());
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

// Views legend (FR-7.5): the topmost sidebar section replaces the former
// footer switcher — one row per configured view, active view marked, invalid
// views greyed out with their rejection reason (§7, AK 84), plus the
// save-current-view action (FR-7.5a).
export function og2BuildViewsLegend() {
  const section = document.getElementById('viewsSection');
  const host = document.getElementById('viewsLegend');
  if (!section || !host) return;
  if (!og2) { section.style.display = 'none'; return; }
  section.style.display = '';
  host.innerHTML = '';
  const describe = (name) => {
    const rawDef = og2.env && og2.env.VIEWS ? og2.env.VIEWS[name] : null;
    if (!rawDef) return name;
    const parts = [];
    if (rawDef.path) parts.push(String(rawDef.path));
    if (rawDef.depth != null) parts.push(`Tiefe ${rawDef.depth}`);
    return parts.join(' — ') || name;
  };
  const makeRow = (name, { invalid = false, title }) => {
    const { row, left } = createLegendRow({ active: !invalid && name === og2.activeViewName, withRight: false });
    row.classList.add('view-row');
    if (invalid) row.classList.add('view-row-invalid');
    row.title = title;
    const label = document.createElement('span');
    label.className = 'legend-label-chip';
    label.textContent = name;
    left.appendChild(label);
    if (!invalid) row.addEventListener('click', () => og2SwitchView(name));
    host.appendChild(row);
  };
  for (const name of Object.keys(og2.views)) makeRow(name, { title: describe(name) });
  for (const [name, reasons] of Object.entries(og2.rejectedViews || {})) {
    makeRow(name, { invalid: true, title: `Ungültig: ${(reasons || []).join('; ')}` });
  }
  const saveBtn = document.getElementById('saveViewBtn');
  if (saveBtn && !saveBtn.dataset.og2Wired) {
    saveBtn.dataset.og2Wired = '1';
    saveBtn.addEventListener('click', (e) => { e.stopPropagation(); og2SaveCurrentView(); });
  }
}

// Save the current scene as a named view (FR-7.5a): the active view's path
// with the effective runtime overrides (roots FR-7.6, depth FR-7.7) becomes a
// new named entry in env.VIEWS, validated like any configured view and
// persisted in the tenant store — never a silent overwrite.
export async function og2SaveCurrentView() {
  if (!og2 || !og2.activeViewName) {
    showTemporaryNotification('Keine aktive View — nichts zu speichern.', 4000);
    return;
  }
  const baseRaw = og2.env && og2.env.VIEWS ? og2.env.VIEWS[og2.activeViewName] : null;
  if (!baseRaw) {
    showTemporaryNotification('Die aktive Ansicht hat keine View-Konfiguration als Basis (Diagnose-Projektion) — bitte zuerst eine konfigurierte View wählen.', 6000);
    return;
  }
  const name = (window.prompt('Name der neuen View:') || '').trim();
  if (!name) return;
  if ((og2.env.VIEWS && Object.prototype.hasOwnProperty.call(og2.env.VIEWS, name)) || og2.views[name] || (og2.rejectedViews && og2.rejectedViews[name])) {
    showTemporaryNotification(`View «${name}» existiert bereits — bitte einen anderen Namen wählen (kein Überschreiben, FR-7.5a).`, 6000);
    return;
  }
  const def = JSON.parse(JSON.stringify(baseRaw));
  if (og2.runtimeRoots && og2.runtimeRoots.length) def.roots = og2.runtimeRoots.map(String);
  const depthEl = document.querySelector(INPUT_DEPTH_ID);
  const uiDepth = depthEl ? parseInt(depthEl.value, 10) : NaN;
  if (Number.isFinite(uiDepth)) def.depth = uiDepth;
  else if (og2.runtimeDepth != null) def.depth = og2.runtimeDepth;
  const { valid, rejected } = validateViews({ [name]: def }, og2.registry);
  if (!valid[name]) {
    showTemporaryNotification(`View «${name}» ist ungültig: ${((rejected && rejected[name]) || []).join('; ')}`, 8000);
    return;
  }
  og2.env.VIEWS = og2.env.VIEWS || {};
  og2.env.VIEWS[name] = def;
  og2.views[name] = valid[name];
  try {
    await putStored(KEY_ENV, JSON.stringify(og2.env));
  } catch (e) {
    console.error('View-Persistenz fehlgeschlagen:', e);
    showTemporaryNotification('View konnte nicht gespeichert werden — Details in der Konsole.', 6000);
    return;
  }
  og2SwitchView(name);
  og2BuildViewsLegend();
  await og2PersistUiStateNow(); // the new active view must survive an immediate reload
  showTemporaryNotification(`View «${name}» gespeichert.`, 4000);
}

// Footer time controls (FR-8.6): asOf slider and diff pickers live next to
// the view switcher. With fewer than two snapshot stands they stay VISIBLE
// but disabled, with an explaining tooltip (AK 50); default is asOf on the
// youngest instant.
export function og2BuildTimeControls() {
  const host = document.querySelector('.footer-stats');
  if (!og2 || !host) return;
  const instants = og2TimeInstants(og2);
  let wrap = document.getElementById('timeControls');
  if (!wrap) {
    wrap = document.createElement('span');
    wrap.id = 'timeControls';
    wrap.className = 'time-controls';
    wrap.innerHTML = '<span>Zeit: </span>'
      + '<input type="range" id="timeSlider" min="0" max="0" step="1" />'
      + '<span id="timeStamp"></span>'
      + '<select id="diffT1" title="Diff T1"></select>'
      + '<select id="diffT2" title="Diff T2"></select>'
      + '<button id="diffToggle" class="toggle-btn" title="Diff-Modus T1→T2">Δ</button>';
    const sep = document.createElement('span');
    sep.className = 'stat-separator';
    sep.textContent = '|';
    // FR-8.6: the time controls lead the footer; the view switch lives in
    // the views legend since the FR-7.5 revision.
    host.prepend(sep);
    host.prepend(wrap);
    wrap.querySelector('#timeSlider').addEventListener('input', () => {
      const list = og2TimeInstants(og2);
      const idx = parseInt(wrap.querySelector('#timeSlider').value, 10);
      // youngest = live view (open intervals), older stands slice via asOf
      og2.asOf = idx >= list.length - 1 ? null : list[idx];
      og2.diff = null;
      og2SyncTimeControls();
      applyFromUI('timeSlider');
    });
    wrap.querySelector('#diffToggle').addEventListener('click', () => {
      const t1 = wrap.querySelector('#diffT1').value;
      const t2 = wrap.querySelector('#diffT2').value;
      if (og2.diff) og2.diff = null;
      else if (t1 && t2 && t1 !== t2) og2.diff = { t1, t2 };
      og2SyncTimeControls();
      applyFromUI('diffToggle');
    });
  }
  og2SyncTimeControls();
}

export function og2SyncTimeControls() {
  const wrap = document.getElementById('timeControls');
  if (!wrap || !og2) return;
  const instants = og2TimeInstants(og2);
  const enabled = instants.length >= 2;
  const slider = wrap.querySelector('#timeSlider');
  const t1Sel = wrap.querySelector('#diffT1');
  const t2Sel = wrap.querySelector('#diffT2');
  const toggle = wrap.querySelector('#diffToggle');
  const hint = 'Zeitnavigation braucht mindestens zwei Snapshot-Stände (FR-8.6).';
  for (const el of [slider, t1Sel, t2Sel, toggle]) {
    el.disabled = !enabled;
    el.title = enabled ? el.title : hint;
  }
  slider.max = String(Math.max(0, instants.length - 1));
  const activeIdx = og2.asOf ? Math.max(0, instants.indexOf(og2.asOf)) : Math.max(0, instants.length - 1);
  slider.value = String(activeIdx);
  wrap.querySelector('#timeStamp').textContent = og2.diff
    ? `${og2.diff.t1} → ${og2.diff.t2}`
    : (og2.asOf || (instants.length ? instants[instants.length - 1] : '—'));
  const fill = (sel, def) => {
    sel.innerHTML = '';
    for (const t of instants) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      sel.append(opt);
    }
    if (def) sel.value = def;
  };
  fill(t1Sel, og2.diff ? og2.diff.t1 : instants[0]);
  fill(t2Sel, og2.diff ? og2.diff.t2 : instants[instants.length - 1]);
  toggle.classList.toggle('active', !!og2.diff);
}

// Switch the active view (FR-7.5b): capture the leaving view's runtime
// context, re-apply the entered view's one (or its definition defaults on
// first entry); the search domain follows the new path's types (FR-7.6/8.4).
export function og2SwitchView(name) {
  if (!og2 || !og2.views[name] || name === og2.activeViewName) return;
  og2CaptureViewContext();
  og2.activeViewName = name;
  og2ApplyViewContext(name);
  og2SyncStockGlobals();
  og2BuildViewsLegend();
  og2SyncTimeControls();
  applyFromUI('viewSwitch');
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
  // globals; they override the view roots for this session. Non-anchor hits
  // resolve backwards to the nearest anchor node (E64) — an unreachable hit
  // reports instead of silently doing nothing (AK 40).
  const comboRoots = Array.isArray(selectedRootIds) && selectedRootIds.length > 0
    ? selectedRootIds.slice()
    : (currentSelectedId ? [String(currentSelectedId)] : null);
  if (comboRoots) {
    const resolved = [];
    for (const id of comboRoots) {
      const res = og2ResolveAnchorRoot(og2, id);
      if (res.ok) resolved.push(res.root);
      else setStatus(`«${id}» ist in dieser View nicht erreichbar — Root unverändert.`);
    }
    if (resolved.length) og2.runtimeRoots = resolved;
  }

  const res = og2.diff ? og2ProjectDiff(og2, og2.diff.t1, og2.diff.t2) : og2Project(og2);
  const projection = res.projection;
  og2.lastDiff = res.diff || null;

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
    // FR-7.5b/FR-8.14: on the first apply after a view switch or session
    // restore, the view context's ring selection replaces the carried-over
    // one — exactly the stored off-set is deselected, everything else is on.
    if (og2.pendingAttributesOff) {
      activeAttributes = new Set([...nextTypes.keys()].filter(k => !og2.pendingAttributesOff.has(k)));
      og2.pendingAttributesOff = null;
    }
    personAttributes = nextByHost;
    attributeTypes = nextTypes;
  }

  // Attribute focus (§9.4/FR-8.10a): prune the projected scene to visibly
  // attributed nodes, their tree connectors and the roots — the same
  // semantics as the legacy traversal, applied to the projection output.
  if (typeof attributeFocusEnabled !== 'undefined' && attributeFocusEnabled) {
    recomputeAttributeFocusHidden();
    const focusRoots = ((og2.runtimeRoots && og2.runtimeRoots.length ? og2.runtimeRoots : projection.resolvedRoots) || []).map(String);
    const keep = applyAttributeFocusToScene(sub.nodes.filter(n => n.kind === 'node'), sub.links, focusRoots);
    sub.nodes = sub.nodes.filter(n => n.kind !== 'node' || keep.has(String(n.id)));
    sub.links = sub.links.filter(l => keep.has(String(l.source)) && keep.has(String(l.target)));
  }

  // Cluster scope: hull roots = projected cluster nodes (FR-8.2). The user's
  // legend deselection is a runtime override (FR-8.2a): it survives every
  // parameter change (depth/time/filter/focus) — only clusters NEW to the
  // scope start visible; a view switch resets the override (FR-7.5).
  const scopeOrgs = new Set(sub.nodes.filter(n => n.kind === 'cluster').map(n => String(n.id)));
  if (!og2.lastScopeOrgs) {
    allowedOrgs = new Set(scopeOrgs);
  } else {
    const next = new Set();
    for (const id of scopeOrgs) {
      if (!og2.lastScopeOrgs.has(id) || allowedOrgs.has(id)) next.add(id);
    }
    allowedOrgs = next;
  }
  og2.lastScopeOrgs = scopeOrgs;

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
  } else if (og2.store && Array.isArray(og2.store.conflicts) && og2.store.conflicts.some(c => !c.resolved)) {
    // Open tie-breaker conflicts are visible, never silent (FR-5.6): the UI
    // shows the count, keeps the list inspectable and asks for a
    // SOURCE_PRECEDENCE decision (follow-up via applyPrecedenceToConflicts).
    const openConflicts = og2.store.conflicts.filter(c => !c.resolved);
    setStatus(`${openConflicts.length} offene Quell-Konflikte (Tie-Breaker) — SOURCE_PRECEDENCE festlegen; Details in der Konsole (FR-5.6).`);
    console.info('Offene Quell-Konflikte (FR-5.6):', openConflicts);
  }

  og2.lastProjection = { truncated: projection.truncated, skipped: projection.skipped, counters: projection.counters };
  const roots = (og2.runtimeRoots && og2.runtimeRoots.length ? og2.runtimeRoots : projection.resolvedRoots) || [];
  const oldSubgraph = currentSubgraph;
  currentSubgraph = sub;
  const transitionId = ++lastTransitionId;
  transitionGraph(oldSubgraph, sub, roots, transitionId).then(() => {
    if (transitionId !== lastTransitionId) return;
    updateFooterStats(sub);
    applyLegendScope(scopeOrgs);
    // Root changes via search/context menu re-center the scene (FR-8.13,
    // AK 40): after an E64-resolved hit the anchor scene must be in view —
    // parameter tweaks (depth/time/filter) keep the user's zoom untouched.
    if (triggerSource === 'comboSelect' || triggerSource === 'contextSetRoot' || triggerSource === 'legendSetRoot') {
      try { fitToViewport(); } catch (_) {}
    }
  });
  buildAttributeLegend();
  updateHiddenLegendTitle();
  lastRenderRoots = roots.slice();
  lastRenderDepth = og2.runtimeDepth;
  og2PersistUiStateSoon(); // FR-8.14: every applied parameter change persists
}
/* v8 ignore stop */
