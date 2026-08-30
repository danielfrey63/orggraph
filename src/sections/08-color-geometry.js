// Single source of the JS-side design-token fallbacks. Mirrors :root in
// styles.css; it only takes effect where no stylesheet is loaded (unit
// tests), so keeping the two in sync keeps tests on production values.
export const CSS_NUMBER_DEFAULTS = {
  '--node-radius': 8,
  '--node-stroke-width': 1,
  '--link-stroke-width': 2,
  '--link-opacity': 0.5,
  '--arrow-length': 8,
  '--cluster-pad': 10,
  '--attribute-circle-gap': 1,
  '--attribute-circle-stroke-width': 4,
  '--node-with-attributes-stroke-width': 6,
  '--nodes-without-attributes-opacity': 0.2,
  '--link-distance': 20,
  '--link-strength': 0.7,
  '--charge-strength': -250,
  '--collide-padding': 6,
  '--alpha-decay': 0.05,
  '--velocity-decay': 0.5,
  '--radial-force': 0.15,
  '--radial-gap': 120,
    '--radial-base': 0,
  '--center-strength': 0.05,
  '--collide-strength': 0.8,
  '--level-height': 200,
  '--level-force-strength': 0.5,
    '--label-x-offset': 10,
  '--label-y-offset': 4,
  '--label-ring-gap': 3,
  '--link-label-dy': -3,
  '--cluster-force-strength': 0.08,
  '--cluster-jitter': 30,
  '--cluster-ring-radius-factor': 0.35,
    '--radial-child-padding': 4,
  '--viewport-fit-pad': 20,
  '--radial-fallback-radius': 40,
  '--root-spacing-radius-factor': 1.5,
  '--tooltip-cursor-offset': 12,
    '--toast-fade-ms': 300,
  '--depth-pulse-ms': 300,
    '--node-hover-tolerance': 6,
  '--legend-depth-step': 16,
  '--cluster-hull-tension': 0.75,
      '--sim-settle-ms': 100,
    '--legend-settle-ms': 50,
    '--combo-debounce-ms': 150,
  '--toast-short-ms': 3000,
  '--toast-medium-ms': 6000,
  '--toast-long-ms': 10000,
  '--toast-mount-ms': 10,
  '--og2-persist-debounce-ms': 400,
  '--org-saturation': 60,
  '--org-fill-lightness': 60,
  '--org-fill-alpha': 0.25,
  '--org-stroke-lightness': 40,
    '--org-stroke-alpha': 0.85,
  '--rainbow-hue-span': 300,
  '--rainbow-saturation': 70,
  '--rainbow-lightness': 50,
  '--attr-category-hue-step': 40,
  '--attr-local-hue-step': 10,
  '--attr-saturation': 65,
  '--attr-lightness': 50,
  '--attr-lightness-alt-boost': 5,
  '--cluster-hull-samples': 12,
    '--export-pixel-density': 4,
  '--node-fill-level-break-1': 0.33,
  '--node-fill-level-break-2': 0.67,
  '--attr-local-hue-cycle': 6,
  '--attr-lightness-alt-cycle': 2,
    '--bfs-level-delay-ms': 1000,
  '--org-hue-cycle': 12,
  '--org-hue-step': 30,
  '--viewport-fit-ms': 300,
  '--hull-escape-width-factor': 0.2,
  '--zoom-min': 0.2,
  '--zoom-max': 5,
  '--sim-idle-alpha': 0.15,
  '--sim-reheat-alpha-soft': 0.1,
  '--sim-reheat-alpha': 0.3,
  '--sim-update-alpha': 0.5,
  '--sim-restart-alpha': 1,
  '--sim-drag-alpha-target': 0.3,
  '--level-top-offset': 100,
  '--hierarchy-jitter': 100,
  '--cluster-stroke-width': 1.5,
  '--cluster-opacity': 1,
  '--attribute-circle-opacity': 0.8,
  '--diff-removed-opacity': 0.45,
  '--diff-link-removed-opacity': 0.5,
};

