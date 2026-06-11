import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  updateDebugZoomDisplay,
  updateAttributeStats,
  updateFooterStats,
  handleClusterHover,
  ensureTooltip,
  orgDepth,
} from '../src/sections/08-color-geometry.js';
import { getDisplayLabel } from '../src/sections/06-pseudo-labels.js';
import { idOf } from '../src/sections/09-data-load.js';
import { STATUS_ID } from '../src/sections/01-config-status.js';

beforeEach(() => {
  globalThis.STATUS_ID = STATUS_ID;
  globalThis.debugMode = false;
  globalThis.currentZoomTransform = null;
  globalThis.attributeTypes = new Map();
  globalThis.activeAttributes = new Set();
  globalThis.personAttributes = new Map();
  globalThis.clusterPolygons = new Map();
  globalThis.allowedOrgs = new Set();
  globalThis.parentOf = new Map();
  globalThis.orgParent = new Map();
  globalThis.orgDepth = orgDepth;
  globalThis.getDisplayLabel = getDisplayLabel;
  globalThis.pseudonymizationEnabled = false;
  globalThis.pseudoData = null;
  globalThis.idOf = idOf;
  globalThis.simAllById = new Map();
  globalThis.raw = { nodes: [{ id: 'p1' }, { id: 'p2' }, { id: 'o1' }], links: [{ source: 'p1', target: 'p2' }, { source: 'p1', target: 'o1' }], orgs: [{ id: 'o1' }] };
  globalThis.byId = new Map();
  globalThis.d3 = { pointer: () => [0, 0] };
});

describe('updateDebugZoomDisplay', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="status"></div>'; });

  it('resets the status when debug mode is off', () => {
    document.querySelector('#status').textContent = 'Zoom: …';
    updateDebugZoomDisplay();
    expect(document.querySelector('#status').textContent).toBe('Bereit');
  });

  it('keeps quiet without a zoom transform and formats zoom/offset with one', () => {
    globalThis.debugMode = true;
    updateDebugZoomDisplay();
    expect(document.querySelector('#status').textContent).toBe('');
    globalThis.currentZoomTransform = { k: 1.2345, x: 10.6, y: -3.2 };
    updateDebugZoomDisplay();
    expect(document.querySelector('#status').textContent).toBe('Zoom: 1.23 | Offset: (11, -3)');
  });
});

describe('updateAttributeStats', () => {
  it('renders active/loaded attribute counts', () => {
    document.body.innerHTML = '<span id="stats-attributes-count">0</span>';
    globalThis.attributeTypes = new Map([['A', '#f00'], ['B', '#0f0']]);
    globalThis.activeAttributes = new Set(['A']);
    updateAttributeStats();
    expect(document.getElementById('stats-attributes-count').textContent).toBe('1/2');
  });
});

describe('updateFooterStats', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <span id="stats-nodes-total"></span><span id="stats-links-total"></span>
      <span id="stats-orgs-total"></span><span id="stats-attributes-count">0</span>
      <span id="stats-nodes-visible"></span><span id="stats-links-visible"></span>
      <span id="stats-orgs-display"><span id="stats-orgs-count"></span></span>`;
  });

  const text = (id) => document.getElementById(id).textContent;

  it('renders totals and zeroes visible counts without a subgraph', () => {
    updateFooterStats(null);
    expect(text('stats-nodes-total')).toBe('3');
    expect(text('stats-links-total')).toBe('2'); // two raw links in fixture
    expect(text('stats-orgs-total')).toBe('1');
    expect(text('stats-nodes-visible')).toBe('0');
    expect(text('stats-links-visible')).toBe('0');
  });

  it('renders visible counts from the subgraph and the active-org count', () => {
    globalThis.allowedOrgs = new Set(['o1', 'o2']);
    updateFooterStats({ nodes: [1, 2], links: [1] });
    expect(text('stats-nodes-visible')).toBe('2');
    expect(text('stats-links-visible')).toBe('1');
    expect(text('stats-orgs-count')).toBe('2');
  });

  it('shows cluster count separately when it differs from active orgs', () => {
    globalThis.allowedOrgs = new Set(['o1']);
    globalThis.clusterPolygons = new Map([['o1', []], ['o2', []]]);
    updateFooterStats(null);
    expect(document.getElementById('stats-orgs-display').textContent).toBe('Aktive OEs: 1 (Cluster: 2)');
  });
});

describe('handleClusterHover', () => {
  const svgSel = { node: () => ({}) };
  const event = { clientX: 5, clientY: 7 };

  beforeEach(() => {
    // showTooltip requires the module-internal tooltip element (created at app init)
    ensureTooltip();
    globalThis.currentZoomTransform = { invert: (p) => p };
  });

  it('shows person tooltip lines when hovering a node', () => {
    globalThis.simAllById = new Map([['p1', { id: 'p1', label: 'Alice', x: 0, y: 0 }]]);
    handleClusterHover(event, svgSel);
    const tooltip = document.querySelector('.graph-tooltip, [class*="tooltip"]') || document.body.lastElementChild;
    expect(tooltip.style.display).toBe('block');
    expect(tooltip.textContent).toContain('👤 Alice');
  });

  it('shows cluster labels when hovering only an org area', () => {
    globalThis.byId = new Map([['o1', { id: 'o1', label: 'Company', type: 'org' }]]);
    globalThis.allowedOrgs = new Set(['o1']);
    globalThis.clusterPolygons = new Map([['o1', [[-10, -10], [10, -10], [10, 10], [-10, 10]]]]);
    globalThis.d3 = {
      pointer: () => [0, 0],
      polygonContains: () => true,
    };
    handleClusterHover(event, svgSel);
    expect(document.body.lastElementChild.textContent).toContain('🏢 OE-Bereiche:');
    expect(document.body.lastElementChild.textContent).toContain('Company');
  });

  it('hides the tooltip when nothing is hit or no transform exists', () => {
    handleClusterHover(event, svgSel); // empty maps -> no hit
    const el = document.body.lastElementChild;
    if (el) expect(el.style.display).not.toBe('block');
    globalThis.currentZoomTransform = null;
    expect(() => handleClusterHover(event, svgSel)).not.toThrow();
  });
});
