/**
 * Layout-Algorithmen [SF][PA]
 * Verwaltet die Positionierung von Knoten im Graph.
 */

import { getNodeStyleParams, getGraphParam } from '../utils/css.js';
import { WIDTH, HEIGHT } from '../constants.js';

/**
 * Berechnet den äußersten sichtbaren Radius eines Knotens [SF][DRY]
 * @param {Object} node - Der Knoten
 * @param {Map} personAttributes - Attribut-Map
 * @param {Set} activeAttributes - Aktive Attribute
 * @param {boolean} attributesVisible - Sind Attribute sichtbar
 * @returns {number} Äußerster Radius
 */
export function getNodeOuterRadius(node, personAttributes, activeAttributes, attributesVisible) {
  const { radius, strokeWidth, attrCircleGap, attrCircleWidth } = getNodeStyleParams();
  
  let outerRadius = radius + (strokeWidth / 2);
  
  if (attributesVisible) {
    const personId = String(node.id);
    const nodeAttrs = personAttributes.get(personId);
    
    let attrCount = 0;
    if (nodeAttrs && nodeAttrs.size > 0) {
      for (const attrName of nodeAttrs.keys()) {
        if (activeAttributes.has(attrName)) {
          attrCount++;
        }
      }
    }
    
    outerRadius += attrCount * (attrCircleGap + attrCircleWidth);
  }
  
  return outerRadius;
}

/**
 * Positioniert Knoten gleichmäßig im Kreis [SF][DRY]
 * @param {Array} nodes - Array von Knoten
 * @param {number} centerX - Zentrum X
 * @param {number} centerY - Zentrum Y
 * @param {number} radius - Kreisradius
 * @param {number} startAngle - Startwinkel in Radiant
 */
export function positionNodesInCircle(nodes, centerX, centerY, radius, startAngle = 0) {
  if (nodes.length === 0) return;
  
  if (nodes.length === 1) {
    nodes[0].x = centerX + radius * Math.cos(startAngle);
    nodes[0].y = centerY + radius * Math.sin(startAngle);
  } else {
    const angleStep = (2 * Math.PI) / nodes.length;
    nodes.forEach((node, idx) => {
      const angle = startAngle + (idx * angleStep);
      node.x = centerX + radius * Math.cos(angle);
      node.y = centerY + radius * Math.sin(angle);
    });
  }
}

/**
 * Findet Position außerhalb der konvexen Hülle [SF][DRY]
 * @param {Array} existingNodes - Bereits positionierte Knoten
 * @param {number} margin - Abstand zur Hülle
 * @returns {Object} { x, y }
 */
export function findPositionOutsideHull(existingNodes, margin = 200) {
  if (existingNodes.length === 0) {
    return { x: WIDTH / 2 + margin, y: HEIGHT / 2 };
  }
  
  const points = existingNodes
    .filter(n => Number.isFinite(n.x) && Number.isFinite(n.y))
    .map(n => ({ x: n.x, y: n.y }));
  
  if (points.length === 0) {
    return { x: WIDTH / 2 + margin, y: HEIGHT / 2 };
  }
  
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));
  
  const centerY = (minY + maxY) / 2;
  const width = maxX - minX;
  
  return {
    x: maxX + margin + width * 0.2,
    y: centerY
  };
}

/**
 * Führt Breadth-First Expansion für radiales Layout durch [SF][DRY]
 * @param {Array} queue - Initiale Queue mit {nodeId, x, y, level}
 * @param {Map} childrenOf - Map nodeId -> [childIds]
 * @param {Map} parentsOf - Map nodeId -> [parentIds]
 * @param {Array} personNodes - Array aller Person-Knoten
 * @param {Set} positionedSet - Set bereits positionierter IDs
 * @param {boolean} includeParents - Parents einbeziehen
 * @param {Function} getOuterRadius - Funktion für Knotenradius
 */
