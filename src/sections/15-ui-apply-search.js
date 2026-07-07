export function applyFromUI(triggerSource = 'unknown', callStack = false) {
  Logger.log(`[Timing] Start: applyFromUI.${triggerSource}`);
  // OrgGraph 2.0 tenant: the projection-based apply path owns rendering.
  if (typeof og2Active === 'function' && og2Active()) { og2ApplyFromUI(triggerSource); return; }
  if (!raw || !raw.links || !raw.nodes) return;
  if (searchDebounceTimer) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }
  
  Logger.log(`[UI] applyFromUI triggered by: ${triggerSource}`);
  if (callStack && debugMode) console.trace();
  
  // Reset hidden count für neue Berechnung
  currentHiddenCount = 0;
  
  // Get current search input value
  const input = document.querySelector(INPUT_COMBO_ID);
  const inputValue = input?.value.trim() || '';

  // Get selected depth
  const depthEl = document.querySelector(INPUT_DEPTH_ID);
  const depth = depthEl ? parseInt(depthEl.value, 10) || 0 : 0;

  // Direction toggle removed (E22): the legacy subgraph traversal always
  // runs both directions; v2 direction semantics live in the view path.
  const dirMode = 'both';

  // Determine roots
  let roots = Array.isArray(selectedRootIds) && selectedRootIds.length > 0 ? selectedRootIds.slice() : [];
  if (roots.length === 0) {
    let startId = currentSelectedId;
    if (!startId && input && input.value) {
      startId = guessIdFromInput(input.value);
    }
    if (!startId) { setStatus("Startknoten nicht gefunden"); return; }
    roots = [String(startId)];
  }

  // Prüfen, ob sich die Root-Auswahl geändert hat (für BFS-Animation)
  const rootsKey = JSON.stringify(roots.slice().sort());
  const lastRootsKey = JSON.stringify((lastRenderRoots || []).slice().sort());
  const isNewRootSelection = rootsKey !== lastRootsKey;

  // Single-root or multi-root render
  let nextSubgraph;
  let scopeOrgs = new Set();

  if (roots.length === 1) {
    const startId = roots[0];
    // Merke letzten Einzel-Root für zukünftiges Shift-Add Seeding
    lastSingleRootId = String(startId);
    currentSelectedId = String(startId);
    nextSubgraph = computeSubgraph(startId, Number.isFinite(depth) ? depth : 2, dirMode);
    if (nextSubgraph.legendOrgs) scopeOrgs = nextSubgraph.legendOrgs;
  } else {
    // Multi-root: compute union of subgraphs
    const nodeMap = new Map();
    const linkSet = new Set();
    const effDepth = Number.isFinite(depth) ? depth : 2;
    
    for (const rid of roots) {
      const sub = computeSubgraph(rid, effDepth, dirMode);
      for (const n of sub.nodes) {
        const id = String(n.id);
        if (!nodeMap.has(id)) {
          nodeMap.set(id, { ...n });
        } else {
          const cur = nodeMap.get(id);
          cur.level = Math.min(cur.level || 0, n.level || 0);
          nodeMap.set(id, cur);
        }
      }
      for (const l of sub.links) {
        const s = idOf(l.source), t = idOf(l.target);
        linkSet.add(`${s}>${t}`);
      }
      // Add legend orgs from this subgraph
      if (sub.legendOrgs) {
        sub.legendOrgs.forEach(o => scopeOrgs.add(o));
      }
    }
    const nodes = Array.from(nodeMap.values());
    const links = Array.from(linkSet).map(k => {
      const [s, t] = k.split('>');
      return { source: s, target: t };
    });
    nextSubgraph = { nodes, links };
  }

  // Transition durchführen [SF][PA]
  const oldSubgraph = currentSubgraph;
  currentSubgraph = nextSubgraph;
  
  // Neue Transition ID generieren
  const transitionId = ++lastTransitionId;

  // Async Transition starten
  transitionGraph(oldSubgraph, nextSubgraph, roots, transitionId).then(() => {
    if (transitionId !== lastTransitionId) return; // Wenn veraltet, nichts mehr tun

    // Nach Abschluss sicherstellen, dass alles konsistent ist
    updateFooterStats(nextSubgraph);
    
    // Legende anwenden
    if (scopeOrgs.size > 0) {
      applyLegendScope(scopeOrgs);
      // syncGraphAndLegendColors() wird bereits in buildScopedOrgLegend() aufgerufen
    }
  });

  // Letzten Render-Zustand merken (für zukünftige Root-Wechsel-Erkennung)
  lastRenderRoots = roots.slice();
  lastRenderDepth = depth;
  lastRenderDirMode = dirMode;

  // Titel der Hidden-Legende aktualisieren nach allen Graph-Berechnungen
  updateHiddenLegendTitle();
}

// Legacy v1 attribute intake (TSV parser, Levenshtein fuzzy matching and the
// file loader) was torn down with the v1 data path (PRD §9.3/E25): in a v2
// tenant attributes are nodes/props in the snapshot and rings come from the
// view path — there is no attribute round-trip.

/**
 * Hilfsfunktionen für Icons (zentrale Registry ICON, siehe icons.js)
 */
