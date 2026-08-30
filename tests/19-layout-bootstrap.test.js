import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  fitToViewport,
  syncGraphAndLegendColors,
  computeHierarchyLevels,
  configureLayout,
  switchLayout,
  initializeCollapsibleLegends,
} from '../src/sections/19-layout-bootstrap.js';
import { idOf, drawKindOf } from '../src/sections/09-data-load.js';
import { orgDepth, cssNumber } from '../src/sections/08-color-geometry.js';
import { setLegendSectionCollapsed, setLegendIconButtonState } from '../src/sections/12-legend-org.js';
import { SVG_ID, WIDTH, HEIGHT } from '../src/sections/01-config-status.js';

const d3Src = readFileSync('vendor/d3.v7.min.js', 'utf8');
const d3Mod = { exports: {} };
new Function('exports', 'module', d3Src)(d3Mod.exports, d3Mod);
const d3 = d3Mod.exports;

// this jsdom instance exposes no localStorage; the section guards via typeof
const lsStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: (k) => lsStore.delete(k),
  clear: () => lsStore.clear(),
};

beforeEach(() => {
  document.body.innerHTML = '';
  globalThis.localStorage.clear();
  globalThis.envConfig = null;
  globalThis.d3 = d3;
  globalThis.idOf = idOf;
  globalThis.drawKindOf = drawKindOf;
  globalThis.orgDepth = orgDepth;
    globalThis.cssNumber = cssNumber;
  globalThis.setLegendIconButtonState = setLegendIconButtonState;
  globalThis.setLegendSectionCollapsed = setLegendSectionCollapsed;
  globalThis.SVG_ID = SVG_ID;
  globalThis.WIDTH = WIDTH;
  globalThis.HEIGHT = HEIGHT;
  globalThis.byId = new Map([
    ['m', { id: 'm', type: 'person' }],
    ['a', { id: 'a', type: 'person' }],
    ['b', { id: 'b', type: 'person' }],
    ['o1', { id: 'o1', type: 'org' }],
  ]);
  globalThis.parentOf = new Map();
  globalThis.hierarchyLevels = new Map();
  globalThis.raw = { links: [{ source: 'a', target: 'o1' }] };
  globalThis.allowedOrgs = new Set(['o1']);
  globalThis.zoomBehavior = null;
  globalThis.currentSubgraph = null;
  globalThis.currentLayoutMode = 'force';
  globalThis.refreshClusters = vi.fn();
  globalThis.updateLegendRowColors = vi.fn();
  globalThis.updateLegendChips = vi.fn();
  globalThis.updateFooterStats = vi.fn();
});

const NODES = () => [
  { id: 'm', type: 'person' },
  { id: 'a', type: 'person' },
  { id: 'b', type: 'person' },
  { id: 'o1', type: 'org' },
];
const LINKS = [
  { source: 'm', target: 'a' },
  { source: 'a', target: 'b' },
];

describe('computeHierarchyLevels', () => {
  it('assigns BFS levels from manager roots and -1 to orgs', () => {
    const levels = computeHierarchyLevels(NODES(), LINKS);
    expect(levels.get('m')).toBe(0);
    expect(levels.get('a')).toBe(1);
    expect(levels.get('b')).toBe(2);
    expect(levels.get('o1')).toBe(-1);
  });

  it('treats every person as root without manager links', () => {
    const levels = computeHierarchyLevels(NODES(), []);
    expect(levels.get('m')).toBe(0);
    expect(levels.get('a')).toBe(0);
  });
});

