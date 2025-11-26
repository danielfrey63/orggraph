/**
 * D3-Simulation-Konfiguration [SF][PA]
 * Verwaltet die Force-Simulation für das Graph-Layout.
 */

import * as d3 from 'd3';
import { cssNumber, getSimulationParams } from '../utils/css.js';
import { WIDTH, HEIGHT } from '../constants.js';

/**
 * Erstellt und konfiguriert die D3-Simulation [SF][DRY]
 * @param {Array} nodes - Knoten-Array
 * @param {Array} links - Link-Array
 * @param {Function} getCollideRadius - Funktion für Kollisionsradius
 * @returns {d3.Simulation}
 */
export function createSimulation(nodes, links, getCollideRadius) {
  const params = getSimulationParams();
  const nodeRadius = cssNumber('--node-radius', 8);
  const collidePadding = cssNumber('--collide-padding', 6);
  
  const defaultCollideRadius = (_d) => nodeRadius + collidePadding;
  
  return d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links)
      .id(d => String(d.id))
      .distance(params.linkDistance)
      .strength(params.linkStrength))
    .force("charge", d3.forceManyBody().strength(params.chargeStrength))
    .force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2).strength(params.centerStrength))
    .force("collide", d3.forceCollide()
      .radius(getCollideRadius || defaultCollideRadius)
      .strength(params.collideStrength))
    .alphaDecay(params.alphaDecay)
    .velocityDecay(params.velocityDecay);
}

/**
 * Hält Simulation kontinuierlich am Laufen [SF][PA]
 * @param {d3.Simulation} simulation - Die Simulation
 * @param {Function} isEnabled - Funktion die prüft ob Modus aktiv
 */
export function keepSimulationRunning(simulation, isEnabled) {
  if (!isEnabled() || !simulation) return;
  
  if (simulation.alpha() < 0.1) {
    simulation.alpha(0.15).restart();
  }
  
  requestAnimationFrame(() => keepSimulationRunning(simulation, isEnabled));
}

/**
 * Konfiguriert die Simulation für Hierarchie-Layout [SF]
 * @param {d3.Simulation} simulation - Die Simulation
 * @param {Map} hierarchyLevels - Level-Map
 * @param {Array} nodes - Knoten-Array
 */
export function configureHierarchyForces(simulation, hierarchyLevels, nodes) {
  const params = getSimulationParams();
  const LEVEL_HEIGHT = params.levelHeight;
  const LEVEL_FORCE_STRENGTH = params.levelForceStrength;
  
  const sortedLevels = Array.from(new Set(Array.from(hierarchyLevels.values()))).sort((a, b) => a - b);
  const levelToY = new Map();
  sortedLevels.forEach((level, idx) => {
    levelToY.set(level, 100 + idx * LEVEL_HEIGHT);
  });
  
  nodes.forEach(n => {
    if (!Number.isFinite(n.x)) {
      n.x = WIDTH / 2 + (Math.random() - 0.5) * 100;
    }
    if (!Number.isFinite(n.y)) {
      const level = hierarchyLevels.get(String(n.id)) ?? 0;
      n.y = levelToY.get(level) ?? HEIGHT / 2;
    }
  });
  
  simulation.force("level", d3.forceY(d => {
    const level = hierarchyLevels.get(String(d.id)) ?? 0;
    return levelToY.get(level) ?? HEIGHT / 2;
  }).strength(LEVEL_FORCE_STRENGTH));
  
  simulation.force("clusterX", null);
  simulation.force("clusterY", null);
}

/**
 * Konfiguriert die Simulation für Force-Layout mit Cluster-Anziehung [SF]
 * @param {d3.Simulation} simulation - Die Simulation
 * @param {Array} nodes - Knoten-Array
 * @param {Object} params - Layout-Parameter
 */
export function configureClusterForces(simulation, nodes, { 
  memberships, 
  orgDepth, 
  allowedOrgs: _allowedOrgs 
}) {
  simulation.force("level", null);
  
  const orgIds = new Set();
  for (const set of memberships.values()) {
    for (const oid of set) orgIds.add(oid);
  }
  
  const orgList = Array.from(orgIds).sort((a, b) => 
    (orgDepth(a) - orgDepth(b)) || String(a).localeCompare(String(b))
  );
  
  const cx = WIDTH / 2, cy = HEIGHT / 2;
  const CLUSTER_RING_RADIUS = Math.min(WIDTH, HEIGHT) * 0.35;
  const centers = new Map();
  
  for (let i = 0; i < Math.max(1, orgList.length); i++) {
    const angle = (2 * Math.PI * i) / Math.max(1, orgList.length);
    const oid = orgList[i] ?? null;
    if (oid) {
      centers.set(oid, {
        x: cx + Math.cos(angle) * CLUSTER_RING_RADIUS,
        y: cy + Math.sin(angle) * CLUSTER_RING_RADIUS
      });
    }
  }
  
  const primaryOf = new Map();
  for (const [pid, set] of memberships.entries()) {
    let best = null, bestDepth = -1;
    for (const oid of set) {
      const d = orgDepth(oid);
      if (d > bestDepth) {
        bestDepth = d;
        best = oid;
      }
    }
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

export default {
  createSimulation,
  keepSimulationRunning,
  configureHierarchyForces,
  configureClusterForces
};
