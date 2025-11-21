const SVG_ID = "#graph";
const STATUS_ID = "#status";
const INPUT_COMBO_ID = "#comboInput";
const LIST_COMBO_ID = "#comboList";
const INPUT_DEPTH_ID = "#depth";
const BTN_APPLY_ID = "#apply";

const WIDTH = 1200;
const HEIGHT = 800;
const MAX_DROPDOWN_ITEMS = 100;
const MIN_SEARCH_LENGTH = 2;
const MAX_ROOTS = 5;
const BFS_LEVEL_ANIMATION_DELAY_MS = 100;

let raw = { nodes: [], links: [], persons: [], orgs: []};
let personAttributes = new Map(); // Map von ID/Email zu Attribut-Maps
let attributeTypes = new Map(); // Map von Attributnamen zu Farbwerten
let activeAttributes = new Set(); // Menge der aktiven Attribute für die Anzeige
let emptyCategories = new Set(); // Kategorien ohne Attribute (nur Platzhalter)
let categorySourceFiles = new Map(); // Map Kategorie -> {filename, url, originalData}
let modifiedCategories = new Set(); // Set von Kategorien mit Änderungen
let byId = new Map();
let allNodesUnique = [];
let attributesVisible = true; // Flag für die Sichtbarkeit der Attribute
let savedActiveAttributes = new Set(); // Speicher für aktive Attribute
let filteredItems = [];
let activeIndex = -1;
let currentSelectedId = null;
let searchDebounceTimer = null;
let zoomBehavior = null;
let managementEnabled = true;
let clusterLayer = null;
let clusterSimById = new Map();
let clusterPersonIds = new Set();
let clusterPolygons = new Map();
let currentZoomTransform = null;
let labelsVisible = true;
let debugMode = false;
let legendMenuEl = null;
let nodeMenuEl = null;
let simAllById = new Map();
let parentOf = new Map();
let orgParent = new Map();      // childOrgId -> parentOrgId
let orgChildren = new Map();    // parentOrgId -> Set(childOrgId)
let orgRoots = [];              // Array der Wurzel-OEs (ohne Eltern)
let orgLegendNodes = new Map();
let currentSubgraph = null;
let currentLayoutMode = 'force'; // 'force' or 'hierarchy'
let hierarchyLevels = new Map(); // nodeId -> level number
let currentSimulation = null; // Global reference to D3 simulation
let preferredData = "auto";
let envConfig = null;
let collapsedCategories = new Set(); // Kategorien mit eingeklapptem Zustand
let hiddenCategories = new Set();    // Kategorien die temporär ausgeblendet sind (ohne Attribut-Status zu ändern)
let hiddenNodes = new Set();
let hiddenByRoot = new Map();
let currentHiddenCount = 0; // Anzahl der ausgeblendeten Knoten in der aktuellen Ansicht
let selectedRootIds = [];
let lastSingleRootId = null;
let lastRenderRoots = [];
let lastRenderDepth = null;
let lastRenderDirMode = 'both';

function isRoot(id){ return selectedRootIds.includes(String(id)); }
function setSingleRoot(id){
  selectedRootIds = [String(id)];
  lastSingleRootId = String(id);
  // Voll-Reset der Simulation bei Root-Wechsel [SF][PA]
  if (typeof currentSimulation !== 'undefined' && currentSimulation) {
    try { currentSimulation.stop(); } catch(_) {}
    currentSimulation = null;
  }
  try { if (debugMode) console.log('[roots] setSingleRoot', { id: String(id) }); } catch {}
}
function addRoot(id){
  const s = String(id);
  // Wenn noch kein Multi-Root aktiv ist, aber es einen aktuellen Einzel-Root gibt, übernehme ihn als Start
  if (selectedRootIds.length === 0) {
    const seed = currentSelectedId ? String(currentSelectedId) : (lastSingleRootId ? String(lastSingleRootId) : null);
    if (seed && seed !== s) {
      selectedRootIds = [seed];
      try { if (debugMode) console.log('[roots] seed multi-root from', { seed, add: s }); } catch {}
    }
  }
  if (selectedRootIds.includes(s)) return true;
  if (selectedRootIds.length >= MAX_ROOTS) { showTemporaryNotification(`Maximal ${MAX_ROOTS} Roots`); return false; }
  const before = selectedRootIds.slice();
  selectedRootIds = selectedRootIds.concat([s]);
  // Falls dies der erste Add ist und wir einen letzten Einzel-Root kennen, füge ihn nachträglich hinzu
  if (before.length === 0 && lastSingleRootId && lastSingleRootId !== s) {
    selectedRootIds = [String(lastSingleRootId)].concat(selectedRootIds);
    try { if (debugMode) console.log('[roots] retro-seed after add', { lastSingleRootId, add: s, after: selectedRootIds.slice() }); } catch {}
  }
  try { if (debugMode) console.log('[roots] addRoot', { add: s, before, after: selectedRootIds.slice() }); } catch {}
  return true;
}
function removeRoot(id){
  const s = String(id);
  selectedRootIds = selectedRootIds.filter(x => x !== s);
}

function cssNumber(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// Farb-Hilfen: gleiche Kategorie -> ähnliche Farben, Kategorien klar unterscheidbar
const categoryHueCache = new Map();
function quantizedHueFromCategory(category) {
  if (categoryHueCache.has(category)) return categoryHueCache.get(category);
  const rawHue = Math.abs(hashCode(String(category))) % 360;
  const step = 40; // große Abstände zwischen Kategorien
  const hue = (Math.round(rawHue / step) * step) % 360;
  categoryHueCache.set(category, hue);
  return hue;
}
function colorForCategoryAttribute(category, attrName, ordinal) {
  const baseHue = quantizedHueFromCategory(category);
  const localShift = (ordinal % 6) * 10; // kleine Variation innerhalb der Kategorie
  const hue = (baseHue + localShift) % 360;
  const sat = 65;
  const light = 50 + ((ordinal % 2) ? 5 : 0); // leichte Helligkeitsvariation
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/**
 * Berechnet die Füllfarbe für einen Node basierend auf seiner hierarchischen Ebene
 * @param {Object} node - Der Node-Datensatz
 * @returns {string} CSS-Farbwert für die Füllung
 */
function getNodeFillByLevel(node) {
  if (!node || node.type !== 'person') {
    return getComputedStyle(document.documentElement).getPropertyValue('--node-fill') || '#4F46E5';
  }
  
  const level = node.level || 0;
  const maxLevel = Math.max(...Array.from(hierarchyLevels.values()).filter(l => l >= 0));
  
  // Wenn keine Hierarchie-Informationen verfügbar, Standardfarbe verwenden
  if (maxLevel === 0 || hierarchyLevels.size === 0) {
    return getComputedStyle(document.documentElement).getPropertyValue('--node-fill') || '#4F46E5';
  }
  
  // Normalisierte Ebene (0 = top, 1 = bottom)
  const normalizedLevel = maxLevel > 0 ? level / maxLevel : 0;
  
  // Hole die Gradient-Farben aus CSS-Variablen
  const topLevelColor = getComputedStyle(document.documentElement).getPropertyValue('--node-fill-top-level') || '#e0e7ff';
  const midLevelColor = getComputedStyle(document.documentElement).getPropertyValue('--node-fill-mid-level') || '#818cf8';
  const lowLevelColor = getComputedStyle(document.documentElement).getPropertyValue('--node-fill-low-level') || '#4F46E5';
  
  // Whle Farbe basierend auf normalisierter Ebene
  if (normalizedLevel <= 0.33) {
    return topLevelColor.trim();
  } else if (normalizedLevel <= 0.67) {
    return midLevelColor.trim();
  } else {
    return lowLevelColor.trim();
  }
}

function clustersAtPoint(p) {
  // Sammle OEs mit ihren IDs und Labels
  const orgItems = [];
  for (const [oid, poly] of clusterPolygons.entries()) {
    if (!allowedOrgs.has(oid)) continue;
    if (poly && poly.length>=3 && d3.polygonContains(poly, p)) {
      const label = byId.get(oid)?.label || oid;
      orgItems.push({ id: oid, label, depth: orgDepth(oid) });
    }
  }
  
  // Sortiere nach Tiefe absteigend (höhere Tiefe = kleinere OE kommt zuerst)
  orgItems.sort((a, b) => b.depth - a.depth || a.label.localeCompare(b.label));
  
  // Gib nur die Labels zurück
  return orgItems.map(item => item.label);
}

function computeClusterPolygon(nodes, pad) {
  const pts = nodes.map(n => [n.x, n.y]);
  const r = cssNumber('--node-radius', 8) + pad;
  if (pts.length === 0) return [];
  if (pts.length === 1) {
    const [x,y] = pts[0];
    const poly = [];
    for (let i=0;i<12;i++){ const a=(i/12)*Math.PI*2; poly.push([x+Math.cos(a)*r, y+Math.sin(a)*r]); }
    return poly;
  }
  if (pts.length === 2) {
    const [a,b] = pts;
    const dx=b[0]-a[0], dy=b[1]-a[1];
    const len=Math.hypot(dx,dy)||1;
    const ux=dx/len, uy=dy/len; const nx=-uy, ny=ux;
    return [
      [a[0]+nx*r, a[1]+ny*r],
      [b[0]+nx*r, b[1]+ny*r],
      [b[0]-nx*r, b[1]-ny*r],
      [a[0]-nx*r, a[1]-ny*r]
    ];
  }
  const hull = d3.polygonHull(pts);
  if (!hull || hull.length<3) return [];
  const cx=d3.mean(hull,p=>p[0]);
  const cy=d3.mean(hull,p=>p[1]);
  return hull.map(([x,y])=>{
    const vx=x-cx, vy=y-cy; const L=Math.hypot(vx,vy)||1; const s=(L+pad)/L; return [cx+vx*s, cy+vy*s];
  });
}

// Collect active ancestor chain (including self) for a given org id
function getActiveAncestorChain(oid) {
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
function ensureTooltip() {
  if (tooltipEl) return;
  tooltipEl = document.createElement('div');
  tooltipEl.style.position = 'fixed';
  tooltipEl.style.pointerEvents = 'none';
  tooltipEl.style.background = 'rgba(17,17,17,0.9)';
  tooltipEl.style.color = '#fff';
  tooltipEl.style.fontSize = '12px';
  tooltipEl.style.padding = '10px 12px';
  tooltipEl.style.borderRadius = '6px';
  tooltipEl.style.zIndex = 1000;
  tooltipEl.style.whiteSpace = 'pre';
  tooltipEl.style.display = 'none';
  tooltipEl.style.maxWidth = '400px';
  tooltipEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
  tooltipEl.style.lineHeight = '1.4';
  document.body.appendChild(tooltipEl);
}
function showTooltip(x, y, lines) {
  tooltipEl.textContent = lines.join('\n');
  tooltipEl.style.left = `${x+12}px`;
  tooltipEl.style.top = `${y+12}px`;
  tooltipEl.style.display = 'block';
}
function hideTooltip() { if (tooltipEl) tooltipEl.style.display = 'none'; }

/**
 * Erstellt Tooltip-Zeilen für eine Person mit Attributen und OE-Zugehörigkeiten
 * @param {string} personId - ID der Person
 * @param {string} nodeLabel - Label des Knotens
 * @param {Array} visibleOrgs - Array von sichtbaren OE-Labels am Cursor
 * @returns {Array} Array von Tooltip-Zeilen
 */
function buildPersonTooltipLines(personId, nodeLabel, visibleOrgs = []) {
  const lines = [];
  
  // Section header for node
  lines.push(`👤 ${nodeLabel}`);
  
  // Zeige Attribute für diese Person an
  if (personId && personAttributes.has(personId)) {
    const attrs = personAttributes.get(personId);
    lines.push('📊 Attribute:');
    let hasAttributes = false;
    for (const [attrName, attrValue] of attrs.entries()) {
      if (activeAttributes.has(attrName)) {
        const displayValue = attrValue !== '1' ? `: ${attrValue}` : '';
        lines.push(`  • ${attrName}${displayValue}`);
        hasAttributes = true;
      }
    }
    if (!hasAttributes) {
      lines.push('  • Keine aktiven Attribute');
    }
  }
  
  // Get all OEs this person belongs to (not just visible ones)
  const allPersonOrgs = findAllPersonOrgs(personId);
  
  // Add visible org memberships (at mouse point) with a header
  if (visibleOrgs.length > 0) {
    lines.push('🔍 OEs am Cursor:');
    visibleOrgs.forEach(org => lines.push(`  • ${org}`));
  }
  
  // Add all org memberships with header
  if (allPersonOrgs.length > 0) {
    lines.push('🏢 Alle OE-Zugehörigkeiten:');
    allPersonOrgs.forEach(org => lines.push(`  • ${org}`));
  }
  
  return lines;
}

/**
 * Tooltips für Cluster-Hover
 */
function handleClusterHover(event, svgSel) {
  if (!currentZoomTransform) { 
    hideTooltip(); 
    return; 
  }
  
  const [mx, my] = d3.pointer(event, svgSel.node());
  const p = currentZoomTransform.invert([mx, my]);
  
  const r = cssNumber('--node-radius', 8) + 6;
  let nodeLabel = null;
  let personId = null;
  
  for (const nd of simAllById.values()) {
    if (nd.x == null || nd.y == null) continue;
    const dx = p[0] - nd.x, dy = p[1] - nd.y;
    if ((dx*dx + dy*dy) <= r*r) { 
      nodeLabel = nd.label || String(nd.id);
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
    lines.push('🏢 OE-Bereiche:');
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
function findAllPersonOrgs(personId) {
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
      return (node && node.label) ? node.label : String(item.id);
    });
}

function hashCode(str){ let h=0; for(let i=0;i<str.length;i++){ h=((h<<5)-h)+str.charCodeAt(i); h|=0; } return h>>>0; }
const orgColorCache = new Map();

function colorForOrg(oid){
  if (orgColorCache.has(oid)) {
    return orgColorCache.get(oid);
  }
  
  const h = (hashCode(oid) % 12) * 30; // 12-step hue
  const fill = `hsla(${h}, 60%, 60%, 0.25)`;
  const stroke = `hsla(${h}, 60%, 40%, 0.85)`;
  const colors = { fill, stroke };
  
  orgColorCache.set(oid, colors);
  return colors;
}

function orgDepth(oid){
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
 * Konvertiert eine Farbe in ein transparentes RGBA-Format (wie bei OEs)
 * @param {string} color - Farbe im Format hsl(...) oder rgb(...) oder #hex
 * @param {number} alpha - Alpha-Wert (0-1), default 0.25 wie bei OEs
 * @returns {string} RGBA-Farbe mit Transparenz
 */
function colorToTransparent(color, alpha = 0.25) {
  // Parse HSL
  const hslMatch = /hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/.exec(color);
  if (hslMatch) {
    const h = parseInt(hslMatch[1]);
    const s = parseInt(hslMatch[2]);
    const l = parseInt(hslMatch[3]);
    return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
  }
  
  // Fallback: gib die ursprüngliche Farbe zurück
  return color;
}

function setStatus(msg) {
  const el = document.querySelector(STATUS_ID);
  if (el) el.textContent = msg;
}

/**
 * Zeigt eine temporäre Benachrichtigung an, ohne den Status zu überschreiben
 */
function showTemporaryNotification(message, duration = 3000) {
  // Prüfe, ob bereits eine Benachrichtigung existiert
  let notification = document.getElementById('temp-notification');
  
  // Wenn nicht, erstelle eine neue
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'temp-notification';
    notification.style.position = 'fixed';
    notification.style.bottom = '60px'; // Über dem Footer
    notification.style.left = '50%';
    notification.style.transform = 'translateX(-50%)';
    notification.style.background = 'var(--text-strong)';
    notification.style.color = 'var(--panel-bg)';
    notification.style.padding = '8px 16px';
    notification.style.borderRadius = '4px';
    notification.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
    notification.style.zIndex = '1000';
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s ease';
    document.body.appendChild(notification);
  }
  
  // Bestehende Timer löschen
  if (notification.hideTimeout) {
    clearTimeout(notification.hideTimeout);
  }
  
  // Nachricht aktualisieren und einblenden
  notification.textContent = message;
  
  // Sicherstellen, dass das Element im DOM ist, bevor wir die Transition starten
  setTimeout(() => {
    notification.style.opacity = '1';
  }, 10);
  
  // Nach der angegebenen Zeit ausblenden
  notification.hideTimeout = setTimeout(() => {
    notification.style.opacity = '0';
    // Nach dem Ausblenden aus dem DOM entfernen
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300); // Dauer der Ausblend-Transition
  }, duration);
}

/**
 * Aktualisiert die Attribute-Statistik in der Fußzeile
 */
function updateAttributeStats() {
  const attributeCountEl = document.getElementById('stats-attributes-count');
  if (attributeCountEl) {
    const loadedCount = attributeTypes.size;
    const activeCount = activeAttributes.size;
    attributeCountEl.textContent = `${activeCount}/${loadedCount}`;
  }
}

/**
 * Aktualisiert nur die Attribut-Kreise ohne ein komplettes Relayout
 */
function updateAttributeCircles() {
  // Wenn wir aus dem renderGraph-Kontext heraus aufgerufen werden, ist der Graph bereits gerendert
  // Wenn nicht, prüfen wir, ob überhaupt ein Subgraph existiert
  
  // Styling-Parameter
  const nodeRadius = cssNumber('--node-radius', 3);
  const circleGap = cssNumber('--attribute-circle-gap', 1);
  const circleWidth = cssNumber('--attribute-circle-stroke-width', 2);
  const nodeStrokeWidth = cssNumber('--node-with-attributes-stroke-width', 2);
  
  // Farbe und Stil für Knoten mit Attributen
  const nodeWithAttributesFill = 'var(--node-with-attributes-fill)';
  const nodeWithAttributesStroke = 'var(--node-with-attributes-stroke, #4682b4)';
  const nodeWithAttributesStrokeWidth = cssNumber('--node-with-attributes-stroke-width', 3);
  
  // Transparenz für Knoten ohne Attribute
  const nodesWithoutAttributesOpacity = cssNumber('--nodes-without-attributes-opacity', 0.2);
  
  // Alle Knoten im SVG auswählen
  const nodes = d3.selectAll(SVG_ID + ' .node');
  
  // Alle bestehenden Attribut-Kreise entfernen
  nodes.selectAll('circle.attribute-circle').remove();
  
  // Wenn Attribute ausgeblendet sind, nur die Kreise entfernen und den Rest überspringen
  if (!attributesVisible) {
    // Alle Knoten auf Standard zurücksetzen, aber hierarchie-basierte Fill behalten
    nodes.selectAll('circle.node-circle')
      .style('fill', d => getNodeFillByLevel(d))
      .style('stroke', null)
      .style('stroke-width', null)
      .style('opacity', 1);
    
    // Labels auf Standard-Position zurücksetzen
    nodes.selectAll('text.label')
      .attr('x', 10);
    
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
    .style('opacity', 1);
  
  // Labels auf Standard-Position zurücksetzen (werden später für Knoten mit Attributen angepasst)
  nodes.selectAll('text.label')
    .attr('x', 10);
  
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
        .filter(([attrName]) => {
          if (!activeAttributes.has(attrName)) return false;
          // Kategorie aus Attributnamen extrahieren
          const [category] = String(attrName).includes('::') ? String(attrName).split('::') : ['Attribute'];
          // Nur anzeigen, wenn Kategorie nicht ausgeblendet ist
          return !hiddenCategories.has(category);
        })
        .sort((a, b) => {
          const [ca, na] = String(a[0]).split('::');
          const [cb, nb] = String(b[0]).split('::');
          return (ca === cb) ? na.localeCompare(nb) : ca.localeCompare(cb);
        }); // Gruppiere nach Kategorie, dann nach Name
      
      // Wenn es aktive Attribute gibt, ändere den Hauptknoten und speichere die ID
      if (activeNodeAttrs.length > 0) {
        nodesWithActiveAttributesIds.add(personId);
        
        // Haupt-Knoten mit spezieller Darstellung für Knoten mit Attributen
        nodeGroup.select('circle.node-circle')
          .style('fill', nodeWithAttributesFill)
          .style('stroke', nodeWithAttributesStroke)
          .style('stroke-width', nodeWithAttributesStrokeWidth);
        
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
          .style("stroke", attrColor)
          .style("stroke-width", circleWidth);
      });
    }
    
    // Label-Position basierend auf dem äußersten Radius anpassen
    // Füge einen kleinen Abstand hinzu (z.B. 3 Pixel)
    const labelOffset = 3;
    const labelPos = (outerMostRadius === nodeRadius) ? 10 : (outerMostRadius + labelOffset);
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
        nodeGroup.select('circle.node-circle')
          .style('opacity', nodesWithoutAttributesOpacity);
      }
    });
  }
}

function updateFooterStats(subgraph) {
  // Update total loaded stats
  const nodesTotal = raw.nodes.length;
  const linksTotal = raw.links.length;
  const orgsTotal = raw.orgs.length;
  
  document.getElementById('stats-nodes-total').textContent = nodesTotal;
  document.getElementById('stats-links-total').textContent = linksTotal;
  document.getElementById('stats-orgs-total').textContent = orgsTotal;
  
  // Stelle sicher, dass die Attributstatistik aktualisiert wird, wenn noch nicht geschehen
  if (document.getElementById('stats-attributes-count').textContent === '0') {
    updateAttributeStats();
  }
  
  // Update visible stats (from subgraph if provided)
  if (subgraph) {
    document.getElementById('stats-nodes-visible').textContent = subgraph.nodes.length;
    document.getElementById('stats-links-visible').textContent = subgraph.links.length;
  } else {
    document.getElementById('stats-nodes-visible').textContent = 0;
    document.getElementById('stats-links-visible').textContent = 0;
  }
  
  // Update OE stats: show only active OEs, unless cluster count differs
  const clusterCount = clusterPolygons.size;
  const activeOrgsCount = allowedOrgs.size;
  const orgsDisplayEl = document.getElementById('stats-orgs-display');
  const orgsCountEl = document.getElementById('stats-orgs-count');
  
  if (clusterCount > 0 && clusterCount !== activeOrgsCount) {
    // Show both values when they differ
    orgsDisplayEl.innerHTML = `Aktive OEs: <strong>${activeOrgsCount}</strong> (Cluster: <strong>${clusterCount}</strong>)`;
  } else {
    // Show only active OEs
    orgsCountEl.textContent = activeOrgsCount;
  }
}

/**
 * Extrahiert ID aus Objekt oder String
 */
function idOf(v) {
  return String(typeof v === 'object' && v ? v.id : v);
}

let allowedOrgs = new Set();

