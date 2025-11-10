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

let raw = { nodes: [], links: [], persons: [], orgs: []};
let personAttributes = new Map(); // Map von ID/Email zu Attribut-Maps
let attributeTypes = new Map(); // Map von Attributnamen zu Farbwerten
let activeAttributes = new Set(); // Menge der aktiven Attribute für die Anzeige
let byId = new Map();
let allNodesUnique = [];
let filteredItems = [];
let activeIndex = -1;
let currentSelectedId = null;
let searchDebounceTimer = null;
let zoomBehavior = null;
let managementEnabled = true;
let autoFitEnabled = true;
let clusterLayer = null;
let clusterSimById = new Map();
let clusterPersonIds = new Set();
let clusterPolygons = new Map();
let currentZoomTransform = null;
let labelsVisible = true;
let legendMenuEl = null;
let nodeMenuEl = null;
let simAllById = new Map();
let parentOf = new Map();
let currentSubgraph = null;
let currentLayoutMode = 'force'; // 'force' or 'hierarchy'
let hierarchyLevels = new Map(); // nodeId -> level number
let currentSimulation = null; // Global reference to D3 simulation
let preferredData = "auto";
let envConfig = null;
let hiddenNodes = new Set();
let hiddenByRoot = new Map();

function cssNumber(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function hslaToRgba(hslaStr){
  // hsla(h, s%, l%, a)
  const m = /hsla\(([^,]+),\s*([^%]+)%\s*,\s*([^%]+)%\s*,\s*([^\)]+)\)/i.exec(hslaStr||'');
  if (!m) return { r:1, g:1, b:1, a:0 };
  const h = (parseFloat(m[1])||0)/360;
  const s = (parseFloat(m[2])||0)/100;
  const l = (parseFloat(m[3])||0)/100;
  const a = Math.max(0, Math.min(1, parseFloat(m[4])||0));
  const [r,g,b] = hslToRgb(h,s,l);
  return { r, g, b, a };
}

function hslaToRgbaInt(hslaStr){
  const rgba = hslaToRgba(hslaStr);
  return `rgba(${Math.round(rgba.r * 255)},${Math.round(rgba.g * 255)},${Math.round(rgba.b * 255)},${rgba.a})`;
}

// Basic CSS color parser supporting #hex, rgb(a), hsl(a)
function parseColorToRgba(str){
  if (!str) return { r:1, g:1, b:1, a:1 };
  const s = String(str).trim();
  // Hex
  if (s[0] === '#') {
    const h = s.slice(1);
    if (h.length === 3) {
      const r = parseInt(h[0] + h[0], 16) / 255;
      const g = parseInt(h[1] + h[1], 16) / 255;
      const b = parseInt(h[2] + h[2], 16) / 255;
      return { r, g, b, a: 1 };
    }
    if (h.length >= 6) {
      const r = parseInt(h.slice(0,2), 16) / 255;
      const g = parseInt(h.slice(2,4), 16) / 255;
      const b = parseInt(h.slice(4,6), 16) / 255;
      return { r, g, b, a: 1 };
    }
  }
  // rgba/rgb
  let m = /^rgba?\(([^\)]+)\)/i.exec(s);
  if (m) {
    const parts = m[1].split(',').map(x => x.trim());
    const r = Math.max(0, Math.min(255, parseFloat(parts[0]))) / 255;
    const g = Math.max(0, Math.min(255, parseFloat(parts[1]))) / 255;
    const b = Math.max(0, Math.min(255, parseFloat(parts[2]))) / 255;
    const a = parts[3] != null ? Math.max(0, Math.min(1, parseFloat(parts[3]))) : 1;
    return { r, g, b, a };
  }
  // hsla/hsl
  m = /^hsla?\(([^\)]+)\)/i.exec(s);
  if (m) {
    const parts = m[1].split(',').map(x => x.trim());
    const h = (parseFloat(parts[0]) || 0) / 360;
    const sP = (parseFloat(parts[1]) || 0) / 100;
    const lP = (parseFloat(parts[2]) || 0) / 100;
    const a = parts[3] != null ? Math.max(0, Math.min(1, parseFloat(parts[3]))) : 1;
    const [r,g,b] = hslToRgb(h, sP, lP);
    return { r, g, b, a };
  }
  return { r:1, g:1, b:1, a:1 };
}