export function cssNumber(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
  const n = parseFloat(v);
  if (Number.isFinite(n)) return n;
  return fallback !== undefined ? fallback : (CSS_NUMBER_DEFAULTS[varName] ?? 0);
}

// String companion of CSS_NUMBER_DEFAULTS: mirrors the :root light palette in
// styles.css (var() indirections resolved); only applies without a loaded
// stylesheet (unit tests). Covers every token the export stylesheet reads.
export const CSS_COLOR_DEFAULTS = {
  '--node-fill': '#4F46E5',
  '--node-fill-top-level': '#e0e7ff',
  '--node-fill-mid-level': '#818cf8',
  '--node-fill-low-level': '#4F46E5',
  '--node-with-attributes-fill': '#000000',
  '--node-with-attributes-stroke': '#4682b4',
  '--canvas-bg': '#ffffff',
  '--node-stroke': '#ffffff',
  '--link-stroke': '#cbd5e1',
  '--cluster-fill': 'rgba(79,70,229,0.10)',
  '--cluster-stroke': 'rgba(79,70,229,0.25)',
  '--root-node-fill': '#86efac',
  '--label-font-size': '8px',
  '--label-fill': '#334155',
  '--link-label-font-size': '10px',
  '--link-label-fill': '#666',
  '--diff-new-stroke': '#22c55e',
  '--diff-changed-stroke': '#f59e0b',
  '--diff-removed-stroke': '#ef4444',
};

// Resolved string value of a CSS custom property on :root. Single owner of
// the getComputedStyle+fallback pattern — the export stylesheet (03) and the
// level-fill lookups below all go through here.
// One-axis fallback jitter around a centre coordinate; the spread comes from
// a --…-jitter token (hierarchy, cluster).
export function jitterAround(center, tokenName) {
  return center + (Math.random() - 0.5) * cssNumber(tokenName);
}

export function cssVar(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  if (varName in CSS_COLOR_DEFAULTS) return CSS_COLOR_DEFAULTS[varName];
  // numeric tokens read as strings (export stylesheet) share the number map
  if (varName in CSS_NUMBER_DEFAULTS) return String(CSS_NUMBER_DEFAULTS[varName]);
  return '';
}

// Farb-Hilfen: gleiche Kategorie -> ähnliche Farben, Kategorien klar unterscheidbar
export const categoryHueCache = new Map();
export function quantizedHueFromCategory(category) {
  if (categoryHueCache.has(category)) return categoryHueCache.get(category);
    const rawHue = Math.abs(hashCode(String(category))) % 360;
  const step = cssNumber('--attr-category-hue-step'); // große Abstände zwischen Kategorien
  const hue = (Math.round(rawHue / step) * step) % 360;
  categoryHueCache.set(category, hue);
  return hue;
}
// Long rainbow palette (FR-4.2a): one spectral sweep (red → violet, the
// rainbow read top-down) laid ONCE across the ordered list of ALL ring
// attributes — first label of the first group through the last label of the
// last group. Groups land in distinct spectral bands (clearly different),
// labels within a group sit on adjacent hues (similar but distinguishable).
export function colorForRainbowPosition(index, total) {
  const n = Math.max(1, total);
  const t = n === 1 ? 0 : Math.min(1, Math.max(0, index / (n - 1)));
    const hue = Math.round(t * cssNumber('--rainbow-hue-span')); // 0=red … span=violet
  return `hsl(${hue}, ${cssNumber('--rainbow-saturation')}%, ${cssNumber('--rainbow-lightness')}%)`;
}

