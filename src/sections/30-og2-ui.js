// OrgGraph 2.0 — UI wiring of the v2 data path: boot from the persisted
// tenant store, snapshot import with its confirmation dialogs (product HILs,
// §1.5), translation of stock + projection into the globals the layout/render
// machinery consumes (§9.2), and the reactive apply path (FR-8.11).
import { KEY_STORE, KEY_STORE_PART_PREFIX, KEY_REGISTRY, getStoredText, getStoredJson, getPendingSnapshots, putStored, delStored, looksLikeRegistry, looksLikeSnapshot } from './04-storage.js';
import { deserializeTenantStore, serializeTenantStoreParts, deserializeTenantStoreParts, isChunkedStoreHeader, createOg2State, og2ActiveView, og2Project, og2BuildGlobalsData, og2ResolveAnchorRoot, og2TimeInstants, og2ProjectDiff } from './29-og2-app.js';
import { createTenantStore } from './23-og2-store.js';
import { importSnapshotAsync } from './26-og2-import.js';

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
  og2SyncStockGlobals();
  og2BuildViewSwitcher();
  og2BuildTimeControls();
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

// Footer view switcher (FR-7.5), analogous to the profile switcher.
export function og2BuildViewSwitcher() {
  const host = document.querySelector('.footer-stats');
  if (!og2 || !host) return;
  let wrap = document.getElementById('viewSwitcher');
  const names = Object.keys(og2.views);
  if (names.length === 0) { if (wrap) wrap.remove(); return; }
  if (!wrap) {
    wrap = document.createElement('span');
    wrap.id = 'viewSwitcher';
    wrap.className = 'view-switcher';
    const label = document.createElement('span');
    label.textContent = 'View: ';
    const sel = document.createElement('select');
    sel.id = 'viewSwitcherSelect';
    sel.addEventListener('change', () => og2SwitchView(sel.value));
    wrap.append(label, sel);
    const sep = document.createElement('span');
    sep.className = 'stat-separator';
    sep.textContent = '|';
    host.prepend(sep);
    host.prepend(wrap);
  }
  const sel = wrap.querySelector('select');
  sel.innerHTML = '';
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === og2.activeViewName) opt.selected = true;
    sel.append(opt);
  }
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
    const anchor = document.getElementById('viewSwitcher');
    if (anchor && anchor.nextSibling) {
      host.insertBefore(wrap, anchor.nextSibling.nextSibling || null);
      host.insertBefore(sep, wrap);
    } else {
      host.prepend(sep);
      host.prepend(wrap);
    }
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

// Switch the active view; runtime overrides reset (FR-7.5) and the search
// domain follows the new path's visible types (FR-7.6/8.4).
export function og2SwitchView(name) {
  if (!og2 || !og2.views[name] || name === og2.activeViewName) return;
  og2.activeViewName = name;
  og2.runtimeRoots = null;
  og2.runtimeDepth = null;
  selectedRootIds = [];
  currentSelectedId = null;
  const view = og2ActiveView(og2);
  const depthEl = document.querySelector(INPUT_DEPTH_ID);
  if (depthEl && view && view.depth != null) {
    depthEl.value = view.depth;
    const display = document.querySelector('#depthControl .depth-value');
    if (display) display.textContent = String(view.depth);
  }
  og2SyncStockGlobals();
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
}
/* v8 ignore stop */
