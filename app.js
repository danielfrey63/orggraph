const SVG_ID = "#graph";
const STATUS_ID = "#status";
const INPUT_COMBO_ID = "#comboInput";
const LIST_COMBO_ID = "#comboList";
const INPUT_DEPTH_ID = "#depth";
const BTN_APPLY_ID = "#apply";

const WIDTH = 1200;
const HEIGHT = 800;

let raw = { nodes: [], links: [] };
let byId = new Map();
let allNodesUnique = [];
let filteredItems = [];
let activeIndex = -1;
let currentSelectedId = null;
let zoomBehavior = null;

// Read numeric CSS variables with fallback
function cssNumber(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function setStatus(msg) {
  const el = document.querySelector(STATUS_ID);
  if (el) el.textContent = msg;
}

async function loadData() {
  setStatus("Lade Daten...");
  const res = await fetch("./data.json", { cache: "no-store" });
  const data = await res.json();
  raw = data;
  // Deduplicate by ID, then sort by label (or id)
  byId = new Map(raw.nodes.map(n => [String(n.id), n]));
  allNodesUnique = Array.from(byId.values());
  populateCombo("");
  setStatus(`Daten geladen: ${raw.nodes.length} Knoten, ${raw.links.length} Kanten`);
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

function computeSubgraph(startId, depth) {
  const adj = buildAdjacency(raw.links);
  const seen = new Set();
  const dist = new Map();
  const q = [];
  if (!adj.has(startId)) return { nodes: [], links: [] };
  seen.add(startId); dist.set(startId, 0); q.push(startId);
  while (q.length) {
    const v = q.shift();
    const d = dist.get(v) || 0;
    if (d >= depth) continue;
    for (const w of adj.get(v) || []) {
      if (!seen.has(w)) { seen.add(w); dist.set(w, d + 1); q.push(w); }
    }
  }
  const nodes = Array.from(seen)
    .map(id => {
      const n = byId.get(id);
      if (!n) return null;
      // attach BFS level for layout forces
      return { ...n, level: dist.get(id) || 0 };
    })
    .filter(Boolean);
  const nodeSet = new Set(nodes.map(n => String(n.id)));
  const links = raw.links.filter(l => nodeSet.has(String(l.source)) && nodeSet.has(String(l.target)));
  return { nodes, links };
}

function renderGraph(sub) {
  const svg = d3.select(SVG_ID);
  svg.selectAll("*").remove();
  svg.attr("viewBox", [0, 0, WIDTH, HEIGHT]);

  const gZoom = svg.append("g");

  const link = gZoom.append("g")
    .selectAll("line")
    .data(sub.links)
    .join("line")
    .attr("class", "link");

  const node = gZoom.append("g")
    .selectAll("g")
    .data(sub.nodes)
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

  const simulation = d3.forceSimulation(sub.nodes)
    .force("link", d3.forceLink(sub.links).id(d => String(d.id)).distance(linkDistance).strength(linkStrength))
    .force("charge", d3.forceManyBody().strength(chargeStrength))
    .force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2))
    .force("collide", d3.forceCollide().radius(nodeRadius + collidePadding))
    .on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      node.attr("transform", d => `translate(${d.x},${d.y})`);
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
    gZoom.attr("transform", event.transform);
  });
  svg.call(zoomBehavior);
}

function applyFromUI() {
  const input = document.querySelector(INPUT_COMBO_ID);
  const depthVal = parseInt(document.querySelector(INPUT_DEPTH_ID).value, 10);
  let startId = currentSelectedId;
  if (!startId && input && input.value) {
    // if no explicit selection, try exact/partial match
    startId = guessIdFromInput(input.value);
  }
  if (!startId) { setStatus("Startknoten nicht gefunden"); return; }
  const sub = computeSubgraph(startId, Number.isFinite(depthVal) ? depthVal : 2);
  setStatus(`Subgraph: ${sub.nodes.length} Knoten, ${sub.links.length} Kanten (Tiefe ${depthVal})`);
  renderGraph(sub);
}

window.addEventListener("DOMContentLoaded", async () => {
  await loadData();
  document.querySelector(BTN_APPLY_ID).addEventListener("click", applyFromUI);
  const input = document.querySelector(INPUT_COMBO_ID);
  const list = document.querySelector(LIST_COMBO_ID);
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
});

function fitToViewport() {
  const svgEl = document.querySelector(SVG_ID);
  if (!svgEl || !zoomBehavior) return;
  const g = svgEl.querySelector('g');
  if (!g) return;
  const bbox = g.getBBox();
  if (!isFinite(bbox.width) || !isFinite(bbox.height) || bbox.width === 0 || bbox.height === 0) return;
  const rect = svgEl.getBoundingClientRect();
  const padding = 20;
  const scale = Math.min((rect.width - padding * 2) / bbox.width, (rect.height - padding * 2) / bbox.height);
  const x = -bbox.x * scale + (rect.width - bbox.width * scale) / 2;
  const y = -bbox.y * scale + (rect.height - bbox.height * scale) / 2;
  const svg = d3.select(svgEl);
  const t = d3.zoomIdentity.translate(x, y).scale(scale);
  svg.transition().duration(300).call(zoomBehavior.transform, t);
}