export function colorForCategoryAttribute(category, attrName, ordinal) {
  const baseHue = quantizedHueFromCategory(category);
      const localShift = (ordinal % cssNumber('--attr-local-hue-cycle')) * cssNumber('--attr-local-hue-step'); // kleine Variation innerhalb der Kategorie
  const hue = (baseHue + localShift) % 360;
  const sat = cssNumber('--attr-saturation');
  const light = cssNumber('--attr-lightness') + ((ordinal % cssNumber('--attr-lightness-alt-cycle')) ? cssNumber('--attr-lightness-alt-boost') : 0); // leichte Helligkeitsvariation
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/**
 * Berechnet die Füllfarbe für einen Node basierend auf seiner hierarchischen Ebene
 * @param {Object} node - Der Node-Datensatz
 * @returns {string} CSS-Farbwert für die Füllung
 */
export function getNodeFillByLevel(node) {
  if (!node || node.type !== 'person') {
    return cssVar('--node-fill');
  }
  
  const level = node.level || 0;
  const maxLevel = Math.max(...Array.from(hierarchyLevels.values()).filter(l => l >= 0));
  
  // Wenn keine Hierarchie-Informationen verfügbar, Standardfarbe verwenden
  if (maxLevel === 0 || hierarchyLevels.size === 0) {
    return cssVar('--node-fill');
  }
  
  // Normalisierte Ebene (0 = top, 1 = bottom)
  const normalizedLevel = maxLevel > 0 ? level / maxLevel : 0;
  
  // Hole die Gradient-Farben aus CSS-Variablen
  const topLevelColor = cssVar('--node-fill-top-level');
  const midLevelColor = cssVar('--node-fill-mid-level');
  const lowLevelColor = cssVar('--node-fill-low-level');
  
  // Whle Farbe basierend auf normalisierter Ebene
    if (normalizedLevel <= cssNumber('--node-fill-level-break-1')) {
    return topLevelColor;
    } else if (normalizedLevel <= cssNumber('--node-fill-level-break-2')) {
    return midLevelColor;
  } else {
    return lowLevelColor;
  }
}

export function clustersAtPoint(p) {
  // Sammle OEs mit ihren IDs und Labels
  const orgItems = [];
  for (const [oid, poly] of clusterPolygons.entries()) {
    if (!allowedOrgs.has(oid)) continue;
    if (poly && poly.length>=3 && d3.polygonContains(poly, p)) {
      const node = byId.get(oid);
      const depth = orgDepth(oid);
      const label = getDisplayLabel(node, depth);
      orgItems.push({ id: oid, label, depth });
    }
  }
  
  // Sortiere nach Tiefe absteigend (höhere Tiefe = kleinere OE kommt zuerst)
  orgItems.sort((a, b) => b.depth - a.depth || a.label.localeCompare(b.label));
  
  // Gib nur die Labels zurück
  return orgItems.map(item => item.label);
}

export function computeClusterPolygon(nodes, pad) {
  if (nodes.length === 0) return [];
  // Sample each node's outline at its outer radius (incl. attribute rings,
  // see getNodeOuterRadius) so the cloud encloses the rings, not just the
  // bare node circles.
  const metrics = nodeOuterRadiusMetrics();
  const pts = [];
  for (const n of nodes) {
        const r = getNodeOuterRadius(n, metrics) + pad;
    const samples = cssNumber('--cluster-hull-samples');
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      pts.push([n.x + Math.cos(a) * r, n.y + Math.sin(a) * r]);
    }
  }
  if (nodes.length === 1) return pts;
  const hull = d3.polygonHull(pts);
  return (hull && hull.length >= 3) ? hull : [];
}

// Collect active ancestor chain (including self) for a given org id
export function getActiveAncestorChain(oid) {
  const active = new Set();
  let cur = String(oid);
  while (cur) {
    if (allowedOrgs.has(cur)) active.add(cur);
    const p = parentOf.get(cur);
    if (!p) break;
    cur = p;
  }
  return active;
}

// Tooltip helpers for overlapping clusters
let tooltipEl = null;
export function ensureTooltip() {
  if (tooltipEl) return;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'cluster-tooltip';
  document.body.appendChild(tooltipEl);
}
export function showTooltip(x, y, lines) {
  const offset = cssNumber('--tooltip-cursor-offset');
  tooltipEl.textContent = lines.join('\n');
  tooltipEl.style.left = `${x + offset}px`;
  tooltipEl.style.top = `${y + offset}px`;
  tooltipEl.style.display = 'block';
}
export function hideTooltip() { if (tooltipEl) tooltipEl.style.display = 'none'; }

/**
 * Zeigt Zoom-Level im Debug-Modus in der Statusleiste an [SF]
 */
