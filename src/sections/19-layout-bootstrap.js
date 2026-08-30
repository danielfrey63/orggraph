export function fitToViewport() {
  const svgEl = document.querySelector(SVG_ID);
  if (!svgEl || !zoomBehavior) return;
  const g = svgEl.querySelector('g');
  if (!g) return;
  const bbox = g.getBBox();
  if (!isFinite(bbox.width) || !isFinite(bbox.height) || bbox.width === 0 || bbox.height === 0) return;
  // Use SVG viewBox units for stable centering
  const pad = cssNumber('--viewport-fit-pad'); // in viewBox units
  const availW = Math.max(1, WIDTH - pad * 2);
  const availH = Math.max(1, HEIGHT - pad * 2);
  const scale = Math.min(availW / bbox.width, availH / bbox.height);
  const tx = (WIDTH - bbox.width * scale) / 2 - bbox.x * scale;
  const ty = (HEIGHT - bbox.height * scale) / 2 - bbox.y * scale;
  const svg = d3.select(svgEl);
  const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
  svg.transition().duration(cssNumber('--viewport-fit-ms')).call(zoomBehavior.transform, t);
}
// Nach jeder allowedOrgs-Änderung aufrufen
export function syncGraphAndLegendColors() {
  const legend = document.querySelector('#legend');
  if (legend) {
    updateLegendRowColors(legend);
    updateLegendChips(legend);
  }
  // Wir sollten die Simulation hier NICHT neu starten, da dies nur Farb-Updates sind.
  // refreshClusters zeichnet nur Pfade neu, sollte also sicher sein.
  refreshClusters();
  updateFooterStats(currentSubgraph);
}

// ========== HIERARCHY LAYOUT FUNCTIONS ==========
/**
 * Berechnet Hierarchieebenen für Knoten
 */
export function computeHierarchyLevels(nodes, links) {
  const levels = new Map();
  const nodeSet = new Set(nodes.map(n => String(n.id)));
  
  // Build parent map (manager relationships for persons)
  const managerOf = new Map(); // personId -> managerId
  const v2 = typeof og2Active === 'function' && og2Active();
  for (const l of links) {
    const s = idOf(l.source), t = idOf(l.target);
    const sNode = byId.get(s), tNode = byId.get(t);
    if (drawKindOf(sNode) === 'node' && drawKindOf(tNode) === 'node' && nodeSet.has(s) && nodeSet.has(t)) {
      // Stored edge direction (FR-7.2a): v2 descent edges point subordinate
      // -> superior (source reports to target); legacy stored manager ->
      // report. Without the inversion the hierarchy layout is upside down.
      if (v2) managerOf.set(s, t);
      else managerOf.set(t, s);
    }
  }

  // Find roots (drawn nodes without parents in this subgraph)
  const roots = nodes.filter(n => drawKindOf(n) === 'node' && !managerOf.has(String(n.id)));
  
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
    if (drawKindOf(n) === 'cluster' && !levels.has(String(n.id))) {
      levels.set(String(n.id), -1); // cluster hulls get special level
    }
  });
  
  return levels;
}

// Grenzen des Tiefen-Widgets aus den min/max-Attributen des Inputs.
function depthBounds(depthInput) {
  return {
    min: depthInput.min !== '' ? Number(depthInput.min) : 0,
    max: depthInput.max !== '' ? Number(depthInput.max) : Infinity,
  };
}

/**
 * Einziger Schreiber des Tiefen-Widgets: Input-Wert, Anzeige-Text, Tooltip und
 * Puls-Animation wechseln gemeinsam; Grenzen kommen aus den min/max-Attributen.
 */
