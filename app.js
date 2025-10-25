const SVG_ID = "#graph";
const STATUS_ID = "#status";
const INPUT_COMBO_ID = "#comboInput";
const LIST_COMBO_ID = "#comboList";
const INPUT_DEPTH_ID = "#depth";
const BTN_APPLY_ID = "#apply";

const WIDTH = 1200;
const HEIGHT = 800;

let raw = { nodes: [], links: [], persons: [], orgs: [] };
let byId = new Map();
let allNodesUnique = [];
let filteredItems = [];
let activeIndex = -1;
let currentSelectedId = null;
let zoomBehavior = null;
let managementEnabled = true;
let autoFitEnabled = true;
let hasSupervisor = new Set();
let clusterLayer = null;
let clusterSimById = new Map();
let clusterPersonIds = new Set();
let clusterPolygons = new Map();
let currentZoomTransform = null;
let labelsVisible = true;
let legendMenuEl = null;

function cssNumber(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
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
function handleClusterHover(event, svgSel) {
  if (!currentZoomTransform) { hideTooltip(); return; }
  const [mx,my] = d3.pointer(event, svgSel.node());
  const p = currentZoomTransform.invert([mx,my]);
  const hits = [];
  for (const [oid, poly] of clusterPolygons.entries()) {
    if (!allowedOrgs.has(oid)) continue;
    if (poly && poly.length>=3 && d3.polygonContains(poly, p)) {
      const lbl = byId.get(oid)?.label || oid;
      hits.push(lbl);
    }
  }
  if (hits.length) showTooltip(event.clientX, event.clientY, hits); else hideTooltip();
}

// Color mapping for OEs (harmonious palette)
function hashCode(str){ let h=0; for(let i=0;i<str.length;i++){ h=((h<<5)-h)+str.charCodeAt(i); h|=0; } return h>>>0; }
function colorForOrg(oid){
  const h = (hashCode(oid) % 12) * 30; // 12-step hue
  const fill = `hsla(${h}, 60%, 60%, 0.08)`;
  const stroke = `hsla(${h}, 60%, 40%, 0.25)`;
  return { fill, stroke };
}

function setStatus(msg) {
  const el = document.querySelector(STATUS_ID);
  if (el) el.textContent = msg;
}

function idOf(v) {
  return String(typeof v === 'object' && v ? v.id : v);
}

let allowedOrgs = new Set();

async function loadData() {
  setStatus("Lade Daten...");
  let data = null;
  let sourceName = 'data.json';
  try {
    const resGen = await fetch("./data.generated.json", { cache: "no-store" });
    if (resGen.ok) {
      data = await resGen.json();
      sourceName = 'data.generated.json';
    }
  } catch(_) {}
  if (!data) {
    const res = await fetch("./data.json", { cache: "no-store" });
    data = await res.json();
    sourceName = 'data.json';
  }
  // Adapt to new schema {persons, orgs, links}
  const persons = Array.isArray(data.persons) ? data.persons : [];
  const orgs = Array.isArray(data.orgs) ? data.orgs : [];
  const links = Array.isArray(data.links) ? data.links : [];

  // Merge nodes and tag types
  const nodes = [];
  const personIds = new Set();
  persons.forEach(p => { if (p && p.id) { nodes.push({ ...p, id: String(p.id), type: 'person' }); personIds.add(String(p.id)); } });
  orgs.forEach(o => { if (o && o.id) { nodes.push({ ...o, id: String(o.id), type: 'org' }); } });

  // Normalize links and keep only valid endpoints
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

  // Compute hasSupervisor set if not provided
  if (allNodesUnique.some(n => Object.prototype.hasOwnProperty.call(n, 'hasSupervisor'))) {
    hasSupervisor = new Set(allNodesUnique.filter(n => n && n.type === 'person' && n.hasSupervisor).map(n => String(n.id)));
  } else {
    try {
      hasSupervisor = new Set();
      for (const l of raw.links) {
        const s = idOf(l && l.source);
        const t = idOf(l && l.target);
        if (byId.has(s) && byId.has(t) && byId.get(s).type === 'person' && byId.get(t).type === 'person') {
          hasSupervisor.add(String(t));
        }
      }
    } catch(_) { hasSupervisor = new Set(); }
  }

  // Initialize allowed orgs (all enabled by default)
  allowedOrgs = new Set(orgs.map(o => String(o.id)));

  populateCombo("");
  // Start with empty OE legend until a subgraph is applied
  buildOrgLegend(new Set());
  setStatus(`Daten geladen (${sourceName}): ${raw.nodes.length} Knoten, ${raw.links.length} Kanten, ${orgs.length} OEs`);
}

function populateCombo(filterText) {
  const input = document.querySelector(INPUT_COMBO_ID);
  const list = document.querySelector(LIST_COMBO_ID);
  if (!input || !list) return;
  const term = (filterText || "").toLowerCase();
  filteredItems = allNodesUnique
    .filter(n => {
      if (!term) return true;
      const label = (n.label || "").toLowerCase();
      const idStr = String(n.id).toLowerCase();
      return label.includes(term) || idStr.includes(term);
    })
    .sort((a, b) => (a.label || String(a.id)).localeCompare(b.label || String(b.id)));

  list.innerHTML = '';
  activeIndex = -1;
  const frag = document.createDocumentFragment();
  filteredItems.forEach((n, idx) => {
    const li = document.createElement('li');
    const lbl = n.label || String(n.id);
    li.textContent = `${lbl} — ${n.id}`;
    li.setAttribute('data-id', String(n.id));
    li.tabIndex = -1;
    li.addEventListener('mousedown', (e) => { // mousedown to run before blur
      e.preventDefault();
      chooseItem(idx);
    });
    frag.appendChild(li);
  });
  list.appendChild(frag);
  list.hidden = true; // keep hidden until focus or explicit open
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

function guessIdFromInput(val) {
  if (!val) return null;
  const exactByLabel = raw.nodes.find(n => (n.label || "") === val);
  if (exactByLabel) return String(exactByLabel.id);
  const exactById = raw.nodes.find(n => String(n.id) === val);
  if (exactById) return String(exactById.id);
  const part = raw.nodes.find(n => (n.label || "").toLowerCase().includes(val.toLowerCase()));
  return part ? String(part.id) : null;
}

function buildAdjacency(links) {
  const adj = new Map();
  function ensure(id) { if (!adj.has(id)) adj.set(id, new Set()); }
  links.forEach(l => {
    const s = String(typeof l.source === 'object' ? l.source.id : l.source);
    const t = String(typeof l.target === 'object' ? l.target.id : l.target);
    ensure(s); ensure(t);
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
    const haveIsBasis = nodes.some(n => Object.prototype.hasOwnProperty.call(n, 'isBasis'));
    if (haveIsBasis) {
      nodes = nodes.filter(n => !n.isBasis);
    } else {
      nodes = nodes.filter(n => n.type !== 'person' || hasSupervisor.has(String(n.id)));
    }
    // Ensure managers that connect to kept persons are present so links are drawn
    const nodeSet = new Set(nodes.map(n => String(n.id)));
    for (const l of raw.links) {
      const s = idOf(l.source), t = idOf(l.target);
      if (!byId.has(s) || !byId.has(t)) continue;
      if (byId.get(s)?.type !== 'person' || byId.get(t)?.type !== 'person') continue;
      if (nodeSet.has(t) && !nodeSet.has(s)) {
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
      refreshClusters();
    });
    const lab = document.createElement('label');
    lab.setAttribute('for', idAttr);
    lab.textContent = lbl;
    // collapsible branch toggle
    const kids = Array.from(children.get(oid) || []).filter(id => !scopeProvided || scopeSet.has(id));
    const row = document.createElement('div');
    row.className = 'legend-row';
    // colorize row with OE color
    const { fill, stroke } = colorForOrg(oid);
    row.style.background = fill;
    row.style.borderLeft = `3px solid ${stroke}`;
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
    row.appendChild(lab);
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
      // debug removed
      showLegendMenu(e.clientX, e.clientY, {
        onShowAll: () => {
          // include the clicked parent itself
          allowedOrgs.add(oid);
          subtreeIds.forEach(id => allowedOrgs.add(id));
          // Update checkboxes in this subtree
          if (subRoot) Array.from(subRoot.querySelectorAll('input[id^="org_"]')).forEach(c => c.checked = true);
          const selfCb = li.querySelector(`#org_${oid}`);
          if (selfCb) selfCb.checked = true;
          refreshClusters();
        },
        onHideAll: () => {
          // include the clicked parent itself
          allowedOrgs.delete(oid);
          subtreeIds.forEach(id => allowedOrgs.delete(id));
          if (subRoot) Array.from(subRoot.querySelectorAll('input[id^="org_"]')).forEach(c => c.checked = false);
          const selfCb = li.querySelector(`#org_${oid}`);
          if (selfCb) selfCb.checked = false;
          refreshClusters();
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
}

function collectSubtree(rootId, children, scopeSet) {
  const out = new Set([rootId]);
  const q = [rootId];
  for (let i=0;i<q.length;i++) {
    const cur = q[i];
    for (const ch of (children.get(cur) || [])) {
      if (scopeSet && !scopeSet.has(ch)) continue;
      if (!out.has(ch)) { out.add(ch); q.push(ch); }
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
  const clusterData = Array.from(membersByOrg.entries()).map(([oid, arr]) => ({ oid, nodes: arr }));
  const paths = clusterLayer.selectAll('path.cluster').data(clusterData, d => d.oid);
  paths.enter().append('path').attr('class','cluster').merge(paths)
    .each(function(d){
      const poly = computeClusterPolygon(d.nodes, pad);
      clusterPolygons.set(d.oid, poly);
      const { fill, stroke } = colorForOrg(d.oid);
      const line = d3.line().curve(d3.curveCardinalClosed.tension(0.75));
      d3.select(this)
        .attr('d', line(poly))
        .style('fill', fill)
        .style('stroke', stroke);
    });
  paths.exit().remove();
}

function renderGraph(sub) {
  const svg = d3.select(SVG_ID);
  svg.selectAll("*").remove();
  svg.attr("viewBox", [0, 0, WIDTH, HEIGHT]);

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

  const gZoom = svg.append("g");

  // Filter rendering to person-person links only
  const personIdsInSub = new Set(sub.nodes.filter(n => byId.get(String(n.id))?.type === 'person').map(n => String(n.id)));
  const linksPP = sub.links.filter(l => personIdsInSub.has(idOf(l.source)) && personIdsInSub.has(idOf(l.target)));

  // Clusters layer (behind links and nodes)
  const gClusters = gZoom.append("g").attr("class", "clusters");
  clusterLayer = gClusters;

  const link = gZoom.append("g")
    .selectAll("line")
    .data(linksPP, d => `${idOf(d.source)}|${idOf(d.target)}`)
    .join("line")
    .attr("class", "link")
    .attr("marker-end", "url(#arrow)");

  // Render only person nodes
  const personNodes = sub.nodes.filter(n => byId.get(String(n.id))?.type === 'person');
  const simById = new Map(personNodes.map(d => [String(d.id), d]));
  clusterSimById = simById;
  clusterPersonIds = new Set(personNodes.map(d => String(d.id)));
  const node = gZoom.append("g")
    .selectAll("g")
    .data(personNodes)
    .join("g");

  const nodeRadius = cssNumber('--node-radius', 8);
  const collidePadding = cssNumber('--collide-padding', 6);

  const circles = node.append("circle")
    .attr("r", nodeRadius)
    .attr("class", "node-circle");

  const labels = node.append("text")
    .text(d => d.label ?? d.id)
    .attr("x", 10)
    .attr("y", 4)
    .attr("class", "label");

  const linkDistance = cssNumber('--link-distance', 60);
  const linkStrength = cssNumber('--link-strength', 0.4);
  const chargeStrength = cssNumber('--charge-strength', -200);

  const simulation = d3.forceSimulation(personNodes)
    .force("link", d3.forceLink(linksPP).id(d => String(d.id)).distance(linkDistance).strength(linkStrength))
    .force("charge", d3.forceManyBody().strength(chargeStrength))
    .force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2))
    .force("collide", d3.forceCollide().radius(nodeRadius + collidePadding))
    .on("tick", () => {
      const nodeStrokeWidth = cssNumber('--node-stroke-width', 3);
      const nodeOuter = nodeRadius + (nodeStrokeWidth / 2);
      const backoff = nodeOuter + arrowLen;
      link
        .attr("x1", d => d.target.x)
        .attr("y1", d => d.target.y)
        .attr("x2", d => {
          const x1 = d.target.x, y1 = d.target.y;
          const x2 = d.source.x, y2 = d.source.y;
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len;
          return x2 - ux * backoff;
        })
        .attr("y2", d => {
          const x1 = d.target.x, y1 = d.target.y;
          const x2 = d.source.x, y2 = d.source.y;
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len;
          return y2 - uy * backoff;
        });

      node.attr("transform", d => `translate(${d.x},${d.y})`);

      // Update clusters (OE hulls) around member persons
      const pad = cssNumber('--cluster-pad', 12);
      // Build membership map: orgId -> member person nodes present in this subgraph
      const membersByOrg = new Map();
      for (const l of raw.links) {
        const s = idOf(l.source), t = idOf(l.target);
        if (!personIdsInSub.has(s)) continue;
        const tType = byId.get(t)?.type;
        if (tType !== 'org') continue;
        if (!allowedOrgs.has(t)) continue;
        if (!membersByOrg.has(t)) membersByOrg.set(t, []);
        const nd = simById.get(s);
        if (nd && nd.x != null && nd.y != null) membersByOrg.get(t).push(nd);
      }

      // Data join for cluster paths
      const clusterData = Array.from(membersByOrg.entries()).map(([oid, arr]) => ({ oid, nodes: arr }));
      const paths = gClusters.selectAll('path.cluster').data(clusterData, d => d.oid);
      paths.enter().append('path').attr('class','cluster').merge(paths)
        .each(function(d){
          const poly = computeClusterPolygon(d.nodes, pad);
          clusterPolygons.set(d.oid, poly);
          const { fill, stroke } = colorForOrg(d.oid);
          const line = d3.line().curve(d3.curveCardinalClosed.tension(0.75));
          d3.select(this)
            .attr('d', line(poly))
            .style('fill', fill)
            .style('stroke', stroke);
        });
      paths.exit().remove();
    });
  // Re-center once the simulation has settled (if enabled)
  simulation.on('end', () => {
    if (autoFitEnabled) {
      fitToViewport();
    }
  });

  // Optional radial layout to keep deeper levels closer and less disconnected
  const radialForceStrength = cssNumber('--radial-force', 0);
  const radialGap = cssNumber('--radial-gap', 100);
  const radialBase = cssNumber('--radial-base', 0);
  if (radialForceStrength > 0) {
    simulation.force(
      "radial",
      d3.forceRadial(
        (d) => radialBase + ((d.level || 0) * radialGap),
        WIDTH / 2,
        HEIGHT / 2
      ).strength(radialForceStrength)
    );
  }

  const drag = d3.drag()
    .on("start", (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null; // release so the network can re-arrange
      d.fy = null;
    });

  node.call(drag);

  // Double-click a node to make it the new center/start node
  node.on('dblclick', (event, d) => {
    currentSelectedId = String(d.id);
    const input = document.querySelector(INPUT_COMBO_ID);
    if (input) input.value = d.label || String(d.id);
    applyFromUI();
  });

  zoomBehavior = d3.zoom().scaleExtent([0.2, 5]).on("zoom", (event) => {
    currentZoomTransform = event.transform;
    gZoom.attr("transform", event.transform);
  });
  svg.call(zoomBehavior);
  // Apply labels visibility
  svg.classed('labels-hidden', !labelsVisible);
  currentZoomTransform = d3.zoomIdentity;

  // Tooltip hover for overlapping clusters
  ensureTooltip();
  svg.on('mousemove', (event) => handleClusterHover(event, svg));
  svg.on('mouseleave', hideTooltip);
}

// Build a smooth closed path around a set of nodes
function clusterPath(nodes, pad) {
  const pts = nodes.map(n => [n.x, n.y]);
  const r = cssNumber('--node-radius', 8) + pad;
  if (pts.length === 0) return '';
  if (pts.length === 1) {
    const [x,y] = pts[0];
    const rr = r;
    return `M ${x+rr},${y} A ${rr},${rr} 0 1,0 ${x-rr},${y} A ${rr},${rr} 0 1,0 ${x+rr},${y} Z`;
  }
  if (pts.length === 2) {
    const [a,b] = pts;
    const dx = b[0]-a[0], dy = b[1]-a[1];
    const len = Math.hypot(dx,dy) || 1;
    const ux = dx/len, uy = dy/len; // along
    const nx = -uy, ny = ux;        // normal
    const p1 = [a[0] + nx*r, a[1] + ny*r];
    const p2 = [b[0] + nx*r, b[1] + ny*r];
    const p3 = [b[0] - nx*r, b[1] - ny*r];
    const p4 = [a[0] - nx*r, a[1] - ny*r];
    const line = d3.line().curve(d3.curveCardinalClosed.tension(0.75));
    return line([p1,p2,p3,p4]);
  }
  const hull = d3.polygonHull(pts);
  if (!hull || hull.length < 3) {
    // Fallback to circle around centroid
    const cx = d3.mean(pts, p=>p[0]);
    const cy = d3.mean(pts, p=>p[1]);
    const rr = r;
    return `M ${cx+rr},${cy} A ${rr},${rr} 0 1,0 ${cx-rr},${cy} A ${rr},${rr} 0 1,0 ${cx+rr},${cy} Z`;
  }
  // Pad hull outward from centroid
  const cx = d3.mean(hull, p=>p[0]);
  const cy = d3.mean(hull, p=>p[1]);
  const padded = hull.map(([x,y]) => {
    const vx = x - cx, vy = y - cy;
    const L = Math.hypot(vx,vy) || 1;
    const scale = (L + pad) / L;
    return [cx + vx*scale, cy + vy*scale];
  });
  const line = d3.line().curve(d3.curveCardinalClosed.tension(0.75));
  return line(padded);
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
  setStatus(`Subgraph: ${sub.nodes.length} Knoten, ${sub.links.length} Kanten (Tiefe ${depthVal}, ${mode})`);
  renderGraph(sub);
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
  await loadData();
  document.querySelector(BTN_APPLY_ID).addEventListener("click", applyFromUI);
  const input = document.querySelector(INPUT_COMBO_ID);
  const list = document.querySelector(LIST_COMBO_ID);
  const mgmt = document.querySelector('#toggleManagement');
  if (mgmt) {
    managementEnabled = !!mgmt.checked;
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
    labelsVisible = !!lbls.checked;
    lbls.addEventListener('change', () => {
      labelsVisible = !!lbls.checked;
      const svg = document.querySelector('#graph');
      if (svg) svg.classList.toggle('labels-hidden', !labelsVisible);
    });
  }
  if (input && list) {
    input.addEventListener('input', () => {
      currentSelectedId = null; // reset explicit selection on typing
      populateCombo(input.value);
      list.hidden = filteredItems.length === 0 ? true : false; // auto-open when typing
    });
    input.addEventListener('keydown', (e) => {
      const max = filteredItems.length - 1;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(max, activeIndex + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(-1, activeIndex - 1)); }
      else if (e.key === 'Enter') {
        if (activeIndex >= 0) { chooseItem(activeIndex); }
        applyFromUI();
      } else if (e.key === 'Escape') {
        list.hidden = true;
      }
    });
    input.addEventListener('focus', () => { if (filteredItems.length) list.hidden = false; });
    input.addEventListener('blur', () => { setTimeout(() => { list.hidden = true; }, 0); });
  }
  const fitBtn = document.querySelector('#fit');
  if (fitBtn) {
    fitBtn.addEventListener('click', fitToViewport);
  }
  // Auto-apply on depth change and direction change
  const depthEl = document.querySelector(INPUT_DEPTH_ID);
  if (depthEl) {
    depthEl.addEventListener('change', applyFromUI);
  }
  const dirRadios = document.querySelectorAll('input[name="dir"]');
  dirRadios.forEach(r => r.addEventListener('change', applyFromUI));
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