export function updateDebugZoomDisplay() {
  const statusEl = document.querySelector(STATUS_ID);
  if (!statusEl) return;
  
  if (!debugMode) {
    // Debug deaktiviert: Status zurücksetzen
    statusEl.textContent = 'Bereit';
    return;
  }
  
  if (!currentZoomTransform) return;
  const k = currentZoomTransform.k.toFixed(2);
  const x = Math.round(currentZoomTransform.x);
  const y = Math.round(currentZoomTransform.y);
  statusEl.textContent = `Zoom: ${k} | Offset: (${x}, ${y})`;
}

/**
 * Erstellt Tooltip-Zeilen für eine Person mit Attributen und OE-Zugehörigkeiten
 * @param {string} personId - ID der Person
 * @param {string} nodeLabel - Label des Knotens
 * @param {Array} visibleOrgs - Array von sichtbaren OE-Labels am Cursor
 * @returns {Array} Array von Tooltip-Zeilen
 */
export function buildPersonTooltipLines(personId, nodeLabel, visibleOrgs = []) {
  const lines = [];
  const node = byId.get(String(personId));

  // Header: registry type name instead of a fixed emoji (FR-4.2a); legacy
  // structural tags keep a neutral header.
  const typeName = node && node.type && node.type !== 'person' && node.type !== 'org' ? node.type : '';
  lines.push(typeName ? `${typeName}: ${nodeLabel}` : String(nodeLabel));

  // Scalar props (FR-8.13), through the privacy gate (E60): in pseudo mode
  // only props whitelisted as nonSensitive in the tenant registry appear.
  if (node && node.props && typeof og2Active === 'function' && og2Active() && og2State()) {
    const decls = ((og2State().registry.nodeTypes || {})[node.type] || {}).props || {};
    const entries = Object.entries(node.props).filter(([key, value]) =>
      value !== undefined && value !== null &&
      (!pseudonymizationEnabled || (decls[key] && decls[key].nonSensitive === true)));
    for (const [key, value] of entries) lines.push(`  ${key}: ${value}`);

    // Property diff in diff mode (FR-8.13/FR-5.8): previous value next to
    // the current one, through the same privacy gate — the raw predecessor
    // label stays hidden in pseudo mode (fail-closed, E48).
    const scene = (typeof currentSubgraph !== 'undefined' && currentSubgraph && Array.isArray(currentSubgraph.nodes))
      ? currentSubgraph.nodes.find(n => String(n.id) === String(personId)) : null;
    if (scene && scene.diffClass === 'diff-changed' && scene.before) {
      const before = scene.before.props || {};
      const now = scene.props || {};
      const diffLines = [];
      if ((scene.before.label ?? null) !== (scene.label ?? null)) {
        diffLines.push(pseudonymizationEnabled ? '  Name geändert' : `  Name: ${scene.before.label} → ${scene.label}`);
      }
      for (const key of new Set([...Object.keys(before), ...Object.keys(now)])) {
        if (pseudonymizationEnabled && !(decls[key] && decls[key].nonSensitive === true)) continue;
        const a = before[key];
        const b = now[key];
        if (a === b) continue;
        if (b === undefined) diffLines.push(`  ${key}: ${a} → entfernt`);
        else if (a === undefined) diffLines.push(`  ${key}: neu ${b}`);
        else diffLines.push(`  ${key}: ${a} → ${b}`);
      }
      if (diffLines.length) {
        lines.push('Änderungen (Diff):');
        lines.push(...diffLines);
      }
    }
  }

  // Ring badges of this node (grouped '<Typ>::<Label>' keys)
  if (personId && personAttributes.has(personId)) {
    const attrs = personAttributes.get(personId);
    let hasAttributes = false;
    for (const [attrName, attrValue] of attrs.entries()) {
      if (activeAttributes.has(attrName)) {
        if (!hasAttributes) lines.push('Ringe:');
        const displayValue = attrValue && attrValue !== '1' ? `: ${attrValue}` : '';
        lines.push(`  • ${attrName}${displayValue}`);
        hasAttributes = true;
      }
    }
  }

  // Cluster memberships: at the cursor and the full upward chain
  const allPersonOrgs = findAllPersonOrgs(personId);
  if (visibleOrgs.length > 0) {
    lines.push('Am Cursor:');
    visibleOrgs.forEach(org => lines.push(`  • ${org}`));
  }
  if (allPersonOrgs.length > 0) {
    lines.push('Zugehörigkeiten:');
    allPersonOrgs.forEach(org => lines.push(`  • ${org}`));
  }

  return lines;
}

