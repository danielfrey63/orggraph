/**
 * Cluster-Berechnungs-System [DRY][PA]
 * Verwaltet die Berechnung und Darstellung von OE-Clustern.
 */

import * as d3 from 'd3';
import { cssNumber } from '../utils/css.js';

/**
 * Berechnet die konvexe Hülle mit Padding für eine Gruppe von Knoten [SF]
 * @param {Array} nodes - Array von Knoten mit x,y Koordinaten
 * @param {number} pad - Padding um die Hülle
 * @returns {Array} Array von [x,y] Punkten für das Polygon
 */
export function computeClusterPolygon(nodes, pad) {
  const pts = nodes.map(n => [n.x, n.y]);
  const r = cssNumber('--node-radius', 8) + pad;
  
  if (pts.length === 0) return [];
  
  if (pts.length === 1) {
    const [x, y] = pts[0];
    const poly = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      poly.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    return poly;
  }
  
  if (pts.length === 2) {
    const [a, b] = pts;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    return [
      [a[0] + nx * r, a[1] + ny * r],
      [b[0] + nx * r, b[1] + ny * r],
      [b[0] - nx * r, b[1] - ny * r],
      [a[0] - nx * r, a[1] - ny * r]
    ];
  }
  
  const hull = d3.polygonHull(pts);
  if (!hull || hull.length < 3) return [];
  
  const cx = d3.mean(hull, p => p[0]);
  const cy = d3.mean(hull, p => p[1]);
  
  return hull.map(([x, y]) => {
    const vx = x - cx, vy = y - cy;
    const L = Math.hypot(vx, vy) || 1;
    const s = (L + pad) / L;
    return [cx + vx * s, cy + vy * s];
  });
}

/**
 * Berechnet Nachfahren-Cache für OE-Hierarchie [PA][DRY]
 * @param {Map} orgChildren - Map von parentId -> Set(childIds)
 * @returns {Function} getDescendants(rootId) -> Set
 */
export function createDescendantsCache(orgChildren) {
  const cache = new Map();
  
  return function getDescendants(root) {
    const key = String(root);
    if (cache.has(key)) return cache.get(key);
    
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
    
    cache.set(key, res);
    return res;
  };
}

/**
 * Berechnet Cluster-Mitgliedschaften für Personen [DRY][PA]
 * @param {Object} params - Parameter-Objekt
 * @returns {Map} membersByOrg - Map von orgId -> Array von Nodes
 */
export function computeClusterMemberships({
  personIds,
  orgIds,
  allowedOrgs,
  links,
  orgChildren,
  simById,
  idOf
}) {
  const membersByOrg = new Map();
  
  if (!allowedOrgs || allowedOrgs.size === 0) {
    return membersByOrg;
  }
  
  const getDescendants = createDescendantsCache(orgChildren);
  
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
  
  for (const l of links) {
    if (!l) continue;
    
    const s = idOf(l.source), t = idOf(l.target);
    if (!personIds.has(s)) continue;
    if (!orgIds.has(t)) continue;
    
    const roots = rootForOrg.get(t);
    if (!roots || roots.size === 0) continue;
    
    const nd = simById.get(s);
    if (!nd || nd.x === null || nd.x === undefined || nd.y === null || nd.y === undefined) continue;
    
    for (const rid of roots) {
      if (!membersByOrg.has(rid)) membersByOrg.set(rid, []);
      membersByOrg.get(rid).push(nd);
    }
  }
  
  return membersByOrg;
}

/**
 * Rendert Cluster-Pfade [DRY]
 * @param {Object} params - Parameter-Objekt
 */
export function renderClusterPaths({
  clusterLayer,
  membersByOrg,
  clusterPolygons,
  colorForOrg,
  orgDepth
}) {
  if (!clusterLayer) return;
  
  const pad = cssNumber('--cluster-pad', 12);
  
  const clusterData = Array.from(membersByOrg.entries())
    .map(([oid, arr]) => ({ oid, nodes: arr }))
    .sort((a, b) => (orgDepth(a.oid) - orgDepth(b.oid)) || String(a.oid).localeCompare(String(b.oid)));
  
  const paths = clusterLayer.selectAll('path.cluster').data(clusterData, d => d.oid);
  
  paths.enter()
    .append('path')
    .attr('class', 'cluster')
    .merge(paths)
    .each(function(d) {
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
 * Findet alle Cluster an einem Punkt [SF]
 * @param {Array} point - [x, y] Koordinaten
 * @param {Map} clusterPolygons - Map von orgId -> Polygon
 * @param {Set} allowedOrgs - Set der aktiven OEs
 * @param {Map} byId - Map von id -> Node
 * @param {Function} orgDepth - Funktion für OE-Tiefe
 * @param {Function} getDisplayLabel - Funktion für Label
 * @returns {Array} Array von Labels
 */
export function clustersAtPoint(point, clusterPolygons, allowedOrgs, byId, orgDepth, getDisplayLabel) {
  const orgItems = [];
  
  for (const [oid, poly] of clusterPolygons.entries()) {
    if (!allowedOrgs.has(oid)) continue;
    if (poly && poly.length >= 3 && d3.polygonContains(poly, point)) {
      const node = byId.get(oid);
      const depth = orgDepth(oid);
      const label = getDisplayLabel(node, depth);
      orgItems.push({ id: oid, label, depth });
    }
  }
  
  orgItems.sort((a, b) => b.depth - a.depth || a.label.localeCompare(b.label));
  
  return orgItems.map(item => item.label);
}

export default {
  computeClusterPolygon,
  createDescendantsCache,
  computeClusterMemberships,
  renderClusterPaths,
  clustersAtPoint
};