function applyLoadedDataObject(data, sourceName) {
  const persons = Array.isArray(data.persons) ? data.persons : [];
  const orgs = Array.isArray(data.orgs) ? data.orgs : [];
  const links = Array.isArray(data.links) ? data.links : [];

  const nodes = [];
  const personIds = new Set();
  persons.forEach(p => { if (p && p.id) { nodes.push({ ...p, id: String(p.id), type: 'person' }); personIds.add(String(p.id)); } });
  orgs.forEach(o => { if (o && o.id) { nodes.push({ ...o, id: String(o.id), type: 'org' }); } });

  const seen = new Set();
  const idSet = new Set(nodes.map(n => String(n.id)));
  const norm = [];
  for (const l of links) {
    const s = idOf(l && l.source);
    const t = idOf(l && l.target);
    if (!idSet.has(s) || !idSet.has(t)) continue;
    if (s === t) continue;
    const key = `${s}>${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    norm.push({ source: s, target: t });
  }

  raw = { nodes, links: norm, persons, orgs };
  byId = new Map(raw.nodes.map(n => [String(n.id), n]));
  allNodesUnique = Array.from(byId.values());

  // OE-Hierarchie global initialisieren (Org->Org-Kanten) [CA]
  parentOf = new Map();       // Bestehende Nutzung für Org-Tiefe und Tooltips
  orgParent = new Map();
  orgChildren = new Map();
  orgRoots = [];
  if (raw && Array.isArray(raw.orgs) && Array.isArray(raw.links)) {
    const orgIds = new Set(raw.orgs.map(o => String(o.id)));
    const hasParent = new Set();
    for (const l of raw.links) {
      const s = idOf(l.source), t = idOf(l.target);
      if (!orgIds.has(s) || !orgIds.has(t)) continue;
      // child -> parent
      parentOf.set(t, s);
      orgParent.set(t, s);
      // parent -> children
      if (!orgChildren.has(s)) orgChildren.set(s, new Set());
      orgChildren.get(s).add(t);
      hasParent.add(t);
    }
    const allOrgIds = Array.from(orgIds);
    orgRoots = allOrgIds.filter(id => !hasParent.has(id));
  }
  // Anfangszustand: keine OE ist ausgewählt; Auswahl entsteht nur durch Benutzerinteraktion
  allowedOrgs = new Set();
  hiddenNodes = new Set();
  hiddenByRoot = new Map();

  // Beim Laden eines neuen Datensatzes prüfe, ob Personen mit den aktuellen Attributen übereinstimmen
  if (personAttributes.size > 0) {
    const newPersonIds = new Set(persons.map(p => String(p.id)));
    const stillValid = Array.from(personAttributes.keys()).some(id => newPersonIds.has(id));
    
    if (!stillValid) {
      // Wenn keine der Personen mit Attributen im neuen Datensatz vorhanden ist,
      // setze die Attribute zurück
      personAttributes = new Map();
      attributeTypes = new Map();
      activeAttributes = new Set();
      emptyCategories = new Set();
      categorySourceFiles = new Map();
      modifiedCategories = new Set();
      buildAttributeLegend();
      document.getElementById('stats-attributes-count').textContent = '0';
    }
  }
  
  populateCombo("");
  // Globalen OE-Baum einmalig aufbauen; Sichtbarkeit wird separat über applyLegendScope gesteuert
  buildOrgLegend();
  // Initialer Zustand: kein Scope -> alle OEs ausgeblendet
  applyLegendScope(new Set());
  buildHiddenLegend();
  setStatus(sourceName);
  updateFooterStats(null);
}

async function loadEnvConfig() {
  try {
    const res = await fetch("./env.json", { cache: "no-store" });
    if (res.ok) {
      envConfig = await res.json();
      return true;
    } else {
      // Keine gültige env.json gefunden (HTTP-Fehler)
      console.warn('env.json konnte nicht geladen werden:', res.status, res.statusText);
      setStatus('Keine gültige env.json gefunden – manuelles Laden über den Status möglich.');
      showTemporaryNotification('env.json konnte nicht geladen werden – bitte Datei prüfen oder manuell Daten laden.', 5000);
    }
  } catch (e) {
    // Fehler beim Laden oder Parsen von env.json
    console.error('Fehler beim Laden von env.json:', e);
    setStatus('Fehler beim Laden von env.json – manuelles Laden über den Status möglich.');
    showTemporaryNotification('env.json ist ungültig oder konnte nicht gelesen werden (z.B. JSON-Syntaxfehler). Bitte Datei prüfen.', 5000);
  }
  envConfig = null;
  return false;
}

/**
 * Hilfsfunktion: Kategorie aus Dateinamen ableiten
 */
function categoryFromUrl(url){
  try{
    const withoutQuery = String(url).split('?')[0].split('#')[0];
    const parts = withoutQuery.split('/');
    const fname = parts[parts.length-1] || withoutQuery;
    const dot = fname.lastIndexOf('.');
    return (dot>0?fname.slice(0,dot):fname).trim();
  }catch{ return 'Attribute'; }
}

/**
 * Lädt Attribute aus einer URL gemäß ENV-Konfiguration
 */
async function loadAttributesFromUrl(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const text = await res.text();
    const { attributes, types, count, isEmpty } = parseAttributeList(text);
    const category = categoryFromUrl(url);
    
    // Leere Datei = nur Kategorie ohne Attribute
    if (isEmpty) {
      // Registriere die leere Kategorie
      emptyCategories.add(category);
      
      // Speichere Quell-Informationen auch für leere Kategorien
      const filename = url.split('/').pop().split('?')[0];
      categorySourceFiles.set(category, {
        filename: filename || `${category}.txt`,
        url: url,
        originalText: text,
        format: 'comma' // Default für leere Dateien
      });
      
      // Update UI
      buildAttributeLegend();
      updateAttributeStats();
      
      return {
        loaded: true,
        matchedCount: 0,
        unmatchedCount: 0,
        totalAttributes: 0,
        isEmpty: true,
        category
      };
    }
    
    // Verknüpfe die geladenen Attribute mit den Personen-IDs
    const newPersonAttributes = new Map();
    const fuzzyMatches = new Map();
    const unmatchedEntries = new Map();
    let matchedCount = 0;
    
    // Verarbeite alle Attribute ohne Fuzzy-Suche (nur exakte Matches)
    for (const [identifier, attrs] of attributes.entries()) {
      const personIds = findPersonIdsByIdentifier(identifier);
      if (personIds.length > 0) {
        for (const id of personIds) {
          if (!newPersonAttributes.has(id)) {
            newPersonAttributes.set(id, new Map());
          }
          for (const [attrName, attrValue] of attrs.entries()) {
            const composite = `${category}::${attrName}`;
            newPersonAttributes.get(id).set(composite, attrValue);
          }
        }
        matchedCount++;
      } else {
        unmatchedEntries.set(identifier, attrs);
      }
    }
    
    // Setze/Merge die Attribute und Typen
    if (personAttributes.size === 0) {
      personAttributes = newPersonAttributes;
    } else {
      for (const [pid, attrsMap] of newPersonAttributes.entries()) {
        if (!personAttributes.has(pid)) {
          personAttributes.set(pid, new Map(attrsMap));
        } else {
          const target = personAttributes.get(pid);
          for (const [k, v] of attrsMap.entries()) {
            target.set(k, v);
          }
        }
      }
    }
    // 'types' ist ein Array von Attributnamen -> als category::name registrieren
    let existingInCategory = 0;
    for (const k of attributeTypes.keys()) if (String(k).startsWith(category + '::')) existingInCategory++;
    let i = 0;
    for (const type of types) {
      const composite = `${category}::${type}`;
      if (!attributeTypes.has(composite)) {
        const color = colorForCategoryAttribute(category, type, existingInCategory + i);
        attributeTypes.set(composite, color);
        // Neue Attribute standardmäßig aktivieren
        activeAttributes.add(composite);
      }
      i++;
    }
    
    // Beim ersten Laden: alle Attribute aktivieren
    if (activeAttributes.size === 0 && attributeTypes.size > 0) {
      activeAttributes = new Set(attributeTypes.keys());
    }
    
    // Speichere Quell-Informationen für späteres Speichern
    const filename = url.split('/').pop().split('?')[0];
    categorySourceFiles.set(category, {
      filename: filename || `${category}.txt`,
      url: url,
      originalText: text,
      format: text.includes('\t') ? 'tab' : 'comma'
    });
    
    // Update UI
    buildAttributeLegend();
    updateAttributeStats();
    // Falls bereits ein Graph gerendert ist, Attribute sofort sichtbar machen
    updateAttributeCircles();
    
    return {
      loaded: true,
      matchedCount,
      unmatchedCount: unmatchedEntries.size,
      totalAttributes: count
    };
  } catch (error) {
    console.error('Fehler beim Laden der Attribute:', error);
    showTemporaryNotification(`Fehler beim Laden der Attribute: ${error.message}`, 5000);
    return { loaded: false, error: error.message };
  }
}

async function loadData() {
  setStatus("Lade Daten...");
  let data = null;
  let sourceName = '(keine Daten)';

  const dataUrl = envConfig?.DATA_URL || null;

  // Wenn keine Datenquelle über ENV konfiguriert ist, kein Autoload durchführen [SF][REH]
  if (!dataUrl) {
    setStatus('Keine automatische Datenquelle konfiguriert – manuelles Laden über den Status möglich.');
    return false;
  }

  try {
    const res = await fetch(dataUrl, { cache: "no-store" });
    if (res.ok) {
      data = await res.json();
      sourceName = dataUrl;
    } else {
      console.warn('Automatisches Laden der Daten fehlgeschlagen:', res.status, res.statusText);
    }
  } catch (e) {
    console.error('Fehler beim automatischen Laden der Daten:', e);
  }

  if (!data) {
    setStatus('Automatisches Laden der Daten fehlgeschlagen – bitte Daten manuell laden.');
    return false;
  }

  try {
    applyLoadedDataObject(data, sourceName);
  } catch (e) {
    console.error('Fehler beim Anwenden der geladenen Daten:', e);
    setStatus('Fehler beim Verarbeiten der geladenen Daten – bitte Daten manuell laden.');
    return false;
  }

  // Lade Attribute automatisch, falls in ENV konfiguriert (string oder string[])
  const attrCfg = envConfig?.ATTRIBUTES_URL;
  if (attrCfg) {
    const urls = Array.isArray(attrCfg) ? attrCfg : [attrCfg];
    collapsedCategories = new Set(urls.map(u => categoryFromUrl(u)));
    for (const u of urls) {
      try {
        const result = await loadAttributesFromUrl(u);
        if (result.loaded) {
          const catName = categoryFromUrl(u);
          if (result.isEmpty) {
            showTemporaryNotification(`Kategorie "${catName}" geladen (leer - nur Platzhalter)`, 2500);
          } else {
            showTemporaryNotification(`Attribute geladen (${catName}): ${result.matchedCount} zugeordnet, ${result.unmatchedCount} nicht gefunden`, 2500);
          }
        }
      } catch (error) {
        console.error('Automatisches Laden der Attribute fehlgeschlagen:', error);
      }
    }
  }

  return true;
}

function populateCombo(filterText) {
  const input = document.querySelector(INPUT_COMBO_ID);
  const list = document.querySelector(LIST_COMBO_ID);
  if (!input || !list) return;
  const term = (filterText || "").toLowerCase().trim();
  
  // Bei leerem Suchbegriff keine Vorschlagsliste anzeigen
  if (!term) {
    list.innerHTML = "";
    list.hidden = true;
    filteredItems = [];
    activeIndex = -1;
    return;
  }

  // Require minimum search length for large datasets
  if (term.length > 0 && term.length < MIN_SEARCH_LENGTH) {
    list.innerHTML = '<li style="padding: 8px; color: #666; font-style: italic;">Mindestens ' + MIN_SEARCH_LENGTH + ' Zeichen eingeben...</li>';
    list.hidden = false;
    filteredItems = [];
    activeIndex = -1;
    return;
  }
  
  // Fast filtering with early termination
  filteredItems = [];
  let count = 0;
  for (const n of allNodesUnique) {
    if (count >= MAX_DROPDOWN_ITEMS) break;
    
    if (!term) {
      filteredItems.push(n);
      count++;
      continue;
    }
    
    const label = (n.label || "").toLowerCase();
    const idStr = String(n.id).toLowerCase();
    if (label.includes(term) || idStr.includes(term)) {
      filteredItems.push(n);
      count++;
    }
  }
  
  filteredItems.sort((a, b) => (a.label || String(a.id)).localeCompare(b.label || String(b.id)));

  list.innerHTML = '';
  activeIndex = -1;
  const frag = document.createDocumentFragment();
  
  filteredItems.forEach((n, idx) => {
    const li = document.createElement('li');
    const lbl = n.label || String(n.id);
    li.textContent = `${lbl} — ${n.id}`;
    li.setAttribute('data-id', String(n.id));
    li.tabIndex = -1;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      // Shift-Klick fügt als weiteren Root hinzu, sonst ersetzt
      const addMode = !!(e.shiftKey);
      chooseItem(idx, addMode);
    });
    frag.appendChild(li);
  });
  
  // Show "more results" hint if truncated
  if (count >= MAX_DROPDOWN_ITEMS) {
    const hint = document.createElement('li');
    hint.style.padding = '8px';
    hint.style.color = '#666';
    hint.style.fontStyle = 'italic';
    hint.style.borderTop = '1px solid #e5e7eb';
    hint.textContent = `Nur erste ${MAX_DROPDOWN_ITEMS} Ergebnisse angezeigt. Suchbegriff verfeinern...`;
    frag.appendChild(hint);
  }
  
  list.appendChild(frag);
  list.hidden = filteredItems.length === 0;
}

function setActive(idx) {
  const list = document.querySelector(LIST_COMBO_ID);
  if (!list) return;
  const items = Array.from(list.children);
  items.forEach((el, i) => {
    if (i === idx) el.classList.add('is-active'); else el.classList.remove('is-active');
  });
  activeIndex = idx;
  if (idx >= 0 && items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
}

function chooseItem(idx, addMode) {
  const input = document.querySelector(INPUT_COMBO_ID);
  const list = document.querySelector(LIST_COMBO_ID);
  if (!input || !list) return;
  if (idx < 0 || idx >= filteredItems.length) return;
  const n = filteredItems[idx];
  const nid = String(n.id);
  if (addMode) {
    try { if (debugMode) console.log('[ui] chooseItem addMode', { idx, nid }); } catch {}
    // Wenn dies der erste Shift-Add ist, initialisiere die Multi-Root-Liste
    if (selectedRootIds.length === 0) {
      let seed = currentSelectedId || lastSingleRootId;
      if (!seed) {
        // Versuche aus dem aktuellen Eingabetext einen Start zu erraten
        const inputVal = (input && input.value) ? input.value : '';
        const guessed = guessIdFromInput(inputVal);
        if (guessed && guessed !== nid) seed = guessed;
      }
      if (seed && String(seed) !== nid) {
        selectedRootIds = [String(seed)];
        try { if (debugMode) console.log('[roots] initial seed in chooseItem', { seed: String(seed) }); } catch {}
      }
    }
    if (addRoot(nid)) {
      currentSelectedId = nid;
    }
  } else {
    try { if (debugMode) console.log('[ui] chooseItem replaceMode', { idx, nid }); } catch {}
    setSingleRoot(nid);
    currentSelectedId = nid;
  }
  input.value = n.label || nid;
  list.hidden = true;
  // Auto-apply and re-center when selecting from dropdown
  applyFromUI();
}

/**
 * Findet Knoten-ID aus Benutzereingabe
 */
function guessIdFromInput(val) {
  if (!val) return null;
  
  // Priorität 1: Exakte Übereinstimmung mit Label
  const exactByLabel = raw.nodes.find(n => (n.label || "") === val);
  if (exactByLabel) return String(exactByLabel.id);
  
  // Priorität 2: Exakte Übereinstimmung mit ID
  const exactById = raw.nodes.find(n => String(n.id) === val);
  if (exactById) return String(exactById.id);
  
  // Priorität 3: Teilweise Übereinstimmung mit Label (case-insensitive)
  const part = raw.nodes.find(n => (n.label || "").toLowerCase().includes(val.toLowerCase()));
  return part ? String(part.id) : null;
}

/**
 * Erstellt Adjazenzliste des Graphen
 */
function buildAdjacency(links) {
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

function computeSubgraph(startId, depth, mode) {
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
  
  // Zähle ausgeblendete Knoten in der aktuellen Ansicht
  if (hiddenNodes && hiddenNodes.size > 0) {
    const beforeCount = nodes.length;
    nodes = nodes.filter(n => !hiddenNodes.has(String(n.id)));
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
        if (hiddenNodes && hiddenNodes.has(String(s))) continue;
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

function recomputeHiddenNodes() {
  const agg = new Set();
  for (const s of hiddenByRoot.values()) {
    for (const id of s) agg.add(String(id));
  }
  hiddenNodes = agg;
}

function collectReportSubtree(rootId) {
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

function hideSubtreeFromRoot(rootId) {
  const rid = String(rootId);
  const n = byId.get(rid);
  if (!n || n.type !== 'person') { setStatus('Bitte eine Management-Person wählen'); return; }
  const sub = collectReportSubtree(rid);
  hiddenByRoot.set(rid, sub);
  recomputeHiddenNodes();
  buildHiddenLegend();
  applyFromUI();
}

function unhideSubtree(rootId) {
  const rid = String(rootId);
  if (hiddenByRoot.has(rid)) {
    hiddenByRoot.delete(rid);
    recomputeHiddenNodes();
  }
  buildHiddenLegend();
  applyFromUI();
}

// Aktualisiert den Titel der Hidden-Legende mit den aktuellen Zahlen
function updateHiddenLegendTitle() {
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

function buildHiddenLegend() {
  const legend = document.getElementById('hiddenLegend');
  if (!legend) return;
  
  // Titel wird separat aktualisiert nach Graph-Berechnung
  updateHiddenLegendTitle();
  
  legend.innerHTML = '';
  if (hiddenByRoot.size === 0) {
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'legend-list';
  for (const [root, setIds] of hiddenByRoot.entries()) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'legend-row'; // Kein .active State für ausgeblendete Items
    
    // Linker Bereich: Spacer + Label
    const leftArea = document.createElement('div');
    leftArea.className = 'legend-row-left';
    
    // Rechter Bereich: X-Button
    const rightArea = document.createElement('div');
    rightArea.className = 'legend-row-right';
    
    // Spacer statt Chevron
    const spacer = document.createElement('div');
    spacer.className = 'legend-tree-spacer';
    leftArea.appendChild(spacer);
    
    // Label
    const name = byId.get(root)?.label || root;
    const chip = document.createElement('span');
    chip.className = 'legend-label-chip';
    chip.textContent = `${name} (${setIds.size})`;
    chip.title = name;
    leftArea.appendChild(chip);
    
    // X-Button zum Entfernen (unhide)
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'legend-icon-btn';
    removeBtn.title = 'Wieder einblenden';
    removeBtn.innerHTML = '<i class="codicon codicon-close" aria-hidden="true"></i>';
    removeBtn.setAttribute('data-ignore-header-click', 'true');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      unhideSubtree(root);
    });
    
    rightArea.appendChild(removeBtn);
    
    row.appendChild(leftArea);
    row.appendChild(rightArea);
    li.appendChild(row);
    ul.appendChild(li);
  }
  legend.appendChild(ul);
}

let legendCollapsedItems = new Set();

// Gemeinsamer Renderer für OE-Legendeneinträge (voller Baum und Scoped-Baum) [DRY][CA]
function renderOrgLegendNode(oid, depth, options) {
  const { childrenProvider, scopeSet, registerNode } = options || {};
  const id = String(oid);

  if (scopeSet && !scopeSet.has(id)) return null;

  const li = document.createElement('li');
  li.dataset.oid = id;
  const lbl = byId.get(id)?.label || id;
  const idAttr = `org_${id}`;

  const row = document.createElement('div');
  row.className = 'legend-row';

  const leftArea = document.createElement('div');
  leftArea.className = 'legend-row-left';

  const rightArea = document.createElement('div');
  rightArea.className = 'legend-row-right';

  const depthSpacer = document.createElement('div');
  depthSpacer.className = 'legend-depth-spacer';
  depthSpacer.style.width = `${Math.max(0, Number(depth) || 0) * 16}px`;
  leftArea.appendChild(depthSpacer);

  const rawChildren = Array.from((childrenProvider && childrenProvider(id)) || []);
  const kids = scopeSet
    ? rawChildren.filter(k => scopeSet.has(String(k)))
    : rawChildren;

  if (kids.length) {
    const chevron = document.createElement('button');
    chevron.type = 'button';
    const isCollapsed = legendCollapsedItems.has(id);
    chevron.className = isCollapsed ? 'legend-tree-chevron collapsed' : 'legend-tree-chevron expanded';
    chevron.title = 'Ein-/Ausklappen';
    chevron.innerHTML = getChevronSVG();

    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      const sub = li.querySelector('ul');
      const currentlyCollapsed = sub && sub.style.display === 'none';
      if (sub) {
        sub.style.display = currentlyCollapsed ? '' : 'none';
        chevron.className = currentlyCollapsed ? 'legend-tree-chevron expanded' : 'legend-tree-chevron collapsed';
        if (currentlyCollapsed) {
          legendCollapsedItems.delete(id);
        } else {
          legendCollapsedItems.add(id);
        }
      }
    });

    leftArea.appendChild(chevron);
  } else {
    const spacer = document.createElement('div');
    spacer.className = 'legend-tree-spacer';
    leftArea.appendChild(spacer);
  }

  const chip = document.createElement('span');
  chip.className = 'legend-label-chip';
  chip.textContent = lbl;
  chip.title = lbl;
  leftArea.appendChild(chip);

  row.appendChild(leftArea);
  row.appendChild(rightArea);

  const updateRowState = () => {
    const isActive = allowedOrgs.has(id);
    row.title = isActive ? `${lbl} - Klicken zum Ausblenden` : `${lbl} - Klicken zum Anzeigen`;
  };

  updateRowState();

  row.addEventListener('click', (e) => {
    if (e.target.closest('.legend-tree-chevron')) return;
    const isActive = allowedOrgs.has(id);
    if (isActive) {
      allowedOrgs.delete(id);
    } else {
      allowedOrgs.add(id);
    }
    updateRowState();
    syncGraphAndLegendColors();
  });

  row.style.cursor = 'pointer';

  const hiddenInput = document.createElement('input');
  hiddenInput.type = 'checkbox';
  hiddenInput.id = idAttr;
  hiddenInput.style.display = 'none';
  hiddenInput.checked = allowedOrgs.has(id);
  row.appendChild(hiddenInput);

  li.appendChild(row);

  if (kids.length) {
    const sub = document.createElement('ul');
    if (legendCollapsedItems.has(id)) {
      sub.style.display = 'none';
    }
    for (const k of kids) {
      const childLi = renderOrgLegendNode(k, (depth || 0) + 1, options);
      if (childLi) sub.appendChild(childLi);
    }
    li.appendChild(sub);
  }

  const onCtx = (e) => {
    e.preventDefault();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    e.stopPropagation();
    
    let subRoot = null;
    try {
      subRoot = li.querySelector(':scope > ul');
    } catch(_) {
      subRoot = Array.from(li.children).find(ch => ch.tagName === 'UL');
    }
    
    const directChildrenIds = new Set();
    const allDescendantIds = new Set();
    
    if (subRoot) {
      Array.from(subRoot.children).forEach(childLi => {
        const childCb = childLi.querySelector('input[id^="org_"]');
        if (childCb) {
          const childId = childCb.id.replace('org_', '');
          directChildrenIds.add(childId);
        }
        const allCbs = childLi.querySelectorAll('input[id^="org_"]');
        allCbs.forEach(cb => allDescendantIds.add(cb.id.replace('org_', '')));
      });
    }
    
    showLegendMenu(e.clientX, e.clientY, {
      onShowAll: () => {
        allowedOrgs.add(id);
        allDescendantIds.forEach(cid => allowedOrgs.add(cid));
        syncGraphAndLegendColors();
      },
      onHideAll: () => {
        allowedOrgs.delete(id);
        allDescendantIds.forEach(cid => allowedOrgs.delete(cid));
        syncGraphAndLegendColors();
      },
      onShowDirectChildrenOnly: () => {
        allDescendantIds.forEach(cid => {
          allowedOrgs.delete(cid);
          if (subRoot) {
            const cb = subRoot.querySelector(`#org_${cid}`);
            if (cb) cb.checked = false;
          }
        });
        
        allowedOrgs.add(id);
        directChildrenIds.forEach(cid => allowedOrgs.add(cid));
        
        if (subRoot) {
          Array.from(subRoot.children).forEach(childLi => {
            const childUl = childLi.querySelector('ul');
            if (childUl) {
              childUl.style.display = 'none';
              const chevron = childLi.querySelector('.legend-tree-chevron');
              if (chevron) {
                chevron.className = 'legend-tree-chevron collapsed';
              }
            }
          });
        }
        
        syncGraphAndLegendColors();
      }
    });
  };
  
  li.addEventListener('contextmenu', onCtx);
  row.addEventListener('contextmenu', onCtx);

  if (typeof registerNode === 'function') {
    registerNode(id, li);
  }

  return li;
}

function buildOrgLegend() {
  const legend = document.querySelector('#legend');
  if (!legend) return;
  legend.innerHTML = '';

  let children = orgChildren;
  let roots = Array.isArray(orgRoots) && orgRoots.length > 0 ? orgRoots.slice() : [];
  if (!children || children.size === 0 || roots.length === 0) {
    const localChildren = new Map();
    const hasParent = new Set();
    for (const l of raw.links || []) {
      const s = idOf(l.source), t = idOf(l.target);
      if (byId.get(s)?.type !== 'org' || byId.get(t)?.type !== 'org') continue;
      const sid = String(s);
      const tid = String(t);
      if (!localChildren.has(sid)) localChildren.set(sid, new Set());
      localChildren.get(sid).add(tid);
      hasParent.add(tid);
    }
    const allOrgs = raw && Array.isArray(raw.orgs) ? raw.orgs.map(o => String(o.id)) : [];
    roots = allOrgs.filter(id => !hasParent.has(id));
    children = localChildren;
  }

  orgLegendNodes = new Map();

  const ul = document.createElement('ul');
  ul.className = 'legend-list';

  const options = {
    childrenProvider: (id) => (children.get(String(id)) || []),
    scopeSet: null,
    registerNode: (id, li) => { orgLegendNodes.set(id, li); }
  };

  for (const r of roots) {
    const li = renderOrgLegendNode(r, 0, options);
    if (li) ul.appendChild(li);
  }

  legend.appendChild(ul);
  syncGraphAndLegendColors();
}

