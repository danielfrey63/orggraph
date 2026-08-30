export async function transitionGraph(oldSub, newSub, roots, transitionId) {
  Logger.log(`[Timing] Start: transitionGraph-${transitionId}.total`);
  const oldNodes = oldSub ? oldSub.nodes : [];
  const newNodes = newSub ? newSub.nodes : [];
  
  const oldNodeIds = new Set(oldNodes.map(n => String(n.id)));
  const newNodeIds = new Set(newNodes.map(n => String(n.id)));
  
  const nodesToRemove = oldNodes.filter(n => !newNodeIds.has(String(n.id)));
  const nodesToAdd = newNodes.filter(n => !oldNodeIds.has(String(n.id)));

  Logger.log(`[Transition #${transitionId}] Roots: ${roots.join(', ')}`);
  Logger.log(`[Transition #${transitionId}] Nodes: ${oldNodes.length} -> ${newNodes.length} (Remove: ${nodesToRemove.length}, Add: ${nodesToAdd.length})`);
  
  let currentNodes = [...oldNodes];
  // Wir nutzen newSub.links als Basis für alle Links die bleiben oder kommen, 
  // und oldSub.links für die die gehen. 
  // Einfacher: Wir filtern immer die Links passend zu currentNodes aus dem jeweiligen Quell-Set.
  // Da Links Objekte sind, ist es sicherer, sie frisch zu filtern.
  // Strategie: Wir rendern immer eine Teilmenge von (Nodes die da sind) + (Links die dazu passen).
  // Da die Simulation 'links' Array erwartet, das Referenzen enthält, 
  // bauen wir das Link-Array in renderGraph eh neu bzw. d3 updated es.
  // Aber renderGraph erwartet { nodes, links }.
  
  // Wir nehmen die Union aller Links für die Übergangsphase, filtern aber auf die aktuellen Nodes.
  const allLinks = [...(oldSub ? oldSub.links : []), ...(newSub ? newSub.links : [])];
  // Deduplizieren
  const linkMap = new Map();
  allLinks.forEach(l => {
    const s = idOf(l.source);
    const t = idOf(l.target);
    linkMap.set(`${s}>${t}`, l);
  });
  const consolidatedLinks = Array.from(linkMap.values());

  const getLinksForNodes = (nodes) => {
    const nodeIds = new Set(nodes.map(n => String(n.id)));
    // WICHTIG: Neue Link-Objekte erstellen mit nur IDs (nicht Objekt-Referenzen)
    // D3's forceLink mutiert source/target zu Objekt-Referenzen, was nach Node-Wechsel
    // zu Dissoziation führt (Links zeigen auf alte Node-Objekte) [SF][REH]
    return consolidatedLinks
      .filter(l => nodeIds.has(idOf(l.source)) && nodeIds.has(idOf(l.target)))
      .map(l => ({ source: idOf(l.source), target: idOf(l.target) }));
  };

  // === PHASE 1: RÜCKBAU (TEAR-DOWN) ===
  if (nodesToRemove.length > 0) {
    Logger.log('[Timing] Start: transitionGraph.teardown');
    // Levels basierend auf den *alten* Knoten/Links berechnen (Best Effort)
    const levels = getNodesLevels(oldNodes, new Set(roots), oldSub ? oldSub.links : []);
    
    const byLevel = new Map();
    nodesToRemove.forEach(n => {
      const lvl = levels.get(String(n.id));
      if (!byLevel.has(lvl)) byLevel.set(lvl, []);
      byLevel.get(lvl).push(String(n.id));
    });
    
    const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => b - a);
    Logger.log(`[Transition #${transitionId}] Teardown Levels: ${sortedLevels.join(', ')}`);
    
    for (const level of sortedLevels) {
      if (transitionId !== lastTransitionId) {
        Logger.log(`[Transition #${transitionId}] Aborted during teardown (new transition pending)`);
        return;
      }

      const idsToRemove = new Set(byLevel.get(level));
      Logger.log(`[Transition #${transitionId}] Removing Level ${level}: ${idsToRemove.size} nodes`);
      
      currentNodes = currentNodes.filter(n => !idsToRemove.has(String(n.id)));
      const currentLinks = getLinksForNodes(currentNodes);
      
      renderGraph({ nodes: currentNodes, links: currentLinks });
      await new Promise(r => setTimeout(r, BFS_LEVEL_ANIMATION_DELAY_MS));
    }
    Logger.log(`[Timing] End: transitionGraph-${transitionId}.teardown`);
  }
  
  // Hard Sync zum Zwischenzustand (nur nodesToKeep)
  // Wir stellen sicher, dass wir exakt den State haben, bevor wir aufbauen
  const nodesToKeep = newNodes.filter(n => oldNodeIds.has(String(n.id)));
  currentNodes = [...nodesToKeep]; 
  // Hier könnten wir kurz rendern, um sicherzustellen, dass alles sauber ist
  
  // === PHASE 2: AUFBAU (BUILD-UP) ===
  if (nodesToAdd.length > 0) {
    Logger.log('[Timing] Start: transitionGraph.buildup');
    const levels = getNodesLevels(newNodes, new Set(roots), newSub.links);
    
    const byLevel = new Map();
    nodesToAdd.forEach(n => {
      const lvl = levels.get(String(n.id));
      if (!byLevel.has(lvl)) byLevel.set(lvl, []);
      byLevel.get(lvl).push(n);
    });
    
    const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => a - b);
    Logger.log(`[Transition #${transitionId}] Buildup Levels: ${sortedLevels.join(', ')}`);
    
    for (const level of sortedLevels) {
      if (transitionId !== lastTransitionId) {
        Logger.log(`[Transition #${transitionId}] Aborted during buildup (new transition pending)`);
        return;
      }

      const nodesInLevel = byLevel.get(level);
      Logger.log(`[Transition #${transitionId}] Adding Level ${level}: ${nodesInLevel.length} nodes`);
      
      currentNodes = [...currentNodes, ...nodesInLevel];
      
      // Jetzt nehmen wir bevorzugt Links aus newSub, aber unser consolidatedLinks enthält diese ja.
      // Wichtig: Links müssen aktualisiert werden.
      const currentLinks = getLinksForNodes(currentNodes);
      
      renderGraph({ nodes: currentNodes, links: currentLinks });
      await new Promise(r => setTimeout(r, BFS_LEVEL_ANIMATION_DELAY_MS));
    }
    Logger.log(`[Timing] End: transitionGraph-${transitionId}.buildup`);
  }
  
  if (transitionId !== lastTransitionId) {
    Logger.log(`[Transition #${transitionId}] Aborted before final render`);
    return;
  }

  // Finaler Render mit frischen Link-Objekten (IDs statt Objekt-Referenzen) [SF][REH]
  const finalLinks = newSub.links.map(l => ({ source: idOf(l.source), target: idOf(l.target) }));
  renderGraph({ nodes: newSub.nodes, links: finalLinks });
  Logger.log(`[Timing] End: transitionGraph-${transitionId}.total`);
}

