export function buildAdjacency(links) {
  const adj = new Map();
  
  // Hilfsfunktion zum Sicherstellen, dass der Knoten in der Map existiert
  const ensure = (id) => { 
    if (!adj.has(id)) adj.set(id, new Set()); 
  };
  
  // Verarbeite alle Verbindungen
  links.forEach(l => {
    const s = idOf(l.source);
    const t = idOf(l.target);
    ensure(s); 
    ensure(t);
    // Ungerichtete Kanten (beide Richtungen eintragen)
    adj.get(s).add(t);
    adj.get(t).add(s);
  });
  
  return adj;
}

export function computeSubgraph(startId, depth, mode) {
  const out = new Map();
  const inn = new Map();
  for (const l of raw.links) {
    const s = idOf(l.source);
    const t = idOf(l.target);
    if (!byId.has(s) || !byId.has(t)) continue;
    if (!out.has(s)) out.set(s, new Set());
    if (!inn.has(t)) inn.set(t, new Set());
    out.get(s).add(t);
    inn.get(t).add(s);
  }
  const seen = new Set();
  const dist = new Map(); 
  const q = [];
  if (!byId.has(startId)) return { nodes: [], links: [] };
  const startType = byId.get(startId)?.type;
  seen.add(startId); dist.set(startId, 0); q.push(startId);
  while (q.length) {
    const v = q.shift();
    const d = dist.get(v) || 0;
    if (d >= depth) continue;
    const vType = byId.get(v)?.type;
    if (mode === 'down' || mode === 'both') {
      // Follow forward edges with type filtering
      for (const w of out.get(v) || []) {
        const wType = byId.get(w)?.type;
        // Suppress Person->Org in down mode
        if (vType === 'person' && wType === 'org') continue;
        if (!seen.has(w)) { seen.add(w); dist.set(w, d + 1); q.push(w); }
      }
      // Additionally: Org -> Persons via inverse memberOf (Org gets its members)
      // Only permit this fan-out when the START node is an Org, to avoid pulling all members when starting from a person
      if (vType === 'org' && startType === 'org') {
        for (const src of inn.get(v) || []) {
          const sType = byId.get(src)?.type;
          if (sType !== 'person') continue;
          if (!seen.has(src)) { seen.add(src); dist.set(src, d + 1); q.push(src); }
        }
      }
    }
    if (mode === 'up' || mode === 'both') {
      // Follow inverse edges with type filtering
      for (const w of inn.get(v) || []) {
        const wType = byId.get(w)?.type;
        // For org nodes, only climb to parent orgs via inn
        if (vType === 'org' && wType !== 'org') continue;
        if (!seen.has(w)) { seen.add(w); dist.set(w, d + 1); q.push(w); }
      }
      // Additionally: Person -> Org via forward memberOf in up mode
      if (vType === 'person') {
        for (const w of out.get(v) || []) {
          const wType = byId.get(w)?.type;
          if (wType !== 'org') continue;
          // If target is org and it's disabled, skip
          // if (wType === 'org' && !allowedOrgs.has(w)) continue;
          if (!seen.has(w)) { seen.add(w); dist.set(w, d + 1); q.push(w); }
        }
      }
    }
  }
  
  // Collect Orgs for Legend: Only the LOWEST (leaf) OEs,
  // verbunden mit Personen im Subgraph
  const legendOrgs = new Set();
  const legendOrgLevels = new Map(); // oid -> minimaler Personen-Level, der diese OE "aktiviert"
  
  // Build efficient lookup: person -> set of OEs
  const personToOrgs = new Map();
  for (const l of raw.links) {
    const s = idOf(l.source);
    const t = idOf(l.target);
    if (byId.get(s)?.type === 'person' && byId.get(t)?.type === 'org') {
      if (!personToOrgs.has(s)) personToOrgs.set(s, new Set());
      personToOrgs.get(s).add(t);
    }
  }
  
  // Build set of OEs that have children (are not leaf nodes)
  const orgsWithChildren = new Set();
  for (const [child, parent] of parentOf.entries()) {
    if (parent) orgsWithChildren.add(parent);
  }
  
  // For each person in the subgraph, find their lowest OE(s)
  for (const id of seen) {
    const n = byId.get(id);
    if (n && n.type === 'person') {
      const orgs = personToOrgs.get(id);
      if (!orgs) continue;
      
      // Find the lowest OE(s) for this person
      // An OE is "lowest" if it has no children OR all its children are not in the person's org set
      for (const oid of orgs) {
        // Check if this OE is a leaf (has no children in the person's org hierarchy)
        let isLowest = true;
        for (const otherOid of orgs) {
          if (otherOid !== oid && parentOf.get(otherOid) === oid) {
            // otherOid is a child of oid, so oid is not the lowest
            isLowest = false;
            break;
          }
        }
        
        if (isLowest) {
          legendOrgs.add(oid);
          const personLevel = dist.get(id) || 0;
          const prevLevel = legendOrgLevels.get(oid);
          if (prevLevel == null || personLevel < prevLevel) {
            legendOrgLevels.set(oid, personLevel);
          }
        }
      }
    }
  }
  
  let nodes = Array.from(seen)
    .map(id => {
      const n = byId.get(id);
      if (!n) return null;
      return { ...n, level: dist.get(id) || 0 };
    })
    .filter(Boolean);
  
  // Zähle ausgeblendete Knoten in der aktuellen Ansicht (berücksichtige temporäre Sichtbarkeit)
  if (hiddenNodes && hiddenNodes.size > 0) {
    const beforeCount = nodes.length;
    nodes = nodes.filter(n => {
      const nid = String(n.id);
      if (!hiddenNodes.has(nid)) return true;
      // Node ist hidden - prüfe ob temporär sichtbar
      return isNodeTemporarilyVisible(nid);
    });
    const hiddenInThisCall = beforeCount - nodes.length;
    currentHiddenCount += hiddenInThisCall; // Addieren statt überschreiben für Multi-Root
  }
  // Attribute focus mode: prune nodes without visible attributes in self or
  // below; the start node always stays visible so the view never goes blank
  if (attributeFocusEnabled && attributeFocusHiddenNodes.size > 0) {
    const startKey = String(startId);
    nodes = nodes.filter(n => String(n.id) === startKey || !attributeFocusHiddenNodes.has(String(n.id)));
  }
  if (managementEnabled) {
    // Filter out basis persons (leaf nodes without direct reports)
    nodes = nodes.filter(n => !n.isBasis);
    // Ensure managers that connect to kept persons are present so links are drawn
    const nodeSet = new Set(nodes.map(n => String(n.id)));
    for (const l of raw.links) {
      const s = idOf(l.source), t = idOf(l.target);
      if (!byId.has(s) || !byId.has(t)) continue;
      if (byId.get(s)?.type !== 'person' || byId.get(t)?.type !== 'person') continue;
      if (nodeSet.has(t) && !nodeSet.has(s)) {
        // Prüfe ob hidden und nicht temporär sichtbar
        if (hiddenNodes && hiddenNodes.has(String(s)) && !isNodeTemporarilyVisible(s)) continue;
        // Respect the attribute focus mode for re-added managers as well
        if (attributeFocusEnabled && attributeFocusHiddenNodes.has(String(s))) continue;
        // In 'down' mode, only add managers that are below or at the start node level
        // (dist > 0 means they were reached during traversal, dist === 0 is the start node)
        if (mode === 'down' && !dist.has(s)) continue;
        const m = byId.get(s);
        if (m) { nodes.push({ ...m, level: (dist.get(s) || 0) }); nodeSet.add(s); }
      }
    }
  }

  // Attribute focus: within THIS view keep only the roots, visibly
  // attributed nodes and the connectors on their BFS-tree paths (§9.4).
  if (attributeFocusEnabled) {
    const keep = applyAttributeFocusToScene(nodes, raw.links, [String(startId)]);
    nodes = nodes.filter(n => keep.has(String(n.id)));
  }

  // Drop orgs that are disabled
  const nodeSet = new Set(nodes.map(n => String(n.id)));
  const links = raw.links
    .map(l => ({ s: idOf(l.source), t: idOf(l.target) }))
    .filter(x => nodeSet.has(x.s) && nodeSet.has(x.t))
    .map(x => ({ source: x.s, target: x.t }));
  
  return { nodes, links, legendOrgs, legendOrgLevels };
}