// Baut eine OE-Legende nur fuer die angegebenen sichtbaren OEs (visibleSet)
// unter Verwendung der globalen OE-Hierarchie orgParent/orgChildren. [CA][SF]
function buildScopedOrgLegend(visibleSet) {
  const legend = document.querySelector('#legend');
  if (!legend) return;

  const scopeSet = new Set(Array.from(visibleSet || []).map(String));
  legend.innerHTML = '';
  orgLegendNodes = new Map();

  if (!raw || !Array.isArray(raw.orgs) || scopeSet.size === 0) {
    return;
  }

  const roots = [];
  for (const oid of scopeSet) {
    const p = orgParent.get(oid);
    if (!p || !scopeSet.has(String(p))) {
      roots.push(String(oid));
    }
  }

  const ul = document.createElement('ul');
  ul.className = 'legend-list';

  const options = {
    childrenProvider: (id) => (orgChildren.get(String(id)) || []),
    scopeSet,
    registerNode: (id, li) => { orgLegendNodes.set(id, li); }
  };

  for (const r of roots) {
    const li = renderOrgLegendNode(r, 0, options);
    if (li) ul.appendChild(li);
  }

  legend.appendChild(ul);
  syncGraphAndLegendColors();
}

let currentLegendScope = new Set();

function applyLegendScope(scope) {
  const scopeSet = new Set(Array.from(scope || []).map(String));
  currentLegendScope = scopeSet;

  const visible = new Set();
  if (scopeSet.size > 0) {
    for (const oid of scopeSet) {
      let cur = String(oid);
      const seen = new Set();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        visible.add(cur);
        cur = orgParent.get(cur);
      }
    }
  }

  buildScopedOrgLegend(visible);
}

function updateLegendChips(rootEl) {
  const root = rootEl || document;
  
  // Mit Checkboxen synchronisieren, außer wenn OEs absichtlich ausgeblendet wurden
  if (oesVisible) {
    // OEs sind sichtbar, normale Synchronisierung
    const newAllowed = new Set();
    root.querySelectorAll('.legend-list input[id^="org_"]').forEach(cb => { 
      if (cb.checked) newAllowed.add(cb.id.replace('org_','')); 
    });
    allowedOrgs = newAllowed;
  }
  // Wenn OEs ausgeblendet sind (oesVisible=false), dann bleibt allowedOrgs leer
  // For each legend entry (li), ensure chips have transparent background
  root.querySelectorAll('.legend-list > li, .legend-list li').forEach(li => {
    const chip = li.querySelector(':scope > .legend-row .legend-label-chip');
    if (!chip) return;
    // Immer transparent, damit CSS-Hover funktioniert
    chip.style.background = 'transparent';
  });
} 

function updateLegendRowColors(rootEl) {
  const root = rootEl || document;
  root.querySelectorAll('.legend-list > li, .legend-list li').forEach(li => {
    const row = li.querySelector(':scope > .legend-row');
    const cb = li.querySelector(':scope > .legend-row input[id^="org_"]');
    if (!row || !cb) return;
    const oid = cb.id.replace('org_','');
    const { stroke, fill } = colorForOrg(oid);
    
    // Synchronisiere Hidden Input mit allowedOrgs
    cb.checked = allowedOrgs.has(oid);
    
    // Setze Farben immer als CSS-Custom-Properties (für Hover-Effekt bei inaktiven Rows)
    row.style.setProperty('--org-fill', fill);
    row.style.setProperty('--org-stroke', stroke);
    
    if (cb.checked && allowedOrgs.has(oid)) {
      // Active state
      row.classList.add('active');
    } else {
      // Inactive state
      row.classList.remove('active');
    }
  });
}

/**
 * Sammelt alle Knoten im Unterbaum
 */
function collectSubtree(rootId, children, scopeSet) {
  const out = new Set([rootId]);
  const q = [rootId];
  
  for (let i = 0; i < q.length; i++) {
    const cur = q[i];
    // Iteriere über alle Kinder des aktuellen Knotens
    for (const ch of (children.get(cur) || [])) {
      // Überspringe Knoten, die nicht im Scope sind, falls ein Scope definiert ist
      if (scopeSet && !scopeSet.has(ch)) continue;
      // Füge neue Knoten zum Ergebnis und zur Warteschlange hinzu
      if (!out.has(ch)) { 
        out.add(ch); 
        q.push(ch); 
      }
    }
  }
  
  return out;
}

function ensureLegendMenu() {
  if (legendMenuEl) return legendMenuEl;
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.background = '#111';
  el.style.color = '#fff';
  el.style.fontSize = '12px';
  el.style.padding = '6px 0';
  el.style.borderRadius = '6px';
  el.style.minWidth = '160px';
  el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
  el.style.zIndex = 2000;
  el.style.display = 'none';
  const mkItem = (label, handler) => {
    const it = document.createElement('div');
    it.textContent = label;
    it.style.padding = '6px 12px';
    it.style.cursor = 'pointer';
    it.addEventListener('click', () => { hideLegendMenu(); handler(); });
    it.addEventListener('mouseenter', () => it.style.background = '#1f2937');
    it.addEventListener('mouseleave', () => it.style.background = 'transparent');
    return it;
  };
  
  // Erweiterte Menü-Optionen
  el.appendChild(mkItem('Alle einblenden', () => {}));
  el.appendChild(mkItem('Alle ausblenden', () => {}));
  
  // Trennlinie
  const divider = document.createElement('div');
  divider.style.borderTop = '1px solid rgba(255,255,255,0.2)';
  divider.style.margin = '4px 0';
  el.appendChild(divider);
  
  // Neue Option: Nur direkte Kinder anzeigen
  el.appendChild(mkItem('Nur direkte Kinder anzeigen', () => {}));
  
  document.body.appendChild(el);
  legendMenuEl = el;
  // Dismiss on click elsewhere
  document.addEventListener('click', (e) => { if (legendMenuEl && legendMenuEl.style.display === 'block') hideLegendMenu(); });
  return el;
}
function showLegendMenu(x, y, actions) {
  const el = ensureLegendMenu();
  // Wire actions
  const items = el.querySelectorAll('div:not([style*="border-top"])');
  items[0].onclick = () => { hideLegendMenu(); actions.onShowAll(); };
  items[1].onclick = () => { hideLegendMenu(); actions.onHideAll(); };
  items[2].onclick = () => { hideLegendMenu(); actions.onShowDirectChildrenOnly(); };
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.display = 'block';
}
function hideLegendMenu() { if (legendMenuEl) legendMenuEl.style.display = 'none'; }

/**
 * Fügt einen Knoten zu einem Attribut hinzu
 */
function addNodeToAttribute(nodeId, categoryKey, attributeName, attributeValue = '1') {
  const personId = String(nodeId);
  
  // Erstelle Attribut-Key im Format "Kategorie::Attribut"
  const attrKey = `${categoryKey}::${attributeName}`;
  
  // Füge Attribut zur Person hinzu
  if (!personAttributes.has(personId)) {
    personAttributes.set(personId, new Map());
  }
  personAttributes.get(personId).set(attrKey, attributeValue);
  
  // Füge Attributtyp hinzu, falls noch nicht vorhanden
  if (!attributeTypes.has(attrKey)) {
    const existingInCategory = Array.from(attributeTypes.keys())
      .filter(k => String(k).startsWith(categoryKey + '::')).length;
    const color = colorForCategoryAttribute(categoryKey, attributeName, existingInCategory);
    attributeTypes.set(attrKey, color);
    
    // Falls dies das erste Attribut in einer leeren Kategorie ist, entferne sie aus emptyCategories
    if (emptyCategories.has(categoryKey)) {
      emptyCategories.delete(categoryKey);
    }
  }
  
  // Aktiviere das Attribut automatisch
  activeAttributes.add(attrKey);
  
  // Markiere Kategorie als geändert
  modifiedCategories.add(categoryKey);
  if (debugMode) {
    console.log(`Kategorie "${categoryKey}" als geändert markiert. Hat Quelle:`, categorySourceFiles.has(categoryKey));
  }
  
  // UI aktualisieren
  buildAttributeLegend();
  updateAttributeStats();
  updateAttributeCircles();
  
  const nodeName = byId.get(personId)?.label || personId;
  showTemporaryNotification(`"${attributeName}" zu ${nodeName} hinzugefügt`);
}

/**
 * Erstellt ein hierarchisches Attribut-Menü als Submenu
 */
function addAttributeSubmenu(parentItem, mainMenu, nodeId) {
  let submenu = null;
  let submenuVisible = false;
  
  const showSubmenu = () => {
    if (submenuVisible) return;
    
    // Erstelle Submenu
    submenu = document.createElement('div');
    submenu.className = 'node-context-menu';
    submenu.setAttribute('data-level', '2');
    submenu.style.display = 'block';
    
    // Position rechts neben dem Parent-Item
    const rect = parentItem.getBoundingClientRect();
    submenu.style.left = `${rect.right}px`;
    submenu.style.top = `${rect.top}px`;
    
    // Kategorien sammeln
    const categories = new Map();
    for (const key of attributeTypes.keys()) {
      const [cat, name] = String(key).includes('::') ? String(key).split('::') : ['Attribute', String(key)];
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat).push({ key, name });
    }
    
    // Leere Kategorien hinzufügen
    for (const cat of emptyCategories) {
      if (!categories.has(cat)) {
        categories.set(cat, []);
      }
    }
    
    // Falls keine Attribute und keine leeren Kategorien vorhanden, nur "neue Kategorie" anzeigen
    if (categories.size === 0) {
      const item = createSubmenuItem('+ neue Kategorie ...', () => {
        hideAllMenus();
        promptNewCategory(nodeId);
      });
      submenu.appendChild(item);
    } else {
      // Kategorien sortieren und rendern - HIERARCHISCH
      const sortedCats = Array.from(categories.keys()).sort();
      
      for (const cat of sortedCats) {
        const attrs = categories.get(cat).sort((a, b) => a.name.localeCompare(b.name));
        
        // Kategorie als klickbares Item mit Pfeil (öffnet Sub-Submenu)
        const catItem = createCategorySubmenuItem(cat, attrs, nodeId, hideAllMenus);
        submenu.appendChild(catItem);
      }
      
      // Trennlinie vor "neue Kategorie"
      const divider = document.createElement('div');
      divider.className = 'menu-divider';
      submenu.appendChild(divider);
      
      // "neue Kategorie..." am Ende
      const newCatItem = createSubmenuItem('+ neue Kategorie ...', () => {
        hideAllMenus();
        promptNewCategory(nodeId);
      });
      submenu.appendChild(newCatItem);
    }
    
    document.body.appendChild(submenu);
    submenuVisible = true;
  };
  
  const hideSubmenu = () => {
    if (submenu && submenu.parentNode) {
      submenu.parentNode.removeChild(submenu);
    }
    submenu = null;
    submenuVisible = false;
  };
  
  const hideAllMenus = () => {
    // Verstecke alle Kategorie-Submenus
    document.querySelectorAll('.node-context-menu[data-level="3"]').forEach(sub => {
      if (sub !== submenu) {
        sub.remove();
      }
    });
    hideSubmenu();
    mainMenu.style.display = 'none';
  };
  
  // Event-Handler für Parent-Item
  parentItem.addEventListener('mouseenter', showSubmenu);
  parentItem.addEventListener('mouseleave', (e) => {
    // Prüfe, ob Maus zum Submenu gewechselt hat
    setTimeout(() => {
      const hasActiveCategoryMenu = document.querySelector('.node-context-menu[data-level="3"]');
      const isCategoryMenuHovered = hasActiveCategoryMenu && hasActiveCategoryMenu.matches(':hover');
      
      if (submenu && !submenu.matches(':hover') && !parentItem.matches(':hover') && !isCategoryMenuHovered) {
        hideSubmenu();
      }
    }, 100);
  });
  
  // Klick auf Parent öffnet/schließt Submenu
  parentItem.addEventListener('click', (e) => {
    e.stopPropagation();
    if (submenuVisible) {
      hideSubmenu();
    } else {
      showSubmenu();
    }
  });
  
  // Event-Handler für Submenu (falls erstellt)
  const setupSubmenuHandlers = () => {
    if (!submenu) return;
    
    submenu.addEventListener('mouseleave', (e) => {
      setTimeout(() => {
        // Prüfe ob ein Kategorie-Submenu (Ebene 3) aktiv ist
        const hasActiveCategoryMenu = document.querySelector('.node-context-menu[data-level="3"]');
        const isCategoryMenuHovered = hasActiveCategoryMenu && hasActiveCategoryMenu.matches(':hover');
        
        if (!submenu.matches(':hover') && !parentItem.matches(':hover') && !isCategoryMenuHovered) {
          hideSubmenu();
        }
      }, 100);
    });
  };
  
  // Setup-Handler nach Delay, damit Submenu erstellt wurde
  parentItem.addEventListener('mouseenter', () => {
    setTimeout(setupSubmenuHandlers, 10);
  });
}

/**
 * Erstellt ein Submenu-Item mit Hover-Effekt
 */
function createSubmenuItem(label, handler) {
  const item = document.createElement('div');
  item.className = 'menu-item';
  const labelSpan = document.createElement('span');
  labelSpan.className = 'menu-item-label';
  labelSpan.textContent = label;
  item.appendChild(labelSpan);
  item.onclick = handler;
  return item;
}

/**
 * Erstellt ein hierarchisches Kategorie-Item mit eigenem Submenu
 */
function createCategorySubmenuItem(categoryName, attributes, nodeId, hideAllMenus) {
  const item = document.createElement('div');
  item.className = 'menu-item';
  
  const labelSpan = document.createElement('span');
  labelSpan.className = 'menu-item-label';
  labelSpan.textContent = categoryName;
  item.appendChild(labelSpan);
  
  const arrow = document.createElement('span');
  arrow.className = 'menu-item-arrow';
  arrow.textContent = '▶';
  item.appendChild(arrow);
  
  let categorySubmenu = null;
  let categorySubmenuVisible = false;
  
  const showCategorySubmenu = () => {
    if (categorySubmenuVisible) return;
    
    // Verstecke alle anderen Kategorie-Submenus
    document.querySelectorAll('.node-context-menu[data-level="3"]').forEach(sub => {
      if (sub !== categorySubmenu) {
        sub.remove();
      }
    });
    
    // Erstelle Kategorie-Submenu
    categorySubmenu = document.createElement('div');
    categorySubmenu.className = 'node-context-menu';
    categorySubmenu.setAttribute('data-level', '3');
    categorySubmenu.style.display = 'block';
    
    // Position rechts neben dem Kategorie-Item
    const rect = item.getBoundingClientRect();
    categorySubmenu.style.left = `${rect.right}px`;
    categorySubmenu.style.top = `${rect.top}px`;
    
    // Attribute der Kategorie hinzufügen
    if (attributes.length > 0) {
      for (const attr of attributes) {
        const attrItem = createSubmenuItem(attr.name, () => {
          hideAllMenus();
          addNodeToAttribute(nodeId, categoryName, attr.name);
        });
        categorySubmenu.appendChild(attrItem);
      }
      
      // Trennlinie
      const divider = document.createElement('div');
      divider.className = 'menu-divider';
      categorySubmenu.appendChild(divider);
    }
    
    // "neues Attribut..." für diese Kategorie
    const newAttrItem = createSubmenuItem('+ neues Attribut ...', () => {
      hideAllMenus();
      promptNewAttribute(nodeId, categoryName);
    });
    categorySubmenu.appendChild(newAttrItem);
    
    document.body.appendChild(categorySubmenu);
    categorySubmenuVisible = true;
    
    // Event-Handler für Kategorie-Submenu
    categorySubmenu.addEventListener('mouseleave', (e) => {
      setTimeout(() => {
        // Schließe nur das Kategorie-Submenu, nicht das Parent-Submenu
        if (!categorySubmenu.matches(':hover') && !item.matches(':hover')) {
          hideCategorySubmenu();
        }
      }, 100);
    });
  };
  
  const hideCategorySubmenu = () => {
    if (categorySubmenu && categorySubmenu.parentNode) {
      categorySubmenu.parentNode.removeChild(categorySubmenu);
    }
    categorySubmenu = null;
    categorySubmenuVisible = false;
  };
  
  // Event-Handler für Kategorie-Item
  item.addEventListener('mouseenter', () => {
    showCategorySubmenu();
  });
  
  item.addEventListener('mouseleave', (e) => {
    setTimeout(() => {
      if (categorySubmenu && !categorySubmenu.matches(':hover') && !item.matches(':hover')) {
        hideCategorySubmenu();
      }
    }, 100);
  });
  
  return item;
}

/**
 * Exportiert die Attribute einer Kategorie als CSV/TSV Datei
 */
function exportCategoryAttributes(categoryName) {
  const sourceInfo = categorySourceFiles.get(categoryName);
  if (!sourceInfo) {
    showTemporaryNotification(`Keine Quell-Informationen für Kategorie "${categoryName}" gefunden`, 3000);
    return;
  }
  
  const separator = sourceInfo.format === 'tab' ? '\t' : ',';
  const lines = [];
  
  // Sammle alle Personen mit Attributen in dieser Kategorie
  for (const [personId, attrs] of personAttributes.entries()) {
    for (const [attrKey, attrValue] of attrs.entries()) {
      const [cat, attrName] = String(attrKey).includes('::') ? String(attrKey).split('::') : ['Attribute', String(attrKey)];
      
      if (cat === categoryName) {
        // Versuche E-Mail oder ID zu finden
        const person = byId.get(personId);
        const identifier = person?.email || personId;
        
        // Nur 2 Spalten: ID/Email und Attributname (ohne Wert)
        lines.push(`${identifier}${separator}${attrName}`);
      }
    }
  }
  
  // Sortiere alphabetisch
  lines.sort();
  
  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = sourceInfo.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  // Markiere Kategorie als nicht mehr geändert
  modifiedCategories.delete(categoryName);
  buildAttributeLegend();
  
  showTemporaryNotification(`"${sourceInfo.filename}" heruntergeladen`, 2000);
}

/**
 * Prompt für neues Attribut in bestehender Kategorie
 */
function promptNewAttribute(nodeId, category) {
  const name = prompt(`Neues Attribut für Kategorie "${category}":`, '');
  if (!name || !name.trim()) return;
  
  // Wert ist immer "1" - wird für Zählzwecke verwendet
  addNodeToAttribute(nodeId, category, name.trim(), '1');
}

/**
 * Prompt für neue Kategorie
 */
function promptNewCategory(nodeId) {
  const category = prompt('Name der neuen Kategorie:', '');
  if (!category || !category.trim()) return;
  
  const attrName = prompt(`Attributname für "${category.trim()}":`, '');
  if (!attrName || !attrName.trim()) return;
  
  // Wert ist immer "1" - wird für Zählzwecke verwendet
  addNodeToAttribute(nodeId, category.trim(), attrName.trim(), '1');
}

function ensureNodeMenu() {
  if (nodeMenuEl) return nodeMenuEl;
  const el = document.createElement('div');
  el.className = 'node-context-menu';
  const it = document.createElement('div');
  it.className = 'menu-item';
  it.textContent = 'Ausblenden';
  el.appendChild(it);
  document.body.appendChild(el);
  nodeMenuEl = el;
  document.addEventListener('click', () => { if (nodeMenuEl && nodeMenuEl.style.display === 'block') nodeMenuEl.style.display = 'none'; });
  return el;
}
function showNodeMenu(x, y, actionsOrOnHide) {
  const el = ensureNodeMenu();
  // Menü dynamisch aufbauen, aber Abwärtskompatibilität für alte Signatur behalten
  // Alte Signatur: actionsOrOnHide ist eine Funktion (Ausblenden)
  // Neue Signatur: Objekt { onHideSubtree, onRemoveRoot, isRoot, nodeId }
  while (el.firstChild) el.removeChild(el.firstChild);
  
  const addItem = (label, handler, hasSubmenu = false) => {
    const it = document.createElement('div');
    it.className = 'menu-item';
    
    const labelSpan = document.createElement('span');
    labelSpan.className = 'menu-item-label';
    labelSpan.textContent = label;
    it.appendChild(labelSpan);
    
    if (hasSubmenu) {
      const arrow = document.createElement('span');
      arrow.className = 'menu-item-arrow';
      arrow.textContent = '▶';
      it.appendChild(arrow);
    }
    
    if (!hasSubmenu) {
      it.onclick = () => { el.style.display = 'none'; handler && handler(); };
    }
    el.appendChild(it);
    return it;
  };
  
  if (typeof actionsOrOnHide === 'function') {
    addItem('Ausblenden', actionsOrOnHide);
  } else {
    const actions = actionsOrOnHide || {};
    if (actions.onHideSubtree) addItem('Ausblenden', actions.onHideSubtree);
    
    // Neuer Root-Eintrag [SF]
    if (actions.onSetAsRoot) addItem('Ins Zentrum stellen', actions.onSetAsRoot);
    
    if (actions.isRoot && actions.onRemoveRoot && Array.isArray(selectedRootIds) && selectedRootIds.length > 1) {
      addItem('Als Root entfernen', actions.onRemoveRoot);
    }
    
    // Attribute-Menü hinzufügen
    if (actions.nodeId) {
      const attrMenuItem = addItem('Attribute', null, true);
      addAttributeSubmenu(attrMenuItem, el, actions.nodeId);
    }
  }
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.display = 'block';
}


function refreshClusters() {
  if (!clusterLayer) return;
  
  const pad = cssNumber('--cluster-pad', 12);
  const membersByOrg = new Map();
  
  if (!raw || !Array.isArray(raw.orgs) || !Array.isArray(raw.links)) return;
  const orgIds = new Set(raw.orgs.map(o => String(o.id)));

  // Cache: für jedes OE alle Nachfahren inkl. sich selbst
  const descendantsCache = new Map();
  const getDescendants = (root) => {
    const key = String(root);
    if (descendantsCache.has(key)) return descendantsCache.get(key);
    const res = new Set([key]);
    const q = [key];
    while (q.length) {
      const cur = q.shift();
      const kids = orgChildren.get(cur);
      if (!kids) continue;
      for (const k of kids) {
        if (!res.has(k)) {
          res.add(k);
          q.push(k);
        }
      }
    }
    descendantsCache.set(key, res);
    return res;
  };

  // Mapping: jede OE -> Menge aktiver Wurzel-OEs, deren Unterbaum sie angehört
  const rootForOrg = new Map();
  for (const root of allowedOrgs) {
    const rootId = String(root);
    if (!orgIds.has(rootId)) continue;
    const desc = getDescendants(rootId);
    for (const oid of desc) {
      if (!rootForOrg.has(oid)) rootForOrg.set(oid, new Set());
      rootForOrg.get(oid).add(rootId);
    }
  }

  // Personen den Clustern der Wurzel-OEs ihrer Basis-OEs zuordnen
  for (const l of raw.links) {
    if (!l) continue;
    const s = idOf(l.source), t = idOf(l.target);
    if (!clusterPersonIds.has(s)) continue;
    if (!orgIds.has(t)) continue;
    const roots = rootForOrg.get(t);
    if (!roots || roots.size === 0) continue;
    const nd = clusterSimById.get(s);
    if (!nd || nd.x == null || nd.y == null) continue;
    for (const rid of roots) {
      if (!membersByOrg.has(rid)) membersByOrg.set(rid, []);
      membersByOrg.get(rid).push(nd);
    }
  }
  
  const clusterData = Array.from(membersByOrg.entries()).map(([oid, arr]) => ({ oid, nodes: arr }))
    .sort((a,b) => (orgDepth(a.oid) - orgDepth(b.oid)) || String(a.oid).localeCompare(String(b.oid)));
    
  const paths = clusterLayer.selectAll('path.cluster').data(clusterData, d => d.oid);
  paths.enter().append('path').attr('class','cluster').merge(paths)
    .each(function(d){
      const poly = computeClusterPolygon(d.nodes, pad);
      clusterPolygons.set(d.oid, poly);
      const { stroke, fill } = colorForOrg(d.oid);
      const line = d3.line().curve(d3.curveCardinalClosed.tension(0.75));
      d3.select(this)
        .attr('d', line(poly))
        .style('fill', fill)
        .style('stroke', stroke);
    })
    .order();
  paths.exit().remove();
}