/**
 * Rendert den Graphen basierend auf dem berechneten Subgraphen
 */
export function renderGraph(sub) {
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
  const arrowLen = cssNumber('--arrow-length');
  const linkStroke = cssNumber('--link-stroke-width');
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
  // Presentation lives in styles.css (#arrow path) and the export stylesheet
  arrowPath.attr("d", "M 0 0 L 10 5 L 0 10 z");

  // Zoom-Container (einmalig)
  let gZoom = svg.select("g.zoom-layer");
  if (gZoom.empty()) {
    gZoom = svg.append("g").attr("class", "zoom-layer");
  }

  // Nur Verbindungen zwischen gezeichneten Graph-Knoten anzeigen (§9.2)
  const personIdsInSub = new Set(sub.nodes.filter(n => drawKindOf(byId.get(String(n.id)) || n) === 'node').map(n => String(n.id)));
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
      update => update.attr("marker-end", "url(#arrow)"), // Ensure marker stays
      exit => exit.remove()
    )
    .call(applyDiffClasses);

  // Debug-Link-Labels (optional)
  let linkLabelGroup = gZoom.select("g.link-labels");
  if (linkLabelGroup.empty()) {
    linkLabelGroup = gZoom.append("g").attr("class", "link-labels");
  }
  const linkLabel = linkLabelGroup
    .selectAll("text")
    .data(linksPP, d => `${idOf(d.source)}|${idOf(d.target)}`)
        .join(enter => enter.append("text")
      .attr("class", "link-label")
      .attr("dy", cssNumber('--link-label-dy')));

  // Nur Graph-Knoten (Draw-Kind 'node') rendern; Cluster werden als Hüllen gezeichnet
  const personNodes = sub.nodes.filter(n => drawKindOf(byId.get(String(n.id)) || n) === 'node');
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
    )
    // Diff mode (§5/FR-8.6): added/removed/changed classification per node.
    .call(applyDiffClasses);

  // Styling-Parameter
  const nodeRadius = cssNumber('--node-radius');
  const collidePadding = cssNumber('--collide-padding');
  const circleGap = cssNumber('--attribute-circle-gap');
  const circleWidth = cssNumber('--attribute-circle-stroke-width');
  const nodeStrokeWidth = cssNumber('--node-with-attributes-stroke-width');
  
  // Hauptkreis und Label nur für neue Knoten hinzufügen
  const nodeEnter = node.filter(function() { return this.childElementCount === 0; });
  nodeEnter.append("circle").attr("r", nodeRadius).attr("class", "node-circle")
    .style("fill", d => getNodeFillByLevel(d));
  nodeEnter.append("text")
    .text(d => debugMode ? `(${Math.round(d.x || 0)}, ${Math.round(d.y || 0)})` : getDisplayLabel(d))
    .attr("x", cssNumber('--label-x-offset'))
    .attr("y", cssNumber('--label-y-offset'))
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
    
    Logger.log('[Layout] Radiales Initial-Layout', { rootIds, nodeCount: personNodes.length });
    
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
        const pos = findPositionOutsideHull(alreadyPositioned, cssNumber('--node-radius') * cssNumber('--root-spacing-radius-factor'));
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
    
    Logger.log('[Layout] Erweitere Layout mit neuen Knoten', { newCount: newNodeIds.size });
    
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

    // New root nodes have no positioned parent and would otherwise fall into
    // the random center fallback, landing in the middle of the existing cloud.
    // Place them outside the hull instead and expand their subtree from there.
    const rootIds = selectedRootIds.length > 0 ? selectedRootIds : [currentSelectedId].filter(Boolean);
    for (const rootIdRaw of rootIds) {
      const rootId = String(rootIdRaw);
      if (!newNodeIds.has(rootId)) continue;
      const rootNode = personNodes.find(n => String(n.id) === rootId);
      if (!rootNode) continue;
      const alreadyPositioned = personNodes.filter(n => positioned.has(String(n.id)));
      const pos = findPositionOutsideHull(alreadyPositioned, cssNumber('--node-radius') * cssNumber('--root-spacing-radius-factor'));
      rootNode.x = pos.x;
      rootNode.y = pos.y;
      positioned.add(rootId);
      queue.push({ nodeId: rootId, x: pos.x, y: pos.y, level: 0 });
    }

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
    const nodeLabel = getDisplayLabel(d);
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
      onUnhide: hiddenByRoot.has(pid) ? () => unhideSubtree(pid) : null,
      onOnlyDirectChildren: () => {
        setSingleRoot(pid);
        currentSelectedId = pid;
                setDepth(1, { pulse: false });
        applyFromUI('contextDirectChildren');
      },
      onSetAsRoot: () => {
        // Setze als neue Root - Simulation NICHT auf null setzen [SF][DRY]
        // Die Positionen müssen erhalten bleiben für transitionGraph
        setSingleRoot(pid);
        currentSelectedId = pid;
        const input = document.querySelector(INPUT_COMBO_ID);
        if (input) input.value = getDisplayLabel(d);
        applyFromUI('contextSetRoot');
      },
      isRoot: isRoot(pid),
      onRemoveRoot: () => { removeRoot(pid); applyFromUI('contextRemoveRoot'); },
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
    simulation.alpha(cssNumber('--sim-update-alpha')).restart();
  } else {
    simulation = createSimulation(personNodes, linksPP);
  }

  // Tick-Handler für Animation
  simulation.on("tick", () => {
    const nodeStrokeWidth = cssNumber('--node-stroke-width');
    const nodeOuter = nodeRadius + (nodeStrokeWidth / 2);
    
    // Funktion zur Berechnung des äussersten Attributring-Radius für einen Knoten
    const getOutermostAttributeRadius = (d) => {
      // Wenn Attribute ausgeblendet sind, nur Hauptknoten-Radius verwenden [SF]
      if (!attributesVisible) {
        return nodeRadius;
      }
      
      const circleGap = cssNumber('--attribute-circle-gap');
      const circleWidth = cssNumber('--attribute-circle-stroke-width');
      const nodeStrokeWidth = cssNumber('--node-with-attributes-stroke-width');

      // Only rings that are actually drawn (active + category visible) count
      const attrCount = countVisibleAttributeRings(d.id);

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

    // Cluster (OE-Hüllen) aktualisieren — shared hull renderer in 13
    renderClusterHulls(gClusters, personIdsInSub, simById, cssNumber('--cluster-pad'));
  });
  
  // No auto-fit after simulation ends
  simulation.on('end', () => {});

  // Optionales radiales Layout
  const radialForceStrength = cssNumber('--radial-force');
  if (radialForceStrength > 0) {
    const radialGap = cssNumber('--radial-gap');
    const radialBase = cssNumber('--radial-base');
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
      if (!event.active) simulation.alphaTarget(cssNumber('--sim-drag-alpha-target')).restart();
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
    // Simulation NICHT auf null setzen - Positionen müssen für transitionGraph erhalten bleiben
    const nodeId = String(d.id);
    setSingleRoot(nodeId);
    currentSelectedId = nodeId;
    
    // Aktualisiere UI-Input
    const input = document.querySelector(INPUT_COMBO_ID);
    if (input) input.value = getDisplayLabel(d);
    
    // Graph mit neuem Root neu berechnen und rendern
    // transitionGraph kümmert sich um den inkrementellen Übergang
    applyFromUI('doubleClickNode');
  });

  // Zoom-Verhalten
  zoomBehavior = d3.zoom().scaleExtent([cssNumber('--zoom-min'), cssNumber('--zoom-max')])
    .on("zoom", (event) => {
      currentZoomTransform = event.transform;
      gZoom.attr("transform", event.transform);
      updateDebugZoomDisplay();
    });
  svg.call(zoomBehavior);
  // Label-Sichtbarkeitsklassen setzen [SF]
  setLabelVisibility(labelsVisible);

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
    // Fallback: ENV-Zoom oder Standard-Identität [SF]
    const defaultZoom = envConfig?.TOOLBAR_ZOOM_DEFAULT;
    if (typeof defaultZoom === 'number' && defaultZoom > 0) {
      // Zentrierten Zoom mit ENV-Skalierung anwenden
      const cx = WIDTH / 2, cy = HEIGHT / 2;
      currentZoomTransform = d3.zoomIdentity.translate(cx * (1 - defaultZoom), cy * (1 - defaultZoom)).scale(defaultZoom);
      gZoom.attr("transform", currentZoomTransform);
      svg.call(zoomBehavior.transform, currentZoomTransform);
    } else {
      currentZoomTransform = d3.zoomIdentity;
    }
  }

  // Tooltips für Cluster-Überlappungen
  ensureTooltip();
  svg.on('mousemove', event => handleClusterHover(event, svg));
  svg.on('mouseleave', hideTooltip);
  
  // Simulation global speichern und Layout anwenden
  currentSimulation = simulation;
  configureLayout(personNodes, linksPP, simulation, currentLayoutMode);

  // Simulation neu starten, um Positionsänderungen (Teardown) auszugleichen
  simulation.alpha(cssNumber('--sim-reheat-alpha')).restart();
  
  // Kontinuierliche Animation fortsetzen, falls aktiviert [SF]
  if (continuousSimulation) {
    keepSimulationRunning();
  }
}