export function setDepth(value, { pulse = true } = {}) {
  const depthControl = document.getElementById('depthControl');
  const depthInput = document.getElementById('depth');
  const depthValueDisplay = depthControl?.querySelector('.depth-value');
  if (!depthControl || !depthInput || !depthValueDisplay) return;
  const { min, max } = depthBounds(depthInput);
  const clamped = Math.max(min, Math.min(max, Number(value) || 0));
  depthInput.value = clamped;
  depthValueDisplay.textContent = clamped;
  const plural = clamped === 1 ? 'Ebene' : 'Ebenen';
  depthControl.title = `Hierarchietiefe: ${clamped} ${plural}`;
  if (pulse) {
    depthControl.classList.add('changed');
    setTimeout(() => depthControl.classList.remove('changed'), cssNumber('--depth-pulse-ms'));
  }
}

/**
 * Konfiguriert das Graph-Layout
 */
export function configureLayout(nodes, links, simulation, mode) {
  // Spezifische Parameter für Hierarchie-Layout
    const LEVEL_HEIGHT = cssNumber('--level-height'); // Vertikaler Abstand zwischen Hierarchie-Ebenen
  const LEVEL_FORCE_STRENGTH = cssNumber('--level-force-strength'); // Stärke der vertikalen Anziehungskraft
  
  // Manager-Parent-Map aufbauen für radiales Layout
  const pMap = new Map();
  for (const l of links) {
    const s = idOf(l.source), t = idOf(l.target);
    const sNode = byId.get(s), tNode = byId.get(t);
    if (drawKindOf(sNode) === 'node' && drawKindOf(tNode) === 'node') {
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
      levelToY.set(level, cssNumber('--level-top-offset') + idx * LEVEL_HEIGHT);
    });
    
    // Knoten vorpositionieren für besseren Start [SF]
    nodes.forEach(n => {
      if (!Number.isFinite(n.x)) {
        n.x = WIDTH/2 + (Math.random() - 0.5) * cssNumber('--hierarchy-jitter');
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
      if (drawKindOf(byId.get(s)) !== 'node') continue;
      if (drawKindOf(byId.get(t)) !== 'cluster') continue;
      if (!allowedOrgs.has(t)) continue;
      if (!memberships.has(s)) memberships.set(s, new Set());
      memberships.get(s).add(t);
    }
    const orgIds = new Set();
    for (const set of memberships.values()) { for (const oid of set) orgIds.add(oid); }
    const orgList = Array.from(orgIds).sort((a,b) => (orgDepth(a) - orgDepth(b)) || String(a).localeCompare(String(b)));
    const cx = WIDTH / 2, cy = HEIGHT / 2;
    const CLUSTER_RING_RADIUS = Math.min(WIDTH, HEIGHT) * cssNumber('--cluster-ring-radius-factor');
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
    const JITTER = cssNumber('--cluster-jitter');
    nodes.forEach(n => {
      const pid = String(n.id);
      const oid = primaryOf.get(pid);
      const c = (oid && centers.get(oid)) || { x: cx, y: cy };
      if (!Number.isFinite(n.x)) n.x = c.x + (Math.random() - 0.5) * JITTER;
      if (!Number.isFinite(n.y)) n.y = c.y + (Math.random() - 0.5) * JITTER;
    });
    const CLUSTER_FORCE_STRENGTH = cssNumber('--cluster-force-strength');
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
  simulation.alpha(cssNumber('--sim-restart-alpha')).restart();
}

/**
 * Wechselt zwischen Layout-Modi
 */
export function switchLayout(mode, simulation) {
  currentLayoutMode = mode;
  
  const nodes = simulation.nodes();
  const links = currentSubgraph?.links || [];
  
  // Konfiguriere Layout basierend auf Modus [DRY]
  configureLayout(nodes, links, simulation, mode);
  
    setTimeout(() => refreshClusters(), cssNumber('--sim-settle-ms'));
}

/**
 * Initialisiert die kollabierbaren Legendenbereiche
 */
export function initializeCollapsibleLegends() {
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
  
  // ENV defaults (LEGEND_*_COLLAPSED) per section; persisted state wins [SF]
  const ENV_COLLAPSE_DEFAULTS = {
    legend: 'LEGEND_OES_COLLAPSED',
    attributeContainer: 'LEGEND_ATTRIBUTES_COLLAPSED',
    hiddenLegend: 'LEGEND_HIDDEN_COLLAPSED',
  };

  // Collapse state: localStorage first, then the ENV default, then expanded.
  // Single init owner — a separate ENV initializer would be overwritten here.
  const loadCollapseState = (id) => {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(`orggraph_collapsed_${id}`);
        if (saved !== null) return saved === '1';
      }
    } catch (e) {
      console.warn('Konnte Zustand nicht laden:', e);
    }
    const envKey = ENV_COLLAPSE_DEFAULTS[id];
    return !!(envKey && typeof envConfig !== 'undefined' && envConfig && envConfig[envKey] === true);
  };
  
  // Alle Sektions-Chevrons und ihre Inhalte initialisieren
  const buttons = document.querySelectorAll('.legend-chevron');
  buttons.forEach(btn => {
    const targetId = btn.dataset.target;
    const target = document.getElementById(targetId);
    if (!target) return;
    
    // Initialen Zustand aus localStorage laden
    setLegendSectionCollapsed(btn, target, loadCollapseState(targetId));
    
    // Klick-Event für den Button
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = !target.classList.contains('collapsed');
      setLegendSectionCollapsed(btn, target, isCollapsed);
      saveCollapseState(targetId, isCollapsed);
    });
    
    // Klick-Event für die Überschrift
    {
      const header = btn.closest('.legend-header');
      if (header) {
        header.addEventListener('click', (e) => {
          // Check whether the click landed on an element opting out of the
          // header toggle. Prefer composedPath: it still contains the original
          // ancestors even if a button handler replaced its icon DOM (which
          // detaches e.target) before the event bubbled up here.
          let shouldIgnore = false;
          const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
          if (path.length) {
            for (const element of path) {
              if (element === header) break;
              if (element.hasAttribute && element.hasAttribute('data-ignore-header-click')) {
                shouldIgnore = true;
                break;
              }
            }
          } else {
            let element = e.target;
            while (element && element !== header) {
              if (element.hasAttribute && element.hasAttribute('data-ignore-header-click')) {
                shouldIgnore = true;
                break;
              }
              element = element.parentElement;
            }
          }
          
          // Wenn der Klick nicht auf den collapse-button selbst war und nicht auf ein zu ignorierendes Element
          if (!shouldIgnore && e.target !== btn) {
            const isCollapsed = !target.classList.contains('collapsed');
            setLegendSectionCollapsed(btn, target, isCollapsed);
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
      const hasValue = !!oeFilter.value.trim();
      oeFilter.classList.toggle('has-value', hasValue);
      // Filter-Icon ohne Hover nur sichtbar, wenn ein Wert vorhanden ist
      setLegendIconButtonState(oeFilterBtn, { visible: hasValue });
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
        // Grenzen kommen aus den min/max-Attributen des Inputs (Template als Quelle)
    const { min: MIN_DEPTH, max: MAX_DEPTH } = depthBounds(depthInput);

    // Up-Button: Tiefe erhöhen
    if (depthUpBtn) {
      depthUpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const current = parseInt(depthInput.value) || 0;
        if (current < MAX_DEPTH) {
          setDepth(current + 1);
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
          setDepth(current - 1);
          // Trigger change event für bestehende Handler
          depthInput.dispatchEvent(new Event('change'));
        }
      });
    }

    // Synchronisiere Anzeige mit Input-Feld (falls extern geändert)
    depthInput.addEventListener('change', () => {
      const value = parseInt(depthInput.value) || 0;
      setDepth(value, { pulse: false });
    });

    // Initiale Anzeige setzen
        const initialValue = parseInt(depthInput.value, 10);
    setDepth(isNaN(initialValue) ? (parseInt(depthInput.defaultValue, 10) || 0) : initialValue, { pulse: false });
  }
}
