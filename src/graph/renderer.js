import * as d3 from 'd3';
import { SVG_ID, WIDTH, HEIGHT, BFS_LEVEL_ANIMATION_DELAY_MS } from '../constants.js';
import { cssNumber, getGraphParam } from '../utils/css.js';
import { computeClusterMemberships, renderClusterPaths } from './clusters.js';
import { idOf, getOrgDepth } from './adjacency.js';
import { createSimulation as createSimulationUtil, configureHierarchyForces, configureClusterForces } from './simulation.js';
import { getNodeOuterRadius as getNodeOuterRadiusUtil, findPositionOutsideHull, radialLayoutExpansion, computeLevelsFromRoots, computeHierarchyLevels } from './layout.js';
import { graphStore } from '../state/store.js';
import { pseudonymizationService } from '../services/pseudonymization.js';

/**
 * GraphRenderer encapsulates all D3 rendering concerns.
 */
export class GraphRenderer {
  constructor({ svgSelector = SVG_ID, onNodeClick = null } = {}) {
    this.svgSelector = svgSelector;
    this.onNodeClick = onNodeClick;

    // D3 / simulation state
    this.currentSimulation = null;
    this.continuousSimulation = false;

    // Zoom state
    this.currentZoomTransform = d3.zoomIdentity;
    this.zoomBehavior = null;

    // Hover detail state
    this.hoverDetailNode = null;
    this.hoverDimActive = false;
    
    // SVG selections
    this.svg = null;
    this.gZoom = null;
    this.gClusters = null;
    this.linkGroup = null;
    this.nodeGroup = null;
    this.linkLabelGroup = null;

    // Cluster state (visual only)
    this.clusterLayer = null;
    this.clusterSimById = new Map();
    this.clusterPersonIds = new Set();
    this.clusterPolygons = new Map();

    this._initSvg();
  }

  // --- Public API ---

  setContinuousSimulation(enabled) {
    this.continuousSimulation = !!enabled;
    if (this.continuousSimulation && this.currentSimulation) {
      this._keepSimulationRunning();
    }
  }

  update(subgraph) {
    if (!subgraph || !Array.isArray(subgraph.nodes) || !Array.isArray(subgraph.links)) return;
    this._renderGraph(subgraph);
  }

  /**
   * Orchestrates the transition between two subgraph states.
   */
  async transition(oldSub, newSub, roots) {
    const oldNodes = oldSub ? oldSub.nodes : [];
    const newNodes = newSub ? newSub.nodes : [];
    
    const oldNodeIds = new Set(oldNodes.map(n => String(n.id)));
    const newNodeIds = new Set(newNodes.map(n => String(n.id)));
    
    const nodesToRemove = oldNodes.filter(n => !newNodeIds.has(String(n.id)));
    const nodesToAdd = newNodes.filter(n => !oldNodeIds.has(String(n.id)));

    // Helper to filter links for current node set
    const allLinks = [...(oldSub ? oldSub.links : []), ...(newSub ? newSub.links : [])];
    const linkMap = new Map();
    allLinks.forEach(l => {
      const s = idOf(l.source);
      const t = idOf(l.target);
      linkMap.set(`${s}>${t}`, l);
    });
    const consolidatedLinks = Array.from(linkMap.values());

    const getLinksForNodes = (nodes) => {
      const nodeIds = new Set(nodes.map(n => String(n.id)));
      return consolidatedLinks
        .filter(l => nodeIds.has(idOf(l.source)) && nodeIds.has(idOf(l.target)))
        .map(l => ({ source: idOf(l.source), target: idOf(l.target) }));
    };

    let currentNodes = [...oldNodes];

    // Tear-down
    if (nodesToRemove.length > 0) {
      const levels = computeLevelsFromRoots(oldNodes, new Set(roots), oldSub ? oldSub.links : [], idOf);
      const byLevel = new Map();
      nodesToRemove.forEach(n => {
        const lvl = levels.get(String(n.id));
        if (!byLevel.has(lvl)) byLevel.set(lvl, []);
        byLevel.get(lvl).push(String(n.id));
      });
      const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => b - a);

      for (const level of sortedLevels) {
        const idsToRemove = new Set(byLevel.get(level));
        currentNodes = currentNodes.filter(n => !idsToRemove.has(String(n.id)));
        const currentLinks = getLinksForNodes(currentNodes);
        this._renderGraph({ nodes: currentNodes, links: currentLinks });
        await new Promise(r => setTimeout(r, BFS_LEVEL_ANIMATION_DELAY_MS));
      }
    }

