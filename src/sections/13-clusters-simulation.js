function refreshClusters() {
  if (!clusterLayer) return;
  
  // Early exit: Keine Cluster zeichnen wenn keine OEs ausgewählt sind [PA][SF]
  if (allowedOrgs.size === 0) {
    clusterLayer.selectAll('path.cluster').remove();
    clusterPolygons.clear();
    return;
  }
  
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
 * Hält die Simulation kontinuierlich am Laufen, wenn der Modus aktiviert ist [SF][PA]
 */
function keepSimulationRunning() {
  if (!continuousSimulation || !currentSimulation) return;
  
  // Alpha auf niedrigem Level halten für sanfte, kontinuierliche Bewegung
  if (currentSimulation.alpha() < 0.1) {
    currentSimulation.alpha(0.15).restart();
  }
  
  // Nächsten Frame planen
  requestAnimationFrame(keepSimulationRunning);
}

/**
 * Berechnet die Generation (Level) jedes Knotens relativ zu einer Menge von Root-IDs.
 * @param {Array} nodes - Array von Knoten-Objekten
 * @param {Set<string>} rootIds - Set von Root-IDs
 * @param {Array} links - Array von Links
 * @returns {Map<string, number>} Map von Node-ID zu Level (0 = Root)
 */
function getNodesLevels(nodes, rootIds, links) {
  const levelMap = new Map();
  const adjacency = new Map();
  
  // Adjazenzliste bauen (ungerichtet für Distanzberechnung)
  links.forEach(l => {
    const s = idOf(l.source);
    const t = idOf(l.target);
    if (!adjacency.has(s)) adjacency.set(s, []);
    if (!adjacency.has(t)) adjacency.set(t, []);
    adjacency.get(s).push(t);
    adjacency.get(t).push(s);
  });

  // BFS
  const queue = [];
  rootIds.forEach(rid => {
    if (nodes.find(n => String(n.id) === rid)) {
      levelMap.set(rid, 0);
      queue.push({ id: rid, level: 0 });
    }
  });

  const visited = new Set(rootIds);
  
  while (queue.length > 0) {
    const { id, level } = queue.shift();
    const neighbors = adjacency.get(id) || [];
    
    neighbors.forEach(nid => {
      if (!visited.has(nid)) {
        // Prüfen ob Knoten Teil des Subgraphen ist
        if (nodes.find(n => String(n.id) === nid)) {
          visited.add(nid);
          levelMap.set(nid, level + 1);
          queue.push({ id: nid, level: level + 1 });
        }
      }
    });
  }
  
  // Fallback für nicht erreichbare Knoten
  nodes.forEach(n => {
    const nid = String(n.id);
    if (!levelMap.has(nid)) levelMap.set(nid, 999);
  });

  return levelMap;
}

// Entferne altes TS Objekt, da Funktionalität jetzt in Logger ist
const TS = { now: Logger.ts };

// Globaler Counter für Transitionen, um Race-Conditions zu vermeiden
let lastTransitionId = 0;

/**
 * Orchestriert den Übergang zwischen zwei Subgraphen-Zuständen.
 * Führt einen schrittweisen Rückbau (Tear-Down) und Aufbau (Build-Up) durch.
 */