/**
 * Berechnet den äußersten sichtbaren Radius eines Knotens
 * (Node-Radius + Stroke + Attributringe)
 */
function getNodeOuterRadius(node) {
  const nodeRadius = cssNumber('--node-radius', 8);
  const nodeStrokeWidth = cssNumber('--node-stroke-width', 3);
  
  // Basis: Node-Radius + halber Stroke
  let outerRadius = nodeRadius + (nodeStrokeWidth / 2);
  
  // Wenn Attribute sichtbar sind, addiere Attributringe
  if (attributesVisible) {
    const personId = String(node.id);
    const nodeAttrs = personAttributes.get(personId);
    const circleGap = cssNumber('--attribute-circle-gap', 4);
    const circleWidth = cssNumber('--attribute-circle-stroke-width', 2);
    
    let attrCount = 0;
    if (nodeAttrs && nodeAttrs.size > 0) {
      for (const attrName of nodeAttrs.keys()) {
        if (activeAttributes.has(attrName)) {
          attrCount++;
        }
      }
    }
    
    // Attributringe hinzufügen
    outerRadius += attrCount * (circleGap + circleWidth);
  }
  
  return outerRadius;
}

/**
 * Hilfsfunktion: Positioniere Knoten gleichmäßig im Kreis um Parent
 */
function positionNodesInCircle(nodes, centerX, centerY, radius, startAngle = 0) {
  if (nodes.length === 0) return;
  
  if (nodes.length === 1) {
    // Einzelner Knoten: direkt beim Winkel positionieren
    nodes[0].x = centerX + radius * Math.cos(startAngle);
    nodes[0].y = centerY + radius * Math.sin(startAngle);
  } else {
    // Mehrere Knoten: gleichmäßig verteilt
    const angleStep = (2 * Math.PI) / nodes.length;
    nodes.forEach((node, idx) => {
      const angle = startAngle + (idx * angleStep);
      node.x = centerX + radius * Math.cos(angle);
      node.y = centerY + radius * Math.sin(angle);
    });
  }
}

/**
 * Findet eine Position außerhalb der konvexen Hülle für einen sekundären Root
 */
function findPositionOutsideHull(existingNodes, margin = 200) {
  if (existingNodes.length === 0) {
    return { x: WIDTH / 2 + margin, y: HEIGHT / 2 };
  }
  
  // Sammle alle Positionen
  const points = existingNodes
    .filter(n => Number.isFinite(n.x) && Number.isFinite(n.y))
    .map(n => ({ x: n.x, y: n.y }));
  
  if (points.length === 0) {
    return { x: WIDTH / 2 + margin, y: HEIGHT / 2 };
  }
  
  // Berechne Bounding Box
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));
  
  const centerY = (minY + maxY) / 2;
  const width = maxX - minX;
  
  // Platziere neuen Root rechts außerhalb der Bounding Box
  return {
    x: maxX + margin + width * 0.2,
    y: centerY
  };
}

/**
 * Führt eine Breadth-First Expansion für das radiale Layout durch
 */
function radialLayoutExpansion(queue, childrenOf, parentsOf, personNodes, positionedSet, includeParents = false) {
  const childPadding = 4;
  
  while (queue.length > 0) {
    const current = queue.shift();
    
    // Children (Down-Links)
    const children = childrenOf.get(current.nodeId) || [];
    
    // Parents (Up-Links) only if level 0 and includeParents is true
    let parents = [];
    if (includeParents && current.level === 0) {
      parents = parentsOf.get(current.nodeId) || [];
    }
    
    const allDescendants = [...children, ...parents];
    
    if (allDescendants.length > 0) {
      const unpositionedIds = allDescendants.filter(id => !positionedSet.has(id));
      
      if (unpositionedIds.length > 0) {
        const descendantNodes = unpositionedIds
          .map(id => personNodes.find(n => String(n.id) === id))
          .filter(Boolean);
        
        const parentNode = personNodes.find(n => String(n.id) === current.nodeId);
        let parentRadius = 40; 
        if (parentNode) {
          parentRadius = getNodeOuterRadius(parentNode) + childPadding;
        }
        
        // Parents start at -90deg (North)
        const startAngle = (includeParents && current.level === 0 && parents.length > 0) ? -Math.PI / 2 : 0;
        
        positionNodesInCircle(descendantNodes, current.x, current.y, parentRadius, startAngle);
        
        descendantNodes.forEach(node => {
          positionedSet.add(String(node.id));
          queue.push({
            nodeId: String(node.id),
            x: node.x,
            y: node.y,
            level: current.level + 1
          });
        });
      }
    }
  }
}

/**
 * Erstellt und konfiguriert die D3-Simulation
 */
function createSimulation(nodes, links) {
  // Force-Simulation-Parameter
  const linkDistance = cssNumber('--link-distance', 60);
  const linkStrength = cssNumber('--link-strength', 0.4);
  const chargeStrength = cssNumber('--charge-strength', -200);
  const alphaDecay = cssNumber('--alpha-decay', 0.0228);
  const velocityDecay = cssNumber('--velocity-decay', 0.4);
  const nodeRadius = cssNumber('--node-radius', 8);
  const collidePadding = cssNumber('--collide-padding', 6);
  const nodeStrokeWidth = cssNumber('--node-stroke-width', 3);

  return d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => String(d.id)).distance(linkDistance).strength(linkStrength))
    .force("charge", d3.forceManyBody().strength(chargeStrength))
    // Schwächere Center-Force für mehr Stabilität mit radialem Layout
    .force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2).strength(0.05))
    .force("collide", d3.forceCollide().radius(d => {
      // Kollisionsradius basierend auf Attribut-Kreisen berechnen
      const personId = String(d.id);
      const nodeAttrs = personAttributes.get(personId);
      const circleGap = cssNumber('--attribute-circle-gap', 4);
      const circleWidth = cssNumber('--attribute-circle-stroke-width', 2);
      
      // Zähle aktive Attribute für diese Person
      let attrCount = 0;
      if (nodeAttrs && nodeAttrs.size > 0) {
        for (const attrName of nodeAttrs.keys()) {
          if (activeAttributes.has(attrName)) {
            attrCount++;
          }
        }
      }
      
      // Äußerer Radius der Attributringe relativ zum Knotenzentrum:
      // outer = nodeRadius + nodeStroke/2 + attrCount * (gap + width)
      const outerExtra = (attrCount > 0)
        ? (nodeStrokeWidth / 2) + (attrCount * (circleGap + circleWidth))
        : 0;
      return nodeRadius + collidePadding + outerExtra;
    }).strength(0.8)) // Stärkere Kollisionsvermeidung
    .alphaDecay(alphaDecay)
    .velocityDecay(velocityDecay);
}

/**
 * Rendert den Graphen basierend auf dem berechneten Subgraphen
 */
function renderGraph(sub) {
  // Aktuellen Zoom-Zustand speichern
  const savedZoomTransform = currentZoomTransform;

  // SVG-Element vorbereiten (ohne komplettes Leeren des DOM)
  const svg = d3.select(SVG_ID);
  svg.attr("viewBox", [0, 0, WIDTH, HEIGHT]);

  // Pfeilspitzen-Definitionen (einmalig anlegen/aktualisieren)
  let defs = svg.select("defs");
  if (defs.empty()) {
    defs = svg.append("defs");
  }
  const arrowLen = cssNumber('--arrow-length', 10);
  const linkStroke = cssNumber('--link-stroke-width', 3);
  let arrow = defs.select("marker#arrow");
  if (arrow.empty()) {
    arrow = defs.append("marker").attr("id", "arrow");
  }
  arrow
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 0)
    .attr("refY", 5)
    .attr("markerWidth", arrowLen)
    .attr("markerHeight", arrowLen + linkStroke)
    .attr("markerUnits", "userSpaceOnUse")
    .attr("orient", "auto-start-reverse");
  let arrowPath = arrow.select("path");
  if (arrowPath.empty()) {
    arrowPath = arrow.append("path");
  }
  arrowPath
    .attr("d", "M 0 0 L 10 5 L 0 10 z")
    .attr("fill", getComputedStyle(document.documentElement).getPropertyValue('--link-stroke') || '#bbb')
    .attr("fill-opacity", parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--link-opacity')) || 1);

  // Zoom-Container (einmalig)
  let gZoom = svg.select("g.zoom-layer");
  if (gZoom.empty()) {
    gZoom = svg.append("g").attr("class", "zoom-layer");
  }

  // Nur Personen-zu-Personen-Verbindungen anzeigen
  const personIdsInSub = new Set(sub.nodes.filter(n => byId.get(String(n.id))?.type === 'person').map(n => String(n.id)));
  const linksPP = sub.links.filter(l => personIdsInSub.has(idOf(l.source)) && personIdsInSub.has(idOf(l.target)));

  // Cluster-Ebene (hinter Links und Knoten)
  let gClusters = gZoom.select("g.clusters");
  if (gClusters.empty()) {
    gClusters = gZoom.append("g").attr("class", "clusters");
  }
  clusterLayer = gClusters;

  // Verbindungen rendern (inkrementell)
  let linkGroup = gZoom.select("g.links");
  if (linkGroup.empty()) {
    linkGroup = gZoom.append("g").attr("class", "links");
  }
  const link = linkGroup
    .selectAll("line")
    .data(linksPP, d => `${idOf(d.source)}|${idOf(d.target)}`)
    .join(
      enter => enter.append("line")
        .attr("class", "link")
        .attr("marker-end", "url(#arrow)"),
      update => update,
      exit => exit.remove()
    );

  // Debug-Link-Labels (optional)
  let linkLabelGroup = gZoom.select("g.link-labels");
  if (linkLabelGroup.empty()) {
    linkLabelGroup = gZoom.append("g").attr("class", "link-labels");
  }
  const linkLabel = linkLabelGroup
    .selectAll("text")
    .data(linksPP, d => `${idOf(d.source)}|${idOf(d.target)}`)
    .join("text")
    .attr("class", "link-label")
    .attr("text-anchor", "middle")
    .attr("dy", -3)
    .style("display", (debugMode && labelsVisible) ? "block" : "none")
    .style("font-size", "10px")
    .style("fill", "#666")
    .style("pointer-events", "none");

  // Nur Personen-Knoten rendern
  const personNodes = sub.nodes.filter(n => byId.get(String(n.id))?.type === 'person');
  const simById = new Map(personNodes.map(d => [String(d.id), d]));
  clusterSimById = simById;
  clusterPersonIds = new Set(personNodes.map(d => String(d.id)));
  simAllById = new Map(personNodes.map(d => [String(d.id), d]));
  
  // Knoten erstellen (inkrementell)
  let nodeGroup = gZoom.select("g.nodes");
  if (nodeGroup.empty()) {
    nodeGroup = gZoom.append("g").attr("class", "nodes");
  }
  const node = nodeGroup
    .selectAll("g.node")
    .data(personNodes, d => String(d.id))
    .join(
      enter => {
        const g = enter.append("g").attr("class", "node");
        return g;
      },
      update => update,
      exit => exit.remove()
    );

  // Styling-Parameter
  const nodeRadius = cssNumber('--node-radius', 8);
  const collidePadding = cssNumber('--collide-padding', 6);
  const circleGap = cssNumber('--attribute-circle-gap', 2);
  const circleWidth = cssNumber('--attribute-circle-stroke-width', 2);
  const nodeStrokeWidth = cssNumber('--node-with-attributes-stroke-width', 3);
  
  // Hauptkreis und Label nur für neue Knoten hinzufügen
  const nodeEnter = node.filter(function() { return this.childElementCount === 0; });
  nodeEnter.append("circle").attr("r", nodeRadius).attr("class", "node-circle")
    .style("fill", d => getNodeFillByLevel(d));
  nodeEnter.append("text")
    .text(d => debugMode ? `(${Math.round(d.x || 0)}, ${Math.round(d.y || 0)})` : (d.label ?? d.id))
    .attr("x", 10)
    .attr("y", 4)
    .attr("class", "label");
    
  // Attribut-Kreise hinzufügen (ohne Relayout)
  updateAttributeCircles();

  const prevPos = new Map();
  if (currentSimulation && typeof currentSimulation.nodes === 'function') {
    currentSimulation.nodes().forEach(n => {
      if (n && n.id != null) {
        prevPos.set(String(n.id), { x: n.x, y: n.y, vx: n.vx || 0, vy: n.vy || 0 });
      }
    });
  }
  
  // ============================================================================
  // RADIALES LAYOUT-SYSTEM MIT BREADTH-FIRST EXPANSION [SF]
  // ============================================================================
  
  /**
   * Neues radiales Layout-System mit Breadth-First Expansion
   * - Root(s) exakt im Zentrum (oder außerhalb der Hülle für sekundäre Roots)
   * - Level 1: Alle Kinder auf Kreis um Root
   * - Weitere Levels: Breadth-First, Kinder auf Kreis um Parent
   * - Force-Simulation läuft auf diesen Startpositionen
   */
  const initializeRadialLayout = () => {
    // Root-Knoten finden
    const rootIds = selectedRootIds.length > 0 ? selectedRootIds : [currentSelectedId].filter(Boolean);
    if (rootIds.length === 0) return false;
    
    if (debugMode) {
      console.log('[Layout] Radiales Initial-Layout', { rootIds, nodeCount: personNodes.length });
    }
    
    // Build parent-child map
    const childrenOf = new Map();
    const parentsOf = new Map();
    
    linksPP.forEach(l => {
      const s = idOf(l.source), t = idOf(l.target);
      if (!childrenOf.has(s)) childrenOf.set(s, []);
      childrenOf.get(s).push(t);
      if (!parentsOf.has(t)) parentsOf.set(t, []);
      parentsOf.get(t).push(s);
    });
    
    // Track welche Knoten bereits positioniert wurden
    const positioned = new Set();
    
    // Positioniere jeden Root
    rootIds.forEach((rootId, rootIndex) => {
      let rootX, rootY;
      
      if (rootIndex === 0) {
        // Erster Root: Zentrum
        rootX = WIDTH / 2;
        rootY = HEIGHT / 2;
      } else {
        // Sekundärer Root: Außerhalb der Hülle der bereits positionierten Knoten
        const alreadyPositioned = personNodes.filter(n => positioned.has(String(n.id)));
        const pos = findPositionOutsideHull(alreadyPositioned, cssNumber('--node-radius', 8) * 1.5); // baseRadius * 1.5 approximated
        rootX = pos.x;
        rootY = pos.y;
      }
      
      // Root-Knoten positionieren
      const rootNode = personNodes.find(n => String(n.id) === rootId);
      if (rootNode) {
        rootNode.x = rootX;
        rootNode.y = rootY;
        // Keine Fixierung (fx/fy) - Root kann sich mit Force-Simulation bewegen
        positioned.add(rootId);
      }
      
      // Breadth-First Expansion von diesem Root aus
      const queue = [{ nodeId: rootId, x: rootX, y: rootY, level: 0 }];
      radialLayoutExpansion(queue, childrenOf, parentsOf, personNodes, positioned, true);
    });
    
    return true;
  };
  
  /**
   * Erweitert bestehendes Layout mit neuen Knoten (Breadth-First)
   * Neue Knoten werden Generation für Generation hinzugefügt
   */
  const extendLayoutWithNewNodes = () => {
    // Build parent-child map
    const childrenOf = new Map();
    const parentsOf = new Map();
    
    linksPP.forEach(l => {
      const s = idOf(l.source), t = idOf(l.target);
      if (!childrenOf.has(s)) childrenOf.set(s, []);
      childrenOf.get(s).push(t);
      if (!parentsOf.has(t)) parentsOf.set(t, []);
      parentsOf.get(t).push(s);
    });
    
    // Identifiziere neue Knoten
    const newNodeIds = new Set();
    personNodes.forEach(n => {
      if (!prevPos.has(String(n.id))) {
        newNodeIds.add(String(n.id));
      }
    });
    
    if (newNodeIds.size === 0) return; // Keine neuen Knoten
    
    if (debugMode) {
      console.log('[Layout] Erweitere Layout mit neuen Knoten', { newCount: newNodeIds.size });
    }
    
    // Finde Blattknoten (Leaf Nodes) im bestehenden Layout
    // Ein Blattknoten hat keine Kinder oder alle Kinder sind neu
    const leafNodes = [];
    personNodes.forEach(n => {
      const nodeId = String(n.id);
      if (prevPos.has(nodeId)) {
        const children = childrenOf.get(nodeId) || [];
        const existingChildren = children.filter(cid => !newNodeIds.has(cid));
        
        // Blattknoten: keine existierenden Kinder
        if (existingChildren.length === 0 && children.length > 0) {
          leafNodes.push({ nodeId, x: n.x, y: n.y });
        }
      }
    });
    
    // Breadth-First Expansion von Blattknoten aus
    const queue = leafNodes.map(leaf => ({
      nodeId: leaf.nodeId,
      x: leaf.x,
      y: leaf.y,
      level: 0
    }));
    
    // Wir markieren alle *nicht* neuen Knoten als "positioniert", damit wir nicht in sie hinein expandieren
    // Aber `radialLayoutExpansion` filtert `!positionedSet.has(id)`.
    // Wir wollen nur in neue Knoten expandieren.
    // Also müssen wir `positioned` mit allen bestehenden Knoten initialisieren (oder allen außer den neuen).
    // Einfacher: `positioned` enthält alle `!newNodeIds`.
    const positioned = new Set();
    personNodes.forEach(n => {
        if (!newNodeIds.has(String(n.id))) {
            positioned.add(String(n.id));
        }
    });
    
    // Expansion ohne Parents (includeParents = false)
    radialLayoutExpansion(queue, childrenOf, parentsOf, personNodes, positioned, false);
    
    // Fallback für neue Knoten ohne Parent (sollte selten vorkommen)
    personNodes.forEach(n => {
      if (newNodeIds.has(String(n.id)) && !positioned.has(String(n.id))) {
        n.x = WIDTH / 2 + (Math.random() - 0.5) * 100;
        n.y = HEIGHT / 2 + (Math.random() - 0.5) * 100;
      }
    });
  };
  
  // Prüfe ob es vorherige Positionen gibt (= nicht erstes Laden)
  const hasExistingLayout = prevPos.size > 0;
  
  if (hasExistingLayout) {
    // Bestehende Positionen wiederherstellen
    personNodes.forEach(n => {
      const p = prevPos.get(String(n.id));
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        // Knoten hatte bereits Position - beibehalten
        n.x = p.x;
        n.y = p.y;
        n.vx = p.vx;
        n.vy = p.vy;
      }
    });
    
    // Erweitere Layout mit neuen Knoten (Breadth-First)
    extendLayoutWithNewNodes();
    
    // Fallback für Knoten ohne Position
    personNodes.forEach(n => {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
        n.x = WIDTH / 2 + (Math.random() - 0.5) * 100;
        n.y = HEIGHT / 2 + (Math.random() - 0.5) * 100;
      }
    });
  } else {
    // ERSTES Laden - radiales Initial-Layout
    const radialInitialized = initializeRadialLayout();
    
    if (!radialInitialized) {
      // Kein Root gefunden - Fallback zu zufälligen Positionen
      personNodes.forEach(n => {
        n.x = WIDTH / 2 + (Math.random() - 0.5) * 100;
        n.y = HEIGHT / 2 + (Math.random() - 0.5) * 100;
      });
    } else {
      // Radiales Layout wurde angewendet - Fallback für nicht-positionierte Knoten
      personNodes.forEach(n => {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
          n.x = WIDTH / 2 + (Math.random() - 0.5) * 100;
          n.y = HEIGHT / 2 + (Math.random() - 0.5) * 100;
        }
      });
    }
  }

  // Tooltips für Knoten
  node.on('mousemove', (event, d) => {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    const [mx, my] = d3.pointer(event, svg.node());
    const p = currentZoomTransform ? currentZoomTransform.invert([mx, my]) : [mx, my];
    
    const personId = String(d.id);
    const nodeLabel = d.label || personId;
    const clusters = clustersAtPoint(p);
    
    const lines = buildPersonTooltipLines(personId, nodeLabel, clusters);
    showTooltip(event.clientX, event.clientY, lines);
  });
  node.on('mouseleave', hideTooltip);
  // Context menu: hide subtree and (if applicable) remove as Root
  node.on('contextmenu', (event, d) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    const pid = String(d.id);
    showNodeMenu(event.clientX, event.clientY, {
      onHideSubtree: () => hideSubtreeFromRoot(pid),
      onSetAsRoot: () => {
        // Setze als neue Root mit radialem Re-Layout [SF][DRY]
        setSingleRoot(pid);
        currentSelectedId = pid;
        const input = document.querySelector(INPUT_COMBO_ID);
        if (input) input.value = d.label || pid;
        
        // Stoppe Simulation für Fresh-Layout
        if (currentSimulation) {
          currentSimulation.stop();
          currentSimulation = null;
        }
        applyFromUI();
      },
      isRoot: isRoot(pid),
      onRemoveRoot: () => { removeRoot(pid); applyFromUI(); },
      nodeId: pid
    });
  });

  // ============================================================================
  // FORCE-SIMULATION KONFIGURATION [SF][PA]
  // ============================================================================
  
  // Simulation erstellen oder wiederverwenden
  // Die Simulation arbeitet auf den radialen Startpositionen und verfeinert das Layout
  let simulation;
  if (currentSimulation && typeof currentSimulation.nodes === 'function' && typeof currentSimulation.force === 'function') {
    simulation = currentSimulation;
    simulation.nodes(personNodes);
    const linkForce = simulation.force("link");
    if (linkForce && typeof linkForce.links === 'function') {
      linkForce.links(linksPP);
    }
    simulation.alpha(0.5).restart();
  } else {
    simulation = createSimulation(personNodes, linksPP);
  }

  // Optionale BFS-Level-Animation für Single-Root-Subgraphen
  if (sub && sub.animateLevels) {
    const levelById = new Map();
    personNodes.forEach(n => {
      levelById.set(String(n.id), n.level || 0);
    });
    let maxLevel = 0;
    levelById.forEach(lvl => { if (lvl > maxLevel) maxLevel = lvl; });

    // Legendenscope pro Level berechnen (auf Basis von legendOrgLevels)
    const legendOrgLevels = sub.legendOrgLevels instanceof Map ? sub.legendOrgLevels : null;
    const updateLegendForLevel = (level) => {
      if (!legendOrgLevels) return;
      const legendEl = document.querySelector('#legend');
      if (!legendEl) return;

      // Aktuelle Auswahl (Checkboxen) zurück nach allowedOrgs spiegeln
      updateLegendChips(legendEl);

      const scope = new Set();
      legendOrgLevels.forEach((lvl, oid) => {
        if (lvl <= level) scope.add(oid);
      });

      applyLegendScope(scope);
      syncGraphAndLegendColors();
    };

    // Starte mit Root-Level sichtbar, restliche Knoten ausblenden
    node.style('opacity', d => (levelById.get(String(d.id)) || 0) === 0 ? 1 : 0);
    link.style('opacity', 0);

    // Initiale Legende für Level 0
    if (legendOrgLevels) {
      updateLegendForLevel(0);
    }

    if (maxLevel > 0) {
      let currentLevel = 0;
      const revealNextLevel = () => {
        currentLevel += 1;
        node.filter(d => (levelById.get(String(d.id)) || 0) === currentLevel)
          .style('opacity', 1);
        link.filter(d => {
          const sLevel = levelById.get(idOf(d.source)) || 0;
          const tLevel = levelById.get(idOf(d.target)) || 0;
          return Math.max(sLevel, tLevel) <= currentLevel;
        }).style('opacity', 1);

        if (legendOrgLevels) {
          updateLegendForLevel(currentLevel);
        }
        if (currentLevel < maxLevel) {
          setTimeout(revealNextLevel, BFS_LEVEL_ANIMATION_DELAY_MS);
        }
      };
      setTimeout(revealNextLevel, BFS_LEVEL_ANIMATION_DELAY_MS);
    }
  } else {
    node.style('opacity', 1);
    link.style('opacity', 1);
  }

  // Tick-Handler für Animation
  simulation.on("tick", () => {
    const nodeStrokeWidth = cssNumber('--node-stroke-width', 3);
    const nodeOuter = nodeRadius + (nodeStrokeWidth / 2);
    
    // Funktion zur Berechnung des äussersten Attributring-Radius für einen Knoten
    const getOutermostAttributeRadius = (d) => {
      // Wenn Attribute ausgeblendet sind, nur Hauptknoten-Radius verwenden [SF]
      if (!attributesVisible) {
        return nodeRadius;
      }
      
      const personId = String(d.id);
      const nodeAttrs = personAttributes.get(personId);
      const circleGap = cssNumber('--attribute-circle-gap', 2);
      const circleWidth = cssNumber('--attribute-circle-stroke-width', 2);
      const nodeStrokeWidth = cssNumber('--node-with-attributes-stroke-width', 3);
      
      let attrCount = 0;
      if (nodeAttrs && nodeAttrs.size > 0) {
        for (const attrName of nodeAttrs.keys()) {
          if (activeAttributes.has(attrName)) {
            attrCount++;
          }
        }
      }
      
      // Äusserster Radius: nodeRadius + nodeStroke/2 + attrCount * (gap + width)
      return nodeRadius + (nodeStrokeWidth / 2) + (attrCount * (circleGap + circleWidth));
    };
    
    // Verbindungsposition aktualisieren
    link
      .attr("x1", d => {
        const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
        const len = Math.hypot(dx, dy) || 1;
        const targetOuter = getOutermostAttributeRadius(d.target);
        return d.target.x - (dx / len) * targetOuter; // Startpunkt am äussersten Ring des Ziel-Knotens
      })
      .attr("y1", d => {
        const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
        const len = Math.hypot(dx, dy) || 1;
        const targetOuter = getOutermostAttributeRadius(d.target);
        return d.target.y - (dy / len) * targetOuter; // Startpunkt am äussersten Ring des Ziel-Knotens
      })
      .attr("x2", d => {
        const dx = d.source.x - d.target.x, dy = d.source.y - d.target.y;
        const len = Math.hypot(dx, dy) || 1;
        const sourceOuter = getOutermostAttributeRadius(d.source);
        const backoff = sourceOuter + arrowLen;
        return d.source.x - (dx / len) * backoff; // Endpunkt am äussersten Ring des Quell-Knotens mit Platz für Pfeilspitze
      })
      .attr("y2", d => {
        const dx = d.source.x - d.target.x, dy = d.source.y - d.target.y;
        const len = Math.hypot(dx, dy) || 1;
        const sourceOuter = getOutermostAttributeRadius(d.source);
        const backoff = sourceOuter + arrowLen;
        return d.source.y - (dy / len) * backoff; // Endpunkt am äussersten Ring des Quell-Knotens mit Platz für Pfeilspitze
      });

    // Knotenposition aktualisieren
    node.attr("transform", d => `translate(${d.x},${d.y})`);
    
    // Node-Labels aktualisieren (für Debug-Modus mit Koordinaten)
    if (debugMode) {
      node.selectAll("text.label")
        .text(d => `(${Math.round(d.x || 0)}, ${Math.round(d.y || 0)})`);
    }
    
    // Link-Labels aktualisieren (Mittelpunkt + Länge)
    linkLabel
      .attr("x", d => (d.source.x + d.target.x) / 2)
      .attr("y", d => (d.source.y + d.target.y) / 2)
      .text(d => {
        const dx = d.target.x - d.source.x;
        const dy = d.target.y - d.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return Math.round(dist) + 'px';
      });

    // Cluster (OE-Hüllen) aktualisieren
    const pad = cssNumber('--cluster-pad', 12);
    const membersByOrg = new Map();

    if (raw && Array.isArray(raw.orgs) && Array.isArray(raw.links)) {
      const orgIds = new Set(raw.orgs.map(o => String(o.id)));

      // Cache: für jedes OE alle Nachfahren inkl. sich selbst auf Basis der globalen orgChildren
      const descendantsCache = new Map();
      const getDescendants = (root) => {
        const key = String(root);
        if (descendantsCache.has(key)) return descendantsCache.get(key);
        const res = new Set([key]);
        const q = [key];
        while (q.length) {
          const cur = q.shift();
          const kids = orgChildren.get(cur);
          if (!kids) continue;
          for (const k of kids) {
            if (!res.has(k)) {
              res.add(k);
              q.push(k);
            }
          }
        }
        descendantsCache.set(key, res);
        return res;
      };

      // Mapping: jede OE -> Menge aktiver Wurzel-OEs, deren Unterbaum sie angehört
      const rootForOrg = new Map();
      for (const rootOid of allowedOrgs) {
        const rootId = String(rootOid);
        if (!orgIds.has(rootId)) continue;
        const desc = getDescendants(rootId);
        for (const oid of desc) {
          if (!rootForOrg.has(oid)) rootForOrg.set(oid, new Set());
          rootForOrg.get(oid).add(rootId);
        }
      }

      // Personen den Clustern der Wurzel-OEs ihrer Basis-OEs zuordnen
      for (const l of raw.links) {
        if (!l) continue;
        const s = idOf(l.source), t = idOf(l.target);
        if (!personIdsInSub.has(s)) continue;
        if (!orgIds.has(t)) continue;
        const roots = rootForOrg.get(t);
        if (!roots || roots.size === 0) continue;
        const nd = simById.get(s);
        if (!nd || nd.x == null || nd.y == null) continue;
        for (const rid of roots) {
          if (!membersByOrg.has(rid)) membersByOrg.set(rid, []);
          membersByOrg.get(rid).push(nd);
        }
      }
    }

    // Cluster-Pfade aktualisieren
    const clusterData = Array.from(membersByOrg.entries())
      .map(([oid, arr]) => ({ oid, nodes: arr }))
      .sort((a,b) => (orgDepth(a.oid) - orgDepth(b.oid)) || String(a.oid).localeCompare(String(b.oid)));
      
    const paths = gClusters.selectAll('path.cluster').data(clusterData, d => d.oid);
    paths.enter().append('path').attr('class','cluster').merge(paths)
      .each(function(d){
        const poly = computeClusterPolygon(d.nodes, pad);
        clusterPolygons.set(d.oid, poly);
        const { stroke, fill } = colorForOrg(d.oid);
        const line = d3.line().curve(d3.curveCardinalClosed.tension(0.75));
        d3.select(this)
          .attr('d', line(poly))
          .style('fill', fill)
          .style('stroke', stroke);
      })
      .order();
    paths.exit().remove();
  });
  
  // No auto-fit after simulation ends
  simulation.on('end', () => {});

  // Optionales radiales Layout
  const radialForceStrength = cssNumber('--radial-force', 0);
  if (radialForceStrength > 0) {
    const radialGap = cssNumber('--radial-gap', 100);
    const radialBase = cssNumber('--radial-base', 0);
    simulation.force(
      "radial",
      d3.forceRadial(
        d => radialBase + ((d.level || 0) * radialGap),
        WIDTH / 2,
        HEIGHT / 2
      ).strength(radialForceStrength)
    );
  }

  // Drag-Handler
  const drag = d3.drag()
    .on("start", (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on("drag", (event, d) => {
      d.fx = event.x; d.fy = event.y;
    })
    .on("end", (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null; d.fy = null;
    });
  node.call(drag);

  // Doppelklick auf Knoten setzt neues Zentrum
  node.on('dblclick', (event, d) => {
    event.stopPropagation(); // Verhindert Zoom-Konflikt
    
    // Setze geklickten Knoten als neuen Root [SF]
    const nodeId = String(d.id);
    setSingleRoot(nodeId);
    currentSelectedId = nodeId;
    
    // Aktualisiere UI-Input
    const input = document.querySelector(INPUT_COMBO_ID);
    if (input) input.value = d.label || nodeId;
    
    // Stoppe aktuelle Simulation für komplettes Re-Layout [SF]
    // Dies erzwingt radiales Initial-Layout mit neuem Root im Zentrum
    if (currentSimulation) {
      currentSimulation.stop();
      currentSimulation = null;
    }
    
    // Graph mit neuem Root neu berechnen und rendern
    // - Knoten außerhalb der Tiefe werden automatisch ausgeblendet
    // - Neu sichtbare Knoten werden über radiales Layout positioniert
    applyFromUI();
  });

  // Zoom-Verhalten
  zoomBehavior = d3.zoom().scaleExtent([0.2, 5])
    .on("zoom", (event) => {
      currentZoomTransform = event.transform;
      gZoom.attr("transform", event.transform);
    });
  svg.call(zoomBehavior);
  svg.classed('labels-hidden', !labelsVisible);

  // Alten Zoom-Zustand wiederherstellen, falls vorhanden und gültig
  if (savedZoomTransform && typeof savedZoomTransform.k === 'number' && 
      typeof savedZoomTransform.x === 'number' && 
      typeof savedZoomTransform.y === 'number') {
    // Wende den gespeicherten Zoom direkt auf die SVG an
    currentZoomTransform = savedZoomTransform;
    gZoom.attr("transform", savedZoomTransform);
    // Aktualisiere auch den internen Zustand des Zoom-Verhaltens
    svg.call(zoomBehavior.transform, savedZoomTransform);
  } else {
    // Fallback auf Standard-Identität, wenn noch kein Zoom angewendet wurde
    currentZoomTransform = d3.zoomIdentity;
  }

  // Tooltips für Cluster-Überlappungen
  ensureTooltip();
  svg.on('mousemove', event => handleClusterHover(event, svg));
  svg.on('mouseleave', hideTooltip);
  
  // Simulation global speichern und Layout anwenden
  currentSimulation = simulation;
  configureLayout(personNodes, linksPP, simulation, currentLayoutMode);
}

function applyFromUI() {
  if (!raw || !raw.links || !raw.nodes) return;
  if (searchDebounceTimer) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }
  
  // Reset hidden count für neue Berechnung
  currentHiddenCount = 0;
  
  // Get current search input value
  const input = document.querySelector(INPUT_COMBO_ID);
  const inputValue = input?.value.trim() || '';

  // Get selected depth
  const depthEl = document.querySelector(INPUT_DEPTH_ID);
  const depth = depthEl ? parseInt(depthEl.value, 10) || 0 : 0;

  // Get direction mode from split component
  let dirMode = 'both';
  const upHalf = document.querySelector('#directionToggle .direction-up');
  const downHalf = document.querySelector('#directionToggle .direction-down');
  if (upHalf && downHalf) {
    const upActive = upHalf.classList.contains('active');
    const downActive = downHalf.classList.contains('active');
    if (upActive && downActive) {
      dirMode = 'both';
    } else if (upActive) {
      dirMode = 'up';
    } else if (downActive) {
      dirMode = 'down';
    }
  }

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
  if (roots.length === 1) {
    const startId = roots[0];
    // Merke letzten Einzel-Root für zukünftiges Shift-Add Seeding
    lastSingleRootId = String(startId);
    currentSelectedId = String(startId);
    const sub = computeSubgraph(startId, Number.isFinite(depth) ? depth : 2, dirMode);
    if (isNewRootSelection) {
      // Nur bei echter Root-Änderung BFS-Animation aktivieren
      sub.animateLevels = true;
    }
    currentSubgraph = sub;
    renderGraph(sub);
    updateFooterStats(sub);

    // Bei reinen Parameteränderungen (Tiefe/Richtung) Legenden-Scope direkt anwenden
    if (!sub.animateLevels && sub.legendOrgs) {
      applyLegendScope(sub.legendOrgs);
      syncGraphAndLegendColors();
    }
  } else {
    // Multi-root: compute union of subgraphs
    const nodeMap = new Map();
    const linkSet = new Set();
    const effDepth = Number.isFinite(depth) ? depth : 2;
    const scopeOrgs = new Set(); // Union of all legendOrgs
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
    const merged = { nodes, links };
    currentSubgraph = merged;
    renderGraph(merged);
    updateFooterStats(merged);
    // Multi-Root: Legende auf die Vereinigungsmenge der relevanten OEs einschränken
    applyLegendScope(scopeOrgs);
    syncGraphAndLegendColors();
  }

  // Letzten Render-Zustand merken (für zukünftige Root-Wechsel-Erkennung)
  lastRenderRoots = roots.slice();
  lastRenderDepth = depth;
  lastRenderDirMode = dirMode;

  // Titel der Hidden-Legende aktualisieren nach allen Graph-Berechnungen
  updateHiddenLegendTitle();
}

