import * as d3 from 'd3';
import { SVG_ID } from '../constants.js';
import { graphStore } from '../state/store.js';
import { pseudonymizationService } from '../services/pseudonymization.js';
import { findAllPersonOrgs, getOrgDepth } from '../graph/adjacency.js';

export class DetailPanel {
  constructor() {
    this.panelEl = null;
    this.lineEl = null;
    this.hoverDetailNode = null;
    this.hoverDimActive = false;
    this.hoverDimTimeout = null;
    this.hoverPanelTimeout = null;
    
    // Dependencies to be injected or retrieved from store
    this.clusterPolygons = new Map();
    this.allowedOrgs = new Set();
    this.parentOf = new Map(); // Needed for org depth
  }

  ensureDom() {
    if (!this.panelEl) {
      const canvasEl = document.querySelector('.canvas');
      if (!canvasEl) return null;

      const panel = document.createElement('div');
      panel.id = 'hoverDetailPanel';
      canvasEl.appendChild(panel);
      this.panelEl = panel;
    }

    if (!this.lineEl) {
      const svg = d3.select(SVG_ID);
      const layer = svg.select('.hover-detail-layer').empty()
        ? svg.insert('g', ':first-child').attr('class', 'hover-detail-layer')
        : svg.select('.hover-detail-layer');

      this.lineEl = layer.append('line')
        .attr('class', 'hover-detail-line')
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', 0).attr('y2', 0)
        .node();
    }

    return { panel: this.panelEl, line: this.lineEl };
  }

  updateState({ clusterPolygons, allowedOrgs, parentOf }) {
    if (clusterPolygons) this.clusterPolygons = clusterPolygons;
    if (allowedOrgs) this.allowedOrgs = allowedOrgs;
    if (parentOf) this.parentOf = parentOf;
  }

  clustersAtPoint(p) {
    const orgItems = [];
    for (const [oid, poly] of this.clusterPolygons.entries()) {
      if (!this.allowedOrgs.has(oid)) continue;
      if (poly && poly.length >= 3 && d3.polygonContains(poly, p)) {
        // Use store or service for node lookup?
        // We need 'byId' to get the node for label.
        const node = graphStore.state.byId.get(oid);
        if (node) {
          const depth = getOrgDepth(oid, this.parentOf);
          const label = pseudonymizationService.getDisplayLabel(node, depth, this.parentOf);
          orgItems.push({ id: oid, label, depth });
        }
      }
    }
    
    // Sortiere nach Tiefe absteigend
    orgItems.sort((a, b) => b.depth - a.depth || a.label.localeCompare(b.label));
    
    return orgItems.map(item => item.label);
  }

  buildTooltipLines(node) {
    const personId = String(node.id);
    const label = pseudonymizationService.getDisplayLabel(node);
    const visibleOrgs = this.clustersAtPoint([node.x, node.y]);
    
    const lines = [];
    const addLine = (text, type = 'content') => lines.push({ text, type });
    
    // Section header
    addLine(`👤 ${label}`, 'name');
    
    // Attributes
    const { personAttributes, activeAttributes } = graphStore.state;
    if (personId && personAttributes.has(personId)) {
      const attrs = personAttributes.get(personId);
      let hasAttributes = false;
      
      // Check if we have any active attributes for this person
      const activeAttrsList = [];
      for (const [attrName, attrValue] of attrs.entries()) {
        if (activeAttributes.has(attrName)) {
           activeAttrsList.push({ name: attrName, value: attrValue });
        }
      }
      
      if (activeAttrsList.length > 0) {
        addLine('📊 Attribute:', 'title');
        for (const { name, value } of activeAttrsList) {
          const displayValue = value !== '1' ? `: ${value}` : '';
          const displayName = name.replace('::', ': ');
          addLine(`  • ${displayName}${displayValue}`, 'content');
        }
        hasAttributes = true;
      }
      
      if (!hasAttributes && activeAttributes.size > 0) {
         // Only show "No active attributes" if there are active attributes globally but this person has none of them
         // Or maybe just skip? app.js showed 'Keine aktiven Attribute'
         // addLine('  • Keine aktiven Attribute', 'content');
      }
    }
    
    // All OEs
    const { raw, byId } = graphStore.state;
    const allPersonOrgs = findAllPersonOrgs(personId, raw, byId, this.parentOf, (n, d) => pseudonymizationService.getDisplayLabel(n, d, this.parentOf));
    
    // Visible OEs
    if (visibleOrgs.length > 0) {
      addLine('🔍 OEs am Cursor:', 'title');
      visibleOrgs.forEach(org => addLine(`  • ${org}`, 'content'));
    }
    
    // All OEs
    if (allPersonOrgs.length > 0) {
      addLine('🏢 Alle OE-Zugehörigkeiten:', 'title');
      allPersonOrgs.forEach(org => addLine(`  • ${org}`, 'content'));
    }
    
    return lines;
  }

