import { describe, it, expect } from 'vitest';
import {
  hashCode,
  quantizedHueFromCategory,
  colorForCategoryAttribute,
  colorForOrg,
  colorToTransparent,
  computeClusterPolygon,
  cssNumber,
} from '../src/sections/08-color-geometry.js';

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
  it('returns an empty polygon for no nodes', () => {
    expect(computeClusterPolygon([], 10)).toEqual([]);
  });

  it('returns a 12-point circle around a single node', () => {
    const poly = computeClusterPolygon([{ x: 100, y: 50 }], 10);
    expect(poly).toHaveLength(12);
    const r = Math.hypot(poly[0][0] - 100, poly[0][1] - 50);
    for (const [x, y] of poly) {
      expect(Math.hypot(x - 100, y - 50)).toBeCloseTo(r, 6);
    }
  });

  it('returns a 4-point band around two nodes', () => {
    const poly = computeClusterPolygon([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10);
    expect(poly).toHaveLength(4);
    // band is symmetric around the segment y=0
    expect(poly[0][1]).toBeCloseTo(-poly[3][1], 6);
    expect(poly[1][1]).toBeCloseTo(-poly[2][1], 6);
  });
});