/**
 * Parse a list of attributes from a text string.
 * 
 * @param {string} text - The text string to parse.
 * @returns {object} An object containing the parsed attributes.
 */
function parseAttributeList(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const result = new Map();
  const foundAttributes = new Set();
  let count = 0;
  
  // Leere Dateien sind erlaubt - repräsentieren eine Kategorie ohne Attribute
  if (lines.length === 0) {
    return { 
      attributes: result, 
      types: Array.from(foundAttributes),
      count: 0,
      isEmpty: true
    };
  }
  
  for (const line of lines) {
    // Zeilenweise das Trennzeichen erkennen (Tab oder Komma)
    let separator = ',';
    let parts;
    
    if (line.includes('\t')) {
      // Tab-separiert
      parts = line.split('\t').map(p => p.trim());
    } else {
      // Komma-separiert
      parts = line.split(',').map(p => p.trim());
    }
    
    if (parts.length < 2) continue;
    
    const identifier = parts[0]; // ID oder E-Mail
    const attribute = parts[1]; // Attributname
    const value = parts.length > 2 ? parts[2] : '1'; // Optionaler Attributwert
    
    if (!result.has(identifier)) {
      result.set(identifier, new Map());
    }
    
    result.get(identifier).set(attribute, value);
    foundAttributes.add(attribute);
    count++;
  }
  
  return { 
    attributes: result, 
    types: Array.from(foundAttributes),
    count,
    isEmpty: false
  };
}

/**
 * Berechnet die Levenshtein-Distanz zwischen zwei Strings
 * Gibt einen Wert zurück, der die Ähnlichkeit der Strings angibt (kleinerer Wert = ähnlicher)
 */
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  
  // Erstelle eine Matrix für die Berechnung
  const matrix = [];
  
  // Initialisiere die erste Zeile und Spalte
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }
  
  // Berechne die Distanz
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // Löschen
        matrix[i][j - 1] + 1,      // Einfügen
        matrix[i - 1][j - 1] + cost // Ersetzen oder Beibehalten
      );
    }
  }
  
  return matrix[len1][len2];
}

/**
 * Berechnet die normalisierte Levenshtein-Distanz zwischen zwei Strings
 * Gibt einen Wert zwischen 0 und 1 zurück (0 = identisch, 1 = komplett verschieden)
 */
function normalizedLevenshteinDistance(str1, str2) {
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  // Vermeide Division durch Null
  if (maxLength === 0) return 0;
  return distance / maxLength;
}

/**
 * Führt eine Fuzzy-Suche für einen Identifikator durch und gibt potentielle Treffer zurück
 */
function fuzzySearch(identifier, threshold = 0.3, progressCallback = null, abortFlag = null) {
  if (!identifier || !String(identifier).trim()) return [];
  
  const normalizedInput = String(identifier).toLowerCase();
  const potentialMatches = [];
  let processedCount = 0;
  const totalItems = raw.persons.length;
  const batchSize = 100; // Anzahl der zu verarbeitenden Elemente pro Batch
  
  return new Promise((resolve) => {
    // Timer für Progress-Update, wenn die Suche länger als 1 Sekunde dauert
    let searchStartTime = performance.now();
    let progressShown = false;
    let progressTimer = setTimeout(() => {
      progressShown = true;
      if (progressCallback) progressCallback(0, totalItems);
    }, 1000);
    
    function processNextBatch(startIndex) {
      // Prüfen, ob die Suche abgebrochen wurde
      if (abortFlag && abortFlag.aborted) {
        clearTimeout(progressTimer);
        resolve([]); // Leeres Ergebnis zurückgeben
        return;
      }
      
      let endIndex = Math.min(startIndex + batchSize, totalItems);
      
      // Verarbeite den aktuellen Batch
      for (let i = startIndex; i < endIndex; i++) {
        // Noch einmal prüfen, ob die Suche abgebrochen wurde (feingranularer)
        if (abortFlag && abortFlag.aborted) break;
        
        const person = raw.persons[i];
        if (!person || !person.id) continue;
        
        // Berechne die Levenshtein-Distanz für ID
        const personId = String(person.id);
        const normalizedId = personId.toLowerCase();
        const idDistance = normalizedLevenshteinDistance(normalizedInput, normalizedId);
        
        // Berechne die Levenshtein-Distanz für E-Mail, falls vorhanden
        let emailDistance = 1; // Maximum (keine Übereinstimmung)
        let normalizedEmail = '';
        if (person.email) {
          normalizedEmail = person.email.toLowerCase();
          emailDistance = normalizedLevenshteinDistance(normalizedInput, normalizedEmail);
        }
        
        // Berechne die Levenshtein-Distanz für das Label (Name), falls vorhanden
        let labelDistance = 1; // Maximum (keine Übereinstimmung)
        let normalizedLabel = '';
        if (person.label) {
          normalizedLabel = person.label.toLowerCase();
          labelDistance = normalizedLevenshteinDistance(normalizedInput, normalizedLabel);
        }
        
        // Nehme den besten Match (kleinsten Distanzwert)
        const bestDistance = Math.min(idDistance, emailDistance, labelDistance);
        const matchedOn = bestDistance === idDistance ? 'ID' : 
                         (bestDistance === emailDistance ? 'E-Mail' : 'Name');
        
        // Wenn die Distanz unter dem Threshold liegt, füge es zu den potentiellen Matches hinzu
        if (bestDistance <= threshold) {
          potentialMatches.push({
            id: personId,
            label: person.label || personId,
            email: person.email || '',
            similarity: bestDistance,
            matchedOn
          });
        }
      }
      
      processedCount = endIndex;
      
      // Update Progress-Callback wenn gezeigt
      if (progressShown && progressCallback) {
        progressCallback(processedCount, totalItems);
      }
      
      // Abbruch oder Fortsetzung?
      if (abortFlag && abortFlag.aborted) {
        clearTimeout(progressTimer);
        resolve([]); // Leeres Ergebnis bei Abbruch
        return;
      }
      
      // Prüfen ob wir fertig sind oder den nächsten Batch verarbeiten müssen
      if (processedCount < totalItems) {
        // Für bessere Reaktionsfähigkeit der UI, zeitversetzt fortsetzen
        setTimeout(() => processNextBatch(endIndex), 0);
      } else {
        // Fertig! Timer löschen und Ergebnis zurückgeben
        clearTimeout(progressTimer);
        
        // Sortiere nach Ähnlichkeit (kleinere Werte zuerst)
        resolve(potentialMatches.sort((a, b) => a.similarity - b.similarity));
      }
    }
    
    // Starte die Verarbeitung mit dem ersten Batch
    processNextBatch(0);
  });
}

/**
 * Sucht nach Personen im Datensatz basierend auf ID oder E-Mail
 */
function findPersonIdsByIdentifier(identifier) {
  const normalizedId = String(identifier).toLowerCase();
  const matches = [];
  
  // Suche nach exakter ID
  const exactById = raw.persons.find(p => String(p.id).toLowerCase() === normalizedId);
  if (exactById) matches.push(String(exactById.id));
  
  // Suche nach exakter E-Mail
  const exactByEmail = raw.persons.find(p => (p.email || '').toLowerCase() === normalizedId);
  if (exactByEmail && !matches.includes(String(exactByEmail.id))) {
    matches.push(String(exactByEmail.id));
  }
  
  return matches;
}

/**
 * Lädt Attributliste aus einer Datei mit Fuzzy-Search-Unterstützung
 */
