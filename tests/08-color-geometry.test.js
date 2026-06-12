import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  hashCode,
  quantizedHueFromCategory,
  colorForCategoryAttribute,
  colorForOrg,
  colorToTransparent,
  computeClusterPolygon,
  countVisibleAttributeRings,
  cssNumber,
} from '../src/sections/08-color-geometry.js';

const d3Src = readFileSync('vendor/d3.v7.min.js', 'utf8');
const d3Mod = { exports: {} };
new Function('exports', 'module', d3Src)(d3Mod.exports, d3Mod);
const d3 = d3Mod.exports;

// section 13 references Logger at module top level -> import after globals
let clusterMod;
beforeAll(async () => {
  globalThis.Logger = { log: () => {}, ts: () => '00:00:00.000' };
  clusterMod = await import('../src/sections/13-clusters-simulation.js');
});

// computeClusterPolygon resolves these as bundle globals at call time
beforeEach(() => {
  globalThis.d3 = d3;
  globalThis.cssNumber = cssNumber;
  globalThis.attributesVisible = false;
  globalThis.personAttributes = new Map();
  globalThis.activeAttributes = new Set();
  globalThis.hiddenCategories = new Set();
  globalThis.countVisibleAttributeRings = countVisibleAttributeRings;
  globalThis.getNodeOuterRadius = clusterMod.getNodeOuterRadius;
  globalThis.nodeOuterRadiusMetrics = clusterMod.nodeOuterRadiusMetrics;
});

describe('hashCode', () => {
  it('returns a stable unsigned integer for the same input', () => {
    expect(hashCode('abc')).toBe(hashCode('abc'));
    expect(hashCode('abc')).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hashCode('abc'))).toBe(true);
  });

  it('differs for different inputs', () => {
    expect(hashCode('abc')).not.toBe(hashCode('abd'));
  });

  it('returns 0 for the empty string', () => {
    expect(hashCode('')).toBe(0);
  });
});

describe('quantizedHueFromCategory', () => {
  it('returns a hue in [0, 360) quantized to steps of 40', () => {
    const hue = quantizedHueFromCategory('Team');
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
    expect(hue % 40).toBe(0);
  });

  it('is stable across calls (cached)', () => {
    expect(quantizedHueFromCategory('Rolle')).toBe(quantizedHueFromCategory('Rolle'));
  });
});

describe('colorForCategoryAttribute', () => {
  it('produces an hsl() color string', () => {
    expect(colorForCategoryAttribute('Team', 'A', 0)).toMatch(/^hsl\(\d+, 65%, \d+%\)$/);
  });

  it('varies lightness with ordinal parity', () => {
    const even = colorForCategoryAttribute('Team', 'A', 0);
    const odd = colorForCategoryAttribute('Team', 'B', 1);
    expect(even).toMatch(/50%\)$/);
    expect(odd).toMatch(/55%\)$/);
  });

  it('shifts hue within the category by ordinal', () => {
    const base = quantizedHueFromCategory('Team');
    expect(colorForCategoryAttribute('Team', 'C', 2)).toContain(`hsl(${(base + 20) % 360},`);
  });
});

describe('colorForOrg', () => {
  it('returns fill and stroke as hsla strings', () => {
    const c = colorForOrg('o-1');
    expect(c.fill).toMatch(/^hsla\(\d+, 60%, 60%, 0\.25\)$/);
    expect(c.stroke).toMatch(/^hsla\(\d+, 60%, 40%, 0\.85\)$/);
  });

  it('caches per org id', () => {
    expect(colorForOrg('o-2')).toBe(colorForOrg('o-2'));
  });
});

describe('colorToTransparent', () => {
  it('converts hsl() to hsla() with the given alpha', () => {
    expect(colorToTransparent('hsl(120, 65%, 50%)', 0.5)).toBe('hsla(120, 65%, 50%, 0.5)');
  });

  it('defaults alpha to 0.25', () => {
    expect(colorToTransparent('hsl(0, 10%, 20%)')).toBe('hsla(0, 10%, 20%, 0.25)');
  });

  it('returns non-hsl colors unchanged', () => {
    expect(colorToTransparent('#ff0000', 0.5)).toBe('#ff0000');
    expect(colorToTransparent('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
  });
});

describe('cssNumber', () => {
  it('falls back when the CSS variable is not defined', () => {
    expect(cssNumber('--does-not-exist', 8)).toBe(8);
  });

  it('reads a numeric CSS variable from :root', () => {
    document.documentElement.style.setProperty('--test-radius', '12');
    expect(cssNumber('--test-radius', 8)).toBe(12);
  });
});

describe('computeClusterPolygon', () => {
  // base radius (8 + 3/2 stroke) + pad 10, no rings visible
  const R = 19.5;

  it('returns an empty polygon for no nodes', () => {
    expect(computeClusterPolygon([], 10)).toEqual([]);
  });

  it('returns a 12-point circle at outer radius + pad around a single node', () => {
    const poly = computeClusterPolygon([{ id: 'p1', x: 100, y: 50 }], 10);
    expect(poly).toHaveLength(12);
    for (const [x, y] of poly) {
      expect(Math.hypot(x - 100, y - 50)).toBeCloseTo(R, 6);
    }
  });

  it('encloses both node circles for two nodes, including the outer ends', () => {
    const poly = computeClusterPolygon([{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 100, y: 0 }], 10);
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(-R, 6);
    expect(Math.max(...xs)).toBeCloseTo(100 + R, 6);
    expect(Math.min(...ys)).toBeCloseTo(-R, 6);
    expect(Math.max(...ys)).toBeCloseTo(R, 6);
  });

  it('grows the polygon for nodes with visible attribute rings', () => {
    globalThis.attributesVisible = true;
    globalThis.personAttributes = new Map([['p1', new Map([['A', '1'], ['B', '1']])]]);
    globalThis.activeAttributes = new Set(['A', 'B']);
    const poly = computeClusterPolygon([{ id: 'p1', x: 0, y: 0 }], 10);
    // base 9.5 + 2 rings * (gap 4 + width 2) + pad 10
    for (const [x, y] of poly) {
      expect(Math.hypot(x, y)).toBeCloseTo(31.5, 6);
    }
  });

  it('spans mixed-radius nodes with their individual outer radii', () => {
    globalThis.attributesVisible = true;
    globalThis.personAttributes = new Map([['p1', new Map([['A', '1']])]]);
    globalThis.activeAttributes = new Set(['A']);
    const poly = computeClusterPolygon([{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 100, y: 0 }], 10);
    const xs = poly.map((p) => p[0]);
    // p1 has one ring (base 9.5 + 6 + pad = 25.5), p2 none (19.5)
    expect(Math.min(...xs)).toBeCloseTo(-25.5, 6);
    expect(Math.max(...xs)).toBeCloseTo(100 + R, 6);
  });
});
