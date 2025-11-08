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

let raw = { nodes: [], links: [], persons: [], orgs: [] };
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
let simAllById = new Map();
let parentOf = new Map();
let currentSubgraph = null;
let currentLayoutMode = 'force'; // 'force' or 'hierarchy'
let hierarchyLevels = new Map(); // nodeId -> level number
let currentSimulation = null; // Global reference to D3 simulation
let preferredData = "auto";
let envConfig = null;

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
  const labels = [];
  for (const [oid, poly] of clusterPolygons.entries()) {
    if (!allowedOrgs.has(oid)) continue;
    if (poly && poly.length>=3 && d3.polygonContains(poly, p)) {
      labels.push(byId.get(oid)?.label || oid);
    }
  }
  return labels;
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
  tooltipEl.style.background = 'rgba(17,17,17,0.85)';
  tooltipEl.style.color = '#fff';
  tooltipEl.style.fontSize = '12px';
  tooltipEl.style.padding = '6px 8px';
  tooltipEl.style.borderRadius = '4px';
  tooltipEl.style.zIndex = 1000;
  tooltipEl.style.whiteSpace = 'pre';
  tooltipEl.style.display = 'none';
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
  
  for (const nd of simAllById.values()) {
    if (nd.x == null || nd.y == null) continue;
    const dx = p[0] - nd.x, dy = p[1] - nd.y;
    if ((dx*dx + dy*dy) <= r*r) { 
      nodeLabel = nd.label || String(nd.id); 
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
  
  const lines = nodeLabel ? [nodeLabel, ...hits] : hits;
  if (lines.length) {
    showTooltip(event.clientX, event.clientY, lines);
  } else {
    hideTooltip();
  }
}

// Color mapping for OEs (harmonious palette)
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

function updateFooterStats(subgraph) {
  // Update total loaded stats
  const nodesTotal = raw.nodes.length;
  const linksTotal = raw.links.length;
  const orgsTotal = raw.orgs.length;
  
  document.getElementById('stats-nodes-total').textContent = nodesTotal;
  document.getElementById('stats-links-total').textContent = linksTotal;
  document.getElementById('stats-orgs-total').textContent = orgsTotal;
  
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
  populateCombo("");
  buildOrgLegend(new Set());
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
        if (wType === 'org' && !allowedOrgs.has(w)) continue;
        if (!seen.has(w)) { seen.add(w); dist.set(w, d + 1); q.push(w); }
      }
      // Additionally: Person -> Org via forward memberOf in up mode
      if (vType === 'person') {
        for (const w of out.get(v) || []) {
          const wType = byId.get(w)?.type;
          if (wType !== 'org') continue;
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
      row.appendChild(spacer);
    }
    row.appendChild(chk);
    row.appendChild(chip);
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
      const subtreeIds = new Set(
        subRoot ? Array.from(subRoot.querySelectorAll('input[id^="org_"]')).map(cb => cb.id.replace('org_','')) : []
      );
            showLegendMenu(e.clientX, e.clientY, {
        onShowAll: () => {
          // include the clicked parent itself
          allowedOrgs.add(oid);
          subtreeIds.forEach(id => allowedOrgs.add(id));
          // Update checkboxes in this subtree
          if (subRoot) Array.from(subRoot.querySelectorAll('input[id^="org_"]')).forEach(c => c.checked = true);
          const selfCb = li.querySelector(`#org_${oid}`);
          if (selfCb) selfCb.checked = true;
          syncGraphAndLegendColors();
        },
        onHideAll: () => {
          // include the clicked parent itself
          allowedOrgs.delete(oid);
          subtreeIds.forEach(id => allowedOrgs.delete(id));
          if (subRoot) Array.from(subRoot.querySelectorAll('input[id^="org_"]')).forEach(c => c.checked = false);
          const selfCb = li.querySelector(`#org_${oid}`);
          if (selfCb) selfCb.checked = false;
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
  // Keep allowedOrgs in sync with legend checkboxes
  const newAllowed = new Set();
  root.querySelectorAll('.legend-list input[id^="org_"]').forEach(cb => { if (cb.checked) newAllowed.add(cb.id.replace('org_','')); });
  allowedOrgs = newAllowed;
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
  el.appendChild(mkItem('Alle einblenden', () => {}));
  el.appendChild(mkItem('Alle ausblenden', () => {}));
  document.body.appendChild(el);
  legendMenuEl = el;
  // Dismiss on click elsewhere
  document.addEventListener('click', (e) => { if (legendMenuEl && legendMenuEl.style.display === 'block') hideLegendMenu(); });
  return el;
}
function showLegendMenu(x, y, actions) {
  const el = ensureLegendMenu();
  // Wire actions
  const items = el.querySelectorAll('div');
  items[0].onclick = () => { hideLegendMenu(); actions.onShowAll(); };
  items[1].onclick = () => { hideLegendMenu(); actions.onHideAll(); };
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.display = 'block';
}
function hideLegendMenu() { if (legendMenuEl) legendMenuEl.style.display = 'none'; }

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

  // Kreise und Labels
  node.append("circle").attr("r", nodeRadius).attr("class", "node-circle");
  node.append("text")
    .text(d => d.label ?? d.id)
    .attr("x", 10)
    .attr("y", 4)
    .attr("class", "label");

  // Tooltips für Knoten
  node.on('mousemove', (event, d) => {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    const [mx, my] = d3.pointer(event, svg.node());
    const p = currentZoomTransform ? currentZoomTransform.invert([mx, my]) : [mx, my];
    const lines = [d.label || String(d.id), ...clustersAtPoint(p)];
    showTooltip(event.clientX, event.clientY, lines);
  });
  node.on('mouseleave', hideTooltip);

  // Force-Simulation-Parameter
  const linkDistance = cssNumber('--link-distance', 60);
  const linkStrength = cssNumber('--link-strength', 0.4);
  const chargeStrength = cssNumber('--charge-strength', -200);

  // Simulation erstellen
  const simulation = d3.forceSimulation(personNodes)
    .force("link", d3.forceLink(linksPP).id(d => String(d.id)).distance(linkDistance).strength(linkStrength))
    .force("charge", d3.forceManyBody().strength(chargeStrength))
    .force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2))
    .force("collide", d3.forceCollide().radius(nodeRadius + collidePadding));
  
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
  const input = document.querySelector(INPUT_COMBO_ID);
  const depthVal = parseInt(document.querySelector(INPUT_DEPTH_ID).value, 10);
  const dirEl = document.querySelector('input[name="dir"]:checked');
  const mode = dirEl ? dirEl.value : 'both';
  let startId = currentSelectedId;
  if (!startId && input && input.value) {
    startId = guessIdFromInput(input.value);
  }
  if (!startId) { setStatus("Startknoten nicht gefunden"); return; }
  const sub = computeSubgraph(startId, Number.isFinite(depthVal) ? depthVal : 2, mode);
  currentSubgraph = sub;
  renderGraph(sub);
  updateFooterStats(sub);
  // update legend to only include orgs related to the START node
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

window.addEventListener("DOMContentLoaded", async () => {
  await loadEnvConfig();
  await loadData();
  const applyBtn = document.querySelector(BTN_APPLY_ID);
  if (applyBtn) applyBtn.addEventListener("click", applyFromUI);
  const input = document.querySelector(INPUT_COMBO_ID);
  const list = document.querySelector(LIST_COMBO_ID);
  const mgmt = document.querySelector('#toggleManagement');
  if (mgmt) {
    if (envConfig?.DEFAULT_MANAGEMENT != null) {
      managementEnabled = !!envConfig.DEFAULT_MANAGEMENT;
      mgmt.checked = managementEnabled;
    } else {
      managementEnabled = !!mgmt.checked;
    }
    mgmt.addEventListener('change', () => {
      managementEnabled = !!mgmt.checked;
      applyFromUI();
    });
  }
  const auto = document.querySelector('#toggleAutoFit');
  if (auto) {
    autoFitEnabled = !!auto.checked;
    auto.addEventListener('change', () => {
      autoFitEnabled = !!auto.checked;
      if (autoFitEnabled) {
        fitToViewport();
      }
    });
  }
  const lbls = document.querySelector('#toggleLabels');
  if (lbls) {
    if (envConfig?.DEFAULT_LABELS != null) {
      labelsVisible = !!envConfig.DEFAULT_LABELS;
      lbls.checked = labelsVisible;
    } else {
      labelsVisible = !!lbls.checked;
    }
    lbls.addEventListener('change', () => {
      labelsVisible = !!lbls.checked;
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
  const dirRadios = document.querySelectorAll('input[name="dir"]');
  if (envConfig?.DEFAULT_DIR) {
    const targetRadio = document.querySelector(`input[name="dir"][value="${envConfig.DEFAULT_DIR}"]`);
    if (targetRadio) targetRadio.checked = true;
  }
  dirRadios.forEach(r => r.addEventListener('change', applyFromUI));
  
  // Hierarchy single-checkbox toggle
  const hier = document.querySelector('#toggleHierarchy');
  if (hier) {
    if (envConfig?.DEFAULT_HIERARCHY != null) {
      hier.checked = !!envConfig.DEFAULT_HIERARCHY;
    }
    currentLayoutMode = hier.checked ? 'hierarchy' : 'force';
    hier.addEventListener('change', () => {
      currentLayoutMode = hier.checked ? 'hierarchy' : 'force';
      if (currentSimulation) switchLayout(currentLayoutMode, currentSimulation);
    });
  }

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
      if (input) input.value = startNode.label || String(startNode.id);
      try { applyFromUI(); } catch(_) {}
    }
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
  // Gemeinsame Force-Stärken und Distanzen [CMV]
  const LINK_DISTANCE = 80;
  const LINK_STRENGTH = 0.7;
  const CHARGE_STRENGTH = -250;
  const COLLIDE_RADIUS = 15;
  const COLLIDE_STRENGTH = 0.7;
  const CENTER_STRENGTH = 0.05;
  
  // Spezifische Parameter für Hierarchie-Layout
  const LEVEL_HEIGHT = 200; // Vertikaler Abstand zwischen Hierarchie-Ebenen
  const LEVEL_FORCE_STRENGTH = 0.25; // Stärke der Ebenen-Ausrichtungskraft (0.1-0.5)
  
  // Fixierte Positionen zurücksetzen [DRY]
  nodes.forEach(n => {
    n.fx = null;
    n.fy = null;
  });

  // Grundlegende Forces für beide Modi konfigurieren [DRY]
  simulation
    .force("link", d3.forceLink(links).id(d => d.id)
      .distance(LINK_DISTANCE)
      .strength(LINK_STRENGTH))
    .force("charge", d3.forceManyBody()
      .strength(CHARGE_STRENGTH))
    .force("collide", d3.forceCollide()
      .radius(COLLIDE_RADIUS)
      .strength(COLLIDE_STRENGTH))
    .force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2)
      .strength(CENTER_STRENGTH))
    .alphaDecay(0.05) // Optimierte Konvergenz für besseres Layout [PA]
    .velocityDecay(0.5); // Optimierte Dämpfung für flüssigere Bewegung [PA]

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
  } else {
    // Im Force-Modus die level-Force entfernen
    simulation.force("level", null);
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