/**
 * Tooltips für Cluster-Hover
 */
export function handleClusterHover(event, svgSel) {
  if (!currentZoomTransform) { 
    hideTooltip(); 
    return; 
  }
  
  const [mx, my] = d3.pointer(event, svgSel.node());
  const p = currentZoomTransform.invert([mx, my]);
  
  const r = cssNumber('--node-radius') + cssNumber('--node-hover-tolerance');
  let nodeLabel = null;
  let personId = null;
  
  for (const nd of simAllById.values()) {
    if (nd.x == null || nd.y == null) continue;
    const dx = p[0] - nd.x, dy = p[1] - nd.y;
    if ((dx*dx + dy*dy) <= r*r) { 
      nodeLabel = getDisplayLabel(nd);
      personId = String(nd.id);
      break; 
    }
  }
  
  // Verwende die sortierte clustersAtPoint Funktion
  const hits = clustersAtPoint(p);
  
  let lines = [];
  
  // Person information or cluster information
  if (nodeLabel) {
    lines = buildPersonTooltipLines(personId, nodeLabel, hits);
  } else if (hits.length) {
    // Display cluster information with header
    lines.push('Cluster:');
    hits.forEach(hit => lines.push(`  • ${hit}`));
  }
  
  if (lines.length) {
    showTooltip(event.clientX, event.clientY, lines);
  } else {
    hideTooltip();
  }
}

// Color mapping for OEs (harmonious palette)
/**
 * Finds all organizational units a person belongs to
 * @param {string} personId - ID of the person
 * @returns {string[]} - Array of organization labels ordered by hierarchy (smallest/lowest unit first)
 */
export function findAllPersonOrgs(personId) {
  if (!personId || !raw || !Array.isArray(raw.links) || !Array.isArray(raw.orgs)) return [];

  const pid = String(personId);
  const orgIds = new Set(raw.orgs.map(o => String(o.id)));

  // Basis-OEs der Person: direkte Person->Org Kanten
  const baseOrgs = new Set();
  for (const link of raw.links) {
    if (!link) continue;
    const s = idOf(link.source);
    const t = idOf(link.target);
    if (s === pid && orgIds.has(t)) {
      baseOrgs.add(t);
    }
  }

  // Alle OEs entlang der Aufwärts-Kette (Basis-OE + alle Eltern) einsammeln
  const orgMap = new Map(); // label -> { id, depth }

  // Tiefe innerhalb der OE-Hierarchie cachen (Abstand zur Wurzel)
  const depthCache = new Map();
  const computeDepth = (oid) => {
    const key = String(oid);
    if (depthCache.has(key)) return depthCache.get(key);
    let d = 0;
    let cur = key;
    const seen = new Set();
    while (orgParent.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = orgParent.get(cur);
      d++;
    }
    depthCache.set(key, d);
    return d;
  };

  for (const baseId of baseOrgs) {
    let cur = String(baseId);
    const chainSeen = new Set();
    while (cur && !chainSeen.has(cur)) {
      chainSeen.add(cur);
      const node = byId.get(cur);
      if (node && node.type === 'org') {
        const label = node.label || cur;
        if (!orgMap.has(label)) {
          orgMap.set(label, { id: cur, depth: computeDepth(cur) });
        }
      }
      cur = orgParent.get(cur);
    }
  }

  // Nach Tiefe sortieren (kleinere/basisnähere OEs haben eine höhere Tiefe)
  return Array.from(orgMap.values())
    .sort((a, b) => b.depth - a.depth || String(a.id).localeCompare(String(b.id)))
    .map(item => {
      const node = byId.get(String(item.id));
      return getDisplayLabel(node, item.depth);
    });
}

