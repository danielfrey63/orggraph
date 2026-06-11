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
        // In 'down' mode, only add managers that are below or at the start node level
        // (dist > 0 means they were reached during traversal, dist === 0 is the start node)
        if (mode === 'down' && !dist.has(s)) continue;
        const m = byId.get(s);
        if (m) { nodes.push({ ...m, level: (dist.get(s) || 0) }); nodeSet.add(s); }
      }
    }
  }
  
  // Drop orgs that are disabled
  const nodeSet = new Set(nodes.map(n => String(n.id)));
  const links = raw.links
    .map(l => ({ s: idOf(l.source), t: idOf(l.target) }))
    .filter(x => nodeSet.has(x.s) && nodeSet.has(x.t))
    .map(x => ({ source: x.s, target: x.t }));
  
  return { nodes, links, legendOrgs, legendOrgLevels };
}

export function recomputeHiddenNodes() {
  const agg = new Set();
  for (const s of hiddenByRoot.values()) {
    for (const id of s) agg.add(String(id));
  }
  hiddenNodes = agg;
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
  const out = new Map();
  for (const l of raw.links) {
    const s = idOf(l.source), t = idOf(l.target);
    if (byId.get(s)?.type === 'person' && byId.get(t)?.type === 'person') {
      if (!out.has(s)) out.set(s, new Set());
      out.get(s).add(t);
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
  if (!n || n.type !== 'person') { setStatus('Bitte eine Management-Person wählen'); return; }
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