async function loadAttributesFromFile(file) {
  try {
    const text = await file.text();
    const { attributes, types, count, isEmpty } = parseAttributeList(text);
    
    // Leere Datei = nur Kategorie ohne Attribute
    if (isEmpty) {
      const category = file.name.replace(/\.[^/.]+$/, ''); // Dateiname ohne Extension
      
      // Registriere die leere Kategorie
      emptyCategories.add(category);
      
      // Speichere Quell-Informationen auch für leere Kategorien
      categorySourceFiles.set(category, {
        filename: file.name,
        url: null, // Von Datei geladen, nicht von URL
        originalText: text,
        format: 'comma' // Default für leere Dateien
      });
      
      showTemporaryNotification(`Kategorie "${category}" geladen (leer - nur Platzhalter)`, 3000);
      
      // UI aktualisieren
      buildAttributeLegend();
      updateAttributeStats();
      
      return true;
    }
    
    // Erkenne das verwendete Format für die Statusmeldung
    const hasTabFormat = text.includes('\t');
    const formatInfo = hasTabFormat ? 'Tab-separiert' : 'Komma-separiert';
    
    // Verknüpfe die geladenen Attribute mit den Personen-IDs
    const newPersonAttributes = new Map();
    const fuzzyMatches = new Map();
    const unmatchedEntries = new Map();
    let matchedCount = 0;
    
    // Progress-Anzeige erstellen
    let searchProgress = null;
    let searchCount = 0;
    let searchAborted = false; // Flag, um die Suche abzubrechen
    
    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';
    progressContainer.style.display = 'none';
    
    const progressOverlay = document.createElement('div');
    progressOverlay.className = 'progress-overlay';
    
    const progressBox = document.createElement('div');
    progressBox.className = 'progress-box';
    
    const progressText = document.createElement('div');
    progressText.className = 'progress-text';
    progressText.textContent = 'Suche nach ähnlichen Einträgen...';
    
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    
    const progressBarInner = document.createElement('div');
    progressBarInner.className = 'progress-bar-inner';
    progressBar.appendChild(progressBarInner);
    
    const progressPercent = document.createElement('div');
    progressPercent.className = 'progress-percent';
    progressPercent.textContent = '0%';
    
    // Abbrechen-Button hinzufügen
    const progressCancelBtn = document.createElement('button');
    progressCancelBtn.className = 'progress-cancel-btn';
    progressCancelBtn.textContent = 'Abbrechen';
    progressCancelBtn.addEventListener('click', () => {
      // Suche abbrechen
      searchAborted = true;
      
      // Dialog entfernen
      progressContainer.remove();
      
      // Meldung anzeigen
      showTemporaryNotification('Suche nach ähnlichen Einträgen abgebrochen');
    });
    
    progressBox.appendChild(progressText);
    progressBox.appendChild(progressBar);
    progressBox.appendChild(progressPercent);
    progressBox.appendChild(progressCancelBtn); // Button zum Container hinzufügen
    progressContainer.appendChild(progressOverlay);
    progressContainer.appendChild(progressBox);
    document.body.appendChild(progressContainer);
    
    // Progress-Callback für Fortschrittsanzeige
    const updateProgress = (processed, total) => {
      if (progressContainer.style.display === 'none') {
        progressContainer.style.display = 'flex';
      }
      
      const percent = Math.round((processed / total) * 100);
      progressBarInner.style.width = `${percent}%`;
      progressPercent.textContent = `${processed} / ${total} (${percent}%)`;
      progressText.textContent = `Suche nach ähnlichen Einträgen für ${searchCount} nicht exakt zugeordnete Attribute...`;
    };
    
    // Verarbeite alle Attribute
    // Sammle explizit alle Einträge ohne exakte Zuordnung für die spätere Fuzzy-Suche
    const unmatchedToSearch = [];
    for (const [identifier, attrs] of attributes.entries()) {
      const personIds = findPersonIdsByIdentifier(identifier);
      if (personIds.length > 0) {
        for (const id of personIds) {
          if (!newPersonAttributes.has(id)) {
            newPersonAttributes.set(id, new Map());
          }
          for (const [attrName, attrValue] of attrs.entries()) {
            newPersonAttributes.get(id).set(attrName, attrValue);
          }
        }
        matchedCount++;
      } else {
        // Zähle nicht exakt zugeordnete Einträge
        searchCount++;
        unmatchedToSearch.push([identifier, attrs]);
      }
    }
    
    // Abbruch-Flag außerhalb des Blocks deklarieren, damit es nachher sicher verfügbar ist
    let abortFlagObj = null;

    // Neue, vollständig lineare Fortschrittsberechnung für nicht-matched Attribute
    if (searchCount > 0) {
      progressText.textContent = `Vorbereitung der Suche für ${searchCount} nicht zugeordnete Attribute...`;
      
      // Klare Berechnung: Gesamtfortschritt = 100% / searchCount für jeden Eintrag
      const progressPerEntry = 1 / searchCount;
      
      // Statische Variablen zum Tracking des Fortschritts
      let searchesCompleted = 0;
      
      // Neuer, linearer Progress-Handler
      const linearProgressHandler = (entriesProcessed, totalEntries, currentEntryIndex) => {
        // Korrekte Index-Anzeige (1-basiert, begrenzt)
        const displayIndex = Math.max(1, Math.min(currentEntryIndex + 1, searchCount));
        
        // Prüfe auf Division durch Null
        const entryProgress = totalEntries > 0 ? entriesProcessed / totalEntries : 0;
        
        // Linearer Gesamtfortschritt:
        // - Abgeschlossene Einträge zählen zu 100%
        // - Aktueller Eintrag zählt anteilig
        const overallProgress = (searchesCompleted * progressPerEntry) + 
                              (entryProgress * progressPerEntry);
        
        // Sichere Prozentberechnung mit Rundung
        const percent = Math.round(overallProgress * 100);
        const boundedPercent = Math.max(0, Math.min(100, percent));
        
        // Aktualisiere die visuelle Anzeige
        progressBarInner.style.width = `${boundedPercent}%`;
        progressPercent.textContent = `${boundedPercent}%`;
        progressText.textContent = `Suche nach ähnlichen Einträgen... (${displayIndex} von ${searchCount})`;
        
        // Stelle sicher, dass der Progress-Dialog sichtbar ist
        if (progressContainer.style.display === 'none') {
          progressContainer.style.display = 'flex';
        }
      };
      
      // Objekt für das Abbruch-Flag (als Referenz, damit es in der fuzzySearch-Funktion aktualisiert werden kann)
      abortFlagObj = { aborted: false };
      
      // Abbruch-Flag mit dem Cancel-Button verknüpfen
      progressCancelBtn.addEventListener('click', () => {
        abortFlagObj.aborted = true;
      });
      
      // Fuzzy-Suche nur über die tatsächlich nicht zugeordneten Einträge durchführen
      for (let i = 0; i < unmatchedToSearch.length; i++) {
        if (searchAborted || (abortFlagObj && abortFlagObj.aborted)) break;

        const [identifier, attrs] = unmatchedToSearch[i];

        // Fortschritt-Handler für diesen Eintrag (Index i ist 0-basiert)
        const entryProgressHandler = (processed, total) => {
          linearProgressHandler(processed, total, i);
        };

        // Fuzzy Search durchführen
        const potentialMatches = await fuzzySearch(identifier, 0.3, entryProgressHandler, abortFlagObj);
        if (potentialMatches.length > 0) {
          fuzzyMatches.set(identifier, { attrs, potentialMatches });
        } else if (!abortFlagObj.aborted) {
          unmatchedEntries.set(identifier, attrs);
        }

        // Eintrag abgeschlossen -> Gesamtfortschritt erhöhen
        searchesCompleted++;
      }
    }
    
    // Progress-Anzeige entfernen
    progressContainer.remove();
    
    // Prüfen, ob die Suche abgebrochen wurde
    if (searchAborted || (abortFlagObj && abortFlagObj.aborted)) {
      showTemporaryNotification('Attribute-Import abgebrochen - keine Änderungen vorgenommen');
      return false;
    }
    
    // Generiere Farben für neue Attributtypen
    for (const type of types) {
      if (!attributeTypes.has(type)) {
        // Generiere eine neue Farbe für diesen Attributtyp
        const hue = (hashCode(type) % 360);
        const color = `hsl(${hue}, 70%, 50%)`;
        attributeTypes.set(type, color);
        activeAttributes.add(type); // Neue Attribute standardmäßig aktivieren
      }
    }
    
    // Wenn es Fuzzy-Matches gibt, zeige den Dialog
    if (fuzzyMatches.size > 0) {
      showFuzzyMatchDialog(fuzzyMatches, unmatchedEntries, newPersonAttributes, attributeTypes);
      return true;
    }
    
    // Wenn nur unmatched entries existieren, exportiere diese
    if (unmatchedEntries.size > 0) {
      exportUnmatchedEntries(unmatchedEntries);
    }
    
    // Setze die neuen Attribute und aktualisiere
    personAttributes = newPersonAttributes;
    
    // Speichere Quell-Informationen für späteres Speichern
    const category = file.name.replace(/\.[^/.]+$/, '');
    categorySourceFiles.set(category, {
      filename: file.name,
      url: null, // Von Datei geladen, nicht von URL
      originalText: text,
      format: hasTabFormat ? 'tab' : 'comma'
    });
    
    // UI aktualisieren
    buildAttributeLegend();
    updateAttributeStats();
    
    // Nur die Attribut-Kreise aktualisieren, ohne Layout-Neuberechnung
    if (currentSubgraph) updateAttributeCircles();
    
    // Zeige eine temporäre Benachrichtigung ohne den Status zu überschreiben
    showTemporaryNotification(`Attribute geladen: ${count} Einträge, ${matchedCount} gefunden (${formatInfo})`);
    
    return true;
  } catch (e) {
    // Zeige Fehler als Benachrichtigung an, nicht als Status
    showTemporaryNotification(`Fehler beim Laden der Attribute: ${e.message}`, 5000);
    console.error('Fehler beim Laden der Attribute:', e);
    return false;
  }
}

/**
 * Hilfsfunktionen für Codicon-Icons
 */
function getCheckboxSVG(checked = false) {
  if (checked) {
    return `<i class="codicon codicon-check" aria-hidden="true"></i>`;
  } else {
    return `<i class="codicon codicon-close" aria-hidden="true"></i>`;
  }
}

function getChevronSVG() {
  return `<i class="codicon codicon-chevron-down" aria-hidden="true"></i>`;
}

function getCheckAllSVG() {
  return `<i class="codicon codicon-check-all" aria-hidden="true"></i>`;
}

function getEyeSVG(closed = false) {
  if (closed) {
    return `<i class="codicon codicon-eye-closed" aria-hidden="true"></i>`;
  }
  return `<i class="codicon codicon-eye" aria-hidden="true"></i>`;
}

function getSaveSVG() {
  return `<i class="codicon codicon-save" aria-hidden="true"></i>`;
}

function updateCheckboxIcon(checkboxElement, checked) {
  checkboxElement.innerHTML = getCheckboxSVG(checked);
  checkboxElement.className = checked ? 
    checkboxElement.className.replace(/\s*checked/, '') + ' checked' : 
    checkboxElement.className.replace(/\s*checked/, '');
}

function initializeChevronIcons() {
  // Aktualisiere alle Chevron-Buttons im HTML mit dem zentralen SVG
  document.querySelectorAll('.legend-chevron').forEach(chevronBtn => {
    chevronBtn.innerHTML = getChevronSVG();
  });
}

/**
 * Erstellt die Attribut-Legende mit einheitlichem legend-row Layout (wie OEs)
 */
function buildAttributeLegend() {
  const legend = document.getElementById('attributeLegend');
  if (!legend) return;

  legend.innerHTML = '';
  if (attributeTypes.size === 0 && emptyCategories.size === 0) {
    updateAttributeStats();
    return;
  }

  // Zähle Vorkommen je Attributtyp
  const typeCount = new Map();
  for (const attrs of personAttributes.values()) {
    for (const type of attrs.keys()) {
      typeCount.set(type, (typeCount.get(type) || 0) + 1);
    }
  }

  // Kategorien sammeln
  const categories = new Map(); // cat -> [{key,name,color,count}]
  for (const key of attributeTypes.keys()) {
    const [cat, name] = String(key).includes('::') ? String(key).split('::') : ['Attribute', String(key)];
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat).push({
      key,
      name,
      color: attributeTypes.get(key),
      count: typeCount.get(key) || 0
    });
  }
  
  // Leere Kategorien hinzufügen (ohne Attribute)
  for (const cat of emptyCategories) {
    if (!categories.has(cat)) {
      categories.set(cat, []);
    }
  }

  // Liste erstellen mit legend-list (wie OEs)
  const ul = document.createElement('ul');
  ul.className = 'legend-list';

  const sortedCats = Array.from(categories.keys()).sort();
  for (const cat of sortedCats) {
    const items = categories.get(cat).sort((a,b)=> a.name.localeCompare(b.name));
    
    // Kategorie-Listenelement
    const catLi = document.createElement('li');
    
    // Haupt-Row für Kategorie
    const catRow = document.createElement('div');
    catRow.className = 'legend-row';
    
    // Linker Bereich: Chevron + Label
    const catLeftArea = document.createElement('div');
    catLeftArea.className = 'legend-row-left';
    
    // Rechter Bereich: Action-Buttons
    const catRightArea = document.createElement('div');
    catRightArea.className = 'legend-row-right';
    
    // Chevron für Kategorie
    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = collapsedCategories.has(cat) ? 'legend-tree-chevron collapsed' : 'legend-tree-chevron expanded';
    chevron.title = 'Ein-/Ausklappen';
    chevron.innerHTML = getChevronSVG();
    
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      const sub = catLi.querySelector('ul');
      const isCollapsed = sub && sub.style.display === 'none';
      
      if (sub) {
        sub.style.display = isCollapsed ? '' : 'none';
        chevron.className = isCollapsed ? 'legend-tree-chevron expanded' : 'legend-tree-chevron collapsed';
        
        if (isCollapsed) {
          collapsedCategories.delete(cat);
        } else {
          collapsedCategories.add(cat);
        }
      }
    });
    
    catLeftArea.appendChild(chevron);
    
    // Kategorie-Label mit Anzahl
    const catLabel = document.createElement('span');
    catLabel.className = 'legend-label-chip';
    const total = items.reduce((s,it)=> s + (it.count||0), 0);
    catLabel.textContent = `${cat} (${total})`;
    catLabel.title = `${cat} - ${total} Einträge`;
    catLeftArea.appendChild(catLabel);
    
    // Eye-Toggle Button (rechts) - blendet Kategorie temporär aus
    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    const isHidden = hiddenCategories.has(cat);
    eyeBtn.className = isHidden ? 'legend-icon-btn hidden' : 'legend-icon-btn';
    eyeBtn.title = isHidden ? 'Kategorie einblenden' : 'Kategorie ausblenden';
    eyeBtn.innerHTML = getEyeSVG(isHidden);
    eyeBtn.setAttribute('data-ignore-header-click', 'true');
    
    eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCurrentlyHidden = hiddenCategories.has(cat);
      const icon = eyeBtn.querySelector('.codicon');
      
      if (isCurrentlyHidden) {
        // Einblenden
        hiddenCategories.delete(cat);
        eyeBtn.className = 'legend-icon-btn';
        eyeBtn.title = 'Kategorie ausblenden';
        if (icon) {
          icon.classList.remove('codicon-eye-closed');
          icon.classList.add('codicon-eye');
        }
      } else {
        // Ausblenden
        hiddenCategories.add(cat);
        eyeBtn.className = 'legend-icon-btn hidden';
        eyeBtn.title = 'Kategorie einblenden';
        if (icon) {
          icon.classList.remove('codicon-eye');
          icon.classList.add('codicon-eye-closed');
        }
      }
      
      // Attribut-Kreise neu zeichnen
      updateAttributeCircles();
    });
    
    catRightArea.appendChild(eyeBtn);
    
    // Save-Button (nur sichtbar wenn Kategorie geändert wurde)
    const isModified = modifiedCategories.has(cat);
    const hasSource = categorySourceFiles.has(cat);
    
    // Debug: Log wenn eine Kategorie geändert wurde aber keinen Source hat
    if (isModified && !hasSource && debugMode) {
      console.log(`Kategorie "${cat}" ist geändert, hat aber keine Quelldatei. Verfügbare Quellen:`, Array.from(categorySourceFiles.keys()));
    }
    
    if (isModified && hasSource) {
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'legend-icon-btn save-btn';
      saveBtn.title = `Änderungen in "${cat}" speichern`;
      saveBtn.innerHTML = getSaveSVG();
      saveBtn.setAttribute('data-ignore-header-click', 'true');
      
      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        exportCategoryAttributes(cat);
      });
      
      catRightArea.appendChild(saveBtn);
    }
    
    // Bereiche zu Kategorie-Row hinzufügen
    catRow.appendChild(catLeftArea);
    catRow.appendChild(catRightArea);
    catLi.appendChild(catRow);
    
    // Unter-Liste für Attribute-Items
    const itemsUl = document.createElement('ul');
    itemsUl.style.display = collapsedCategories.has(cat) ? 'none' : '';
    
    for (const it of items) {
      const itemLi = document.createElement('li');
      
      // Item-Row (ganze Zeile klickbar)
      const itemRow = document.createElement('div');
      const isItemActive = activeAttributes.has(it.key);
      itemRow.className = isItemActive ? 'legend-row active' : 'legend-row';
      itemRow.setAttribute('data-attribute-color', it.color);
      
      // Setze die Attribut-Farbe als CSS-Variable für den Hintergrund (transparent wie bei OEs)
      const transparentBg = colorToTransparent(it.color, 0.25);
      const transparentHoverBg = colorToTransparent(it.color, 0.35);
      itemRow.style.setProperty('--attribute-bg', transparentBg);
      itemRow.style.setProperty('--attribute-bg-hover', transparentHoverBg);
      
      // Linker Bereich: Spacer + Farbe + Label
      const itemLeftArea = document.createElement('div');
      itemLeftArea.className = 'legend-row-left';
      
      // Tiefe-Spacer für Einrückung (16px wie bei OEs)
      const depthSpacer = document.createElement('div');
      depthSpacer.className = 'legend-depth-spacer';
      depthSpacer.style.width = '16px';
      itemLeftArea.appendChild(depthSpacer);
      
      // Spacer statt Chevron
      const spacer = document.createElement('div');
      spacer.className = 'legend-tree-spacer';
      itemLeftArea.appendChild(spacer);
      
      // Farb-Indikator (nur Border, wie Attribut-Ringe im Graphen)
      const colorSpan = document.createElement('span');
      colorSpan.className = 'attribute-color-dot';
      const circleDiameter = 12;
      colorSpan.style.display = 'inline-block';
      colorSpan.style.width = `${circleDiameter}px`;
      colorSpan.style.height = `${circleDiameter}px`;
      colorSpan.style.borderRadius = '50%';
      colorSpan.style.backgroundColor = 'transparent';
      // Border = 50% des Radius = 1/4 des Durchmessers
      const borderWidth = circleDiameter / 4;
      colorSpan.style.border = `${borderWidth}px solid ${it.color}`;
      colorSpan.style.marginRight = '8px';
      colorSpan.style.flexShrink = '0';
      itemLeftArea.appendChild(colorSpan);
      
      // Item-Label mit Count
      const itemLabel = document.createElement('span');
      itemLabel.className = 'legend-label-chip';
      itemLabel.textContent = `${it.name} (${it.count})`;
      itemLabel.title = `${cat} :: ${it.name} - ${it.count} Einträge`;
      itemLeftArea.appendChild(itemLabel);
      
      // Ganze Zeile klickbar für Toggle
      itemRow.addEventListener('click', (e) => {
        const isActive = activeAttributes.has(it.key);
        
        if (isActive) {
          activeAttributes.delete(it.key);
          itemRow.classList.remove('active');
        } else {
          activeAttributes.add(it.key);
          itemRow.classList.add('active');
        }
        
        updateAttributeStats();
        updateAttributeCircles();
      });
      
      // Bereiche zu Item-Row hinzufügen
      itemRow.appendChild(itemLeftArea);
      itemLi.appendChild(itemRow);
      itemsUl.appendChild(itemLi);
    }
    
    catLi.appendChild(itemsUl);
    ul.appendChild(catLi);
  }

  legend.appendChild(ul);
  updateAttributeStats();
}

/**
 * Zeigt einen Dialog mit Fuzzy-Match-Vorschlägen
 */
