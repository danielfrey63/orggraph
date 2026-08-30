import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { idOf } from '../src/sections/09-data-load.js';
import { cssNumber, computeClusterPolygon, colorForOrg, orgDepth, countVisibleAttributeRings } from '../src/sections/08-color-geometry.js';
import { WIDTH, HEIGHT } from '../src/sections/01-config-status.js';

const d3Src = readFileSync('vendor/d3.v7.min.js', 'utf8');
const d3Mod = { exports: {} };
new Function('exports', 'module', d3Src)(d3Mod.exports, d3Mod);
const d3 = d3Mod.exports;

// section 13 references Logger at module top level -> import after globals
let mod;
beforeAll(async () => {
  globalThis.Logger = { log: () => {}, ts: () => '00:00:00.000' };
  mod = await import('../src/sections/13-clusters-simulation.js');
});

beforeEach(() => {
  document.body.innerHTML = '<svg id="graph"><g id="clusters"></g></svg>';
  globalThis.d3 = d3;
  globalThis.idOf = idOf;
  globalThis.cssNumber = cssNumber;
  globalThis.computeClusterPolygon = computeClusterPolygon;
  globalThis.colorForOrg = colorForOrg;
  globalThis.orgDepth = orgDepth;
  globalThis.WIDTH = WIDTH;
  globalThis.HEIGHT = HEIGHT;
  globalThis.clusterLayer = d3.select('#clusters');
  globalThis.allowedOrgs = new Set();
  globalThis.clusterPolygons = new Map();
  globalThis.parentOf = new Map();
  globalThis.orgChildren = new Map([['o1', new Set(['o2'])]]);
  globalThis.raw = {
    orgs: [{ id: 'o1' }, { id: 'o2' }],
    links: [
      { source: 'p1', target: 'o2' },
      { source: 'p2', target: 'o1' },
    ],
  };
  globalThis.clusterPersonIds = new Set(['p1', 'p2']);
  globalThis.clusterSimById = new Map([
    ['p1', { id: 'p1', x: 10, y: 10 }],
    ['p2', { id: 'p2', x: 50, y: 50 }],
  ]);
  globalThis.attributesVisible = true;
  globalThis.personAttributes = new Map();
  globalThis.activeAttributes = new Set();
  globalThis.hiddenCategories = new Set();
  globalThis.countVisibleAttributeRings = countVisibleAttributeRings;
  globalThis.getNodeOuterRadius = mod.getNodeOuterRadius;
  globalThis.nodeOuterRadiusMetrics = mod.nodeOuterRadiusMetrics;
  globalThis.continuousSimulation = false;
  globalThis.currentSimulation = null;
});