/**
 * Attribute focus on a scene (§9.4/FR-8.10a), scene-agnostic: keep the
 * roots, every present seed (visibly attributed node, attributeFocusSeeds)
 * and the BFS-tree connectors from each seed to a root; then peel remaining
 * unattributed leaves. Leaf peeling alone cannot remove unattributed nodes
 * sitting on cycles (person-org-manager triangles are everywhere), so the
 * path marking is the primary mechanism. Both the legacy traversal and the
 * v2 projection path feed their own node/link sets. Returns the keep set.
 */
export function applyAttributeFocusToScene(nodes, links, rootKeys) {
  const present = new Set(nodes.map(n => String(n.id)));
  const adj = new Map();
  for (const l of links) {
    const s = idOf(l.source), t = idOf(l.target);
    if (s === t || !present.has(s) || !present.has(t)) continue;
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s).add(t);
    adj.get(t).add(s);
  }

  // BFS forest from the roots over the scene's links (undirected)
  const roots = rootKeys.map(String).filter(id => present.has(id));
  const rootSet = new Set(roots);
  const parent = new Map(roots.map(r => [r, null]));
  const bfs = [...roots];
  for (let qi = 0; qi < bfs.length; qi++) {
    for (const nb of adj.get(bfs[qi]) || []) {
      if (!parent.has(nb)) { parent.set(nb, bfs[qi]); bfs.push(nb); }
    }
  }

  // Keep the roots, every present seed and the tree path from seed to root
  const keep = new Set(roots);
  for (const id of present) {
    if (!attributeFocusSeeds.has(id)) continue;
    keep.add(id);
    let cur = parent.get(id);
    while (cur != null && !keep.has(cur)) { keep.add(cur); cur = parent.get(cur); }
  }

  // Final sweep: peel any unattributed leaf that may remain in the kept set
  const kadj = new Map();
  for (const id of keep) {
    const nbs = new Set();
    for (const nb of adj.get(id) || []) if (keep.has(nb)) nbs.add(nb);
    kadj.set(id, nbs);
  }
  const isRemovableLeaf = (id) =>
    !rootSet.has(id) && !attributeFocusSeeds.has(id) && ((kadj.get(id)?.size || 0) <= 1);
  const peelQueue = Array.from(keep).filter(isRemovableLeaf);
  for (let qi = 0; qi < peelQueue.length; qi++) {
    const id = peelQueue[qi];
    if (!keep.has(id) || !isRemovableLeaf(id)) continue;
    keep.delete(id);
    for (const nb of kadj.get(id) || []) {
      kadj.get(nb)?.delete(id);
      if (keep.has(nb) && isRemovableLeaf(nb)) peelQueue.push(nb);
    }
    kadj.delete(id);
  }

  return keep;
}