function showFuzzyMatchDialog(fuzzyMatches, unmatchedEntries, newPersonAttributes, attributeTypes) {
  // Dialog-Container erstellen
  const dialogContainer = document.createElement('div');
  dialogContainer.className = 'fuzzy-match-dialog-container';
  
  // Event-Listener für Dialog-Schließung durch Klick auf Overlay - Abbruch ohne Änderungen
  dialogContainer.addEventListener('click', (e) => {
    // Nur reagieren, wenn direkt auf den Container geklickt wurde (nicht auf Dialog-Inhalt)
    if (e.target === dialogContainer) {
      // Bereinige alle Dropdown-Elemente
      document.querySelectorAll('body > .combo-list').forEach(el => {
        el.remove();
      });
      
      // Entferne den Dialog ohne Attribute zu importieren
      dialogContainer.remove();
      
      // Benachrichtigung anzeigen
      showTemporaryNotification('Import abgebrochen - keine Änderungen vorgenommen');
    }
  });
  
  // ESC-Taste zum Abbrechen des Dialogs ohne Änderungen
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape' && document.body.contains(dialogContainer)) {
      // Bereinige alle Dropdown-Elemente
      document.querySelectorAll('body > .combo-list').forEach(el => {
        el.remove();
      });
      
      // Entferne den Dialog ohne Attribute zu importieren
      dialogContainer.remove();
      
      // Benachrichtigung anzeigen
      showTemporaryNotification('Import abgebrochen - keine Änderungen vorgenommen');
      
      // Entferne den Event-Listener nach Dialog-Schließung
      document.removeEventListener('keydown', escHandler);
    }
  });
  
  const dialog = document.createElement('div');
  dialog.className = 'fuzzy-match-dialog';
  
  // Dialog-Header
  const header = document.createElement('div');
  header.className = 'fuzzy-match-header';
  
  const title = document.createElement('h2');
  title.textContent = 'Mögliche Übereinstimmungen gefunden';
  header.appendChild(title);
  
  // Close Button (Abbrechen)
  const closeBtn = document.createElement('button');
  closeBtn.className = 'fuzzy-match-close-btn';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Abbrechen';
  closeBtn.addEventListener('click', () => {
    // Abbrechen ohne Änderungen - nichts importieren
    
    // Bereinige alle Dropdown-Elemente, die direkt an body angehängt wurden
    document.querySelectorAll('body > .combo-list').forEach(el => {
      el.remove();
    });
    
    // Entferne den Dialog ohne Attribute zu importieren
    dialogContainer.remove();
    
    // Benachrichtigung anzeigen
    showTemporaryNotification('Import abgebrochen - keine Änderungen vorgenommen');
  });
  header.appendChild(closeBtn);
  
  dialog.appendChild(header);
  
  // Dialog-Inhalt
  const content = document.createElement('div');
  content.className = 'fuzzy-match-content';
  
  // Meldung
  const message = document.createElement('p');
  message.textContent = 'Folgende Einträge konnten nicht eindeutig zugeordnet werden. Bitte wählen Sie die korrekte Zuordnung:'
  content.appendChild(message);
  
  // Liste der Fuzzy-Matches
  const matchList = document.createElement('div');
  matchList.className = 'fuzzy-match-list';
  
  // Für jeden unklaren Eintrag
  for (const [identifier, { attrs, potentialMatches }] of fuzzyMatches.entries()) {
    const matchItem = document.createElement('div');
    matchItem.className = 'fuzzy-match-item';
    
    // Vereinfachter Header mit Identifier und Attributen in einer Zeile
    const itemInfo = document.createElement('div');
    itemInfo.className = 'fuzzy-match-info';
    
    // Erstelle Infotext (Identifier und Attribute)
    const identifierDisplay = document.createElement('span');
    identifierDisplay.className = 'fuzzy-identifier';
    identifierDisplay.textContent = identifier;
    itemInfo.appendChild(identifierDisplay);
    
    // Trenner
    itemInfo.appendChild(document.createTextNode(' — '));
    
    // Attribute anzeigen
    const attrsDisplay = document.createElement('span');
    attrsDisplay.className = 'fuzzy-attrs';
    attrsDisplay.textContent = Array.from(attrs.entries())
      .map(([name, value]) => `${name}${value !== '1' ? `: ${value}` : ''}`)
      .join(', ');
    itemInfo.appendChild(attrsDisplay);
    
    matchItem.appendChild(itemInfo);
    
    // Combo-Container im Stil des Hauptfensters (eine einzelne Komponente)
    const comboContainer = document.createElement('div');
    comboContainer.className = 'fuzzy-match-combo';
    
    // Die eigentliche Combo-Box
    const combo = document.createElement('div');
    combo.className = 'combo';
    comboContainer.appendChild(combo);
    
    // Suchfeld innerhalb der Combo
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'combo-input';
    searchInput.placeholder = 'Klicken zum Auswählen...';
    searchInput.id = `fuzzy-search-${identifier}`;
    searchInput.setAttribute('data-identifier', identifier);
    
    // Standardwert: "Keine Übereinstimmung - als unzugeordnet markieren"
    const defaultText = 'Keine Übereinstimmung - als unzugeordnet markieren';
    searchInput.value = defaultText;
    
    // Default: keine Übereinstimmung (unmatched entry)
    unmatchedEntries.set(identifier, attrs);
    
    combo.appendChild(searchInput);
    
    // Dropdown-Liste mit verbesserter Sichtbarkeit
    const dropdownList = document.createElement('ul');
    dropdownList.className = 'combo-list';
    dropdownList.id = `fuzzy-list-${identifier}`;
    
    // Beginn: unsichtbar, aber bereit zum Anzeigen
    dropdownList.style.cssText = 'display: none; visibility: hidden; opacity: 0;';
    
    // Füge das Dropdown direkt an body an, damit es nicht von anderen Elementen verdeckt wird
    // Wir werden die Position später anpassen
    document.body.appendChild(dropdownList);
    
    // Speichere die Referenz auf das Dropdown im Combo-Element
    combo.dropdownElement = dropdownList;
    
    // Option "Keine Übereinstimmung" als erstes Item
    const noMatchItem = document.createElement('li');
    noMatchItem.dataset.value = 'none';
    noMatchItem.dataset.search = 'keine übereinstimmung unzugeordnet';
    noMatchItem.textContent = 'Keine Übereinstimmung - als unzugeordnet markieren';
    noMatchItem.classList.add('none-match-option');
    noMatchItem.addEventListener('click', (e) => {
      e.stopPropagation(); // Verhindern, dass das Klick-Event zu anderen Elementen propagiert
      searchInput.value = noMatchItem.textContent;
      dropdownList.style.cssText = 'display: none !important;';
      // "Keine Übereinstimmung" - zur unmatched Liste hinzufügen
      unmatchedEntries.set(identifier, attrs);
      
      // Fokus zurück auf Eingabefeld setzen
      searchInput.focus();
    });
    dropdownList.appendChild(noMatchItem);
    
    // Keine Trennlinie mehr zwischen "Keine Übereinstimmung" und den Vorschlägen
    
    // Speichere die Matches für die Suche
    const matchOptions = [];
    
    // Potentielle Matches als Liste hinzufügen
    for (const match of potentialMatches) {
      const option = document.createElement('li');
      option.dataset.value = match.id;
      
      // Ähnlichkeit als Prozentsatz anzeigen
      const similarityPercent = Math.round((1 - match.similarity) * 100);
      
      // HTML für formatiertes Item
      const nameHtml = `<strong>${match.label}</strong> (ID: ${match.id})`;
      const emailHtml = match.email ? ` - ${match.email}` : '';
      const similarityHtml = ` <span class="match-similarity">${similarityPercent}%</span>`;
      const matchedOnHtml = ` <span class="match-source">(${match.matchedOn})</span>`;
      
      option.innerHTML = nameHtml + emailHtml + similarityHtml + matchedOnHtml;
      
      // Such-Keywords hinzufügen
      let searchTerms = match.label + ' ' + match.id;
      if (match.email) searchTerms += ' ' + match.email;
      searchTerms += ' ' + match.matchedOn + ' ' + similarityPercent;
      option.dataset.search = searchTerms.toLowerCase();
      
      // Click-Handler mit verbessertem Verhalten
      option.addEventListener('click', (e) => {
        e.stopPropagation(); // Verhindere Bubbling
        
        // Setze den Wert im Suchfeld
        searchInput.value = match.label + (match.email ? ` (${match.email})` : ` (ID: ${match.id})`);
        
        // Dropdown vollständig ausblenden mit !important
        dropdownList.style.cssText = 'display: none !important; visibility: hidden !important;';
        
        // Aus unmatched entfernen, falls vorhanden
        unmatchedEntries.delete(identifier);
        
        // Attribute zuordnen
        const personId = match.id;
        if (!newPersonAttributes.has(personId)) {
          newPersonAttributes.set(personId, new Map());
        }
        for (const [attrName, attrValue] of attrs.entries()) {
          newPersonAttributes.get(personId).set(attrName, attrValue);
        }
        
        // Fokus zurück auf Eingabefeld setzen
        searchInput.focus();
      });
      
      dropdownList.appendChild(option);
      matchOptions.push({
        element: option,
        id: match.id,
        label: match.label,
        email: match.email || '',
        matchedOn: match.matchedOn,
        similarity: match.similarity,
        similarityPercent: similarityPercent,
        searchTerms: searchTerms.toLowerCase()
      });
    }
    
    // Variablen für die aktuelle Auswahl in der Combo-Box
    let activeItemIndex = -1;
    let visibleItems = [];
    
    // Hilfsfunktion, um das aktive Item zu setzen
    const setActiveItem = (index) => {
      // Alte Auswahl entfernen
      dropdownList.querySelectorAll('li').forEach(li => li.classList.remove('is-active'));
      
      // Gültige Indizes prüfen
      activeItemIndex = Math.max(-1, Math.min(index, visibleItems.length - 1));
      
      // Neue Auswahl setzen, wenn Index gültig
      if (activeItemIndex >= 0) {
        visibleItems[activeItemIndex].classList.add('is-active');
      }
    };
    
    // Hilfsfunktion zum Auswählen eines Items
    const chooseItem = (index) => {
      if (index >= 0 && index < visibleItems.length) {
        // Simuliere einen Klick auf das Element
        visibleItems[index].click();
      }
    };
    
    // Verbesserter Event-Listener für Tastatureingaben
    searchInput.addEventListener('keydown', (e) => {
      // Stell sicher, dass das Dropdown sichtbar ist
      const isVisible = window.getComputedStyle(dropdownList).display !== 'none';
      if (!isVisible && e.key !== 'ArrowDown') return;
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          // Falls das Dropdown nicht sichtbar ist, zeige es an
          if (!isVisible) {
            showDropdown();
            setActiveItem(0); // Aktiviere das erste Element
          } else {
            setActiveItem(activeItemIndex + 1);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveItem(Math.max(-1, activeItemIndex - 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (activeItemIndex >= 0) {
            chooseItem(activeItemIndex);
          } else if (searchInput.value.trim() !== '') {
            // Falls etwas eingegeben wurde, aber kein Item aktiviert ist
            // Erster sichtbarer Eintrag auswählen
            if (visibleItems.length > 0) {
              chooseItem(0);
            }
          }
          break;
        case 'Escape':
          e.preventDefault();
          // Vollständiges Ausblenden mit !important
          dropdownList.style.cssText = 'display: none !important; visibility: hidden !important;';
          break;
      }
    });
    
    // Event-Listeners für die Suche mit verbesserter Anzeige
    searchInput.addEventListener('input', function() {
      const searchTerm = this.value.toLowerCase();
      const dropdownId = `fuzzy-list-${this.getAttribute('data-identifier')}`;
      const dropdown = document.getElementById(dropdownId);
      
      // Dropdown anzeigen (mit showDropdown-Funktion)
      showDropdown();
      
      // Erster Eintrag (Keine Übereinstimmung)
      const noMatchLi = dropdown.children[0];
      
      // Alle sichtbaren Elemente zurücksetzen
      visibleItems = [];
      
      // "Keine Übereinstimmung" filtern
      if (!noMatchLi.dataset.search.includes(searchTerm)) {
        noMatchLi.style.display = 'none';
      } else {
        noMatchLi.style.display = '';
        visibleItems.push(noMatchLi);
      }
      
      // Variable für die Sichtbarkeit der Match-Optionen
      let matchOptionsVisible = false;
      
      // Alle anderen Optionen filtern
      for (const matchOption of matchOptions) {
        const listItem = matchOption.element;
        if (!searchTerm || matchOption.searchTerms.includes(searchTerm)) {
          listItem.style.display = '';
          matchOptionsVisible = true;
          visibleItems.push(listItem);
        } else {
          listItem.style.display = 'none';
        }
      }
      
      // Keine Trennlinie mehr zu verwalten
      
      // Falls keine Ergebnisse, Info anzeigen
      if (visibleItems.length === 0 && searchTerm) {
        const noResults = document.createElement('li');
        noResults.className = 'no-results';
        noResults.textContent = 'Keine Ergebnisse gefunden';
        noResults.style.fontStyle = 'italic';
        noResults.style.color = 'var(--text-muted)';
        noResults.style.textAlign = 'center';
        noResults.style.padding = '10px';
        dropdown.appendChild(noResults);
      } else {
        // Entferne no-results falls vorhanden
        const noResultsEl = dropdown.querySelector('.no-results');
        if (noResultsEl) noResultsEl.remove();
      }
      
      // Aktives Element zurücksetzen
      activeItemIndex = -1;
    });
    
    // Hilfsfunktion zum Positionieren des Dropdowns unter dem Eingabefeld
    const positionDropdown = () => {
      const rect = searchInput.getBoundingClientRect();
      dropdownList.style.position = 'fixed';
      dropdownList.style.top = (rect.bottom + window.scrollY) + 'px';
      dropdownList.style.left = (rect.left + window.scrollX) + 'px';
      
      // Setze die Breite exakt auf die Breite des Eingabefelds
      const inputWidth = rect.width;
      dropdownList.style.width = inputWidth + 'px';
      dropdownList.style.minWidth = inputWidth + 'px';
      dropdownList.style.maxWidth = inputWidth + 'px';
    };
    
    // Hilfsfunktion zum Anzeigen des Dropdowns
    const showDropdown = () => {
      // Positioniere das Dropdown korrekt
      positionDropdown();
      
      // Hole die aktuellen Maße des Eingabefelds
      const rect = searchInput.getBoundingClientRect();
      const inputWidth = rect.width;
      
      // Mache es sichtbar mit !important Eigenschaften
      dropdownList.style.cssText = `
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        position: fixed !important;
        z-index: 99999 !important;
        top: ${(rect.bottom + window.scrollY)}px !important;
        left: ${(rect.left + window.scrollX)}px !important;
        width: ${inputWidth}px !important;
        min-width: ${inputWidth}px !important;
        max-width: ${inputWidth}px !important;
      `;
      
      // Force DOM Reflow für bessere Sichtbarkeit
      void dropdownList.offsetWidth;
    };
    
    // Fokus-Handler für Suchfeld
    searchInput.addEventListener('focus', function() {
      // Zeige das Dropdown an
      showDropdown();
      
      // Selektiere den gesamten Text im Input
      this.select();
    });
    
    // Wenn das Fenster oder ein Element die Größe ändert, Dropdown neu positionieren
    window.addEventListener('resize', () => {
      if (dropdownList.style.display !== 'none') {
        positionDropdown();
      }
    });
    
    // Bei jedem Klick auf das Eingabefeld das Dropdown anzeigen
    searchInput.addEventListener('click', function() {
      showDropdown();
    });
    
    // Klick außerhalb schließt die Dropdown-Liste
    document.addEventListener('click', function(e) {
      if (!combo.contains(e.target) && e.target !== dropdownList && !dropdownList.contains(e.target)) {
        dropdownList.style.display = 'none';
      }
    });
    
    matchItem.appendChild(comboContainer);
    matchList.appendChild(matchItem);
  }
  
  content.appendChild(matchList);
  dialog.appendChild(content);
  
  // Footer mit Aktionsbuttons
  const footer = document.createElement('div');
  footer.className = 'fuzzy-match-footer';
  
  // "Bestätigen" Button
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'fuzzy-match-confirm-btn';
  confirmBtn.textContent = 'Bestätigen';
  confirmBtn.addEventListener('click', () => {
    // Prüfen, ob Einträge ohne Auswahl vorhanden sind und diese als "unmatched" markieren
    for (const [identifier, { attrs }] of fuzzyMatches.entries()) {
      const searchInput = document.getElementById(`fuzzy-search-${identifier}`);
      
      // Wenn kein Wert ausgewählt wurde, als unmatched markieren
      if (!searchInput || searchInput.value === '') {
        unmatchedEntries.set(identifier, attrs);
      }
    }
    
    // Unmatched exportieren
    if (unmatchedEntries.size > 0) {
      exportUnmatchedEntries(unmatchedEntries);
    }
    
    // Bereinige alle Dropdown-Elemente, die direkt an body angehängt wurden
    document.querySelectorAll('body > .combo-list').forEach(el => {
      el.remove();
    });
    
    finalizeFuzzyMatching(newPersonAttributes, attributeTypes);
    dialogContainer.remove();
  });
  footer.appendChild(confirmBtn);
  
  dialog.appendChild(footer);
  dialogContainer.appendChild(dialog);
  document.body.appendChild(dialogContainer);
}

/**
 * Schließt den Fuzzy-Match-Prozess ab und wendet die Attribute an
 */
function finalizeFuzzyMatching(newPersonAttributes, attributeTypes) {
  // Generiere Farben für neue Attributtypen
  const attributeNames = new Set();
  for (const [id, attrs] of newPersonAttributes.entries()) {
    for (const attrName of attrs.keys()) {
      attributeNames.add(attrName);
    }
  }
  
  // Erstelle Farben für neue Attributtypen
  for (const attrName of attributeNames) {
    if (!attributeTypes.has(attrName)) {
      // Generiere eine neue Farbe für diesen Attributtyp
      const hue = (hashCode(attrName) % 360);
      const color = `hsl(${hue}, 70%, 50%)`;
      attributeTypes.set(attrName, color);
      activeAttributes.add(attrName); // Neue Attribute standardmäßig aktivieren
    }
  }
  
  // Setze die neuen Attribute und aktualisiere
  personAttributes = newPersonAttributes;
  
  // UI aktualisieren
  buildAttributeLegend();
  updateAttributeStats();
  
  // Nur die Attribut-Kreise aktualisieren, ohne Layout-Neuberechnung
  if (currentSubgraph) updateAttributeCircles();
  
  // Benachrichtigung anzeigen
  showTemporaryNotification(`Attribute wurden erfolgreich zugeordnet und aktualisiert`);
}

/**
 * Exportiert nicht zugeordnete Einträge in eine separate Datei
 */
function exportUnmatchedEntries(unmatchedEntries) {
  if (unmatchedEntries.size === 0) return;
  
  // Erstelle den Export-Inhalt im CSV-Format
  let exportContent = 'Identifier,Attribute,Wert\n';
  
  for (const [identifier, attrs] of unmatchedEntries.entries()) {
    for (const [attrName, attrValue] of attrs.entries()) {
      // Vermeide Komma-Probleme durch Anführungszeichen
      const safeIdentifier = `"${identifier.replace(/"/g, '""')}"`;
      const safeAttrName = `"${attrName.replace(/"/g, '""')}"`;
      const safeAttrValue = `"${String(attrValue).replace(/"/g, '""')}"`;
      
      exportContent += `${safeIdentifier},${safeAttrName},${safeAttrValue}\n`;
    }
  }
  
  // Erstelle einen Download-Link
  const blob = new Blob([exportContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `unmatched_attributes_${timestamp}.csv`;
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  
  document.body.appendChild(link);
  link.click();
  
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
  
  showTemporaryNotification(`${unmatchedEntries.size} nicht zugeordnete Einträge exportiert als ${filename}`);
}

// Zustand für OE-Sichtbarkeit (init mit true = sichtbar)
let oesVisible = true;
let savedAllowedOrgs = new Set();

window.addEventListener("DOMContentLoaded", async () => {
  const envLoaded = await loadEnvConfig();
  let dataLoaded = false;

  // Nur versuchen automatisch zu laden, wenn ENV erfolgreich geladen wurde und eine Datenquelle konfiguriert ist [SF][REH]
  if (envLoaded && envConfig?.DATA_URL) {
    dataLoaded = await loadData();
    if (!dataLoaded) {
      showTemporaryNotification('Automatisches Laden der Daten ist fehlgeschlagen – bitte unten manuell eine Datei wählen.', 5000);
    }
  }
  // Initialisiere Chevron-Icons im HTML
  initializeChevronIcons();
  // Unterdrücke das Browser-Kontextmenü global, wir zeigen eigene Menüs
  try { document.addEventListener('contextmenu', (e) => e.preventDefault()); } catch {}
  const applyBtn = document.querySelector(BTN_APPLY_ID);
  if (applyBtn) applyBtn.addEventListener("click", applyFromUI);
  const input = document.querySelector(INPUT_COMBO_ID);
  const list = document.querySelector(LIST_COMBO_ID);
  // OE-Sichtbarkeits-Toggle
  const oeVisibilityBtn = document.getElementById('toggleOesVisibility');
  if (oeVisibilityBtn) {
    // Anfangs aktiv (OEs sichtbar)
    oesVisible = oeVisibilityBtn.classList.contains('active');
    
    oeVisibilityBtn.addEventListener('click', () => {
      // Toggle Button-Status
      oeVisibilityBtn.classList.toggle('active');
      oesVisible = oeVisibilityBtn.classList.contains('active');
      
      // Icon wechseln zwischen eye und eye-closed
      const icon = oeVisibilityBtn.querySelector('.codicon');
      if (icon) {
        if (oesVisible) {
          icon.classList.remove('codicon-eye-closed');
          icon.classList.add('codicon-eye');
        } else {
          icon.classList.remove('codicon-eye');
          icon.classList.add('codicon-eye-closed');
        }
      }
      
      if (oesVisible) {
        // OEs einblenden - gespeicherte Auswahl wiederherstellen
        if (savedAllowedOrgs.size > 0) {
          allowedOrgs = new Set(savedAllowedOrgs);
          savedAllowedOrgs = new Set();
        }
      } else {
        // OEs ausblenden - aktuelle Auswahl speichern
        savedAllowedOrgs = new Set(allowedOrgs);
        allowedOrgs = new Set();
      }
      
      // NUR den Graph aktualisieren ohne UI-Elemente zu beeinflussen
      refreshClusters();
    });
  }
  
  // Alle Attribut-Kategorien expandieren/kollabieren (Toggle)
  const expandAllAttributesBtn = document.getElementById('expandAllAttributes');
  if (expandAllAttributesBtn) {
    expandAllAttributesBtn.addEventListener('click', () => {
      const attributeContainer = document.getElementById('attributeContainer');
      const chevron = document.querySelector('[data-target="attributeContainer"]');
      const attributeLegend = document.getElementById('attributeLegend');
      
      // Prüfe ob aktuell alle Kategorien expandiert sind
      const allCategories = Array.from(attributeTypes.keys()).map(k => k.split('::')[0]).filter((v, i, a) => a.indexOf(v) === i);
      const allExpanded = allCategories.every(cat => !collapsedCategories.has(cat));
      
      if (allExpanded) {
        // KOLLABIEREN: Alle Kategorien kollabieren
        allCategories.forEach(cat => collapsedCategories.add(cat));
        
        // Legende neu aufbauen
        buildAttributeLegend();
        
        setTimeout(() => {
          if (attributeLegend) {
            // Alle Listen ausblenden
            const allLists = attributeLegend.querySelectorAll('ul ul');
            allLists.forEach(ul => {
              ul.style.display = 'none';
            });
            
            // Alle Chevrons auf collapsed setzen
            const categoryChevrons = attributeLegend.querySelectorAll('.legend-tree-chevron');
            categoryChevrons.forEach(chev => {
              chev.classList.remove('expanded');
              chev.classList.add('collapsed');
            });
          }
        }, 50);
      } else {
        // EXPANDIEREN: Alle Kategorien expandieren
        // 1. Legende selbst expandieren (falls kollabiert)
        if (attributeContainer && chevron) {
          attributeContainer.classList.remove('collapsed');
          chevron.classList.remove('collapsed');
          chevron.classList.add('expanded');
        }
        
        // 2. Alle Kategorien aus collapsedCategories entfernen
        collapsedCategories.clear();
        
        // 3. Legende neu aufbauen
        buildAttributeLegend();
        
        // 4. Alle Listen und Items einblenden
        setTimeout(() => {
          if (attributeLegend) {
            const allLists = attributeLegend.querySelectorAll('ul');
            allLists.forEach(ul => {
              ul.style.display = 'block';
            });
            
            const categoryChevrons = attributeLegend.querySelectorAll('.legend-tree-chevron');
            categoryChevrons.forEach(chev => {
              chev.classList.remove('collapsed');
              chev.classList.add('expanded');
            });
          }
        }, 50);
      }
    });
  }
  
  // Attribute-Sichtbarkeit-Toggle (nur Graph-Sichtbarkeit, keine Selektion ändern)
  const attributesVisibilityBtn = document.getElementById('toggleAttributesVisibility');
  if (attributesVisibilityBtn) {
    // Anfangs aktiv (Attribute sichtbar)
    if (envConfig?.DEFAULT_ATTRIBUTES != null) {
      attributesVisible = !!envConfig.DEFAULT_ATTRIBUTES;
      if (!attributesVisible) attributesVisibilityBtn.classList.remove('active');
    } else {
      attributesVisible = attributesVisibilityBtn.classList.contains('active');
    }
    
    attributesVisibilityBtn.addEventListener('click', () => {
      // Toggle Button-Status
      attributesVisibilityBtn.classList.toggle('active');
      attributesVisible = attributesVisibilityBtn.classList.contains('active');
      
      // Icon wechseln zwischen eye und eye-closed
      const icon = attributesVisibilityBtn.querySelector('.codicon');
      if (icon) {
        if (attributesVisible) {
          icon.classList.remove('codicon-eye-closed');
          icon.classList.add('codicon-eye');
        } else {
          icon.classList.remove('codicon-eye');
          icon.classList.add('codicon-eye-closed');
        }
      }
      
      // NUR die Graph-Sichtbarkeit steuern, KEINE Änderung an:
      // - activeAttributes (bleiben wie sie sind)
      // - hiddenCategories (bleiben wie sie sind)
      // - Legende (bleibt wie sie ist)
      
      // Nur Attribut-Kreise im Graph aktualisieren
      updateAttributeCircles();
      
      // Simulation kurz reaktivieren um Links neu zu positionieren [SF]
      if (currentSimulation) {
        currentSimulation.alpha(0.1).restart();
        // Nach kurzer Zeit wieder stoppen
        setTimeout(() => {
          if (currentSimulation) currentSimulation.alpha(0);
        }, 100);
      }
    });
  }
  
  // Toggle-All für OEs
  const toggleAllOesBtn = document.getElementById('toggleAllOes');
  if (toggleAllOesBtn) {
    toggleAllOesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Prüfe ob mindestens eine OE ausgewählt ist
      const hasAnySelected = allowedOrgs.size > 0;
      
      if (hasAnySelected) {
        // Mindestens eine OE ist ausgewählt -> Alle abwählen
        allowedOrgs.clear();
        showTemporaryNotification('Alle OEs abgewählt');
      } else {
        // Keine OE ist ausgewählt -> Alle auswählen
        raw.orgs.forEach(o => {
          if (o && o.id) allowedOrgs.add(String(o.id));
        });
        showTemporaryNotification('Alle OEs ausgewählt');
      }
      
      // Graph und Legende aktualisieren
      syncGraphAndLegendColors();
    });
  }
  
  // Toggle-All für Attribute
  const toggleAllAttributesBtn = document.getElementById('toggleAllAttributes');
  if (toggleAllAttributesBtn) {
    toggleAllAttributesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Prüfe ob mindestens ein Attribut ausgewählt ist
      const hasAnySelected = activeAttributes.size > 0;
      
      if (hasAnySelected) {
        // Mindestens ein Attribut ist ausgewählt -> Alle abwählen
        activeAttributes.clear();
        showTemporaryNotification('Alle Attribute abgewählt');
      } else {
        // Kein Attribut ist ausgewählt -> Alle auswählen
        attributeTypes.forEach((color, key) => {
          activeAttributes.add(key);
        });
        showTemporaryNotification('Alle Attribute ausgewählt');
      }
      
      // Legende und Graph aktualisieren
      buildAttributeLegend();
      updateAttributeCircles();
      updateAttributeStats();
    });
  }
  
  // OE-Filter initialisieren
  const oeFilter = document.getElementById('oeFilter');
  if (oeFilter) {
    oeFilter.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      const legend = document.querySelector('#legend');
      if (!legend) return;
      
      const items = legend.querySelectorAll('.legend-list li');
      let anyVisible = false;
      
      items.forEach(li => {
        const chip = li.querySelector('.legend-label-chip');
        const label = chip?.textContent?.toLowerCase() || '';
        const match = label.includes(term);
        
        // Setze Sichtbarkeit basierend auf Filter
        li.style.display = term === '' || match ? '' : 'none';
        
        // Merke, ob mindestens ein Element sichtbar ist
        if (li.style.display !== 'none') {
          anyVisible = true;
        }
        
        // Wenn der übergeordnete Knoten sichtbar ist, mache alle Kinder sichtbar
        if (match && term !== '') {
          // Mache alle Eltern-ULs sichtbar
          let parent = li.parentElement;
          while (parent) {
            if (parent.tagName === 'UL') {
              parent.style.display = '';
              const parentLi = parent.parentElement;
              if (parentLi && parentLi.tagName === 'LI') {
                parentLi.style.display = '';
              }
            }
            parent = parent.parentElement;
          }
          
          // Mache alle Kind-ULs sichtbar und expandiere sie
          const childUl = li.querySelector('ul');
          if (childUl) {
            childUl.style.display = '';
            const twisty = li.querySelector('.twisty');
            if (twisty && twisty.textContent === '▸') {
              twisty.textContent = '▾';
            }
          }
        }
      });
      
      // Zeige Meldung, wenn keine Treffer
      let noMatchesMsg = legend.querySelector('.no-matches-message');
      if (!anyVisible && term !== '') {
        if (!noMatchesMsg) {
          noMatchesMsg = document.createElement('div');
          noMatchesMsg.className = 'no-matches-message';
          noMatchesMsg.textContent = 'Keine OEs gefunden';
          noMatchesMsg.style.padding = '8px';
          noMatchesMsg.style.fontStyle = 'italic';
          noMatchesMsg.style.color = '#666';
          legend.appendChild(noMatchesMsg);
        }
      } else if (noMatchesMsg) {
        noMatchesMsg.remove();
      }
    });
  }
  
  const mgmt = document.querySelector('#toggleManagement');
  if (mgmt) {
    if (envConfig?.DEFAULT_MANAGEMENT != null) {
      managementEnabled = !!envConfig.DEFAULT_MANAGEMENT;
      if (!managementEnabled) mgmt.classList.remove('active');
    } else {
      managementEnabled = mgmt.classList.contains('active');
    }
    mgmt.addEventListener('click', () => {
      mgmt.classList.toggle('active');
      managementEnabled = mgmt.classList.contains('active');
      applyFromUI();
    });
  }
  // Auto-fit functionality has been removed
  
  function updateLinkLabelVisibility() {
    const display = (debugMode && labelsVisible) ? 'block' : 'none';
    d3.select('#graph').selectAll('.link-label')
      .style('display', display);
  }

  const lbls = document.querySelector('#toggleLabels');
  if (lbls) {
    if (envConfig?.DEFAULT_LABELS != null) {
      labelsVisible = !!envConfig.DEFAULT_LABELS;
      if (!labelsVisible) lbls.classList.remove('active');
    } else {
      labelsVisible = lbls.classList.contains('active');
    }
    lbls.addEventListener('click', () => {
      lbls.classList.toggle('active');
      labelsVisible = lbls.classList.contains('active');
      const svg = document.querySelector('#graph');
      if (svg) svg.classList.toggle('labels-hidden', !labelsVisible);
      
      // Link-Labels auch aktualisieren (nur sichtbar wenn Debug UND Labels aktiv) [SF]
      updateLinkLabelVisibility();
    });
  }
  if (input && list) {
    input.addEventListener('input', () => {
      currentSelectedId = null;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => populateCombo(input.value), 150);
    });
    
    input.addEventListener('keydown', (e) => {
      const max = filteredItems.length - 1;
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); setActive(Math.min(max, activeIndex + 1)); break;
        case 'ArrowUp': e.preventDefault(); setActive(Math.max(-1, activeIndex - 1)); break;
        case 'Enter': {
          const addMode = !!(e.shiftKey);
          // Wenn kein aktives Element, wähle den ersten Treffer automatisch
          const idx = activeIndex >= 0 ? activeIndex : (filteredItems.length > 0 ? 0 : -1);
          try { if (debugMode) console.log('[ui] key Enter', { addMode, activeIndex, chosenIdx: idx, items: filteredItems.length }); } catch {}
          if (idx >= 0) chooseItem(idx, addMode);
          applyFromUI();
          break;
        }
        case 'Escape': list.hidden = true; break;
      }
    });
    
    input.addEventListener('change', applyFromUI);
    input.addEventListener('focus', () => { if (filteredItems.length) list.hidden = false; });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 0));
  }
  const fitBtn = document.querySelector('#fit');
  if (fitBtn) {
    fitBtn.addEventListener('click', fitToViewport);
  }
  
  const debugBtn = document.querySelector('#debugBtn');
  if (debugBtn) {
    if (envConfig?.DEFAULT_DEBUG != null) {
      debugMode = !!envConfig.DEFAULT_DEBUG;
      if (debugMode) debugBtn.classList.add('active');
    } else {
      debugMode = debugBtn.classList.contains('active');
    }
    debugBtn.addEventListener('click', () => {
      debugBtn.classList.toggle('active');
      debugMode = debugBtn.classList.contains('active');
      
      // Aktualisiere Labels und Link-Labels sofort [SF]
      const svg = d3.select('#graph');
      
      // Node-Labels aktualisieren
      svg.selectAll('.node text.label').text(d => {
        return debugMode 
          ? `(${Math.round(d.x || 0)}, ${Math.round(d.y || 0)})`
          : (d.label ?? d.id);
      });
      
      // Link-Labels ein/ausblenden (nur wenn auch Labels sichtbar)
      updateLinkLabelVisibility();
    });
  }
  // Auto-apply on depth change and direction change
  const depthEl = document.querySelector(INPUT_DEPTH_ID);
  if (depthEl) {
    if (envConfig?.DEFAULT_DEPTH != null) {
      depthEl.value = envConfig.DEFAULT_DEPTH;
    }
    depthEl.addEventListener('change', applyFromUI);
    depthEl.addEventListener('input', applyFromUI);
  }
  // Direction Split Component
  const upHalf = document.querySelector('#directionToggle .direction-up');
  const downHalf = document.querySelector('#directionToggle .direction-down');
  let currentDir = 'both';
  
  // Helper function to get current direction state
  const getCurrentDirection = () => {
    if (!upHalf || !downHalf) return 'both';
    const upActive = upHalf.classList.contains('active');
    const downActive = downHalf.classList.contains('active');
    if (upActive && downActive) return 'both';
    if (upActive) return 'up';
    if (downActive) return 'down';
    return 'both';
  };
  
  // Initialize direction from config
  if (envConfig?.DEFAULT_DIR) {
    currentDir = envConfig.DEFAULT_DIR;
    if (upHalf && downHalf) {
      if (currentDir === 'both') {
        upHalf.classList.add('active');
        downHalf.classList.add('active');
      } else if (currentDir === 'up') {
        upHalf.classList.add('active');
        downHalf.classList.remove('active');
      } else if (currentDir === 'down') {
        upHalf.classList.remove('active');
        downHalf.classList.add('active');
      }
    }
  }
  
  // Direction half click handlers with constraint: at least one must be active
  if (upHalf && downHalf) {
    upHalf.addEventListener('click', () => {
      const upActive = upHalf.classList.contains('active');
      const downActive = downHalf.classList.contains('active');
      
      if (upActive && !downActive) {
        // Only up active - switch to only down
        upHalf.classList.remove('active');
        downHalf.classList.add('active');
      } else if (upActive && downActive) {
        // Both active - deactivate up
        upHalf.classList.remove('active');
      } else {
        // Up inactive - activate it
        upHalf.classList.add('active');
      }
      
      currentDir = getCurrentDirection();
      applyFromUI();
    });
    
    downHalf.addEventListener('click', () => {
      const upActive = upHalf.classList.contains('active');
      const downActive = downHalf.classList.contains('active');
      
      if (downActive && !upActive) {
        // Only down active - switch to only up
        downHalf.classList.remove('active');
        upHalf.classList.add('active');
      } else if (upActive && downActive) {
        // Both active - deactivate down
        downHalf.classList.remove('active');
      } else {
        // Down inactive - activate it
        downHalf.classList.add('active');
      }
      
      currentDir = getCurrentDirection();
      applyFromUI();
    });
  }
  
  // Hierarchy toggle button
  const hier = document.querySelector('#toggleHierarchy');
  if (hier) {
    if (envConfig?.DEFAULT_HIERARCHY != null) {
      const hierEnabled = !!envConfig.DEFAULT_HIERARCHY;
      if (!hierEnabled) hier.classList.remove('active');
      currentLayoutMode = hierEnabled ? 'hierarchy' : 'force';
    } else {
      currentLayoutMode = hier.classList.contains('active') ? 'hierarchy' : 'force';
    }
    
    hier.addEventListener('click', () => {
      hier.classList.toggle('active');
      currentLayoutMode = hier.classList.contains('active') ? 'hierarchy' : 'force';
      if (currentSimulation) switchLayout(currentLayoutMode, currentSimulation);
    });
  }

  // Attribute-Funktionalität einbinden
  const loadAttrBtn = document.getElementById('loadAttributes');
  const attrFileInput = document.getElementById('attributeFileInput');
  if (loadAttrBtn && attrFileInput) {
    // Klick auf Button löst File-Dialog aus
    loadAttrBtn.addEventListener('click', (e) => {
      // Verhindere Bubbling zum Header, damit dieser nicht kollabiert wird
      e.preventDefault();
      e.stopPropagation();
      attrFileInput.click();
    });
    
    // Datei-Input-Änderung verarbeiten
    attrFileInput.addEventListener('change', async () => {
      if (attrFileInput.files && attrFileInput.files[0]) {
        const file = attrFileInput.files[0];
        await loadAttributesFromFile(file);
        attrFileInput.value = ''; // Reset für wiederholtes Laden
      }
    });
    
    // Initialen leeren Attribut-Legend erzeugen
    buildAttributeLegend();
    updateAttributeStats();
  }
  
  // Kollabierbare Legenden einrichten
  initializeCollapsibleLegends();

  // Footer: click status to open a file dialog and load JSON dataset
  const statusEl = document.querySelector(STATUS_ID);
  if (statusEl) {
    statusEl.addEventListener('click', async () => {
      const picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = 'application/json,.json';
      picker.style.display = 'none';
      document.body.appendChild(picker);
      picker.addEventListener('change', async () => {
        try {
          const file = picker.files && picker.files[0];
          if (!file) return;
          const text = await file.text();
          const data = JSON.parse(text);
          applyLoadedDataObject(data, file.name);
          populateCombo("");
          try { applyFromUI(); } catch(_) { updateFooterStats(null); }
        } catch(_) {
          setStatus('Ungültige Datei');
        } finally {
          picker.remove();
        }
      });
      picker.click();
    });
  }

  // Apply initial start node(s) from env.json if provided
  if (envConfig && envConfig.DEFAULT_START_ID != null) {
    const def = envConfig.DEFAULT_START_ID;
    if (Array.isArray(def)) {
      const requested = def.map(v => String(v));
      const roots = requested.filter(id => byId.has(id));
      const invalid = requested.filter(id => !byId.has(id));
      if (roots.length > 0) {
        selectedRootIds = roots.slice();
        currentSelectedId = roots[0];
        lastSingleRootId = roots[0];
        try { applyFromUI(); } catch(_) {}
        // Nach Initial-Apply das Suchfeld leeren und Dropdown schließen
        if (input && list) {
          input.value = "";
          list.innerHTML = "";
          list.hidden = true;
        }
      }
      if (invalid.length > 0) {
        // Zeige Info über ungültige IDs
        showTemporaryNotification(`Ungültige DEFAULT_START_ID Einträge ignoriert: ${invalid.join(', ')}`);
      }
    } else {
      const sid = String(def);
      const startNode = byId.get(sid);
      if (startNode) {
        currentSelectedId = String(startNode.id);
        lastSingleRootId = String(startNode.id);
        try { applyFromUI(); } catch(_) {}
        // Nach Initial-Apply das Suchfeld leeren und Dropdown schließen
        if (input && list) {
          input.value = "";
          list.innerHTML = "";
          list.hidden = true;
        }
      } else {
        showTemporaryNotification(`DEFAULT_START_ID nicht gefunden: ${sid}`);
      }
    }
  }
  // Apply default hidden roots from env
  if (Array.isArray(envConfig?.DEFAULT_HIDDEN_ROOTS) && envConfig.DEFAULT_HIDDEN_ROOTS.length > 0) {
    hiddenByRoot = new Map();
    for (const ridRaw of envConfig.DEFAULT_HIDDEN_ROOTS) {
      const rid = String(ridRaw);
      if (byId.has(rid)) hiddenByRoot.set(rid, collectReportSubtree(rid));
    }
    recomputeHiddenNodes();
    buildHiddenLegend();
    try { applyFromUI(); } catch(_) {}
  }
  // hideSubtree-Button wurde aus der Toolbar entfernt
  // Die hideSubtreeFromRoot-Funktion bleibt für das Kontextmenü erhalten
  buildHiddenLegend();
  
  // Initialisiere Export-Funktionalität
  if (typeof initializeExport === 'function') {
    initializeExport();
  }
});