describe('refreshClusters', () => {
  it('clears all cluster paths when no org is selected', () => {
    globalThis.clusterLayer.append('path').attr('class', 'cluster');
    globalThis.clusterPolygons.set('o1', []);
    mod.refreshClusters();
    expect(document.querySelectorAll('path.cluster')).toHaveLength(0);
    expect(globalThis.clusterPolygons.size).toBe(0);
  });

  it('draws hulls around members of allowed root orgs including descendants', () => {
    globalThis.allowedOrgs = new Set(['o1']);
    mod.refreshClusters();
    const paths = document.querySelectorAll('path.cluster');
    expect(paths).toHaveLength(1); // both persons roll up into root o1
    expect(paths[0].getAttribute('d')).toBeTruthy();
    expect(paths[0].style.fill).toMatch(/^hsla\(/);
    expect(globalThis.clusterPolygons.has('o1')).toBe(true);
  });

  it('does nothing without a cluster layer', () => {
    globalThis.clusterLayer = null;
    expect(() => mod.refreshClusters()).not.toThrow();
  });
});

describe('getNodeOuterRadius', () => {
  it('uses base radius plus half stroke without attributes', () => {
    globalThis.attributesVisible = false;
    expect(mod.getNodeOuterRadius({ id: 'p1' })).toBeCloseTo(8 + 0.5);
  });

  it('adds one ring per active attribute', () => {
    globalThis.personAttributes = new Map([['p1', new Map([['A', '1'], ['B', '1']])]]);
    globalThis.activeAttributes = new Set(['A']);
    // 8 + 1.5 + 1 * (4 + 2)
    expect(mod.getNodeOuterRadius({ id: 'p1' })).toBeCloseTo(13.5);
  });

  it('ignores rings whose category is hidden via the eye toggle', () => {
    globalThis.personAttributes = new Map([['p1', new Map([['Team::A', '1'], ['Rolle::B', '1']])]]);
    globalThis.activeAttributes = new Set(['Team::A', 'Rolle::B']);
    globalThis.hiddenCategories = new Set(['Rolle']);
    // only the Team ring is drawn, so only it counts
    expect(mod.getNodeOuterRadius({ id: 'p1' })).toBeCloseTo(13.5);
  });
});

describe('positionNodesInCircle', () => {
  it('places a single node at the start angle', () => {
    const n = [{}];
    mod.positionNodesInCircle(n, 100, 100, 10, 0);
    expect(n[0].x).toBeCloseTo(110);
    expect(n[0].y).toBeCloseTo(100);
  });

  it('distributes multiple nodes evenly on the circle', () => {
    const nodes = [{}, {}, {}, {}];
    mod.positionNodesInCircle(nodes, 0, 0, 10);
    expect(nodes[0].x).toBeCloseTo(10);
    expect(nodes[1].y).toBeCloseTo(10);
    expect(nodes[2].x).toBeCloseTo(-10);
    expect(nodes[3].y).toBeCloseTo(-10);
    expect(() => mod.positionNodesInCircle([], 0, 0, 10)).not.toThrow();
  });
});

describe('findPositionOutsideHull', () => {
  it('falls back to a viewport offset without nodes', () => {
    expect(mod.findPositionOutsideHull([])).toEqual({ x: WIDTH / 2 + 200, y: HEIGHT / 2 });
    expect(mod.findPositionOutsideHull([{ x: NaN, y: NaN }])).toEqual({ x: WIDTH / 2 + 200, y: HEIGHT / 2 });
  });

  it('places the new root right of the bounding box', () => {
    const pos = mod.findPositionOutsideHull([{ x: 0, y: 0 }, { x: 100, y: 50 }], 200);
    expect(pos.x).toBeCloseTo(100 + 200 + 100 * 0.2);
    expect(pos.y).toBeCloseTo(25);
  });
});

describe('radialLayoutExpansion', () => {
  it('positions children around their parent breadth-first', () => {
    const personNodes = [
      { id: 'root', x: 0, y: 0 },
      { id: 'a' }, { id: 'b' }, { id: 'c' },
    ];
    const childrenOf = new Map([['root', ['a', 'b']], ['a', ['c']]]);
    const positioned = new Set(['root']);
    mod.radialLayoutExpansion(
      [{ nodeId: 'root', x: 0, y: 0, level: 0 }],
      childrenOf, new Map(), personNodes, positioned,
    );
    expect(positioned.size).toBe(4);
    for (const n of personNodes.slice(1)) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it('includes parents at level 0 starting north', () => {
    const personNodes = [{ id: 'root', x: 0, y: 0 }, { id: 'boss' }];
    const positioned = new Set(['root']);
    mod.radialLayoutExpansion(
      [{ nodeId: 'root', x: 0, y: 0, level: 0 }],
      new Map(), new Map([['root', ['boss']]]), personNodes, positioned, true,
    );
    expect(positioned.has('boss')).toBe(true);
    expect(personNodes[1].y).toBeLessThan(0); // north of the root
  });
});

describe('createSimulation', () => {
  it('builds a force simulation with link/charge/center/collide forces', () => {
    const nodes = [{ id: 'p1' }, { id: 'p2' }];
    const sim = mod.createSimulation(nodes, [{ source: 'p1', target: 'p2' }]);
    expect(sim.force('link')).toBeTruthy();
    expect(sim.force('charge')).toBeTruthy();
    expect(sim.force('center')).toBeTruthy();
    expect(sim.force('collide')).toBeTruthy();
    sim.stop();
  });

  it('grows the collide radius with active attributes', () => {
    globalThis.personAttributes = new Map([['p1', new Map([['A', '1']])]]);
    globalThis.activeAttributes = new Set(['A']);
    const sim = mod.createSimulation([{ id: 'p1' }, { id: 'p2' }], []);
    const radius = sim.force('collide').radius();
    expect(radius({ id: 'p1' })).toBeGreaterThan(radius({ id: 'p2' }));
    sim.stop();
  });
});

describe('keepSimulationRunning / getNodesLevels / TS', () => {
  it('re-energizes a low-alpha simulation only in continuous mode', () => {
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    mod.keepSimulationRunning(); // continuous off -> noop
    expect(raf).not.toHaveBeenCalled();

    globalThis.continuousSimulation = true;
    const restart = vi.fn();
    globalThis.currentSimulation = { alpha: vi.fn(() => 0.05) };
    globalThis.currentSimulation.alpha = Object.assign(
      vi.fn((v) => (v === undefined ? 0.05 : { restart })),
      {},
    );
    mod.keepSimulationRunning();
    expect(restart).toHaveBeenCalled();
    expect(raf).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('getNodesLevels assigns BFS distances and 999 for unreachable nodes', () => {
    const nodes = [{ id: 'r' }, { id: 'a' }, { id: 'b' }, { id: 'island' }];
    const links = [{ source: 'r', target: 'a' }, { source: 'a', target: 'b' }];
    const levels = mod.getNodesLevels(nodes, new Set(['r']), links);
    expect(levels.get('r')).toBe(0);
    expect(levels.get('a')).toBe(1);
    expect(levels.get('b')).toBe(2);
    expect(levels.get('island')).toBe(999);
  });

  it('TS.now proxies the logger timestamp', () => {
    expect(mod.TS.now()).toBe('00:00:00.000');
  });
});