  show(node, _event) {
    if (!node) return;
    this.ensureDom();
    this.hoverDetailNode = node;
    
    // Clear panel
    while (this.panelEl.firstChild) this.panelEl.removeChild(this.panelEl.firstChild);
    
    const lines = this.buildTooltipLines(node);
    lines.forEach(item => {
      const row = document.createElement('div');
      if (item.type === 'name') row.className = 'detail-row detail-name';
      else if (item.type === 'title') row.className = 'detail-row detail-title';
      else row.className = 'detail-row';
      row.textContent = item.text;
      this.panelEl.appendChild(row);
    });

    // Highlight
    this.hoverDimActive = true;
    document.body.classList.add('hover-dim-active');
    d3.selectAll(SVG_ID + ' .node').classed('is-hover-target', d => d === node);

    // Position panel
    const t = d3.zoomTransform(d3.select(SVG_ID).node()) || d3.zoomIdentity;
    const [nx] = t.apply([node.x, node.y]);

    this.panelEl.style.left = '';
    this.panelEl.style.right = '';
    this.panelEl.style.transformOrigin = '';

    if (nx < 350) {
      this.panelEl.style.left = 'auto';
      this.panelEl.style.right = '16px';
      this.panelEl.style.transformOrigin = 'right center';
    } else {
      this.panelEl.style.left = '16px';
      this.panelEl.style.right = 'auto';
      this.panelEl.style.transformOrigin = 'left center';
    }

    this.panelEl.style.visibility = 'visible';

    requestAnimationFrame(() => {
      this.updateLinePosition(node);
      d3.select(this.lineEl).classed('visible', true);
      
      if (this.hoverPanelTimeout) clearTimeout(this.hoverPanelTimeout);
      this.hoverPanelTimeout = setTimeout(() => {
        if (this.hoverDetailNode === node) {
          this.panelEl.classList.add('visible');
        }
      }, 200);
    });
  }

  hide() {
    this.hoverDetailNode = null;
    this.hoverDimActive = false;
    document.body.classList.remove('hover-dim-active');
    d3.selectAll(SVG_ID + ' .node').classed('is-hover-target', false);
    
    if (this.panelEl) {
      this.panelEl.classList.remove('visible');
      this.panelEl.style.visibility = '';
    }
    if (this.lineEl) {
      d3.select(this.lineEl).classed('visible', false);
    }
    if (this.hoverPanelTimeout) clearTimeout(this.hoverPanelTimeout);
  }

  updateLinePosition(node) {
    if (!this.lineEl || !this.hoverDetailNode || this.hoverDetailNode !== node) return;
    const svg = d3.select(SVG_ID);
    const svgNode = svg.node();
    if (!svgNode || !this.panelEl) return;

    const t = d3.zoomTransform(svgNode) || d3.zoomIdentity;
    const [sx, sy] = t.apply([node.x, node.y]);
    const panelRect = this.panelEl.getBoundingClientRect();

    const distToLeft = Math.abs(sx - panelRect.left);
    const distToRight = Math.abs(sx - panelRect.right);
    const panelTargetX = (distToLeft < distToRight) ? panelRect.left : panelRect.right;
    const panelCenterY = panelRect.top + (this.panelEl.clientHeight / 2);

    let ax = panelTargetX;
    let ay = panelCenterY;

    try {
      const pt = svgNode.createSVGPoint();
      pt.x = panelTargetX;
      pt.y = panelCenterY;
      const svgP = pt.matrixTransform(svgNode.getScreenCTM().inverse());
      ax = svgP.x;
      ay = svgP.y;
    } catch (e) {
      const svgRect = svgNode.getBoundingClientRect();
      ax = panelTargetX - svgRect.left;
      ay = panelCenterY - svgRect.top;
    }

    d3.select(this.lineEl)
      .attr('x1', sx)
      .attr('y1', sy)
      .attr('x2', ax)
      .attr('y2', ay);
  }
}

export const detailPanel = new DetailPanel();
