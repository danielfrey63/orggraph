import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { updateAttributeCircles } from '../src/sections/08-color-geometry.js';
import { SVG_ID } from '../src/sections/01-config-status.js';

// Load the real vendored d3 (UMD; require() under "type":"module" yields an
// empty ESM namespace, so evaluate the bundle manually against jsdom globals).
const d3Src = readFileSync('vendor/d3.v7.min.js', 'utf8');
const d3Mod = { exports: {} };
new Function('exports', 'module', d3Src)(d3Mod.exports, d3Mod);
const d3 = d3Mod.exports;

const addNode = (svg, datum) => {
  const g = d3.select(svg).append('g').attr('class', 'node').datum(datum);
  g.append('circle').attr('class', 'node-circle');
  g.append('text').attr('class', 'label').attr('x', 10);
  return g;
};

beforeEach(() => {
  document.body.innerHTML = '<svg id="graph"></svg>';
  globalThis.d3 = d3;
  globalThis.SVG_ID = SVG_ID;
  globalThis.attributesVisible = true;
  globalThis.activeAttributes = new Set();
  globalThis.personAttributes = new Map();
  globalThis.attributeTypes = new Map();
  globalThis.hiddenCategories = new Set();
  globalThis.hierarchyLevels = new Map();
  globalThis.selectedRootIds = [];
  globalThis.currentSelectedId = null;
  const svg = document.querySelector('#graph');
  addNode(svg, { id: 'p1', type: 'person' });
  addNode(svg, { id: 'p2', type: 'person' });
});

const nodeGroup = (id) =>
  Array.from(document.querySelectorAll('.node')).find(
    (g) => d3.select(g).datum().id === id,
  );

describe('updateAttributeCircles', () => {
  it('draws one ring per active attribute with its registered color', () => {
    globalThis.personAttributes = new Map([
      ['p1', new Map([['Team::Coach', '1'], ['Team::PL', '1']])],
    ]);
    globalThis.activeAttributes = new Set(['Team::Coach', 'Team::PL']);
    globalThis.attributeTypes = new Map([
      ['Team::Coach', 'hsl(0, 65%, 50%)'],
      ['Team::PL', 'hsl(40, 65%, 50%)'],
    ]);
    updateAttributeCircles();

    const rings = nodeGroup('p1').querySelectorAll('circle.attribute-circle');
    expect(rings).toHaveLength(2);
    const strokes = Array.from(rings).map((c) => c.style.stroke);
    expect(strokes).toContain('hsl(0, 65%, 50%)');
    expect(strokes).toContain('hsl(40, 65%, 50%)');
    expect(nodeGroup('p1').classList.contains('has-attributes')).toBe(true);
    // label shifted outwards beyond the default
    expect(Number(nodeGroup('p1').querySelector('text.label').getAttribute('x'))).toBeGreaterThan(10);
  });

  it('dims nodes without active attributes when others have them', () => {
    globalThis.personAttributes = new Map([['p1', new Map([['Team::Coach', '1']])]]);
    globalThis.activeAttributes = new Set(['Team::Coach']);
    globalThis.attributeTypes = new Map([['Team::Coach', 'red']]);
    updateAttributeCircles();
    expect(nodeGroup('p2').classList.contains('has-attributes')).toBe(false);
    const p2Circle = nodeGroup('p2').querySelector('circle.node-circle');
    expect(Number(p2Circle.style.opacity)).toBeLessThan(1);
  });

  it('skips attributes of hidden categories', () => {
    globalThis.personAttributes = new Map([['p1', new Map([['Team::Coach', '1']])]]);
    globalThis.activeAttributes = new Set(['Team::Coach']);
    globalThis.attributeTypes = new Map([['Team::Coach', 'red']]);
    globalThis.hiddenCategories = new Set(['Team']);
    updateAttributeCircles();
    expect(nodeGroup('p1').querySelectorAll('circle.attribute-circle')).toHaveLength(0);
    expect(nodeGroup('p1').classList.contains('has-attributes')).toBe(false);
  });

  it('removes rings and resets state when attributes are toggled off', () => {
    globalThis.personAttributes = new Map([['p1', new Map([['Team::Coach', '1']])]]);
    globalThis.activeAttributes = new Set(['Team::Coach']);
    globalThis.attributeTypes = new Map([['Team::Coach', 'red']]);
    updateAttributeCircles();
    expect(nodeGroup('p1').querySelectorAll('circle.attribute-circle')).toHaveLength(1);

    globalThis.attributesVisible = false;
    updateAttributeCircles();
    expect(nodeGroup('p1').querySelectorAll('circle.attribute-circle')).toHaveLength(0);
    expect(nodeGroup('p1').classList.contains('has-attributes')).toBe(false);
    expect(nodeGroup('p1').querySelector('text.label').getAttribute('x')).toBe('10');
  });

  it('highlights the visual root node with the configured fill', () => {
    globalThis.selectedRootIds = ['p2'];
    updateAttributeCircles();
    const rootCircle = nodeGroup('p2').querySelector('circle.node-circle');
    expect(rootCircle.style.fill).toBe('var(--root-node-fill)');
    expect(Number(rootCircle.style.opacity)).toBe(1);
  });
});