export function recomputeHiddenNodes() {
  const agg = new Set();
  for (const s of hiddenByRoot.values()) {
    for (const id of s) agg.add(String(id));
  }
  hiddenNodes = agg;
}

/**
 * Recomputes the transient set of nodes hidden by the attribute focus mode.
 * A node stays visible if it carries an effectively visible attribute itself
 * or lies on the upward path (managers, member orgs, parent orgs) from such a
 * node — i.e. every maximal attribute-free subtree is pruned at its root.
 * Effectively visible = attribute is active and its category is not hidden
 * via the eye toggle; the global attribute eye is deliberately ignored.
 */
export function recomputeAttributeFocusHidden() {
  attributeFocusHiddenNodes = new Set();
  attributeFocusSeeds = new Set();
  if (!raw || !Array.isArray(raw.nodes) || raw.nodes.length === 0) return;

  const visibleKeys = new Set();
  for (const key of activeAttributes) {
    const cat = String(key).split('::')[0];
    if (!hiddenCategories.has(cat)) visibleKeys.add(key);
  }

  // Seed: persons carrying at least one effectively visible attribute
  const keep = new Set();
  const queue = [];
  if (visibleKeys.size > 0) {
    for (const [pid, attrs] of personAttributes.entries()) {
      for (const k of attrs.keys()) {
        if (visibleKeys.has(k)) {
          const id = String(pid);
          keep.add(id);
          queue.push(id);
          break;
        }
      }
    }
  }
  attributeFocusSeeds = new Set(queue);

  // Upward adjacency: report -> manager, member -> org, child org -> parent org
  const parentsOfNode = new Map();
  const addParent = (child, parent) => {
    let list = parentsOfNode.get(child);
    if (!list) { list = []; parentsOfNode.set(child, list); }
    list.push(parent);
  };
  for (const l of raw.links) {
    const s = idOf(l.source), t = idOf(l.target);
    const sType = byId.get(s)?.type, tType = byId.get(t)?.type;
    if (!sType || !tType) continue;
    if (sType === 'person' && tType === 'person') addParent(t, s);
    else if (sType === 'org' && tType === 'org') addParent(t, s);
    else if (sType === 'person' && tType === 'org') addParent(s, t);
  }

  // Everything reachable upwards from a seed stays visible
  for (let qi = 0; qi < queue.length; qi++) {
    for (const p of parentsOfNode.get(queue[qi]) || []) {
      if (!keep.has(p)) { keep.add(p); queue.push(p); }
    }
  }

  for (const n of raw.nodes) {
    const nid = String(n.id);
    if (!keep.has(nid)) attributeFocusHiddenNodes.add(nid);
  }
}