describe('configureLayout', () => {
  it('hierarchy mode: pre-positions by level and installs the level force', () => {
    const nodes = NODES();
    const sim = d3.forceSimulation(nodes).stop();
    // forceSimulation auto-initializes x/y; reset so pre-positioning kicks in
    nodes.forEach((n) => { n.x = NaN; n.y = NaN; });
    configureLayout(nodes, LINKS, sim, 'hierarchy');
    expect(sim.force('level')).toBeTruthy();
    expect(sim.force('clusterX')).toBeFalsy();
    expect(globalThis.hierarchyLevels.get('b')).toBe(2);
    const byLevelY = nodes.filter((n) => n.type === 'person').map((n) => n.y);
    expect(byLevelY[0]).toBeLessThan(byLevelY[1]);
    expect(byLevelY[1]).toBeLessThan(byLevelY[2]);
    expect(nodes[0].level).toBe(0);
    expect(globalThis.parentOf.get('a')).toBe('m');
  });

  it('force mode: installs cluster forces around allowed org centers', () => {
    const nodes = NODES();
    const sim = d3.forceSimulation(nodes).stop();
    configureLayout(nodes, LINKS, sim, 'force');
    expect(sim.force('level')).toBeFalsy();
    expect(sim.force('clusterX')).toBeTruthy();
    expect(sim.force('clusterY')).toBeTruthy();
    for (const n of nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
    expect(sim.alpha()).toBe(1); // restarted
    sim.stop();
  });
});

describe('switchLayout', () => {
  it('sets the mode, configures the simulation and refreshes clusters', () => {
    vi.useFakeTimers();
    const nodes = NODES();
    const sim = d3.forceSimulation(nodes).stop();
    globalThis.currentSubgraph = { links: LINKS };
    switchLayout('hierarchy', sim);
    expect(globalThis.currentLayoutMode).toBe('hierarchy');
    expect(sim.force('level')).toBeTruthy();
    vi.advanceTimersByTime(100);
    expect(globalThis.refreshClusters).toHaveBeenCalled();
    vi.useRealTimers();
    sim.stop();
  });
});

describe('fitToViewport', () => {
  it('bails out without svg, zoom behavior or a usable bbox', () => {
    expect(() => fitToViewport()).not.toThrow();
    document.body.innerHTML = '<svg id="graph"><g></g></svg>';
    globalThis.zoomBehavior = { transform: vi.fn() };
    document.querySelector('#graph g').getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
    fitToViewport();
    expect(globalThis.zoomBehavior.transform).not.toHaveBeenCalled();
  });

  it('computes a centering transform and applies it via the zoom behavior', () => {
    document.body.innerHTML = '<svg id="graph"><g></g></svg>';
    document.querySelector('#graph g').getBBox = () => ({ x: 0, y: 0, width: 600, height: 400 });
    const applied = [];
    globalThis.zoomBehavior = { transform: (transition, t) => applied.push(t) };
    fitToViewport();
    expect(applied).toHaveLength(1);
    const t = applied[0];
    // scale fits the 600x400 bbox into the padded 1160x760 viewport
    expect(t.k).toBeCloseTo(Math.min(1160 / 600, 760 / 400), 5);
    expect(t.x).toBeCloseTo((WIDTH - 600 * t.k) / 2, 5);
    expect(t.y).toBeCloseTo((HEIGHT - 400 * t.k) / 2, 5);
  });
});

describe('syncGraphAndLegendColors', () => {
  it('updates legend colors/chips when present and always refreshes clusters', () => {
    document.body.innerHTML = '<div id="legend"></div>';
    syncGraphAndLegendColors();
    expect(globalThis.updateLegendRowColors).toHaveBeenCalled();
    expect(globalThis.updateLegendChips).toHaveBeenCalled();
    expect(globalThis.refreshClusters).toHaveBeenCalled();
    expect(globalThis.updateFooterStats).toHaveBeenCalledWith(null);
  });
});

describe('initializeCollapsibleLegends', () => {
  const setupDom = () => {
    document.body.innerHTML = `
      <div class="legend-header">
        <button class="legend-chevron expanded" data-target="legend"></button>
        <span class="title">OEs</span>
        <button data-ignore-header-click="true" id="ignored"></button>
      </div>
      <div id="legend"></div>
      <input id="oeFilter"><button id="oeFilterBtn"></button>
      <div id="depthControl">
        <button class="depth-up"></button>
        <span class="depth-value"></span>
        <button class="depth-down"></button>
      </div>
            <input id="depth" value="2" min="0" max="6">`;
  };

  it('toggles collapse via chevron and persists the state', () => {
    setupDom();
    initializeCollapsibleLegends();
    const chevron = document.querySelector('.legend-chevron');
    chevron.click();
    expect(document.getElementById('legend').classList.contains('collapsed')).toBe(true);
    expect(localStorage.getItem('orggraph_collapsed_legend')).toBe('1');
    chevron.click();
    expect(localStorage.getItem('orggraph_collapsed_legend')).toBe('0');
  });

  it('restores the persisted collapsed state on init', () => {
    localStorage.setItem('orggraph_collapsed_legend', '1');
    setupDom();
    initializeCollapsibleLegends();
    expect(document.getElementById('legend').classList.contains('collapsed')).toBe(true);
    expect(document.querySelector('.legend-chevron').classList.contains('collapsed')).toBe(true);
  });

  it('falls back to the ENV default when nothing is persisted; persisted wins', () => {
    globalThis.envConfig = { LEGEND_OES_COLLAPSED: true };
    setupDom();
    initializeCollapsibleLegends();
    expect(document.getElementById('legend').classList.contains('collapsed')).toBe(true);
    expect(document.querySelector('.legend-chevron').classList.contains('collapsed')).toBe(true);

    localStorage.setItem('orggraph_collapsed_legend', '0');
    setupDom();
    initializeCollapsibleLegends();
    expect(document.getElementById('legend').classList.contains('collapsed')).toBe(false);
  });

  it('header clicks toggle too, but ignore opted-out elements', () => {
    setupDom();
    initializeCollapsibleLegends();
    document.querySelector('.legend-header .title').click();
    expect(document.getElementById('legend').classList.contains('collapsed')).toBe(true);
    document.getElementById('ignored').click();
    expect(document.getElementById('legend').classList.contains('collapsed')).toBe(true); // unchanged
  });

  it('tracks the OE filter value state and clears via the filter button', () => {
    setupDom();
    initializeCollapsibleLegends();
    const filter = document.getElementById('oeFilter');
    filter.value = 'abc';
    filter.dispatchEvent(new Event('input'));
    expect(filter.classList.contains('has-value')).toBe(true);
    document.getElementById('oeFilterBtn').click();
    expect(filter.value).toBe('');
    expect(filter.classList.contains('has-value')).toBe(false);
  });

  it('depth control steps within [0, 6] and syncs the display', () => {
    setupDom();
    initializeCollapsibleLegends();
    const display = document.querySelector('.depth-value');
    const input = document.getElementById('depth');
    expect(display.textContent).toBe('2');
    document.querySelector('.depth-up').click();
    expect(input.value).toBe('3');
    input.value = '99';
    input.dispatchEvent(new Event('change'));
    expect(display.textContent).toBe('6'); // clamped display
    input.value = '0';
    input.dispatchEvent(new Event('change'));
    document.querySelector('.depth-down').click();
    expect(input.value).toBe('0'); // lower bound respected
  });
});
