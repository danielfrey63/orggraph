import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyFromUI, loadAttributesFromFile } from '../src/sections/15-ui-apply-search.js';
import { idOf, processData } from '../src/sections/09-data-load.js';
import { computeSubgraph } from '../src/sections/11-graph-core.js';
import { guessIdFromInput } from '../src/sections/10-combo.js';
import { colorForCategoryAttribute, hashCode } from '../src/sections/08-color-geometry.js';
import {
  INPUT_COMBO_ID, INPUT_DEPTH_ID,
} from '../src/sections/01-config-status.js';

const makeFile = (name, content) => ({ name, text: async () => content });

const setupDom = ({ input = '', depth = '2', up = true, down = true } = {}) => {
  document.body.innerHTML = `
    <input id="comboInput" value="${input}">
    <input id="depth" value="${depth}">
    <div id="directionToggle">
      <span class="direction-up${up ? ' active' : ''}"></span>
      <span class="direction-down${down ? ' active' : ''}"></span>
    </div>`;
};

beforeEach(() => {
  // error-path tests intentionally trigger app-side console output
  vi.spyOn(console, 'error').mockImplementation(() => {});
  globalThis.Logger = { log: () => {} };
  globalThis.idOf = idOf;
  globalThis.computeSubgraph = computeSubgraph;
  globalThis.guessIdFromInput = guessIdFromInput;
  globalThis.colorForCategoryAttribute = colorForCategoryAttribute;
  globalThis.hashCode = hashCode;
  globalThis.INPUT_COMBO_ID = INPUT_COMBO_ID;
  globalThis.INPUT_DEPTH_ID = INPUT_DEPTH_ID;
  globalThis.searchDebounceTimer = null;
  globalThis.debugMode = false;
  globalThis.currentHiddenCount = 0;
  globalThis.managementEnabled = false;
  globalThis.allHiddenTemporarilyVisible = false;
  globalThis.temporarilyVisibleRoots = new Set();
  globalThis.attributeFocusEnabled = false;
  globalThis.attributeFocusHiddenNodes = new Set();
  globalThis.notifyAttributeVisibilityChanged = vi.fn();
  globalThis.selectedRootIds = [];
  globalThis.currentSelectedId = null;
  globalThis.lastSingleRootId = null;
  globalThis.lastRenderRoots = null;
  globalThis.lastRenderDepth = null;
  globalThis.lastRenderDirMode = null;
  globalThis.currentSubgraph = null;
  globalThis.lastTransitionId = 0;
  globalThis.transitionGraph = vi.fn(async () => {});
  globalThis.updateFooterStats = vi.fn();
  globalThis.applyLegendScope = vi.fn();
  globalThis.updateHiddenLegendTitle = vi.fn();
  globalThis.setStatus = vi.fn();
  globalThis.showTemporaryNotification = vi.fn();
  globalThis.buildAttributeLegend = vi.fn();
  globalThis.updateAttributeStats = vi.fn();
  globalThis.updateAttributeCircles = vi.fn();
  globalThis.exportUnmatchedEntries = vi.fn();
  globalThis.showFuzzyMatchDialog = vi.fn();
  globalThis.getStoredAttrMatches = vi.fn(async () => ({}));
  globalThis.mergeStoredAttrMatches = vi.fn(async (u) => u);
  globalThis.personAttributes = new Map();
  globalThis.attributeTypes = new Map();
  globalThis.activeAttributes = new Set();
  globalThis.emptyCategories = new Set();
  globalThis.categorySourceFiles = new Map();
  for (const k of ['raw', 'byId', 'allNodesUnique', 'parentOf', 'orgParent', 'orgChildren', 'orgRoots', 'hiddenNodes', 'hiddenByRoot']) {
    globalThis[k] = undefined;
  }
  processData({
    persons: [
      { id: 'p1', label: 'Boss', email: 'boss@x.ch' },
      { id: 'p2', label: 'Dev' },
      { id: 'p3', label: 'Lead' },
    ],
    orgs: [],
    links: [
      { source: 'p1', target: 'p2' },
      { source: 'p1', target: 'p3' },
    ],
  });
  setupDom();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyFromUI', () => {
  it('bails out without data and without a resolvable start node', () => {
    globalThis.raw = null;
    applyFromUI('test');
    expect(globalThis.transitionGraph).not.toHaveBeenCalled();
  });

  it('reports a missing start node', () => {
    applyFromUI('test');
    expect(globalThis.setStatus).toHaveBeenCalledWith('Startknoten nicht gefunden');
    expect(globalThis.transitionGraph).not.toHaveBeenCalled();
  });

  it('renders a single root from the current selection with DOM depth/direction', () => {
    globalThis.currentSelectedId = 'p1';
    setupDom({ depth: '1', up: false, down: true });
    applyFromUI('test');
    expect(globalThis.currentSubgraph.nodes.map((n) => n.id).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(globalThis.lastRenderRoots).toEqual(['p1']);
    expect(globalThis.lastRenderDepth).toBe(1);
    expect(globalThis.lastRenderDirMode).toBe('down');
    expect(globalThis.transitionGraph).toHaveBeenCalledTimes(1);
    expect(globalThis.updateHiddenLegendTitle).toHaveBeenCalled();
  });

  it('derives the root from the combo input when nothing is selected', () => {
    setupDom({ input: 'Lead', depth: '1' });
    applyFromUI('test');
    expect(globalThis.lastRenderRoots).toEqual(['p3']);
    expect(globalThis.currentSelectedId).toBe('p3');
  });

  it('merges multi-root subgraphs without duplicates and with minimal levels', () => {
    globalThis.selectedRootIds = ['p2', 'p3'];
    setupDom({ depth: '2' });
    applyFromUI('test');
    const ids = globalThis.currentSubgraph.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['p1', 'p2', 'p3']); // union, p1 reached from both
    const p1 = globalThis.currentSubgraph.nodes.find((n) => n.id === 'p1');
    expect(p1.level).toBe(1);
    expect(globalThis.lastRenderRoots).toEqual(['p2', 'p3']);
  });
});