export function hashCode(str){ let h=0; for(let i=0;i<str.length;i++){ h=((h<<5)-h)+str.charCodeAt(i); h|=0; } return h>>>0; }
export const orgColorCache = new Map();

export function colorForOrg(oid){
  if (orgColorCache.has(oid)) {
    return orgColorCache.get(oid);
  }
  
      const h = (hashCode(oid) % cssNumber('--org-hue-cycle')) * cssNumber('--org-hue-step');
  const s = cssNumber('--org-saturation');
  const fill = `hsla(${h}, ${s}%, ${cssNumber('--org-fill-lightness')}%, ${cssNumber('--org-fill-alpha')})`;
  const stroke = `hsla(${h}, ${s}%, ${cssNumber('--org-stroke-lightness')}%, ${cssNumber('--org-stroke-alpha')})`;
  const colors = { fill, stroke };
  
  orgColorCache.set(oid, colors);
  return colors;
}

export function orgDepth(oid){
  let d = 0;
  let cur = String(oid);
  const seen = new Set();
  while (parentOf && parentOf.has(cur)) {
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = parentOf.get(cur);
    d++;
  }
  return d;
}



/**
 * Aktualisiert die Attribute-Statistik in der Fußzeile
 */
export function updateAttributeStats() {
  const attributeCountEl = document.getElementById('stats-attributes-count');
  if (attributeCountEl) {
    const loadedCount = attributeTypes.size;
    const activeCount = activeAttributes.size;
    attributeCountEl.textContent = `${activeCount}/${loadedCount}`;
  }
}

/** True when an attribute ring is effectively drawn: active and category not eye-hidden. */
export function isAttributeRingVisible(attrName) {
  if (!activeAttributes.has(attrName)) return false;
  const [category] = String(attrName).includes('::') ? String(attrName).split('::') : ['Attribute'];
  return !hiddenCategories.has(category);
}

/** Number of attribute rings effectively drawn around a person node. */
export function countVisibleAttributeRings(personId) {
  const nodeAttrs = personAttributes.get(String(personId));
  if (!nodeAttrs || nodeAttrs.size === 0) return 0;
  let count = 0;
  for (const attrName of nodeAttrs.keys()) {
    if (isAttributeRingVisible(attrName)) count++;
  }
  return count;
}

/**
 * Aktualisiert nur die Attribut-Kreise ohne ein komplettes Relayout
 */
