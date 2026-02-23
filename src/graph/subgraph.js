import { graphStore } from '../state/store.js';
import { idOf, getAdjacencyCache } from './adjacency.js';

/**
 * Computes the subgraph based on start node, depth, and traversal mode.
 * @param {string} startId - The ID of the starting node.
 * @param {number} depth - The traversal depth.
 * @param {string} mode - 'down', 'up', or 'both'.
 * @returns {Object} { nodes, links, legendOrgs, legendOrgLevels }
 */
export function computeSubgraph(startId, depth, mode) {
  const { raw, byId, parentOf, hiddenNodes, managementEnabled, personToOrgs } = graphStore.state;
  
  if (!raw || !byId.has(startId)) return { nodes: [], links: [] };

  // Use cached adjacency maps [PA] [DRY] [Medium Severity Fix]
  const { out, inn } = getAdjacencyCache(raw.links, byId);
  
  const seen = new Set();
  const dist = new Map(); 
  const q = [];
  
  const startType = byId.get(startId)?.type;
  seen.add(startId); 
  dist.set(startId, 0); 
  q.push(startId);

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
        if (!seen.has(w)) { seen.add(w); dist.set(w, d + 1); q.push(w); }
      }
      
      // Additionally: Org -> Persons via inverse memberOf (Org gets its members)
      // Only permit this fan-out when the START node is an Org
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
        if (!seen.has(w)) { seen.add(w); dist.set(w, d + 1); q.push(w); }
      }
      
      // Additionally: Person -> Org via forward memberOf in up mode
      if (vType === 'person') {
        for (const w of out.get(v) || []) {
          const wType = byId.get(w)?.type;
          if (wType !== 'org') continue;
          // Note: Filtering by allowedOrgs happens later or in UI, 
          // but we traverse everything to find connections.
          if (!seen.has(w)) { seen.add(w); dist.set(w, d + 1); q.push(w); }
        }
      }
    }
  }
  
  // Collect Orgs for Legend: Only the LOWEST (leaf) OEs connected to persons in subgraph
  const legendOrgs = new Set();
  const legendOrgLevels = new Map(); // oid -> min person level activating this OE
  
  // For each person in the subgraph, find their lowest OE(s)
  // Optimization: use pre-computed personToOrgs [PA] [Medium Severity Fix]
  for (const id of seen) {
    const n = byId.get(id);
    if (n && n.type === 'person') {
      const orgs = personToOrgs.get(id);
      if (!orgs) continue;
      
      for (const oid of orgs) {
        // Check if this OE is a leaf relative to the person's org set
        let isLowest = true;
        for (const otherOid of orgs) {
          if (otherOid !== oid && parentOf.get(otherOid) === oid) {
            isLowest = false;
            break;
          }
        }
        
        if (isLowest) {
          legendOrgs.add(oid);
          const personLevel = dist.get(id) || 0;
          const prevLevel = legendOrgLevels.get(oid);
          if (prevLevel == null || personLevel < prevLevel) {
            legendOrgLevels.set(oid, personLevel);
          }
        }
      }
    }
  }
  
  // Build final nodes array
  let nodes = Array.from(seen)
    .map(id => {
      const n = byId.get(id);
      if (!n) return null;
      return { ...n, level: dist.get(id) || 0 };
    })
    .filter(Boolean);
  
  // Helper to check if a node is temporarily visible despite being hidden
  // This depends on VisibilityManager logic, but since we are in graph logic,
  // we check the store directly for 'temporarilyVisibleRoots' and 'allHiddenTemporarilyVisible'.
  // However, mapping 'hiddenByRoot' to node is needed.
  const isNodeTemporarilyVisible = (nid) => {
    const { allHiddenTemporarilyVisible, hiddenByRoot, temporarilyVisibleRoots } = graphStore.state;
    if (allHiddenTemporarilyVisible) return true;
    for (const [rootId, setIds] of hiddenByRoot.entries()) {
      if (setIds.has(nid) && temporarilyVisibleRoots.has(rootId)) {
        return true;
      }
    }
    return false;
  };

  // Filter hidden nodes
  let hiddenInThisCall = 0;
  if (hiddenNodes && hiddenNodes.size > 0) {
    const beforeCount = nodes.length;
    nodes = nodes.filter(n => {
      const nid = String(n.id);
      if (!hiddenNodes.has(nid)) return true;
      return isNodeTemporarilyVisible(nid);
    });
    hiddenInThisCall = beforeCount - nodes.length;
  }
  
  // Store the hidden count for this specific subgraph calculation
  // NOTE: This might overwrite if multiple calls happen, but usually we compute once for main view.
  graphStore.setCurrentHiddenCount(hiddenInThisCall);

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
        // Check visibility for the manager
        if (hiddenNodes && hiddenNodes.has(String(s)) && !isNodeTemporarilyVisible(String(s))) continue;
        
        // In 'down' mode, only add managers that are below or at the start node level
        if (mode === 'down' && !dist.has(s)) continue;
        
        const m = byId.get(s);
        if (m) { nodes.push({ ...m, level: (dist.get(s) || 0) }); nodeSet.add(s); }
      }
    }
  }
  
  // Build links for the result nodes
  const nodeSet = new Set(nodes.map(n => String(n.id)));
  const links = raw.links
    .map(l => ({ s: idOf(l.source), t: idOf(l.target) }))
    .filter(x => nodeSet.has(x.s) && nodeSet.has(x.t))
    .map(x => ({ source: x.s, target: x.t }));
  
  return { nodes, links, legendOrgs, legendOrgLevels };
}
