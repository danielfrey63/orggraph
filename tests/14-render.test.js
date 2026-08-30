import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { idOf, drawKindOf } from '../src/sections/09-data-load.js';
import { cssNumber, getNodeFillByLevel, countVisibleAttributeRings } from '../src/sections/08-color-geometry.js';
import {
  SVG_ID, WIDTH, HEIGHT, BFS_LEVEL_ANIMATION_DELAY_MS,
} from '../src/sections/01-config-status.js';

const d3Src = readFileSync('vendor/d3.v7.min.js', 'utf8');
const d3Mod = { exports: {} };
new Function('exports', 'module', d3Src)(d3Mod.exports, d3Mod);
const d3 = d3Mod.exports;

let mod;
let sim13;
beforeAll(async () => {
  globalThis.Logger = { log: () => {}, ts: () => '00:00:00.000' };
  sim13 = await import('../src/sections/13-clusters-simulation.js');
  mod = await import('../src/sections/14-render.js');
});

const SUB = (ids, links) => ({
  nodes: ids.map((id) => ({ id })),
  links,
});

beforeEach(() => {
  document.body.innerHTML = '<svg id="graph"></svg>';
  globalThis.d3 = d3;
  globalThis.idOf = idOf;
  globalThis.drawKindOf = drawKindOf;
  globalThis.cssNumber = cssNumber;
  globalThis.renderClusterHulls = sim13.renderClusterHulls;
  globalThis.getNodeFillByLevel = getNodeFillByLevel;
  globalThis.SVG_ID = SVG_ID;
  globalThis.WIDTH = WIDTH;
  globalThis.HEIGHT = HEIGHT;
  globalThis.BFS_LEVEL_ANIMATION_DELAY_MS = BFS_LEVEL_ANIMATION_DELAY_MS;
  globalThis.byId = new Map([
    ['p1', { id: 'p1', label: 'Boss', type: 'person' }],
    ['p2', { id: 'p2', label: 'Dev', type: 'person' }],
    ['p3', { id: 'p3', label: 'Lead', type: 'person' }],
    ['o1', { id: 'o1', label: 'Org', type: 'org' }],
  ]);
  globalThis.getDisplayLabel = (n) => globalThis.byId.get(String(n?.id))?.label || String(n?.id || '');
  globalThis.hierarchyLevels = new Map();
  globalThis.debugMode = false;
  globalThis.labelsVisible = 'all';
  globalThis.currentZoomTransform = null;
  globalThis.currentSimulation = null;
  globalThis.currentLayoutMode = 'force';
  globalThis.selectedRootIds = ['p1'];
  globalThis.currentSelectedId = 'p1';
  globalThis.clusterLayer = null;
  globalThis.clusterSimById = new Map();
  globalThis.clusterPersonIds = new Set();
  globalThis.simAllById = new Map();
  globalThis.zoomBehavior = null;
  globalThis.lastTransitionId = 1;
  globalThis.continuousSimulation = false;
  globalThis.attributesVisible = false;
  globalThis.personAttributes = new Map();
  globalThis.activeAttributes = new Set();
  globalThis.hiddenCategories = new Set();
  globalThis.countVisibleAttributeRings = countVisibleAttributeRings;
  globalThis.allowedOrgs = new Set();
  globalThis.clusterPolygons = new Map();
  globalThis.parentOf = new Map();
  globalThis.orgChildren = new Map();
  globalThis.raw = { orgs: [], links: [] };
  globalThis.oesVisible = true;
  globalThis.envConfig = null;
  globalThis.managementEnabled = false;
  globalThis.currentSubgraph = null;
  globalThis.legendMenuEl = null;
  globalThis.nodeMenuEl = null;
  globalThis.collectReportSubtree = vi.fn(() => new Set());
  globalThis.ensureTooltip = vi.fn();
  globalThis.showTooltip = vi.fn();
  globalThis.updateFooterStats = vi.fn();
  globalThis.buildHiddenLegend = vi.fn();
  globalThis.applyLegendScope = vi.fn();
  globalThis.switchLayout = vi.fn();
  globalThis.configureLayout = vi.fn();
  globalThis.temporarilyVisibleRoots = new Set();
  globalThis.allHiddenTemporarilyVisible = false;
  globalThis.hiddenByRoot = new Map();
  globalThis.hiddenNodes = new Set();
  // real layout helpers from section 13, applicator stubs elsewhere
  globalThis.createSimulation = sim13.createSimulation;
  globalThis.findPositionOutsideHull = sim13.findPositionOutsideHull;
  globalThis.radialLayoutExpansion = sim13.radialLayoutExpansion;
  globalThis.getNodesLevels = sim13.getNodesLevels;
  globalThis.refreshClusters = vi.fn();
  globalThis.updateAttributeCircles = vi.fn();
  globalThis.updateDebugZoomDisplay = vi.fn();
  globalThis.keepSimulationRunning = vi.fn();
  globalThis.handleClusterHover = vi.fn();
  globalThis.hideTooltip = vi.fn();
  globalThis.fitToViewport = vi.fn();
  globalThis.showNodeMenu = vi.fn();
  globalThis.hideSubtreeFromRoot = vi.fn();
  globalThis.setSingleRoot = vi.fn();
  globalThis.addRoot = vi.fn();
  globalThis.removeRoot = vi.fn();
  globalThis.isRoot = vi.fn(() => false);
  globalThis.applyFromUI = vi.fn();
});