export function radialLayoutExpansion(queue, childrenOf, parentsOf, personNodes, positionedSet, includeParents, getOuterRadius) {
  const childPadding = 4;
  
  while (queue.length > 0) {
    const current = queue.shift();
    
    const children = childrenOf.get(current.nodeId) || [];
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
        if (parentNode && getOuterRadius) {
          parentRadius = getOuterRadius(parentNode) + childPadding;
        }
        
        const startAngle = (includeParents && current.level === 0 && parents.length > 0) 
          ? -Math.PI / 2 
          : 0;
        
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
 * Initialisiert radiales Layout von Roots aus [SF]
 * @param {Object} params - Parameter
 * @returns {boolean} true wenn erfolgreich
 */
export function initializeRadialLayout({
  rootIds,
  personNodes,
  linksPP,
  getOuterRadius
}) {
  if (rootIds.length === 0) return false;
  
  const childrenOf = new Map();
  const parentsOf = new Map();
  
  linksPP.forEach(l => {
    const s = String(typeof l.source === 'object' ? l.source.id : l.source);
    const t = String(typeof l.target === 'object' ? l.target.id : l.target);
    
    if (!childrenOf.has(s)) childrenOf.set(s, []);
    childrenOf.get(s).push(t);
    
    if (!parentsOf.has(t)) parentsOf.set(t, []);
    parentsOf.get(t).push(s);
  });
  
  const positioned = new Set();
  
  rootIds.forEach((rootId, rootIndex) => {
    let rootX, rootY;
    
    if (rootIndex === 0) {
      rootX = WIDTH / 2;
      rootY = HEIGHT / 2;
    } else {
      const alreadyPositioned = personNodes.filter(n => positioned.has(String(n.id)));
      const pos = findPositionOutsideHull(alreadyPositioned, getGraphParam('nodeRadius') * 1.5);
      rootX = pos.x;
      rootY = pos.y;
    }
    
    const rootNode = personNodes.find(n => String(n.id) === rootId);
    if (rootNode) {
      rootNode.x = rootX;
      rootNode.y = rootY;
      positioned.add(rootId);
    }
    
    const queue = [{ nodeId: rootId, x: rootX, y: rootY, level: 0 }];
    radialLayoutExpansion(queue, childrenOf, parentsOf, personNodes, positioned, true, getOuterRadius);
  });
  
  return true;
}

/**
 * Berechnet BFS-Level von Roots aus [DRY]
 * @param {Array} nodes - Array von Knoten
 * @param {Set} rootIds - Set von Root-IDs
 * @param {Array} links - Array von Links
 * @param {Function} idOf - ID-Extraktionsfunktion
 * @returns {Map} nodeId -> level
 */
export function computeLevelsFromRoots(nodes, rootIds, links, idOf) {
  const levelMap = new Map();
  const adjacency = new Map();
  
  links.forEach(l => {
    const s = idOf(l.source);
    const t = idOf(l.target);
    if (!adjacency.has(s)) adjacency.set(s, []);
    if (!adjacency.has(t)) adjacency.set(t, []);
    adjacency.get(s).push(t);
    adjacency.get(t).push(s);
  });
  
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
        if (nodes.find(n => String(n.id) === nid)) {
          visited.add(nid);
          levelMap.set(nid, level + 1);
          queue.push({ id: nid, level: level + 1 });
        }
      }
    });
  }
  
  nodes.forEach(n => {
    const nid = String(n.id);
    if (!levelMap.has(nid)) levelMap.set(nid, 999);
  });
  
  return levelMap;
}

/**
 * Berechnet Hierarchie-Ebenen basierend auf Manager-Beziehungen [DRY]
 * @param {Array} nodes - Array von Knoten
 * @param {Array} links - Array von Links
 * @param {Map} byId - Map von id -> Node
 * @param {Function} idOf - ID-Extraktionsfunktion
 * @returns {Map} nodeId -> level
 */
export function computeHierarchyLevels(nodes, links, byId, idOf) {
  const levels = new Map();
  const nodeSet = new Set(nodes.map(n => String(n.id)));
  
  const managerOf = new Map();
  for (const l of links) {
    const s = idOf(l.source), t = idOf(l.target);
    const sNode = byId.get(s), tNode = byId.get(t);
    if (sNode?.type === 'person' && tNode?.type === 'person' && nodeSet.has(s) && nodeSet.has(t)) {
      managerOf.set(t, s);
    }
  }
  
  const roots = nodes.filter(n => n.type === 'person' && !managerOf.has(String(n.id)));
  
  const queue = roots.map(r => ({ id: String(r.id), level: 0 }));
  roots.forEach(r => levels.set(String(r.id), 0));
  
  while (queue.length > 0) {
    const { id, level } = queue.shift();
    
    for (const [empId, mgrId] of managerOf.entries()) {
      if (mgrId === id && !levels.has(empId)) {
        levels.set(empId, level + 1);
        queue.push({ id: empId, level: level + 1 });
      }
    }
  }
  
  nodes.forEach(n => {
    if (n.type === 'org' && !levels.has(String(n.id))) {
      levels.set(String(n.id), -1);
    }
  });
  
  return levels;
}

export default {
  getNodeOuterRadius,
  positionNodesInCircle,
  findPositionOutsideHull,
  radialLayoutExpansion,
  initializeRadialLayout,
  computeLevelsFromRoots,
  computeHierarchyLevels
};