    // Sync to keep nodes
    const nodesToKeep = newNodes.filter(n => oldNodeIds.has(String(n.id)));
    currentNodes = [...nodesToKeep];

    // Build-up
    if (nodesToAdd.length > 0) {
      const levels = computeLevelsFromRoots(newNodes, new Set(roots), newSub.links, idOf);
      const byLevel = new Map();
      nodesToAdd.forEach(n => {
        const lvl = levels.get(String(n.id));
        if (!byLevel.has(lvl)) byLevel.set(lvl, []);
        byLevel.get(lvl).push(n);
      });
      const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => a - b);

      for (const level of sortedLevels) {
        const nodesInLevel = byLevel.get(level);
        currentNodes = [...currentNodes, ...nodesInLevel];
        const currentLinks = getLinksForNodes(currentNodes);
        this._renderGraph({ nodes: currentNodes, links: currentLinks });
        await new Promise(r => setTimeout(r, BFS_LEVEL_ANIMATION_DELAY_MS));
      }
    }

    // Final render
    const finalLinks = newSub.links.map(l => ({ source: idOf(l.source), target: idOf(l.target) }));
    this._renderGraph({ nodes: newSub.nodes, links: finalLinks });
    
    // Signal ready (optional)
    if (this.svg) this.svg.node().dataset.ready = 'true';
  }

  highlight(nodesOrIds) {
    if (!this.svg) return;
    const ids = new Set();
    (nodesOrIds || []).forEach(n => {
      if (!n) return;
      ids.add(typeof n === 'object' && n.id != null ? String(n.id) : String(n));
    });
    this.svg.selectAll('.node').classed('is-hover-target', d => d && ids.has(String(d.id)));
  }

  zoomTo(kOrOptions) {
    if (!this.svg || !this.zoomBehavior) return;
    let transform;
    if (typeof kOrOptions === 'number') {
      const k = kOrOptions;
      const cx = WIDTH / 2;
      const cy = HEIGHT / 2;
      transform = d3.zoomIdentity.translate(cx * (1 - k), cy * (1 - k)).scale(k);
    } else if (kOrOptions && typeof kOrOptions === 'object') {
      const { k = 1, x = 0, y = 0 } = kOrOptions;
      transform = d3.zoomIdentity.translate(x, y).scale(k);
    } else {
      transform = d3.zoomIdentity;
    }
    this.currentZoomTransform = transform;
    this.gZoom.attr('transform', transform);
    this.svg.call(this.zoomBehavior.transform, transform);
  }

  fitToViewport() {
    if (!this.svg || !this.gZoom) return;
    
    // Get graph bounds
    // Note: We need the bbox of content, specifically gClusters, gLinks, gNodes.
    // Or just gZoom bbox if it contains everything.
    const bounds = this.gZoom.node().getBBox();
    
    // If empty or invalid, reset
    if (bounds.width === 0 || bounds.height === 0) {
      this.zoomTo(1);
      return;
    }
    
    const parent = this.svg.node().parentElement;
    const fullWidth = parent.clientWidth || WIDTH;
    const fullHeight = parent.clientHeight || HEIGHT;
    
    const midX = bounds.x + bounds.width / 2;
    const midY = bounds.y + bounds.height / 2;
    
    if (midX === 0 && midY === 0 && bounds.width === 0) return;
    
    const scale = 0.9 / Math.max(bounds.width / fullWidth, bounds.height / fullHeight);
    
    // Apply zoom
    const transform = d3.zoomIdentity
      .translate(fullWidth / 2 - scale * midX, fullHeight / 2 - scale * midY)
      .scale(scale);
      
    this.currentZoomTransform = transform;
    this.gZoom.transition().duration(750).attr('transform', transform);
    this.svg.transition().duration(750).call(this.zoomBehavior.transform, transform);
  }

  // --- Debug / Param Updates ---

  updateSimulationParams() {
    if (!this.currentSimulation) return;
    
    // Link distance
    const linkForce = this.currentSimulation.force('link');
    if (linkForce) {
      linkForce.distance(getGraphParam('linkDistance'));
      linkForce.strength(getGraphParam('linkStrength'));
    }
    
    // Charge
    const chargeForce = this.currentSimulation.force('charge');
    if (chargeForce) {
      chargeForce.strength(getGraphParam('chargeStrength'));
    }
    
    // Collision
    const collideForce = this.currentSimulation.force('collide');
    if (collideForce) {
      // Recalculate collision radius based on node radius + attributes
      collideForce.radius(d => this._getCollideRadius(d));
    }
    
    // Global parameters
    this.currentSimulation.alphaDecay(getGraphParam('alphaDecay'));
    this.currentSimulation.velocityDecay(getGraphParam('velocityDecay'));
  }

  updateVisualParams() {
    this._updateNodeVisuals();
    this._updateLabelVisuals();
    this._updateLinkVisuals();
    this._updateAttributeCircles();
  }

  restartSimulation() {
    if (this.currentSimulation) {
      this.currentSimulation.alpha(0.3).restart();
    }
  }

  updateLayout() {
    if (!this.currentSimulation) return;
    
    const { currentLayoutMode, raw, allowedOrgs, orgChildren, parentOf, byId } = graphStore.state;
    const nodes = this.currentSimulation.nodes();
    const links = this.currentSimulation.force('link')?.links() || [];
    
    // Reset defaults first
    const params = getGraphParam('centerStrength') || 0.05;
    this.currentSimulation.force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2).strength(params));
    
    if (currentLayoutMode === 'hierarchy') {
      const levels = computeHierarchyLevels(nodes, links, byId, idOf);
      configureHierarchyForces(this.currentSimulation, levels, nodes);
    } else if (currentLayoutMode === 'cluster' && allowedOrgs.size > 0) {
      // For cluster mode (if enabled in UI)
      // Note: app currently toggles between 'force' and 'hierarchy', but we can support 'cluster' too
      // or maybe 'force' IS 'cluster' if configured so?
      // Assuming 'force' is standard. 'hierarchy' is levels.
      // If we wanted cluster forces in standard mode:
      
      // Compute memberships on the fly
      const orgIds = new Set(raw.orgs.map(o => String(o.id)));
      const memberships = computeClusterMemberships({
          personIds: new Set(nodes.map(n => String(n.id))),
          orgIds,
          allowedOrgs,
          links: raw.links,
          orgChildren,
          simById: new Map(nodes.map(n => [String(n.id), n])),
          idOf
      });
      
      configureClusterForces(this.currentSimulation, nodes, {
          memberships,
          orgDepth: (id) => getOrgDepth(id, parentOf),
          allowedOrgs
      });
    } else {
      // Standard Force Layout
      this.currentSimulation.force("level", null);
      this.currentSimulation.force("clusterX", null);
      this.currentSimulation.force("clusterY", null);
    }
    
    this.currentSimulation.alpha(0.3).restart();
  }

  // --- Internal ---

  _initSvg() {
    this.svg = d3.select(this.svgSelector);
    if (this.svg.empty()) return;
    this.svg.attr('viewBox', [0, 0, WIDTH, HEIGHT]);

    let defs = this.svg.select('defs');
    if (defs.empty()) defs = this.svg.append('defs');

    // Arrow marker setup
    let arrow = defs.select('marker#arrow');
    if (arrow.empty()) arrow = defs.append('marker').attr('id', 'arrow');
    arrow.attr('viewBox', '0 0 10 10').attr('refX', 0).attr('refY', 5)
         .attr('markerUnits', 'userSpaceOnUse').attr('orient', 'auto-start-reverse');
    if (arrow.select('path').empty()) arrow.append('path').attr('d', 'M 0 0 L 10 5 L 0 10 z');
    
    // Groups
    this.gZoom = this.svg.select('g.zoom-layer');
    if (this.gZoom.empty()) this.gZoom = this.svg.append('g').attr('class', 'zoom-layer');
    
    this.gClusters = this.gZoom.select('g.clusters');
    if (this.gClusters.empty()) this.gClusters = this.gZoom.append('g').attr('class', 'clusters');
    this.clusterLayer = this.gClusters;

    this.linkGroup = this.gZoom.select('g.links');
    if (this.linkGroup.empty()) this.linkGroup = this.gZoom.append('g').attr('class', 'links');

    this.linkLabelGroup = this.gZoom.select('g.link-labels');
    if (this.linkLabelGroup.empty()) this.linkLabelGroup = this.gZoom.append('g').attr('class', 'link-labels');

    this.nodeGroup = this.gZoom.select('g.nodes');
    if (this.nodeGroup.empty()) this.nodeGroup = this.gZoom.append('g').attr('class', 'nodes');

    // Zoom behavior
    this.zoomBehavior = d3.zoom().scaleExtent([0.1, 5]).on('zoom', (event) => {
      this.currentZoomTransform = event.transform;
      this.gZoom.attr('transform', event.transform);
    });
    this.svg.call(this.zoomBehavior);
    
    // Initial visuals update
    this._updateLinkVisuals();
  }

  _renderGraph(sub) {
    if (!this.svg) this._initSvg();
    if (!this.svg) return;

    const { nodes, links } = sub;
    const { byId, debugMode, labelsVisible } = graphStore.state;

    // Filter to persons
    const personIdsInSub = new Set(nodes.filter(n => byId.get(String(n.id))?.type === 'person').map(n => String(n.id)));
    const personNodes = nodes.filter(n => personIdsInSub.has(String(n.id)));
    const linksPP = links.filter(l => personIdsInSub.has(idOf(l.source)) && personIdsInSub.has(idOf(l.target)));

    // Update cluster state
    this.clusterSimById = new Map(personNodes.map(d => [String(d.id), d]));
    this.clusterPersonIds = new Set(personNodes.map(d => String(d.id)));

    // Render Links
    this.linkGroup.selectAll('line')
      .data(linksPP, d => `${idOf(d.source)}|${idOf(d.target)}`)
      .join(
        enter => enter.append('line').attr('class', 'link').attr('marker-end', 'url(#arrow)'),
        update => update.attr('marker-end', 'url(#arrow)'),
        exit => exit.remove()
      );

    // Render Link Labels
    this.linkLabelGroup.selectAll('text')
      .data(linksPP, d => `${idOf(d.source)}|${idOf(d.target)}`)
      .join('text')
      .attr('class', 'link-label')
      .attr('text-anchor', 'middle')
      .attr('dy', -3)
      .style('display', (debugMode && labelsVisible !== 'none') ? 'block' : 'none')
      .text('link') // Placeholder
      .style('font-size', '10px').style('fill', '#666').style('pointer-events', 'none');

    // Render Nodes
    const nodeRadius = getGraphParam('nodeRadius');
    const node = this.nodeGroup.selectAll('g.node')
      .data(personNodes, d => String(d.id))
      .join(
        enter => {
          const g = enter.append('g').attr('class', 'node');
          g.append('circle').attr('r', nodeRadius).attr('class', 'node-circle');
          g.append('text').attr('x', 10).attr('y', 4).attr('class', 'label');
          return g;
        },
        update => update,
        exit => exit.remove()
      );

    // Update node content
    this._updateNodeVisuals();
    this._updateLabelVisuals(); // Update text content and size

    // Layout
    const prevPos = new Map();
    if (this.currentSimulation) {
      this.currentSimulation.nodes().forEach(n => {
        if (n && n.id != null) prevPos.set(String(n.id), { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
      });
    }
    
    this._applyLayout(personNodes, linksPP, prevPos);

    // Simulation
    if (this.currentSimulation) {
      this.currentSimulation.nodes(personNodes);
      const lf = this.currentSimulation.force('link');
      if (lf) lf.links(linksPP);
      this.currentSimulation.alpha(0.5).restart();
    } else {
      this.currentSimulation = this._createSimulation(personNodes, linksPP);
    }

    // Tick
    this.currentSimulation.on('tick', () => {
      this._ticked();
    });
    
    this.currentSimulation.on('end', () => {
      if (this.continuousSimulation) this._keepSimulationRunning();
    });

    // Drag
    const drag = d3.drag()
      .on('start', (e, d) => {
        this.isDragging = true;
        if (!e.active) this.currentSimulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => {
        this.isDragging = false;
        if (!e.active) this.currentSimulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      });
    node.call(drag);

    // Click
    node.on('click', (e, d) => {
      if (e) e.stopPropagation();
      if (this.onNodeClick) this.onNodeClick(d);
    });
    
    // Initial visuals
    this._updateLinkVisuals();
    this._updateAttributeCircles();
  }

  _ticked() {
    const arrowLen = getGraphParam('arrowSize');
    const getOutermost = (d) => this._getOutermostRadius(d);
    
    this.linkGroup.selectAll('line')
        .attr('x1', d => {
          const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
          const len = Math.hypot(dx, dy) || 1;
          const targetOuter = getOutermost(d.target);
          return d.target.x - (dx / len) * targetOuter;
        })
        .attr('y1', d => {
          const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
          const len = Math.hypot(dx, dy) || 1;
          const targetOuter = getOutermost(d.target);
          return d.target.y - (dy / len) * targetOuter;
        })
        .attr('x2', d => {
          const dx = d.source.x - d.target.x, dy = d.source.y - d.target.y;
          const len = Math.hypot(dx, dy) || 1;
          const sourceOuter = getOutermost(d.source);
          const backoff = sourceOuter + arrowLen;
          return d.source.x - (dx / len) * backoff;
        })
        .attr('y2', d => {
          const dx = d.source.x - d.target.x, dy = d.source.y - d.target.y;
          const len = Math.hypot(dx, dy) || 1;
          const sourceOuter = getOutermost(d.source);
          const backoff = sourceOuter + arrowLen;
          return d.source.y - (dy / len) * backoff;
        });

    this.nodeGroup.selectAll('g.node').attr('transform', d => `translate(${d.x},${d.y})`);
    
    this.linkLabelGroup.selectAll('text')
        .attr('x', d => (d.source.x + d.target.x) / 2)
        .attr('y', d => (d.source.y + d.target.y) / 2);
        
    this._updateClusters();
  }

  _getOutermostRadius(d) {
    const nodeRadius = getGraphParam('nodeRadius');
    const nodeStroke = getGraphParam('nodeStrokeWidth');
    const circleGap = cssNumber('--attribute-circle-gap', 4);
    
    const { personAttributes, activeAttributes, hiddenCategories, attributesVisible } = graphStore.state;
    
    if (!attributesVisible) return nodeRadius + nodeStroke / 2;
    
    const personId = String(d.id);
    const nodeAttrs = personAttributes.get(personId);
    
    if (!nodeAttrs || nodeAttrs.size === 0) return nodeRadius + nodeStroke / 2;
    
    let attrCount = 0;
    for (const attrName of nodeAttrs.keys()) {
        if (activeAttributes.has(attrName)) {
            const [cat] = attrName.split('::');
            if (!hiddenCategories.has(cat)) attrCount++;
        }
    }
    
    const additionalRings = Math.max(0, attrCount - 1);
    if (additionalRings > 0) {
        return nodeRadius + nodeStroke / 2 + additionalRings * (circleGap + nodeStroke);
    }
    return nodeRadius + nodeStroke / 2;
  }
  
  _getCollideRadius(d) {
      const outer = this._getOutermostRadius(d);
      const padding = cssNumber('--collide-padding', 6);
      return outer + padding;
  }

  _createSimulation(nodes, links) {
    return createSimulationUtil(nodes, links, (d) => this._getCollideRadius(d));
  }

  _applyLayout(personNodes, links, prevPos) {
    const childrenOf = new Map();
    const parentsOf = new Map();

    links.forEach(l => {
      const s = idOf(l.source), t = idOf(l.target);
      if (!childrenOf.has(s)) childrenOf.set(s, []);
      childrenOf.get(s).push(t);
      if (!parentsOf.has(t)) parentsOf.set(t, []);
      parentsOf.get(t).push(s);
    });

    const newNodeIds = new Set();
    personNodes.forEach(n => {
        if (!prevPos.has(String(n.id))) {
            newNodeIds.add(String(n.id));
        } else {
            // Restore previous position
            const p = prevPos.get(String(n.id));
            if (p) { n.x = p.x; n.y = p.y; n.vx = p.vx; n.vy = p.vy; }
        }
    });

    if (newNodeIds.size === 0) return; // No new nodes to layout

    if (prevPos.size === 0) {
        // First load - radial layout from root(s)
        const { selectedRootIds, currentSelectedId } = graphStore.state;
        const rootIds = selectedRootIds.length > 0 ? selectedRootIds : [currentSelectedId].filter(Boolean);
        
        if (rootIds.length === 0) {
            personNodes.forEach(n => {
                n.x = WIDTH/2 + (Math.random()-0.5)*50;
                n.y = HEIGHT/2 + (Math.random()-0.5)*50;
            });
            return;
        }

        const positioned = new Set();
        rootIds.forEach((rootId, idx) => {
            let rootX = WIDTH/2, rootY = HEIGHT/2;
            if (idx > 0) {
                const already = personNodes.filter(n => positioned.has(String(n.id)));
                const pos = findPositionOutsideHull(already, getGraphParam('nodeRadius')*1.5);
                rootX = pos.x; rootY = pos.y;
            }
            
            const rootNode = personNodes.find(n => String(n.id) === rootId);
            if (rootNode) {
                rootNode.x = rootX; rootNode.y = rootY;
                positioned.add(rootId);
            }
            const queue = [{ nodeId: rootId, x: rootX, y: rootY, level: 0 }];
            radialLayoutExpansion(queue, childrenOf, parentsOf, personNodes, positioned, true, (n) => this._getNodeOuterRadius(n));
        });
    } else {
        // Expansion: place new nodes around existing ones
        const leafNodes = [];
        personNodes.forEach(n => {
            const nodeId = String(n.id);
            if (prevPos.has(nodeId)) {
                const children = childrenOf.get(nodeId) || [];
                const existingChildren = children.filter(cid => !newNodeIds.has(cid));
                if (existingChildren.length === 0 && children.length > 0) {
                    leafNodes.push({ nodeId, x: n.x, y: n.y });
                }
            }
        });

        const queue = leafNodes.map(leaf => ({
            nodeId: leaf.nodeId, x: leaf.x, y: leaf.y, level: 0
        }));

        const positioned = new Set();
        personNodes.forEach(n => {
            if (!newNodeIds.has(String(n.id))) positioned.add(String(n.id));
        });

        radialLayoutExpansion(queue, childrenOf, parentsOf, personNodes, positioned, false, (n) => this._getNodeOuterRadius(n));
    }
  }
  
  _getNodeOuterRadius(node) {
      return getNodeOuterRadiusUtil(node, graphStore.state.personAttributes, graphStore.state.activeAttributes, graphStore.state.attributesVisible);
  }

  _updateClusters() {
    if (!this.clusterLayer) return;
    const { raw, allowedOrgs, orgChildren } = graphStore.state;
    if (!allowedOrgs || allowedOrgs.size === 0) {
        this.clusterLayer.selectAll('path.cluster').remove();
        this.clusterPolygons.clear();
        return;
    }
    
    const orgIds = new Set(raw.orgs.map(o => String(o.id)));
    const membersByOrg = computeClusterMemberships({
        personIds: this.clusterPersonIds,
        orgIds,
        allowedOrgs,
        links: raw.links,
        orgChildren,
        simById: this.clusterSimById,
        idOf
    });
    
    // Helper to get color and depth
    const getColor = (oid) => {
        const h = (this._hashCode(oid) % 12) * 30;
        return { fill: `hsla(${h}, 60%, 60%, 0.25)`, stroke: `hsla(${h}, 60%, 40%, 0.85)` };
    };
    const getDepth = (oid) => getOrgDepth(oid, graphStore.state.parentOf);

    renderClusterPaths({
        clusterLayer: this.clusterLayer,
        membersByOrg,
        clusterPolygons: this.clusterPolygons,
        colorForOrg: getColor,
        orgDepth: getDepth
    });
  }

  _updateLinkVisuals() {
    const linkStroke = getGraphParam('linkStrokeWidth');
    const arrowSize = getGraphParam('arrowSize');
    this.svg.selectAll('.link').style('stroke-width', linkStroke);
    const arrow = this.svg.select('marker#arrow');
    arrow.attr('markerWidth', arrowSize).attr('markerHeight', arrowSize + linkStroke);
  }

  _updateLabelVisuals() {
    const labelSize = getGraphParam('labelFontSize');
    this.svg.selectAll('.node text.label').style('font-size', `${labelSize}px`)
       .text(d => graphStore.state.debugMode ? this._getDebugLabel(d) : pseudonymizationService.getDisplayLabel(d));
  }
  
  _getDebugLabel(d) {
      return pseudonymizationService.getDisplayLabel(d);
  }

  _updateNodeVisuals() {
    const nodeRadius = getGraphParam('nodeRadius');
    const nodeStroke = getGraphParam('nodeStrokeWidth');
    this.svg.selectAll('.node circle.node-circle').attr('r', nodeRadius).style('stroke-width', nodeStroke);
  }

  _updateAttributeCircles() {
    // Logic to add/remove attribute circles based on graphStore.state
    const { personAttributes, activeAttributes, attributeTypes, hiddenCategories, attributesVisible, selectedRootIds, currentSelectedId } = graphStore.state;
    const nodeRadius = getGraphParam('nodeRadius');
    const nodeStroke = getGraphParam('nodeStrokeWidth');
    const circleGap = cssNumber('--attribute-circle-gap', 4);
    
    const nodes = this.svg.selectAll('.node');
    nodes.selectAll('circle.attribute-circle').remove();
    nodes.selectAll('circle.attribute-hit-area').remove();
    
    if (!attributesVisible) {
        nodes.classed('has-attributes', false);
        return;
    }
    
    nodes.each(function(d) {
        if (!d) return;
        const pid = String(d.id);
        const attrs = personAttributes.get(pid);
        
        let hasActive = false;
        let activeList = [];
        
        if (attrs) {
            activeList = Array.from(attrs.entries()).filter(([k]) => {
                if (!activeAttributes.has(k)) return false;
                const [cat] = k.split('::');
                return !hiddenCategories.has(cat);
            }).sort((a,b) => a[0].localeCompare(b[0]));
            if (activeList.length > 0) hasActive = true;
        }
        
        const g = d3.select(this);
        g.classed('has-attributes', hasActive);
        
        const mainCircle = g.select('circle.node-circle');
        
        if (hasActive) {
            // First attr colors border
            const firstColor = attributeTypes.get(activeList[0][0]);
            mainCircle.style('fill', 'var(--node-with-attributes-fill)').style('stroke', firstColor);
            
            // Additional rings
            activeList.slice(1).forEach((entry, idx) => {
                const color = attributeTypes.get(entry[0]);
                const r = nodeRadius + nodeStroke/2 + circleGap + nodeStroke/2 + idx*(circleGap+nodeStroke);
                g.insert('circle', 'circle.node-circle')
                 .attr('r', r).attr('class', 'attribute-circle')
                 .style('stroke', color).style('stroke-width', nodeStroke);
            });
            
            // Hit area
            const outerR = nodeRadius + nodeStroke/2 + (activeList.length > 1 ? (activeList.length-1)*(circleGap+nodeStroke) : 0);
            g.insert('circle', 'circle.node-circle').attr('r', outerR + circleGap).attr('class', 'attribute-hit-area').style('fill', 'transparent');
            
            // Label pos
            g.select('text.label').attr('x', outerR + 3);
        } else {
            // Reset
            mainCircle.style('stroke', null).style('fill', null); // CSS handles default?
            g.select('text.label').attr('x', nodeRadius + nodeStroke/2 + 3);
        }
    });
    
    // Root styling
    const isRoot = (id) => selectedRootIds.includes(String(id)) || String(currentSelectedId) === String(id);
    nodes.each(function(d) {
        if (isRoot(d.id)) {
            d3.select(this).select('circle.node-circle').style('fill', 'var(--root-node-fill)'); // simplify
        }
    });
  }

  _keepSimulationRunning() {
    if (!this.continuousSimulation || !this.currentSimulation) return;
    if (this.currentSimulation.alpha() < 0.1) this.currentSimulation.alpha(0.15).restart();
    requestAnimationFrame(() => this._keepSimulationRunning());
  }

  _hashCode(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
    return h >>> 0;
  }
}
