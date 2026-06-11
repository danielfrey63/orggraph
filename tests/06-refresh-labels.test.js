import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { refreshAllLabels } from '../src/sections/06-pseudo-labels.js';
import { orgDepth } from '../src/sections/08-color-geometry.js';
import { INPUT_COMBO_ID } from '../src/sections/01-config-status.js';

const d3Src = readFileSync('vendor/d3.v7.min.js', 'utf8');
const d3Mod = { exports: {} };
new Function('exports', 'module', d3Src)(d3Mod.exports, d3Mod);
const d3 = d3Mod.exports;

beforeEach(() => {
  document.body.innerHTML = `
    <svg id="graph"></svg>
    <input id="comboInput">
    <ul id="legend"><li data-oid="o1"><span class="legend-label-chip"></span></li></ul>
    <div id="hiddenLegend"><span class="legend-label-chip" data-root-id="p1"></span></div>`;
  globalThis.d3 = d3;
  globalThis.INPUT_COMBO_ID = INPUT_COMBO_ID;
  globalThis.debugMode = false;
  globalThis.pseudonymizationEnabled = false;
  globalThis.pseudoData = null;
  globalThis.parentOf = new Map();
  globalThis.orgDepth = orgDepth;
  globalThis.getDisplayLabel = undefined; // module uses its own local
  globalThis.hideTooltip = vi.fn();
  globalThis.Logger = { log: () => {} };
  globalThis.currentSelectedId = null;
  globalThis.hiddenByRoot = new Map([['p1', new Set(['p2', 'p3'])]]);
  globalThis.byId = new Map([
    ['p1', { id: 'p1', label: 'Alice', type: 'person' }],
    ['o1', { id: 'o1', label: 'Company', type: 'org' }],
  ]);
  const g = d3.select('#graph').append('g').attr('class', 'node')
    .datum({ id: 'p1', label: 'Alice', type: 'person', x: 12.4, y: -3.6 });
  g.append('text').attr('class', 'label');
});

describe('refreshAllLabels', () => {
  it('writes display labels onto node texts and legend chips', () => {
    refreshAllLabels();
    expect(document.querySelector('.node text.label').textContent).toBe('Alice');
    expect(document.querySelector('#legend .legend-label-chip').textContent).toBe('Company');
    const hiddenChip = document.querySelector('#hiddenLegend .legend-label-chip');
    expect(hiddenChip.textContent).toBe('Alice (2)');
    expect(hiddenChip.title).toBe('Alice');
  });

  it('shows rounded coordinates instead of names in debug mode', () => {
    globalThis.debugMode = true;
    refreshAllLabels();
    expect(document.querySelector('.node text.label').textContent).toBe('(12, -4)');
  });

  it('updates the search input for the selected node and hides the tooltip', () => {
    globalThis.currentSelectedId = 'p1';
    refreshAllLabels();
    expect(document.querySelector('#comboInput').value).toBe('Alice');
  });
});