/** Re-renders the graph after attribute visibility changes while focus mode is on. */
export function notifyAttributeVisibilityChanged() {
  if (attributeFocusEnabled) {
    recomputeAttributeFocusHidden();
    try { applyFromUI('attributeFocus'); } catch (_) {}
    return;
  }
  // Cluster clouds size with the attribute rings (getNodeOuterRadius), so a
  // ring toggle must redraw them even without a full re-render.
  try { refreshClusters(); } catch (_) {}
}

// Prüft ob ein Node-ID temporär sichtbar ist (trotz Hidden-Status) [SF]
export function isNodeTemporarilyVisible(nodeId) {
  const nid = String(nodeId);
  if (allHiddenTemporarilyVisible) return true;
  for (const [rootId, setIds] of hiddenByRoot.entries()) {
    if (setIds.has(nid) && temporarilyVisibleRoots.has(rootId)) {
      return true;
    }
  }
  return false;
}

export function collectReportSubtree(rootId) {
  const rid = String(rootId);
  const out = new Map(); // parent -> children in descent direction
  // Legacy links run manager->report; v2 stored direction is child->parent
  // (FR-7.2a), so the descent traverses target->source (§9.2: subtree
  // hiding follows the view path's descent hops).
  const inverted = typeof og2Active === 'function' && og2Active();
  for (const l of raw.links) {
    const s = idOf(l.source), t = idOf(l.target);
    if (drawKindOf(byId.get(s)) === 'node' && drawKindOf(byId.get(t)) === 'node') {
      const parent = inverted ? t : s;
      const child = inverted ? s : t;
      if (!out.has(parent)) out.set(parent, new Set());
      out.get(parent).add(child);
    }
  }
  const seen = new Set([rid]);
  const q = [rid];
  while (q.length) {
    const v = q.shift();
    for (const w of (out.get(v) || [])) {
      if (!seen.has(w)) { seen.add(w); q.push(w); }
    }
  }
  return seen;
}

export function hideSubtreeFromRoot(rootId) {
  const rid = String(rootId);
  const n = byId.get(rid);
  if (!n || drawKindOf(n) !== 'node') { setStatus('Bitte einen Graph-Knoten wählen'); return; }
  const sub = collectReportSubtree(rid);
  hiddenByRoot.set(rid, sub);
  recomputeHiddenNodes();
  buildHiddenLegend();
  applyFromUI('hideSubtree');
}