// Sole owner of the SVG label-visibility state: the mode classes on the SVG
// plus the (debug-only) link-label display toggle. renderGraph (above) and
// the toolbar label toggle (18) both route through here; the export
// stylesheet (03) mirrors the class pair.
export function setLabelVisibility(mode) {
  const svg = d3.select(SVG_ID);
  if (svg.empty()) return;
  svg.classed('labels-hidden', mode === 'none');
  svg.classed('labels-attributes-only', mode === 'attributes');
  svg.selectAll('.link-label').style('display', (debugMode && mode !== 'none') ? null : 'none');
}

// The two SVG-level label-visibility classes; setLabelVisibility (above) owns
// them, buildExportClone (03) copies them onto the export clone.
export const LABEL_VISIBILITY_CLASSES = ['labels-hidden', 'labels-attributes-only'];

// Diff mode (§5/FR-8.6): apply the classification classes additively so that
// classes owned elsewhere (e.g. has-attributes from 08) survive re-renders —
// a full class-attribute rewrite would silently wipe them.
function applyDiffClasses(sel) {
  sel.classed('diff-new', d => d.diffClass === 'diff-new')
    .classed('diff-changed', d => d.diffClass === 'diff-changed')
    .classed('diff-removed', d => d.diffClass === 'diff-removed');
}