function fitToViewport() {
  const svgEl = document.querySelector(SVG_ID);
  if (!svgEl || !zoomBehavior) return;
  const g = svgEl.querySelector('g');
  if (!g) return;
  const bbox = g.getBBox();
  if (!isFinite(bbox.width) || !isFinite(bbox.height) || bbox.width === 0 || bbox.height === 0) return;
  // Use SVG viewBox units for stable centering
  const pad = 20; // in viewBox units
  const availW = Math.max(1, WIDTH - pad * 2);
  const availH = Math.max(1, HEIGHT - pad * 2);
  const scale = Math.min(availW / bbox.width, availH / bbox.height);
  const tx = (WIDTH - bbox.width * scale) / 2 - bbox.x * scale;
  const ty = (HEIGHT - bbox.height * scale) / 2 - bbox.y * scale;
  const svg = d3.select(svgEl);
  const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
  svg.transition().duration(300).call(zoomBehavior.transform, t);
}
// Nach jeder allowedOrgs-Änderung aufrufen
function syncGraphAndLegendColors() {
  const legend = document.querySelector('#legend');
  if (legend) {
    updateLegendRowColors(legend);
    updateLegendChips(legend);
  }
  refreshClusters();
  updateFooterStats(currentSubgraph);
}

// ========== HIERARCHY LAYOUT FUNCTIONS ==========
/**
 * Berechnet Hierarchieebenen für Knoten
 */
function computeHierarchyLevels(nodes, links) {
  const levels = new Map();
  const nodeSet = new Set(nodes.map(n => String(n.id)));
  
  // Build parent map (manager relationships for persons)
  const managerOf = new Map(); // personId -> managerId
  for (const l of links) {
    const s = idOf(l.source), t = idOf(l.target);
    const sNode = byId.get(s), tNode = byId.get(t);
    // Manager -> Employee link (source manages target)
    if (sNode?.type === 'person' && tNode?.type === 'person' && nodeSet.has(s) && nodeSet.has(t)) {
      managerOf.set(t, s);
    }
  }
  
  // Find roots (persons without managers in this subgraph)
  const roots = nodes.filter(n => n.type === 'person' && !managerOf.has(String(n.id)));
  
  // BFS to assign levels
  const queue = roots.map(r => ({ id: String(r.id), level: 0 }));
  roots.forEach(r => levels.set(String(r.id), 0));
  
  while (queue.length > 0) {
    const { id, level } = queue.shift();
    
    // Find all direct reports
    for (const [empId, mgrId] of managerOf.entries()) {
      if (mgrId === id && !levels.has(empId)) {
        levels.set(empId, level + 1);
        queue.push({ id: empId, level: level + 1 });
      }
    }
  }
  
  // Assign level to org nodes (not used for positioning, but for consistency)
  nodes.forEach(n => {
    if (n.type === 'org' && !levels.has(String(n.id))) {
      levels.set(String(n.id), -1); // Orgs get special level
    }
  });
  
  return levels;
}

/**
 * Konfiguriert das Graph-Layout
 */
function configureLayout(nodes, links, simulation, mode) {
  // Spezifische Parameter für Hierarchie-Layout
  const LEVEL_HEIGHT = 200; // Vertikaler Abstand zwischen Hierarchie-Ebenen
  const LEVEL_FORCE_STRENGTH = 0.5; // Stärke der vertikalen Anziehungskraft
  
  // Manager-Parent-Map aufbauen für radiales Layout
  const pMap = new Map();
  for (const l of links) {
    const s = idOf(l.source), t = idOf(l.target);
    const sNode = byId.get(s), tNode = byId.get(t);
    if (sNode?.type === 'person' && tNode?.type === 'person') {
      pMap.set(t, s);
    }
  }
  parentOf = pMap;
  
  // IMMER Hierarchie-Ebenen berechnen (für Farb-Gradienten) [SF]
  hierarchyLevels = computeHierarchyLevels(nodes, links);
  
  // Levels den Node-Objekten zuweisen damit getNodeFillByLevel() funktioniert [SF]
  nodes.forEach(n => {
    const nodeId = String(n.id);
    n.level = hierarchyLevels.get(nodeId) ?? 0;
  });
  
  // Spezifische Konfiguration je nach Modus
  if (mode === 'hierarchy') {
    
    // Ziel-Y-Position für jede Ebene berechnen [SF]
    const sortedLevels = Array.from(new Set(Array.from(hierarchyLevels.values()))).sort((a, b) => a - b);
    const levelToY = new Map();
    sortedLevels.forEach((level, idx) => {
      levelToY.set(level, 100 + idx * LEVEL_HEIGHT);
    });
    
    // Knoten vorpositionieren für besseren Start [SF]
    nodes.forEach(n => {
      if (!Number.isFinite(n.x)) {
        n.x = WIDTH/2 + (Math.random() - 0.5) * 100;
      }
      if (!Number.isFinite(n.y)) {
        const level = hierarchyLevels.get(String(n.id)) ?? 0;
        n.y = levelToY.get(level) ?? HEIGHT/2;
      }
    });
    
    // Hierarchie-spezifische Ebenen-Force hinzufügen
    simulation.force("level", d3.forceY(d => {
      const level = hierarchyLevels.get(String(d.id)) ?? 0;
      return levelToY.get(level) ?? HEIGHT / 2;
    }).strength(LEVEL_FORCE_STRENGTH));
    simulation.force("clusterX", null);
    simulation.force("clusterY", null);
  } else {
    // Im Force-Modus die level-Force entfernen
    simulation.force("level", null);

    const nodeIdSet = new Set(nodes.map(n => String(n.id)));
    const memberships = new Map();
    for (const l of raw.links) {
      const s = idOf(l.source), t = idOf(l.target);
      if (!nodeIdSet.has(s)) continue;
      if (byId.get(s)?.type !== 'person') continue;
      if (byId.get(t)?.type !== 'org') continue;
      if (!allowedOrgs.has(t)) continue;
      if (!memberships.has(s)) memberships.set(s, new Set());
      memberships.get(s).add(t);
    }
    const orgIds = new Set();
    for (const set of memberships.values()) { for (const oid of set) orgIds.add(oid); }
    const orgList = Array.from(orgIds).sort((a,b) => (orgDepth(a) - orgDepth(b)) || String(a).localeCompare(String(b)));
    const cx = WIDTH / 2, cy = HEIGHT / 2;
    const CLUSTER_RING_RADIUS = Math.min(WIDTH, HEIGHT) * 0.35;
    const centers = new Map();
    for (let i = 0; i < Math.max(1, orgList.length); i++) {
      const angle = (2 * Math.PI * i) / Math.max(1, orgList.length);
      const oid = orgList[i] ?? null;
      if (oid) centers.set(oid, { x: cx + Math.cos(angle) * CLUSTER_RING_RADIUS, y: cy + Math.sin(angle) * CLUSTER_RING_RADIUS });
    }
    const primaryOf = new Map();
    for (const [pid, set] of memberships.entries()) {
      let best = null, bestDepth = -1;
      for (const oid of set) { const d = orgDepth(oid); if (d > bestDepth) { bestDepth = d; best = oid; } }
      primaryOf.set(pid, best);
    }
    const JITTER = 30;
    nodes.forEach(n => {
      const pid = String(n.id);
      const oid = primaryOf.get(pid);
      const c = (oid && centers.get(oid)) || { x: cx, y: cy };
      if (!Number.isFinite(n.x)) n.x = c.x + (Math.random() - 0.5) * JITTER;
      if (!Number.isFinite(n.y)) n.y = c.y + (Math.random() - 0.5) * JITTER;
    });
    const CLUSTER_FORCE_STRENGTH = 0.08;
    simulation
      .force("clusterX", d3.forceX(d => {
        const pid = String(d.id);
        const oid = primaryOf.get(pid);
        const c = (oid && centers.get(oid)) || { x: cx, y: cy };
        return c.x;
      }).strength(CLUSTER_FORCE_STRENGTH))
      .force("clusterY", d3.forceY(d => {
        const pid = String(d.id);
        const oid = primaryOf.get(pid);
        const c = (oid && centers.get(oid)) || { x: cx, y: cy };
        return c.y;
      }).strength(CLUSTER_FORCE_STRENGTH));
  }
  
  // Simulation neustarten [SF]
  simulation.alpha(1).restart();
}

/**
 * Wechselt zwischen Layout-Modi
 */
function switchLayout(mode, simulation) {
  currentLayoutMode = mode;
  
  const nodes = simulation.nodes();
  const links = currentSubgraph?.links || [];
  
  // Konfiguriere Layout basierend auf Modus [DRY]
  configureLayout(nodes, links, simulation, mode);
  
  setTimeout(() => refreshClusters(), 100);
}

/**
 * Initialisiert die kollabierbaren Legendenbereiche
 */
function initializeCollapsibleLegends() {
  // Speichern des Klappzustands im localStorage, wenn verfügbar
  const saveCollapseState = (id, isCollapsed) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`orggraph_collapsed_${id}`, isCollapsed ? '1' : '0');
      }
    } catch (e) {
      console.warn('Konnte Zustand nicht speichern:', e);
    }
  };
  
  // Laden des Klappzustands aus localStorage, wenn verfügbar
  const loadCollapseState = (id) => {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(`orggraph_collapsed_${id}`);
        return saved === '1';
      }
    } catch (e) {
      console.warn('Konnte Zustand nicht laden:', e);
    }
    return false; // Standardmäßig aufgeklappt
  };
  
  // Alle Schaltflächen und Inhalte initialisieren (alte und neue Buttons)
  const buttons = document.querySelectorAll('.collapse-btn, .legend-chevron');
  buttons.forEach(btn => {
    const targetId = btn.dataset.target;
    const target = document.getElementById(targetId);
    if (!target) return;
    
    const isChevron = btn.classList.contains('legend-chevron');
    
    // Initialen Zustand aus localStorage laden
    const isInitiallyCollapsed = loadCollapseState(targetId);
    if (isInitiallyCollapsed) {
      target.classList.add('collapsed');
      if (isChevron) {
        btn.classList.remove('expanded');
        btn.classList.add('collapsed');
      } else {
        btn.classList.add('collapsed');
      }
    } else {
      if (isChevron) {
        btn.classList.remove('collapsed');
        btn.classList.add('expanded');
      }
    }
    
    // Klick-Event für den Button
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = target.classList.toggle('collapsed');
      
      if (isChevron) {
        if (isCollapsed) {
          btn.classList.remove('expanded');
          btn.classList.add('collapsed');
        } else {
          btn.classList.remove('collapsed');
          btn.classList.add('expanded');
        }
      } else {
        btn.classList.toggle('collapsed');
      }
      
      saveCollapseState(targetId, isCollapsed);
    });
    
    // Klick-Event für die Überschrift (nur für Chevron-Buttons)
    if (isChevron) {
      const header = btn.closest('.legend-header');
      if (header) {
        header.addEventListener('click', (e) => {
          // Prüfe, ob auf ein Element geklickt wurde, das vom Header-Klick ausgenommen werden soll
          let shouldIgnore = false;
          let element = e.target;

          // Prüfe, ob das Zielelement oder einer seiner Eltern das data-ignore-header-click Attribut hat
          while (element && element !== header) {
            if (element.hasAttribute && element.hasAttribute('data-ignore-header-click')) {
              shouldIgnore = true;
              break;
            }
            element = element.parentElement;
          }
          
          // Wenn der Klick nicht auf den collapse-button selbst war und nicht auf ein zu ignorierendes Element
          if (!shouldIgnore && e.target !== btn) {
            const isCollapsed = target.classList.toggle('collapsed');
            
            if (isCollapsed) {
              btn.classList.remove('expanded');
              btn.classList.add('collapsed');
            } else {
              btn.classList.remove('collapsed');
              btn.classList.add('expanded');
            }
            
            saveCollapseState(targetId, isCollapsed);
          }
        });
      }
    }
  });
  
  // Ausschiebbares Suchfeld-Verhalten
  const oeFilter = document.getElementById('oeFilter');
  const oeFilterBtn = document.getElementById('oeFilterBtn');
  if (oeFilter && oeFilterBtn) {
    // Überwache Wertänderungen für has-value Klasse
    const updateSearchFieldState = () => {
      if (oeFilter.value.trim()) {
        oeFilter.classList.add('has-value');
        // Filter-Icon auch ohne Hover sichtbar wenn Wert vorhanden
        oeFilterBtn.classList.add('visible');
      } else {
        oeFilter.classList.remove('has-value');
        // Filter-Icon nur bei Hover sichtbar wenn leer
        oeFilterBtn.classList.remove('visible');
      }
    };
    
    oeFilter.addEventListener('input', updateSearchFieldState);
    oeFilter.addEventListener('focus', updateSearchFieldState);
    oeFilter.addEventListener('blur', updateSearchFieldState);
    
    // Click auf Filter-Icon: Feld leeren und schließen wenn gefüllt
    oeFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (oeFilter.value.trim()) {
        oeFilter.value = '';
        // Trigger input event für Filter-Reset
        oeFilter.dispatchEvent(new Event('input'));
        updateSearchFieldState();
        // Blur um Feld zu schließen
        oeFilter.blur();
      }
    });
    
    // Initialer Zustand
    updateSearchFieldState();
  }
  
  // ========== DEPTH CONTROL ==========
  const depthControl = document.getElementById('depthControl');
  const depthInput = document.getElementById('depth');
  const depthValueDisplay = depthControl?.querySelector('.depth-value');
  const depthUpBtn = depthControl?.querySelector('.depth-up');
  const depthDownBtn = depthControl?.querySelector('.depth-down');
  
  if (depthControl && depthInput && depthValueDisplay) {
    const MIN_DEPTH = 0;
    const MAX_DEPTH = 6;
    
    // Funktion zum Aktualisieren der Anzeige
    const updateDepthDisplay = (value) => {
      depthValueDisplay.textContent = value;
      depthInput.value = value;
      
      // Animation triggern
      depthControl.classList.add('changed');
      setTimeout(() => depthControl.classList.remove('changed'), 300);
      
      // Tooltip aktualisieren
      const plural = value === 1 ? 'Ebene' : 'Ebenen';
      depthControl.title = `Hierarchietiefe: ${value} ${plural}`;
    };
    
    // Up-Button: Tiefe erhöhen
    if (depthUpBtn) {
      depthUpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const current = parseInt(depthInput.value) || 0;
        if (current < MAX_DEPTH) {
          updateDepthDisplay(current + 1);
          // Trigger change event für bestehende Handler
          depthInput.dispatchEvent(new Event('change'));
        }
      });
    }
    
    // Down-Button: Tiefe verringern
    if (depthDownBtn) {
      depthDownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const current = parseInt(depthInput.value) || 0;
        if (current > MIN_DEPTH) {
          updateDepthDisplay(current - 1);
          // Trigger change event für bestehende Handler
          depthInput.dispatchEvent(new Event('change'));
        }
      });
    }
    
    // Synchronisiere Anzeige mit Input-Feld (falls extern geändert)
    depthInput.addEventListener('change', () => {
      const value = parseInt(depthInput.value) || 0;
      const clamped = Math.max(MIN_DEPTH, Math.min(MAX_DEPTH, value));
      depthValueDisplay.textContent = clamped;
    });
    
    // Initiale Anzeige setzen
    const initialValue = parseInt(depthInput.value, 10);
    const displayValue = isNaN(initialValue) ? 2 : initialValue;
    depthValueDisplay.textContent = displayValue;
    const plural = displayValue === 1 ? 'Ebene' : 'Ebenen';
    depthControl.title = `Hierarchietiefe: ${displayValue} ${plural}`;
  }
}