function canvasBgRgba(){
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg') || '#ffffff';
  return parseColorToRgba(bg);
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
 * Tooltips für Cluster-Hover
 */
function handleClusterHover(event, svgSel) {
  if (!currentZoomTransform) { 
    hideTooltip(); 
    return; 
  }
  
  const [mx, my] = d3.pointer(event, svgSel.node());
  const p = currentZoomTransform.invert([mx, my]);
  const hits = [];
  
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
  
  for (const [oid, poly] of clusterPolygons.entries()) {
    if (!allowedOrgs.has(oid)) continue;
    if (poly && poly.length >= 3 && d3.polygonContains(poly, p)) {
      const lbl = byId.get(oid)?.label || oid;
      hits.push(lbl);
    }
  }
  
  const lines = [];
  
  // Person information or cluster information
  if (nodeLabel) {
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
    if (hits.length > 0) {
      lines.push('🔍 OEs am Cursor:');
      hits.forEach(hit => lines.push(`  • ${hit}`));
    }
    
    // Add all org memberships with header
    if (allPersonOrgs.length > 0) {
      lines.push('🏢 Alle OE-Zugehörigkeiten:');
      allPersonOrgs.forEach(org => lines.push(`  • ${org}`));
    }
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
  if (!personId) return [];
  // Map speichert Zuordnung von OE-Labels zu ihren IDs für die spätere Tiefenberechnung
  const orgMap = new Map(); // Map: label -> id
  
  // Suche nach direkten Verbindungen von Person zu OEs
  for (const link of raw.links) {
    const sourceId = idOf(link.source);
    const targetId = idOf(link.target);
    
    // Person -> Org Verbindungen
    if (sourceId === personId && byId.has(targetId)) {
      const targetNode = byId.get(targetId);
      if (targetNode && targetNode.type === 'org') {
        // Alle OEs einschließen, unabhängig davon, ob sie in allowedOrgs sind
        const label = targetNode.label || String(targetId);
        orgMap.set(label, targetId);
      }
    }
  }
  
  // Nach Tiefe sortieren (kleinere OEs haben eine höhere Tiefe)
  return Array.from(orgMap.entries())
    .map(([label, id]) => ({ label, id, depth: orgDepth(id) }))
    .sort((a, b) => {
      // Zuerst nach Tiefe absteigend sortieren (höhere Tiefe = kleinere OE zuerst)
      return b.depth - a.depth || a.label.localeCompare(b.label);
    })
    .map(item => item.label);
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
 * Mischt mehrere OE-Farben mit dem Canvas-Hintergrund für eine einheitliche Darstellung
 * @param {string[]} oids - IDs der zu mischenden Organisationseinheiten
 * @returns {string} CSS-Farbwert als RGB-String oder 'transparent' wenn keine IDs gegeben
 */
function flattenToWhiteOrdered(oids){
  // Konvertiere zu Array und prüfe auf leere Eingabe
  const arr = Array.from(oids || []);
  if (!arr.length) return 'transparent';
  
  // Sortiere nach Tiefe in der Hierarchie und dann alphabetisch
  const ordered = arr
    .map(oid => ({ oid, depth: orgDepth(oid) }))
    .sort((a,b) => (a.depth - b.depth) || String(a.oid).localeCompare(String(b.oid)));
  
  // Starte mit der Canvas-Hintergrundfarbe
  const bg = canvasBgRgba();
  let r = bg.r, g = bg.g, b = bg.b;
  
  // Wende nacheinander alle Farben mit Alpha-Blending an
  for (const item of ordered) {
    const rgba = hslaToRgba(colorForOrg(item.oid).fill);
    const { r: sr, g: sg, b: sb, a: sa } = rgba;
    // Alpha-Blending-Formel
    r = sr * sa + r * (1 - sa);
    g = sg * sa + g * (1 - sa);
    b = sb * sa + b * (1 - sa);
  }
  
  // Rückgabe als CSS-RGB-Farbe
  return `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
}

/**
 * Berechnet eine gemischte Farbe aus allen aktiven OEs mit angepasster Transparenz für UI-Elemente
 * @param {string[]} oids - Array oder Set von Organisations-IDs
 * @returns {string} CSS-RGBA-Farbwert oder 'transparent' wenn keine IDs gegeben
 */
function mixedActiveFillColorForOids(oids) {
  // Bereite Eingabedaten vor und prüfe auf leere Eingabe
  const list = Array.from(oids || []).map(oid => ({ oid, hsla: colorForOrg(oid).fill }));
  if (!list.length) return 'transparent';
  
  // Sortiere für konsistente Ergebnisse
  list.sort((a,b) => String(a.oid).localeCompare(String(b.oid)));
  
  // Starte mit dem Hintergrund
  const bg = canvasBgRgba();
  let r = bg.r, g = bg.g, b = bg.b;
  let alphaSum = 0;
  
  // Alpha-Blending für alle Farben
  for (const item of list) {
    const rgba = hslaToRgba(item.hsla);
    const { r: sr, g: sg, b: sb, a: sa } = rgba;
    // Alpha-Blending-Formel
    r = sr * sa + r * (1 - sa);
    g = sg * sa + g * (1 - sa);
    b = sb * sa + b * (1 - sa);
    alphaSum += sa;
  }
  
  // Begrenzte Alpha-Transparenz für UI-Elemente (nicht zu transparent oder zu deckend)
  const uiAlpha = Math.max(0.08, Math.min(alphaSum, 0.35));
  
  // Rückgabe als CSS-RGBA-Farbe
  return `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${uiAlpha})`;
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  function f(n){
    const k = (n + h*12) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return color;
  }
  return [f(0), f(8), f(4)];
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
  const nodeRadius = cssNumber('--node-radius', 8);
  const circleGap = cssNumber('--attribute-circle-gap', 4);
  const circleWidth = cssNumber('--attribute-circle-stroke-width', 2);
  
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
  
  // Prüfe, ob es überhaupt aktive Attribute gibt
  const hasAnyActiveAttributes = activeAttributes.size > 0;
  
  // Set zum Speichern aller IDs von Knoten mit aktiven Attributen
  const nodesWithActiveAttributesIds = new Set();
  
  // Alle Knoten auf Standard zurücksetzen
  nodes.selectAll('circle.node-circle')
    .style('fill', null)
    .style('stroke', null)
    .style('stroke-width', null)
    .style('opacity', 1);
  
  // Neue Attribut-Kreise hinzufügen und Knoten mit Attributen identifizieren
  nodes.each(function(d) {
    if (!d) return; // Sicherheitsprüfung
    
    const nodeGroup = d3.select(this);
    const personId = String(d.id);
    const nodeAttrs = personAttributes.get(personId);
    
    // Knoten mit Attributen prüfen
    if (nodeAttrs && nodeAttrs.size > 0) {
      // Filtere auf aktive Attribute
      const activeNodeAttrs = Array.from(nodeAttrs.entries())
        .filter(([attrName]) => activeAttributes.has(attrName))
        .sort((a, b) => a[0].localeCompare(b[0])); // Sortiere für konsistente Reihenfolge
      
      // Wenn es aktive Attribute gibt, ändere den Hauptknoten und speichere die ID
      if (activeNodeAttrs.length > 0) {
        nodesWithActiveAttributesIds.add(personId);
        
        // Haupt-Knoten mit spezieller Darstellung für Knoten mit Attributen
        nodeGroup.select('circle.node-circle')
          .style('fill', nodeWithAttributesFill)
          .style('stroke', nodeWithAttributesStroke)
          .style('stroke-width', nodeWithAttributesStrokeWidth);
      }
      
      // Füge Attribute-Kreise von innen nach außen hinzu
      activeNodeAttrs.forEach(([attrName], idx) => {
        const attrColor = attributeTypes.get(attrName);
        if (!attrColor) return;
        
        // Kreisradius berechnen
        const attrRadius = nodeRadius + circleGap + (idx * (circleGap + circleWidth));
        
        // Attributkreis vor dem Hauptkreis einfügen, damit er dahinter liegt
        nodeGroup.insert("circle", "circle.node-circle")
          .attr("r", attrRadius)
          .attr("class", "attribute-circle")
          .attr("data-attribute", attrName)
          .style("stroke", attrColor)
          .style("stroke-width", circleWidth);
      });
    }
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
  parentOf = new Map();
  for (const l of raw.links) {
    const s = idOf(l.source), t = idOf(l.target);
    if (byId.get(s)?.type === 'org' && byId.get(t)?.type === 'org') {
      parentOf.set(t, s);
    }
  }
  allowedOrgs = new Set(orgs.map(o => String(o.id)));
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
      buildAttributeLegend();
      document.getElementById('stats-attributes-count').textContent = '0';
    }
  }
  
  populateCombo("");
  buildOrgLegend(new Set());
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
    }
  } catch(_) {}
  return false;
}

async function loadData() {
  setStatus("Lade Daten...");
  let data = null;
  let sourceName = '(keine Daten)';
  const dataUrl = envConfig?.DATA_URL || null;
  if (dataUrl) {
    try {
      const res = await fetch(dataUrl, { cache: "no-store" });
      if (res.ok) { data = await res.json(); sourceName = dataUrl; }
    } catch(_) {}
  }
  if (!data && (preferredData === 'generated' || preferredData === 'auto')) {
    try {
      const resGen = await fetch("./data.json", { cache: "no-store" });
      if (resGen.ok) { data = await resGen.json(); sourceName = 'data.json'; }
    } catch(_) {}
  }
  if (!data && (preferredData === 'default' || preferredData === 'auto')) {
    try {
      const resDef = await fetch("./data.default.json", { cache: "no-store" });
      if (resDef.ok) { data = await resDef.json(); sourceName = 'data.default.json'; }
    } catch(_) {}
  }
  if (!data && preferredData === 'auto') {
    try {
      const resBase = await fetch("./data.json", { cache: "no-store" });
      if (resBase.ok) { data = await resBase.json(); sourceName = 'data.json'; }
    } catch(_) {}
  }
  applyLoadedDataObject(data, sourceName);
}

function populateCombo(filterText) {
  const input = document.querySelector(INPUT_COMBO_ID);
  const list = document.querySelector(LIST_COMBO_ID);
  if (!input || !list) return;
  const term = (filterText || "").toLowerCase().trim();
  
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
      chooseItem(idx);
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

function chooseItem(idx) {
  const input = document.querySelector(INPUT_COMBO_ID);
  const list = document.querySelector(LIST_COMBO_ID);
  if (!input || !list) return;
  if (idx < 0 || idx >= filteredItems.length) return;
  const n = filteredItems[idx];
  currentSelectedId = String(n.id);
  input.value = n.label || String(n.id);
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
        // If target is org and it's disabled, skip
        if (wType === 'org' && !allowedOrgs.has(w)) continue;
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
        // If target is org and it's disabled, skip
        if (wType === 'org' && !allowedOrgs.has(w)) continue;
        if (!seen.has(w)) { seen.add(w); dist.set(w, d + 1); q.push(w); }
      }
      // Additionally: Person -> Org via forward memberOf in up mode
      if (vType === 'person') {
        for (const w of out.get(v) || []) {
          const wType = byId.get(w)?.type;
          if (wType !== 'org') continue;
          // If target is org and it's disabled, skip
          if (wType === 'org' && !allowedOrgs.has(w)) continue;
          if (!seen.has(w)) { seen.add(w); dist.set(w, d + 1); q.push(w); }
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
  if (hiddenNodes && hiddenNodes.size > 0) {
    nodes = nodes.filter(n => !hiddenNodes.has(String(n.id)));
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
  nodes = nodes.filter(n => n.type !== 'org' || allowedOrgs.has(String(n.id)));
  const nodeSet = new Set(nodes.map(n => String(n.id)));
  const links = raw.links
    .map(l => ({ s: idOf(l.source), t: idOf(l.target) }))
    .filter(x => nodeSet.has(x.s) && nodeSet.has(x.t))
    .map(x => ({ source: x.s, target: x.t }));
  return { nodes, links };
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
  updateVisibility();
  applyFromUI();
}

function unhideSubtree(rootId) {
  const rid = String(rootId);
  if (hiddenByRoot.has(rid)) {
    hiddenByRoot.delete(rid);
    recomputeHiddenNodes();
  }
  buildHiddenLegend();
  updateVisibility();
  applyFromUI();
}

function buildHiddenLegend() {
  const legend = document.getElementById('hiddenLegend');
  if (!legend) return;
  legend.innerHTML = '';
  if (hiddenByRoot.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'legend-empty';
    empty.textContent = 'Keine ausgeblendeten Personen';
    legend.appendChild(empty);
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'legend-list';
  for (const [root, setIds] of hiddenByRoot.entries()) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'legend-row';
    const name = byId.get(root)?.label || root;
    const chip = document.createElement('span');
    chip.className = 'legend-label-chip';
    chip.textContent = `${name} (${setIds.size})`;
    chip.title = name;
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Einblenden';
    btn.addEventListener('click', () => unhideSubtree(root));
    row.appendChild(chip);
    row.appendChild(btn);
    li.appendChild(row);
    ul.appendChild(li);
  }
  legend.appendChild(ul);
}

function buildOrgLegend(scope) {
  const legend = document.querySelector('#legend');
  if (!legend) return;
  legend.innerHTML = '';
  // Build org parent relationships
  const children = new Map();
  const hasParent = new Set();
  const scopeProvided = typeof scope !== 'undefined';
  const scopeSet = scopeProvided ? new Set(Array.from(scope || []).map(String)) : null;
  for (const l of raw.links) {
    const s = idOf(l.source), t = idOf(l.target);
    if (byId.get(s)?.type !== 'org' || byId.get(t)?.type !== 'org') continue;
    if (scopeProvided && (!scopeSet.has(s) || !scopeSet.has(t))) continue;
    if (!children.has(s)) children.set(s, new Set());
    children.get(s).add(t);
    hasParent.add(t);
  }
  let allOrgs = scopeProvided ? Array.from(scopeSet) : raw.orgs.map(o => String(o.id));
  const roots = allOrgs.filter(id => !hasParent.has(id));

  const ul = document.createElement('ul');
  ul.className = 'legend-list';
  function renderNode(oid) {
    const li = document.createElement('li');
    const lbl = byId.get(oid)?.label || oid;
    const idAttr = `org_${oid}`;
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = allowedOrgs.has(oid);
    chk.id = idAttr;
    chk.addEventListener('change', () => {
      if (chk.checked) allowedOrgs.add(oid); else allowedOrgs.delete(oid);
      syncGraphAndLegendColors();
    });
    const lab = document.createElement('label');
    lab.setAttribute('for', idAttr);
    // label chip to show mixed active color (set later via updateLegendChips)
    const chip = document.createElement('span');
    chip.className = 'legend-label-chip';
    chip.textContent = lbl;
    chip.title = lbl; // Tooltip für den vollständigen Text bei Hover
    // collapsible branch toggle
    const kids = Array.from(children.get(oid) || []).filter(id => !scopeProvided || scopeSet.has(id));
    const row = document.createElement('div');
    row.className = 'legend-row';
    // colorize row only when selected
    const { stroke, fill } = colorForOrg(oid);
    if (chk.checked) {
      row.style.background = fill;
      row.style.borderLeft = `3px solid ${stroke}`;
    } else {
      row.style.background = 'transparent';
      row.style.borderLeft = '3px solid #e5e7eb';
    }
    if (kids.length) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent = '▾';
      toggle.title = 'Ein-/Ausklappen';
      toggle.className = 'twisty';
      toggle.addEventListener('click', () => {
        const sub = li.querySelector('ul');
        const collapsed = sub && sub.style.display === 'none';
        if (sub) sub.style.display = collapsed ? '' : 'none';
        toggle.textContent = collapsed ? '▾' : '▸';
      });
      row.appendChild(toggle);
    } else {
      // placeholder to align without triangle
      const spacer = document.createElement('span');
      spacer.style.display = 'inline-block';
      spacer.style.width = '12px';
      spacer.style.flexShrink = '0';
      row.appendChild(spacer);
    }
    row.appendChild(chk);
    
    // Wrapper für den Chip, um korrekte Größenbegrenzung zu ermöglichen
    const chipWrapper = document.createElement('div');
    chipWrapper.style.overflow = 'hidden'; // Notwendig für text-overflow
    chipWrapper.style.flexGrow = '1'; // Nimmt verfügbaren Platz ein
    chipWrapper.style.minWidth = '0'; // Wichtig für text-overflow in Flexbox
    chipWrapper.appendChild(chip);
    
    row.appendChild(chipWrapper);
    li.appendChild(row);
    if (kids.length) {
      const sub = document.createElement('ul');
      kids.forEach(k => sub.appendChild(renderNode(k)));
      li.appendChild(sub);
    }
    // Context menu for subtree show/hide
    const onCtx = (e) => {
      e.preventDefault();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      e.stopPropagation();
      
      // Compute descendants from immediate subtree (this LI's own UL children)
      let subRoot = null;
      let usedScope = true;
      try {
        subRoot = li.querySelector(':scope > ul');
      } catch(_) {
        usedScope = false;
        subRoot = Array.from(li.children).find(ch => ch.tagName === 'UL');
      }
      
      // Direktes Kind-Mapping abrufen
      const directChildrenIds = new Set();
      const allDescendantIds = new Set();
      
      if (subRoot) {
        // Direkte Kinder sammeln
        Array.from(subRoot.children).forEach(childLi => {
          const childCb = childLi.querySelector('input[id^="org_"]');
          if (childCb) {
            const childId = childCb.id.replace('org_', '');
            directChildrenIds.add(childId);
          }
          
          // Sammle alle Nachfahren-Checkboxen im Subtree
          const allCbs = childLi.querySelectorAll('input[id^="org_"]');
          allCbs.forEach(cb => allDescendantIds.add(cb.id.replace('org_', '')));
        });
      }
      
      showLegendMenu(e.clientX, e.clientY, {
        onShowAll: () => {
          // include the clicked parent itself
          allowedOrgs.add(oid);
          allDescendantIds.forEach(id => allowedOrgs.add(id));
          // Update checkboxes in this subtree
          if (subRoot) Array.from(subRoot.querySelectorAll('input[id^="org_"]')).forEach(c => c.checked = true);
          const selfCb = li.querySelector(`#org_${oid}`);
          if (selfCb) selfCb.checked = true;
          syncGraphAndLegendColors();
        },
        onHideAll: () => {
          // include the clicked parent itself
          allowedOrgs.delete(oid);
          allDescendantIds.forEach(id => allowedOrgs.delete(id));
          if (subRoot) Array.from(subRoot.querySelectorAll('input[id^="org_"]')).forEach(c => c.checked = false);
          const selfCb = li.querySelector(`#org_${oid}`);
          if (selfCb) selfCb.checked = false;
          syncGraphAndLegendColors();
        },
        onShowDirectChildrenOnly: () => {
          // Alle Nachfahren-OEs ausblenden
          allDescendantIds.forEach(id => {
            allowedOrgs.delete(id);
            const cb = subRoot.querySelector(`#org_${id}`);
            if (cb) cb.checked = false;
          });
          
          // Den Parent und direkte Kinder einblenden
          allowedOrgs.add(oid);
          directChildrenIds.forEach(id => allowedOrgs.add(id));
          
          // Checkboxen aktualisieren
          const selfCb = li.querySelector(`#org_${oid}`);
          if (selfCb) selfCb.checked = true;
          
          // Nur direkte Kind-Checkboxen aktivieren
          directChildrenIds.forEach(id => {
            const cb = subRoot.querySelector(`#org_${id}`);
            if (cb) cb.checked = true;
          });
          
          // Direkte Kind-Unterbäume kollabieren
          if (subRoot) {
            Array.from(subRoot.children).forEach(childLi => {
              const childUl = childLi.querySelector('ul');
              if (childUl) {
                childUl.style.display = 'none';
                const twisty = childLi.querySelector('.twisty');
                if (twisty && twisty.textContent === '▾') { // ▾ = ▾
                  twisty.textContent = '▸'; // ▸ = ▸
                }
              }
            });
          }
          
          syncGraphAndLegendColors();
        }
      });
    };
    
    li.addEventListener('contextmenu', onCtx);
    // Also bind to row to catch right-clicks near controls
    row.addEventListener('contextmenu', onCtx);
    return li;
  }
  
  if (roots.length) {
    roots.forEach(r => ul.appendChild(renderNode(r)));
  } else if (scopeProvided) {
    // Fallback: render flat list of scoped orgs (no parent-child within scope)
    Array.from(scopeSet || []).forEach(oid => ul.appendChild(renderNode(oid)));
  }
  legend.appendChild(ul);
  syncGraphAndLegendColors();
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
  // For each legend entry (li), compute active OEs from its checked ancestor chain (including self)
  root.querySelectorAll('.legend-list > li, .legend-list li').forEach(li => {
    const selfCb = li.querySelector(':scope > .legend-row input[id^="org_"]');
    if (!selfCb) return;
    const selfOid = selfCb.id.replace('org_','');
    const chip = li.querySelector(':scope > .legend-row .legend-label-chip');
    if (!chip) return;
    if (!selfCb.checked || !allowedOrgs.has(selfOid)) {
      chip.style.background = 'transparent';
      return;
    }
    const chain = Array.from(getActiveAncestorChain(selfOid));
    if (chain.length > 0) {
      const chipColor = flattenToWhiteOrdered(chain);
      chip.style.background = chipColor;
    } else {
      chip.style.background = 'transparent';
    }
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
    if (cb.checked && allowedOrgs.has(oid)) {
      row.style.background = fill;
      row.style.borderLeft = `3px solid ${stroke}`;
    } else {
      row.style.background = 'transparent';
      row.style.borderLeft = '3px solid #e5e7eb';
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

function ensureNodeMenu() {
  if (nodeMenuEl) return nodeMenuEl;
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
  const it = document.createElement('div');
  it.textContent = 'Ausblenden';
  it.style.padding = '6px 12px';
  it.style.cursor = 'pointer';
  it.addEventListener('mouseenter', () => it.style.background = '#1f2937');
  it.addEventListener('mouseleave', () => it.style.background = 'transparent');
  el.appendChild(it);
  document.body.appendChild(el);
  nodeMenuEl = el;
  document.addEventListener('click', () => { if (nodeMenuEl && nodeMenuEl.style.display === 'block') nodeMenuEl.style.display = 'none'; });
  return el;
}
function showNodeMenu(x, y, onHide) {
  const el = ensureNodeMenu();
  const it = el.querySelector('div');
  it.onclick = () => { el.style.display = 'none'; onHide(); };
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.display = 'block';
}

// Aktualisiert nur die Sichtbarkeit der Knoten im DOM ohne Layout-Änderung
function updateVisibility() {
  // Versteckte Knoten unsichtbar machen
  d3.selectAll(SVG_ID + ' .node').style('opacity', d => 
    hiddenNodes.has(String(d.id)) ? '0' : null);
  
  // Links, die zu versteckten Knoten führen, ebenfalls ausblenden
  d3.selectAll(SVG_ID + ' .link').style('opacity', d => {
    const s = idOf(d.source);
    const t = idOf(d.target);
    return (hiddenNodes.has(s) || hiddenNodes.has(t)) ? '0' : null;
  });
}

function refreshClusters() {
  if (!clusterLayer) return;
  
  const pad = cssNumber('--cluster-pad', 12);
  const membersByOrg = new Map();
  
  for (const l of raw.links) {
    const s = idOf(l.source), t = idOf(l.target);
    if (!clusterPersonIds.has(s)) continue;
    const tType = byId.get(t)?.type;
    if (tType !== 'org') continue;
    if (!allowedOrgs.has(t)) continue;
    if (!membersByOrg.has(t)) membersByOrg.set(t, []);
    const nd = clusterSimById.get(s);
    if (nd && nd.x != null && nd.y != null) membersByOrg.get(t).push(nd);
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
 * Rendert den Graphen basierend auf dem berechneten Subgraphen
 */
function renderGraph(sub) {
  // SVG-Element vorbereiten
  const svg = d3.select(SVG_ID);
  svg.selectAll("*").remove();
  svg.attr("viewBox", [0, 0, WIDTH, HEIGHT]);

  // Pfeilspitzen-Definitionen
  const defs = svg.append("defs");
  const arrowLen = cssNumber('--arrow-length', 10);
  const linkStroke = cssNumber('--link-stroke-width', 3);
  defs.append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 0)
    .attr("refY", 5)
    .attr("markerWidth", arrowLen)
    .attr("markerHeight", arrowLen + linkStroke)
    .attr("markerUnits", "userSpaceOnUse")
    .attr("orient", "auto-start-reverse")
    .append("path")
    .attr("d", "M 0 0 L 10 5 L 0 10 z")
    .attr("fill", getComputedStyle(document.documentElement).getPropertyValue('--link-stroke') || '#bbb')
    .attr("fill-opacity", parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--link-opacity')) || 1);

  // SVG-Tooltip einrichten
  d3.select("svg").append("title").text("Klicke auf eine Person im Graph, um sie als Startpunkt zu setzen");

  // Zoom-Container
  const gZoom = svg.append("g");

  // Nur Personen-zu-Personen-Verbindungen anzeigen
  const personIdsInSub = new Set(sub.nodes.filter(n => byId.get(String(n.id))?.type === 'person').map(n => String(n.id)));
  const linksPP = sub.links.filter(l => personIdsInSub.has(idOf(l.source)) && personIdsInSub.has(idOf(l.target)));

  // Cluster-Ebene (hinter Links und Knoten)
  const gClusters = gZoom.append("g").attr("class", "clusters");
  clusterLayer = gClusters;

  // Verbindungen rendern
  const link = gZoom.append("g")
    .selectAll("line")
    .data(linksPP, d => `${idOf(d.source)}|${idOf(d.target)}`)
    .join("line")
    .attr("class", "link")
    .attr("marker-end", "url(#arrow)");

  // Nur Personen-Knoten rendern
  const personNodes = sub.nodes.filter(n => byId.get(String(n.id))?.type === 'person');
  const simById = new Map(personNodes.map(d => [String(d.id), d]));
  clusterSimById = simById;
  clusterPersonIds = new Set(personNodes.map(d => String(d.id)));
  simAllById = new Map(personNodes.map(d => [String(d.id), d]));
  
  // Knoten erstellen
  const node = gZoom.append("g")
    .selectAll("g")
    .data(personNodes, d => String(d.id))
    .join("g")
    .attr("class", "node");

  // Styling-Parameter
  const nodeRadius = cssNumber('--node-radius', 8);
  const collidePadding = cssNumber('--collide-padding', 6);
  const circleGap = cssNumber('--attribute-circle-gap', 4);
  const circleWidth = cssNumber('--attribute-circle-stroke-width', 2);
  
  // Hauptkreis hinzufügen (nur einmal!)
  node.append("circle").attr("r", nodeRadius).attr("class", "node-circle");
  node.append("text")
    .text(d => d.label ?? d.id)
    .attr("x", 10)
    .attr("y", 4)
    .attr("class", "label");
    
  // Attribut-Kreise hinzufügen (ohne Relayout)
  updateAttributeCircles();

  // Tooltips für Knoten
  node.on('mousemove', (event, d) => {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    const [mx, my] = d3.pointer(event, svg.node());
    const p = currentZoomTransform ? currentZoomTransform.invert([mx, my]) : [mx, my];
    
    // Sammle alle Informationen für den Tooltip
    const lines = [];
    
    // Node header with name/ID
    lines.push(`👤 ${d.label || String(d.id)}`);
    
    // Attribute-Informationen hinzufügen, wenn vorhanden
    const personId = String(d.id);
    if (personAttributes.has(personId)) {
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
    
    // OE-Zugehörigkeiten hinzufügen
    const clusters = clustersAtPoint(p);
    if (clusters.length > 0) {
      lines.push('🔍 OEs am Cursor:');
      clusters.forEach(cluster => lines.push(`  • ${cluster}`));
    }
    
    // Alle OE-Zugehörigkeiten hinzufügen
    const allOrgs = findAllPersonOrgs(personId);
    if (allOrgs.length > 0) {
      lines.push('🏢 Alle OE-Zugehörigkeiten:');
      allOrgs.forEach(org => lines.push(`  • ${org}`));
    }
    
    showTooltip(event.clientX, event.clientY, lines);
  });
  node.on('mouseleave', hideTooltip);
  // Context menu to hide subtree via right-click
  node.on('contextmenu', (event, d) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    showNodeMenu(event.clientX, event.clientY, () => hideSubtreeFromRoot(String(d.id)));
  });

  // Force-Simulation-Parameter
  const linkDistance = cssNumber('--link-distance', 60);
  const linkStrength = cssNumber('--link-strength', 0.4);
  const chargeStrength = cssNumber('--charge-strength', -200);

  // Simulation erstellen
  const simulation = d3.forceSimulation(personNodes)
    .force("link", d3.forceLink(linksPP).id(d => String(d.id)).distance(linkDistance).strength(linkStrength))
    .force("charge", d3.forceManyBody().strength(chargeStrength))
    .force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2))
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
      
      // Basis-Radius + Abstand für jedes Attribut
      const attrSpace = attrCount > 0 ? (circleGap + (attrCount * (circleGap + circleWidth))) : 0;
      return nodeRadius + collidePadding + attrSpace;
    }));
  
  // Tick-Handler für Animation
  simulation.on("tick", () => {
    const nodeStrokeWidth = cssNumber('--node-stroke-width', 3);
    const nodeOuter = nodeRadius + (nodeStrokeWidth / 2);
    const backoff = nodeOuter + arrowLen;
    
    // Verbindungsposition aktualisieren
    link
      .attr("x1", d => d.target.x)
      .attr("y1", d => d.target.y)
      .attr("x2", d => {
        const dx = d.source.x - d.target.x, dy = d.source.y - d.target.y;
        const len = Math.hypot(dx, dy) || 1;
        return d.source.x - (dx / len) * backoff;
      })
      .attr("y2", d => {
        const dx = d.source.x - d.target.x, dy = d.source.y - d.target.y;
        const len = Math.hypot(dx, dy) || 1;
        return d.source.y - (dy / len) * backoff;
      });

    // Knotenposition aktualisieren
    node.attr("transform", d => `translate(${d.x},${d.y})`);

    // Cluster (OE-Hüllen) aktualisieren
    const pad = cssNumber('--cluster-pad', 12);
    const membersByOrg = new Map();
    
    // Mitgliedschaften sammeln
    for (const l of raw.links) {
      const s = idOf(l.source), t = idOf(l.target);
      if (!personIdsInSub.has(s)) continue;
      const tType = byId.get(t)?.type;
      if (tType !== 'org' || !allowedOrgs.has(t)) continue;
      if (!membersByOrg.has(t)) membersByOrg.set(t, []);
      const nd = simById.get(s);
      if (nd && nd.x != null && nd.y != null) membersByOrg.get(t).push(nd);
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
  
  // Auto-Fit nach Simulation-Ende
  simulation.on('end', () => {
    if (autoFitEnabled) fitToViewport();
  });

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
    currentSelectedId = String(d.id);
    const input = document.querySelector(INPUT_COMBO_ID);
    if (input) input.value = d.label || String(d.id);
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
  currentZoomTransform = d3.zoomIdentity;

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
  
  // Get current search input value
  const input = document.querySelector(INPUT_COMBO_ID);
  const inputValue = input?.value.trim() || '';

  // Get selected depth
  const depthEl = document.querySelector(INPUT_DEPTH_ID);
  const depth = depthEl ? parseInt(depthEl.value, 10) || 0 : 0;

  // Get direction mode
  let dirMode = 'both';
  const activeDirectionButton = document.querySelector('#directionToggle button.active');
  if (activeDirectionButton) {
    dirMode = activeDirectionButton.dataset.dir;
  }

  let startId = currentSelectedId;
  if (!startId && input && input.value) {
    startId = guessIdFromInput(input.value);
  }
  if (!startId) { setStatus("Startknoten nicht gefunden"); return; }
  const sub = computeSubgraph(startId, Number.isFinite(depth) ? depth : 2, dirMode);
  currentSubgraph = sub;
  renderGraph(sub);
  updateFooterStats(sub);
  
  
  // Im normalen Modus: update legend to only include orgs related to the START node
  const startType = byId.get(startId)?.type;
  const scopeOrgs = new Set();
  if (startType === 'person') {
    // Direct memberOf orgs of the start person
    for (const l of raw.links) {
      const s = idOf(l.source), t = idOf(l.target);
      if (s === startId && byId.get(t)?.type === 'org') scopeOrgs.add(t);
    }
    // Add ancestor orgs (orgParent upwards)
    const parents = new Map(); // child -> parent set
    const children = new Map(); // parent -> child set (for deepest detection and downward expansion)
    for (const l of raw.links) {
      const s = idOf(l.source), t = idOf(l.target);
      if (byId.get(s)?.type === 'org' && byId.get(t)?.type === 'org') {
        if (!parents.has(t)) parents.set(t, new Set());
        parents.get(t).add(s);
        if (!children.has(s)) children.set(s, new Set());
        children.get(s).add(t);
      }
    }
    const q = Array.from(scopeOrgs);
    for (let i=0;i<q.length;i++) {
      const c = q[i];
      for (const p of (parents.get(c) || [])) {
        if (!scopeOrgs.has(p)) { scopeOrgs.add(p); q.push(p); }
      }
    }
    // Determine deepest memberOf orgs (those that are not parent of another memberOf in this set)
    const memberSet = new Set(Array.from(scopeOrgs).filter(oid => {
      // limit to original direct memberOf (exclude ancestors added above)
      // reconstruct direct memberOf set
      return Array.from(raw.links).some(l => idOf(l.source) === startId && idOf(l.target) === oid);
    }));
    const deepest = Array.from(memberSet).filter(oid => {
      const kids = children.get(oid) || new Set();
      // if any child is also in memberSet, then oid is not deepest
      for (const k of kids) { if (memberSet.has(k)) return false; }
      return true;
    });
    // Expand descendants from deepest
    for (const root of deepest) {
      const dq = [root];
      for (let i=0;i<dq.length;i++) {
        const cur = dq[i];
        for (const ch of (children.get(cur) || [])) {
          if (!scopeOrgs.has(ch)) { scopeOrgs.add(ch); dq.push(ch); }
        }
      }
    }
  } else if (startType === 'org') {
    // The start org and all descendant orgs
    const children = new Map();
    for (const l of raw.links) {
      const s = idOf(l.source), t = idOf(l.target);
      if (byId.get(s)?.type === 'org' && byId.get(t)?.type === 'org') {
        if (!children.has(s)) children.set(s, new Set());
        children.get(s).add(t);
      }
    }
    const q = [startId];
    scopeOrgs.add(startId);
    for (let i=0;i<q.length;i++) {
      const cur = q[i];
      for (const ch of (children.get(cur) || [])) {
        if (!scopeOrgs.has(ch)) { scopeOrgs.add(ch); q.push(ch); }
      }
    }
  }
  buildOrgLegend(scopeOrgs);
}

/**
 * Parst eine Liste von E-Mails/IDs mit Attributen
 * Unterstützte Formate:
 * - Komma-separiert: ID/Email,AttributName[,AttributWert]
 * - Tab-separiert: ID/Email\tAttributName[\tAttributWert]
 * - Gemischte Formate (zeilenweise Erkennung)
 */
function parseAttributeList(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const result = new Map();
  const foundAttributes = new Set();
  let count = 0;
  
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
    count
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
    const { attributes, types, count } = parseAttributeList(text);
    
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
 * Erstellt die Attribut-Legende basierend auf den geladenen Attributtypen
 */
function buildAttributeLegend() {
  const legend = document.getElementById('attributeLegend');
  if (!legend) return;
  
  legend.innerHTML = '';
  if (attributeTypes.size === 0) {
    legend.innerHTML = '<div class="attribute-empty">Keine Attribute geladen</div>';
    updateAttributeStats(); // Aktualisiere 0/0 Anzeige
    return;
  }
  
  // Zähle Vorkommen je Attributtyp
  const typeCount = new Map();
  for (const attrs of personAttributes.values()) {
    for (const type of attrs.keys()) {
      typeCount.set(type, (typeCount.get(type) || 0) + 1);
    }
  }
  
  // Sortiere Attribute alphabetisch
  const sortedTypes = Array.from(attributeTypes.keys()).sort();
  
  for (const type of sortedTypes) {
    const color = attributeTypes.get(type);
    const isActive = activeAttributes.has(type);
    const count = typeCount.get(type) || 0;
    
    const item = document.createElement('div');
    item.className = 'attribute-legend-item';
    
    const colorSpan = document.createElement('span');
    colorSpan.className = 'attribute-color';
    colorSpan.style.backgroundColor = color;
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'attribute-name';
    nameSpan.textContent = type;
    nameSpan.title = type; // Tooltip für vollständigen Namen
    
    const countSpan = document.createElement('span');
    countSpan.className = 'attribute-count';
    countSpan.textContent = `(${count})`;
    
    const toggleCheckbox = document.createElement('input');
    toggleCheckbox.type = 'checkbox';
    toggleCheckbox.className = 'attribute-toggle';
    toggleCheckbox.checked = isActive;
    toggleCheckbox.addEventListener('change', () => {
      if (toggleCheckbox.checked) {
        activeAttributes.add(type);
      } else {
        activeAttributes.delete(type);
      }
      updateAttributeStats(); // Aktualisiere die Attribut-Statistik
      
      // Statt eines kompletten Relayouts nur die Attribut-Kreise aktualisieren
      updateAttributeCircles();
    });
    
    item.appendChild(colorSpan);
    item.appendChild(nameSpan);
    item.appendChild(countSpan);
    item.appendChild(toggleCheckbox);
    legend.appendChild(item);
  }
  
  // Attributstatistik aktualisieren
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
  await loadEnvConfig();
  await loadData();
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
  const auto = document.querySelector('#toggleAutoFit');
  if (auto) {
    if (envConfig?.DEFAULT_AUTOFIT_ENABLED != null) {
      autoFitEnabled = !!envConfig.DEFAULT_AUTOFIT_ENABLED;
      if (!autoFitEnabled) auto.classList.remove('active');
    } else {
      autoFitEnabled = auto.classList.contains('active');
    }
    auto.addEventListener('click', () => {
      auto.classList.toggle('active');
      autoFitEnabled = auto.classList.contains('active');
      if (autoFitEnabled) {
        fitToViewport();
      }
    });
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
        case 'Enter': if (activeIndex >= 0) chooseItem(activeIndex); applyFromUI(); break;
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
  // Auto-apply on depth change and direction change
  const depthEl = document.querySelector(INPUT_DEPTH_ID);
  if (depthEl) {
    if (envConfig?.DEFAULT_DEPTH != null) {
      depthEl.value = envConfig.DEFAULT_DEPTH;
    }
    depthEl.addEventListener('change', applyFromUI);
    depthEl.addEventListener('input', applyFromUI);
  }
  // Direction Buttons
  const dirButtons = document.querySelectorAll('#directionToggle button');
  let currentDir = 'both';
  
  // Initialize direction from config
  if (envConfig?.DEFAULT_DIR) {
    currentDir = envConfig.DEFAULT_DIR;
    dirButtons.forEach(btn => {
      if (btn.dataset.dir === currentDir) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
  
  // Direction button click handlers
  dirButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all buttons
      dirButtons.forEach(b => b.classList.remove('active'));
      
      // Add active class to clicked button
      btn.classList.add('active');
      
      // Update current direction
      currentDir = btn.dataset.dir;
      
      // Apply changes
      applyFromUI();
    });
  });
  
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

  // Apply initial start node from env.json if provided
  if (envConfig?.DEFAULT_START_ID) {
    const startNode = byId.get(String(envConfig.DEFAULT_START_ID));
    if (startNode) {
      currentSelectedId = String(startNode.id);
      if (input) {
        input.value = startNode.label || String(startNode.id);
        // Stelle sicher, dass die Dropdown-Liste geschlossen ist
        list.hidden = true;
      }
      try { applyFromUI(); } catch(_) {}
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
    if (currentSubgraph) updateVisibility();
    try { applyFromUI(); } catch(_) {}
  }
  // hideSubtree-Button wurde aus der Toolbar entfernt
  // Die hideSubtreeFromRoot-Funktion bleibt für das Kontextmenü erhalten
  buildHiddenLegend();
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
  const LEVEL_FORCE_STRENGTH = 0.25; // Stärke der Ebenen-Ausrichtungskraft (0.1-0.5)
  
  // Fixierte Positionen zurücksetzen [DRY]
  nodes.forEach(n => {
    n.fx = null;
    n.fy = null;
  });
  
  // Spezifische Konfiguration je nach Modus
  if (mode === 'hierarchy') {
    // Hierarchie-Ebenen berechnen [SF]
    hierarchyLevels = computeHierarchyLevels(nodes, links);
    
    // Ziel-Y-Position für jede Ebene berechnen [SF]
    const sortedLevels = Array.from(new Set(Array.from(hierarchyLevels.values()))).sort((a, b) => a - b);
    const levelToY = new Map();
    sortedLevels.forEach((level, idx) => {
      levelToY.set(level, 100 + idx * LEVEL_HEIGHT);
    });
    
    // Knoten vorpositionieren für besseren Start [SF]
    nodes.forEach(n => {
      n.x = WIDTH/2 + (Math.random() - 0.5) * 100; // Leichte horizontale Streuung
      const level = hierarchyLevels.get(String(n.id)) ?? 0;
      n.y = levelToY.get(level) ?? HEIGHT/2;
    });
    
    // Hierarchie-spezifische Ebenen-Force hinzufügen
    simulation.force("level", d3.forceY(d => {
      const level = hierarchyLevels.get(String(d.id)) ?? 0;
      return levelToY.get(level) ?? HEIGHT / 2;
    }).strength(LEVEL_FORCE_STRENGTH));
    // Cluster-Forces deaktivieren, um Hierarchie-Layout nicht zu beeinflussen
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
      n.x = c.x + (Math.random() - 0.5) * JITTER;
      n.y = c.y + (Math.random() - 0.5) * JITTER;
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
  
  // Alle Schaltflächen und Inhalte initialisieren
  const buttons = document.querySelectorAll('.collapse-btn');
  buttons.forEach(btn => {
    const targetId = btn.dataset.target;
    const target = document.getElementById(targetId);
    if (!target) return;
    
    // Initialen Zustand aus localStorage laden
    const isInitiallyCollapsed = loadCollapseState(targetId);
    if (isInitiallyCollapsed) {
      target.classList.add('collapsed');
      btn.classList.add('collapsed');
    }
    
    // Klick-Event für den Button
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = target.classList.toggle('collapsed');
      btn.classList.toggle('collapsed');
      saveCollapseState(targetId, isCollapsed);
    });
    
    // Klick-Event für die Überschrift
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
          btn.classList.toggle('collapsed');
          saveCollapseState(targetId, isCollapsed);
        }
      });
    }
  });
}