afterEach(() => {
  globalThis.currentSimulation?.stop?.();
});

const nodeIds = () =>
  Array.from(document.querySelectorAll('g.node')).map((g) => d3.select(g).datum().id).sort();

describe('renderGraph', () => {
  it('builds the svg skeleton with defs, zoom layer and group structure', () => {
    mod.renderGraph(SUB(['p1', 'p2'], [{ source: 'p1', target: 'p2' }]));
    expect(document.querySelector('svg#graph defs marker#arrow path')).not.toBeNull();
    const zoom = document.querySelector('g.zoom-layer');
    expect(zoom.querySelector('g.clusters')).not.toBeNull();
    expect(zoom.querySelector('g.links')).not.toBeNull();
    expect(zoom.querySelector('g.nodes')).not.toBeNull();
  });

  it('renders only person nodes with circle and label, skipping orgs', () => {
    mod.renderGraph(SUB(['p1', 'p2', 'o1'], [
      { source: 'p1', target: 'p2' },
      { source: 'p1', target: 'o1' }, // person->org link must not render
    ]));
    expect(nodeIds()).toEqual(['p1', 'p2']);
    expect(document.querySelectorAll('g.links line')).toHaveLength(1);
    const p1 = document.querySelector('g.node');
    expect(p1.querySelector('circle.node-circle')).not.toBeNull();
    expect(p1.querySelector('text.label').textContent).toBe('Boss');
    expect(globalThis.simAllById.size).toBe(2);
    expect(globalThis.clusterPersonIds.has('p1')).toBe(true);
  });

  it('re-renders incrementally, removing exited nodes', () => {
    mod.renderGraph(SUB(['p1', 'p2'], [{ source: 'p1', target: 'p2' }]));
    globalThis.currentSimulation?.stop?.();
    mod.renderGraph(SUB(['p1'], []));
    expect(nodeIds()).toEqual(['p1']);
    expect(document.querySelectorAll('g.links line')).toHaveLength(0);
  });
});

describe('transitionGraph', () => {
  it('tears down and builds up level by level, ending on the new subgraph', async () => {
    vi.useFakeTimers();
    const oldSub = SUB(['p1', 'p2'], [{ source: 'p1', target: 'p2' }]);
    const newSub = SUB(['p1', 'p3'], [{ source: 'p1', target: 'p3' }]);
    globalThis.lastTransitionId = 7;
    const done = mod.transitionGraph(oldSub, newSub, ['p1'], 7);
    await vi.advanceTimersByTimeAsync(BFS_LEVEL_ANIMATION_DELAY_MS); // teardown level
    await vi.advanceTimersByTimeAsync(BFS_LEVEL_ANIMATION_DELAY_MS); // buildup level
    await done;
    vi.useRealTimers();
    expect(nodeIds()).toEqual(['p1', 'p3']);
  });

  it('aborts when a newer transition supersedes it', async () => {
    vi.useFakeTimers();
    const oldSub = SUB(['p1', 'p2'], [{ source: 'p1', target: 'p2' }]);
    const newSub = SUB(['p1', 'p3'], [{ source: 'p1', target: 'p3' }]);
    globalThis.lastTransitionId = 7;
    const done = mod.transitionGraph(oldSub, newSub, ['p1'], 7);
    globalThis.lastTransitionId = 8; // newer transition arrives
    await vi.advanceTimersByTimeAsync(BFS_LEVEL_ANIMATION_DELAY_MS * 3);
    await done;
    vi.useRealTimers();
    expect(nodeIds()).not.toEqual(['p1', 'p3']); // final render skipped
  });

  it('renders the new subgraph directly when nothing is added or removed', async () => {
    const sub = SUB(['p1'], []);
    globalThis.lastTransitionId = 9;
    await mod.transitionGraph(sub, sub, ['p1'], 9);
    expect(nodeIds()).toEqual(['p1']);
  });

  it('handles a null old subgraph (first render)', async () => {
    vi.useFakeTimers();
    globalThis.lastTransitionId = 10;
    const done = mod.transitionGraph(null, SUB(['p1', 'p2'], [{ source: 'p1', target: 'p2' }]), ['p1'], 10);
    await vi.advanceTimersByTimeAsync(BFS_LEVEL_ANIMATION_DELAY_MS * 2);
    await done;
    vi.useRealTimers();
    expect(nodeIds()).toEqual(['p1', 'p2']);
  });
});