describe('loadAttributesFromFile', () => {
  it('registers an empty file as an empty category', async () => {
    expect(await loadAttributesFromFile(makeFile('Leere Kategorie.tsv', ' \n'))).toBe(true);
    expect(globalThis.emptyCategories.has('Leere Kategorie')).toBe(true);
    expect(globalThis.categorySourceFiles.get('Leere Kategorie')).toMatchObject({
      filename: 'Leere Kategorie.tsv',
      url: null,
    });
  });

  it('applies exact matches and registers attribute types', async () => {
    const ok = await loadAttributesFromFile(makeFile('Team.tsv', 'boss@x.ch\tCoach\np2\tPL'));
    expect(ok).toBe(true);
    expect(globalThis.personAttributes.get('p1')).toBeTruthy();
    expect(globalThis.personAttributes.get('p2')).toBeTruthy();
    expect(globalThis.attributeTypes.size).toBeGreaterThan(0);
    expect(globalThis.activeAttributes.size).toBeGreaterThan(0);
    expect(globalThis.categorySourceFiles.has('Team')).toBe(true);
  });

  it('tolerates unmatched identifiers that have no fuzzy candidates', async () => {
    const ok = await loadAttributesFromFile(
      makeFile('Team.tsv', 'boss@x.ch\tCoach\nzzzzzzzzzzzzzzzz\tGhost'),
    );
    expect(ok).toBe(true);
    expect(globalThis.personAttributes.get('p1')).toBeTruthy();
  });

  it('returns false for unreadable files', async () => {
    const broken = { name: 'x.tsv', text: async () => { throw new Error('io'); } };
    expect(await loadAttributesFromFile(broken)).toBe(false);
  });

  it('applies stored fuzzy resolutions without searching again', async () => {
    globalThis.getStoredAttrMatches = vi.fn(async () => ({ 'ghost@x.ch': 'p2' }));
    const ok = await loadAttributesFromFile(makeFile('Team.tsv', 'ghost@x.ch\tCoach'));
    expect(ok).toBe(true);
    expect(globalThis.personAttributes.get('p2').get('Team::Coach')).toBe('1');
    expect(globalThis.showFuzzyMatchDialog).not.toHaveBeenCalled();
    expect(globalThis.exportUnmatchedEntries).not.toHaveBeenCalled();
  });

  it('skips identifiers previously confirmed as unmatched', async () => {
    globalThis.getStoredAttrMatches = vi.fn(async () => ({ 'ghost@x.ch': null }));
    const ok = await loadAttributesFromFile(makeFile('Team.tsv', 'ghost@x.ch\tCoach\nboss@x.ch\tPL'));
    expect(ok).toBe(true);
    expect(globalThis.personAttributes.get('p1').get('Team::PL')).toBe('1');
    expect(globalThis.showFuzzyMatchDialog).not.toHaveBeenCalled();
    expect(globalThis.exportUnmatchedEntries).not.toHaveBeenCalled();
  });

  it('re-resolves stored matches whose person vanished from the dataset', async () => {
    globalThis.getStoredAttrMatches = vi.fn(async () => ({ 'zzzzzzzzzzzzzzzz': 'p-gone' }));
    const ok = await loadAttributesFromFile(makeFile('Team.tsv', 'zzzzzzzzzzzzzzzz\tGhost'));
    expect(ok).toBe(true);
    // falls back to the normal unmatched flow and remembers the no-match
    expect(globalThis.mergeStoredAttrMatches).toHaveBeenCalledWith({ 'zzzzzzzzzzzzzzzz': null });
    expect(globalThis.exportUnmatchedEntries).toHaveBeenCalled();
  });
});