export function unhideSubtree(rootId) {
  const rid = String(rootId);
  if (hiddenByRoot.has(rid)) {
    hiddenByRoot.delete(rid);
    temporarilyVisibleRoots.delete(rid); // Auch temporären Status entfernen
    recomputeHiddenNodes();
  }
  buildHiddenLegend();
  updateGlobalHiddenVisibilityButton();
  applyFromUI('unhideSubtree');
}

// Temporäre Sichtbarkeit eines einzelnen Hidden-Subtrees umschalten [SF]
export function toggleHiddenRootVisibility(rootId) {
  const rid = String(rootId);
  if (temporarilyVisibleRoots.has(rid)) {
    temporarilyVisibleRoots.delete(rid);
  } else {
    temporarilyVisibleRoots.add(rid);
  }
  updateHiddenLegendEyeButtons();
  updateGlobalHiddenVisibilityButton();
  applyFromUI('toggleHiddenRootVisibility');
}

// Globale temporäre Sichtbarkeit aller Hidden-Subtrees umschalten [SF]
export function toggleAllHiddenVisibility() {
  allHiddenTemporarilyVisible = !allHiddenTemporarilyVisible;
  // Bei globalem Toggle: individuelle Einstellungen zurücksetzen
  if (allHiddenTemporarilyVisible) {
    temporarilyVisibleRoots.clear();
  }
  updateHiddenLegendEyeButtons();
  updateGlobalHiddenVisibilityButton();
  applyFromUI('toggleAllHiddenVisibility');
}

// Eye-Buttons in der Hidden-Legende aktualisieren [DRY]
export function updateHiddenLegendEyeButtons() {
  const legend = document.getElementById('hiddenLegend');
  if (!legend) return;
  
  const eyeBtns = legend.querySelectorAll('.legend-icon-btn[data-root-id]');
  eyeBtns.forEach(btn => {
    const rootId = btn.dataset.rootId;
    const isVisible = allHiddenTemporarilyVisible || temporarilyVisibleRoots.has(rootId);
    // Verwende active-Klasse wie bei OEs/Attributen
    btn.className = isVisible ? 'legend-icon-btn active' : 'legend-icon-btn';
    btn.title = isVisible ? 'Temporär ausblenden' : 'Temporär einblenden';
    // Icon aktualisieren
    setIcon(btn, isVisible ? 'eye' : 'eyeClosed');
  });
}

// Globalen Eye-Button im Header aktualisieren [DRY]
export function updateGlobalHiddenVisibilityButton() {
  const btn = document.getElementById('toggleAllHiddenVisibility');
  if (!btn) return;
  
  const hasHidden = hiddenByRoot.size > 0;
  btn.style.display = hasHidden ? '' : 'none';
  
  if (hasHidden) {
    // Verwende active-Klasse wie bei OEs/Attributen für konsistentes Verhalten
    btn.className = allHiddenTemporarilyVisible ? 'legend-icon-btn active' : 'legend-icon-btn';
    btn.title = allHiddenTemporarilyVisible ? 'Alle temporär ausblenden' : 'Alle temporär einblenden';
    // Icon aktualisieren
    const icon = btn.querySelector('[data-icon]');
    if (icon) setIcon(icon, allHiddenTemporarilyVisible ? 'eye' : 'eyeClosed');
  }
}

// Aktualisiert den Titel der Hidden-Legende mit den aktuellen Zahlen
export function updateHiddenLegendTitle() {
  // Berechne Gesamtanzahl der ausgeblendeten Personen
  let totalHidden = 0;
  for (const setIds of hiddenByRoot.values()) {
    totalHidden += setIds.size;
  }
  
  // Berechne Anzahl ausgeblendeter Knoten die in der aktuellen Ansicht wären
  let countInView = currentHiddenCount;
  
  // Update Titel mit Anzahl: (aktuell sichtbar ausgeblendet / gesamt ausgeblendet)
  const titleElement = document.getElementById('hiddenLegendTitle');
  if (titleElement) {
    if (totalHidden > 0) {
      titleElement.textContent = `Ausgeblendet (${countInView}/${totalHidden})`;
    } else {
      titleElement.textContent = 'Ausgeblendet';
    }
  }
}