export function updateAttributeCircles() {
  // Wenn wir aus dem renderGraph-Kontext heraus aufgerufen werden, ist der Graph bereits gerendert
  // Wenn nicht, prüfen wir, ob überhaupt ein Subgraph existiert
  
  // Styling-Parameter
  const nodeRadius = cssNumber('--node-radius');
  const circleGap = cssNumber('--attribute-circle-gap');
  const circleWidth = cssNumber('--attribute-circle-stroke-width');
  const nodeStrokeWidth = cssNumber('--node-with-attributes-stroke-width');
  
    // Alle Knoten im SVG auswählen
  const nodes = d3.selectAll(SVG_ID + ' .node');
  
  const applyRootStyling = () => {
    nodes.each(function(d) {
      if (!d) return;
      const personId = String(d.id);
      const sid = String(personId);
      const hasExplicitRoots = Array.isArray(selectedRootIds) && selectedRootIds.length > 0;
      const isVisualRoot = hasExplicitRoots
        ? selectedRootIds.includes(sid)
        : (currentSelectedId != null && String(currentSelectedId) === sid);
      // Roots get a configured fill instead of a colored border, so they stay
      // clearly distinguishable from the attribute rings around the node.
      // Presentation lives in styles.css (.node-circle.is-root); the inline
      // fill/opacity from the level-based reset is cleared so the rule wins.
      const circle = d3.select(this).select('circle.node-circle')
        .classed('is-root', isVisualRoot);
      if (isVisualRoot) circle.style('fill', null).style('opacity', null);
    });
  };
  
  // Alle bestehenden Attribut-Kreise entfernen
  nodes.selectAll('circle.attribute-circle').remove();
  
  // Wenn Attribute ausgeblendet sind, nur die Kreise entfernen und den Rest überspringen
  if (!attributesVisible) {
    // Alle Knoten auf Standard zurücksetzen, aber hierarchie-basierte Fill behalten
    nodes.selectAll('circle.node-circle')
      .style('fill', d => getNodeFillByLevel(d))
      .style('stroke', null)
      .style('stroke-width', null)
      .style('opacity', null);
    
    // has-attributes Klasse entfernen [SF]
    nodes.classed('has-attributes', false).classed('attr-dimmed', false);
    
    // Labels auf Standard-Position zurücksetzen
    nodes.selectAll('text.label')
      .attr('x', cssNumber('--label-x-offset'));
    
    applyRootStyling();
    return;
  }
  
  // Prüfe, ob es überhaupt aktive Attribute gibt
  const hasAnyActiveAttributes = activeAttributes.size > 0;
  
  // Set zum Speichern aller IDs von Knoten mit aktiven Attributen
  const nodesWithActiveAttributesIds = new Set();
  
  // Alle Knoten auf Standard zurücksetzen, aber hierarchie-basierte Fill behalten
  nodes.selectAll('circle.node-circle')
    .style('fill', d => getNodeFillByLevel(d))
    .style('stroke', null)
    .style('stroke-width', null)
    .style('opacity', null);
  
  // has-attributes Klasse zurücksetzen (wird in der Schleife neu gesetzt) [SF]
  nodes.classed('has-attributes', false).classed('attr-dimmed', false);
  
  // Labels auf Standard-Position zurücksetzen (werden später für Knoten mit Attributen angepasst)
  nodes.selectAll('text.label')
    .attr('x', cssNumber('--label-x-offset'));
  
  // Neue Attribut-Kreise hinzufügen und Knoten mit Attributen identifizieren
  nodes.each(function(d) {
    if (!d) return; // Sicherheitsprüfung
    
    const nodeGroup = d3.select(this);
    const personId = String(d.id);
    const nodeAttrs = personAttributes.get(personId);
    
    // Standardwert für Label-Position (ohne Attribute)
    let outerMostRadius = nodeRadius;
    
    // Knoten mit Attributen prüfen
    if (nodeAttrs && nodeAttrs.size > 0) {
      // Filtere auf aktive Attribute und nicht-ausgeblendete Kategorien
      const activeNodeAttrs = Array.from(nodeAttrs.entries())
        .filter(([attrName]) => isAttributeRingVisible(attrName))
        .sort((a, b) => {
          const [ca, na] = String(a[0]).split('::');
          const [cb, nb] = String(b[0]).split('::');
          return (ca === cb) ? na.localeCompare(nb) : ca.localeCompare(cb);
        }); // Gruppiere nach Kategorie, dann nach Name
      
      // Wenn es aktive Attribute gibt, ändere den Hauptknoten und speichere die ID
      if (activeNodeAttrs.length > 0) {
        nodesWithActiveAttributesIds.add(personId);
        
        // Klasse für CSS-basierte Label-Sichtbarkeit setzen [SF]
        nodeGroup.classed('has-attributes', true);
        
                // Presentation lives in styles.css (.node.has-attributes .node-circle)
        // and the export stylesheet; the inline level fill is cleared so the
        // class rules win. Roots keep their fill via :not(.is-root).
        nodeGroup.select('circle.node-circle').style('fill', null);
        
        // Berechne äußersten Radius für Label-Positionierung
        const attrCount = activeNodeAttrs.length;
        if (attrCount > 0) {
          // Äußerster Radius: nodeRadius + nodeStroke/2 + attrCount * (gap + width)
          outerMostRadius = nodeRadius + (nodeStrokeWidth / 2) + (attrCount * (circleGap + circleWidth));
        }
      }
      
      // Füge Attribute-Kreise von innen nach außen hinzu
      activeNodeAttrs.forEach(([attrName], idx) => {
        const attrColor = attributeTypes.get(attrName);
        if (!attrColor) return;
        
        // Kreisradius berechnen (gleichmäßige Abstände):
        // r0 = nodeRadius + nodeStroke/2 + gap + width/2
        // r(i) = r0 + i * (gap + width)
        const base = nodeRadius + (nodeStrokeWidth / 2) + circleGap + (circleWidth / 2);
        const attrRadius = base + idx * (circleGap + circleWidth);
        
        // Attributkreis vor dem Hauptkreis einfügen, damit er dahinter liegt
        nodeGroup.insert("circle", "circle.node-circle")
          .attr("r", attrRadius)
          .attr("class", "attribute-circle")
          .attr("data-attribute", attrName)
                    .style("stroke", attrColor);
      });
    }
    
    // Label-Position basierend auf dem äußersten Radius anpassen
    // Füge einen kleinen Abstand hinzu
    const labelOffset = cssNumber('--label-ring-gap');
    const labelPos = (outerMostRadius === nodeRadius) ? cssNumber('--label-x-offset') : (outerMostRadius + labelOffset);
    nodeGroup.select('text.label')
      .attr('x', labelPos);
  });
  
  // Wenn es aktive Attribute gibt, wende Transparenz auf alle Knoten ohne Attribute an
  if (hasAnyActiveAttributes && activeAttributes.size > 0 && nodesWithActiveAttributesIds.size > 0) {
    nodes.each(function(d) {
      if (!d) return;
      const personId = String(d.id);
      const nodeGroup = d3.select(this);
      
      // Wenn dieser Knoten nicht in der Liste der Knoten mit aktiven Attributen ist
            if (!nodesWithActiveAttributesIds.has(personId)) {
        nodeGroup.classed('attr-dimmed', true);
      }
    });
  }
  
  applyRootStyling();
}

// Footer stats, type-driven (FR-8.12): tenant STOCK identities, visible
// projection, per-render-mode counters (cluster nodes, ring groups —
// replacing the fixed OE/attribute counters), hidden counter, and the
// lower-bound cap counter when the projection is truncated (E67).
export function updateFooterStats(subgraph) {
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  // Stock: v2 counts store identities; the legacy tenant counts raw records.
  const og2 = (typeof og2Active === 'function' && og2Active()) ? og2State() : null;
  if (og2) {
    setText('stats-nodes-total', og2.store.nodes.size);
    setText('stats-links-total', og2.store.edges.size);
  } else {
    setText('stats-nodes-total', raw.nodes.length);
    setText('stats-links-total', raw.links.length);
  }

  // Stelle sicher, dass die Ring-Gruppen-Statistik aktualisiert wird
  const attrCountEl = document.getElementById('stats-attributes-count');
  if (attrCountEl && attrCountEl.textContent === '0') {
    updateAttributeStats();
  }

  setText('stats-nodes-visible', subgraph ? subgraph.nodes.length : 0);
  setText('stats-links-visible', subgraph ? subgraph.links.length : 0);
  setText('stats-orgs-count', allowedOrgs.size);
  setText('stats-hidden-count', typeof currentHiddenCount === 'number' ? currentHiddenCount : 0);

  // Diff counters (FR-8.12): added / removed / changed of the visible scene.
  const diffWrap = document.getElementById('stats-diff');
  if (diffWrap) {
    const diff = og2 && og2.lastDiff;
    if (diff) {
      setText('stats-diff-new', diff.added);
      setText('stats-diff-removed', diff.removed);
      setText('stats-diff-changed', diff.changed);
      diffWrap.hidden = false;
    } else {
      diffWrap.hidden = true;
    }
  }

  // Cap counter (E67/FR-8.1): lower bound from the discovered frontier.
  const capped = document.getElementById('stats-capped');
  if (capped) {
    const projection = og2 && og2.lastProjection;
    if (projection && projection.truncated) {
      setText('stats-capped-count', projection.skipped);
      capped.hidden = false;
    } else {
      capped.hidden = true;
    }
  }
}

/**
 * Extrahiert ID aus Objekt oder String
 */
