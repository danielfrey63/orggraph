import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { ICON, setIcon } from '../src/sections/02-icons.js';
import {
  INPUT_COMBO_ID, LIST_COMBO_ID, STATUS_ID, BTN_APPLY_ID, INPUT_DEPTH_ID, SVG_ID,
} from '../src/sections/01-config-status.js';
import { KEY_DATA, ATTR_PREFIX } from '../src/sections/04-storage.js';

const FIXTURE = `
  <input id="comboInput"><ul id="comboList" hidden></ul>
  <div id="status"></div><button id="apply"></button>
  <input id="depth" value="2">
  <div id="directionToggle">
    <span class="direction-up active"></span>
    <span class="direction-down active"></span>
  </div>
  <button id="toggleOesVisibility" class="active"><span data-icon="eye"></span></button>
  <button id="toggleAllHiddenVisibility"></button>
  <button id="expandAllAttributes"></button>
  <button id="toggleAttributesVisibility" class="active"><span data-icon="eye"></span></button>
  <button id="toggleAllOes"></button>
  <button id="toggleAllAttributes"></button>
  <input id="oeFilter">
  <button id="toggleManagement" class="active"></button>
  <button id="toggleHierarchy"></button>
  <button id="toggleLabels" class="active"></button>
  <button id="togglePseudonymization" class="active"></button>
  <button id="toggleSimulation"></button>
  <button id="debugBtn"></button>
  <button id="fit"></button>
  <svg id="graph"></svg>
  <div class="footer-stats"></div>
  <div id="legend"><ul class="legend-list">
    <li><div class="legend-row"><span class="legend-label-chip">Alpha</span></div></li>
    <li><div class="legend-row"><span class="legend-label-chip">Beta</span></div></li>
  </ul></div>
  <div id="attributeLegend"></div><div id="attributeContainer"></div><div id="hiddenLegend"></div>
  <input id="attributeFileInput" type="file" style="display:none">
  <button id="loadAttributes"></button>
  <a id="resetData"></a>`;

const flush = () => new Promise((r) => setTimeout(r, 0));

const setupGlobals = () => {
  globalThis.ICON = ICON;
  globalThis.setIcon = setIcon;
  globalThis.INPUT_COMBO_ID = INPUT_COMBO_ID;
  globalThis.LIST_COMBO_ID = LIST_COMBO_ID;
  globalThis.STATUS_ID = STATUS_ID;
  globalThis.BTN_APPLY_ID = BTN_APPLY_ID;
  globalThis.INPUT_DEPTH_ID = INPUT_DEPTH_ID;
  globalThis.SVG_ID = SVG_ID;
  globalThis.KEY_DATA = KEY_DATA;
  globalThis.ATTR_PREFIX = ATTR_PREFIX;
  globalThis.envConfig = null;
  globalThis.pseudonymizationEnabled = true;
  globalThis.oesVisible = true;
  globalThis.savedAllowedOrgs = new Set();
  globalThis.allowedOrgs = new Set();
  globalThis.raw = { orgs: [{ id: 'o1' }, { id: 'o2' }], nodes: [], links: [] };
  globalThis.attributeTypes = new Map([['Team::Coach', 'red']]);
  globalThis.activeAttributes = new Set();
  globalThis.collapsedCategories = new Set();
  globalThis.hiddenCategories = new Set();
  globalThis.managementEnabled = true;
  globalThis.continuousSimulation = false;
  globalThis.currentSimulation = null;
  globalThis.currentSubgraph = null;
  globalThis.searchDebounceTimer = null;
  globalThis.labelsVisible = 'all';
  globalThis.attributesVisible = true;
  globalThis.debugMode = false;
  globalThis.hiddenByRoot = new Map();
  globalThis.selectedRootIds = [];
  globalThis.currentSelectedId = null;
  globalThis.currentLayoutMode = 'force';
  globalThis.currentDir = 'both';
  globalThis.zoomBehavior = null;
  globalThis.legendMenuEl = null;
  globalThis.nodeMenuEl = null;
  globalThis.Logger = { log: () => {} };

  globalThis.loadEnvConfig = vi.fn(async () => false);
  globalThis.loadPseudoData = vi.fn(async () => false);
  globalThis.loadData = vi.fn(async () => false);
  globalThis.applyFromUI = vi.fn();
  globalThis.populateCombo = vi.fn();
  globalThis.fitToViewport = vi.fn();
  globalThis.switchLayout = vi.fn();
  globalThis.refreshAllLabels = vi.fn();
  globalThis.updateDebugZoomDisplay = vi.fn();
  globalThis.keepSimulationRunning = vi.fn();
  globalThis.refreshClusters = vi.fn();
  globalThis.syncGraphAndLegendColors = vi.fn();
  globalThis.buildAttributeLegend = vi.fn();
  globalThis.updateAttributeCircles = vi.fn();
  globalThis.updateAttributeStats = vi.fn();
  globalThis.updateGlobalHiddenVisibilityButton = vi.fn();
  globalThis.toggleAllHiddenVisibility = vi.fn();
  globalThis.initializeExport = vi.fn();
  globalThis.buildHiddenLegend = vi.fn();
  globalThis.buildOrgLegend = vi.fn();
  globalThis.applyLegendScope = vi.fn();
  globalThis.updateFooterStats = vi.fn();
  globalThis.recomputeHiddenNodes = vi.fn();
  globalThis.collectReportSubtree = vi.fn(() => new Set());
  globalThis.initializeChevronIcons = vi.fn();
  globalThis.initializeLegendCollapsedStates = vi.fn();
  globalThis.initializeCollapsibleLegends = vi.fn();
  globalThis.installGlobalDrop = vi.fn();
  globalThis.showDropZone = vi.fn();
  globalThis.hideDropZone = vi.fn();
  globalThis.requestPersistence = vi.fn(async () => true);
  globalThis.loadAttributesFromFile = vi.fn(async () => true);
  globalThis.idbPut = vi.fn(async () => {});
  globalThis.idbClear = vi.fn(async () => {});
  globalThis.setStatus = vi.fn();
  globalThis.showTemporaryNotification = vi.fn();
  globalThis.showPasswordDialog = vi.fn();
  globalThis.setSingleRoot = vi.fn();
  globalThis.confirm = vi.fn(() => true);
  globalThis.storeEntries = vi.fn(async () => ({ stored: [], unknown: [], missing: [], ignored: [] }));
};

beforeAll(async () => {
  document.body.innerHTML = FIXTURE;
  setupGlobals();
  vi.stubGlobal('location', { reload: vi.fn() });
  await import('../src/sections/18-files-reset.js'); // registers the listener
  window.dispatchEvent(new Event('DOMContentLoaded'));
  await flush(); await flush(); await flush();
});

beforeEach(() => {
  // re-arm spies that tests inspect, keep wiring from the single bootstrap run
  globalThis.applyFromUI.mockClear();
  globalThis.populateCombo.mockClear();
  globalThis.showTemporaryNotification.mockClear();
  globalThis.syncGraphAndLegendColors.mockClear();
});

describe('bootstrap wiring (DOMContentLoaded)', () => {
  it('runs the init path: env/pseudo/data loads, drop zone fallback, export init', () => {
    expect(globalThis.loadEnvConfig).toHaveBeenCalled();
    expect(globalThis.loadPseudoData).toHaveBeenCalled();
    expect(globalThis.loadData).toHaveBeenCalled();
    expect(globalThis.showDropZone).toHaveBeenCalled(); // no data -> drop zone
    expect(globalThis.installGlobalDrop).toHaveBeenCalled();
    expect(globalThis.initializeExport).toHaveBeenCalled();
    expect(globalThis.initializeCollapsibleLegends).toHaveBeenCalled();
  });

  it('wires the apply button to applyFromUI', () => {
    document.querySelector('#apply').click();
    expect(globalThis.applyFromUI).toHaveBeenCalled();
  });

  it('debounces search input into populateCombo', async () => {
    vi.useFakeTimers();
    const input = document.querySelector('#comboInput');
    input.value = 'ali';
    input.dispatchEvent(new Event('input'));
    expect(globalThis.populateCombo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(globalThis.populateCombo).toHaveBeenCalledWith('ali');
    vi.useRealTimers();
  });

  it('toggle-all OEs selects everything, then clears on second click', () => {
    globalThis.allowedOrgs = new Set();
    const btn = document.getElementById('toggleAllOes');
    btn.click();
    expect(Array.from(globalThis.allowedOrgs).sort()).toEqual(['o1', 'o2']);
    btn.click();
    expect(globalThis.allowedOrgs.size).toBe(0);
    expect(globalThis.syncGraphAndLegendColors).toHaveBeenCalledTimes(2);
  });

  it('toggle-all attributes mirrors the same pattern for attribute keys', () => {
    globalThis.activeAttributes = new Set();
    const btn = document.getElementById('toggleAllAttributes');
    btn.click();
    expect(globalThis.activeAttributes.has('Team::Coach')).toBe(true);
    btn.click();
    expect(globalThis.activeAttributes.size).toBe(0);
  });

  it('OE visibility toggle stashes and restores the selection', () => {
    globalThis.allowedOrgs = new Set(['o1']);
    globalThis.savedAllowedOrgs = new Set();
    const btn = document.getElementById('toggleOesVisibility');
    btn.click(); // hide
    expect(globalThis.allowedOrgs.size).toBe(0);
    expect(Array.from(globalThis.savedAllowedOrgs)).toEqual(['o1']);
    btn.click(); // show again
    expect(Array.from(globalThis.allowedOrgs)).toEqual(['o1']);
    expect(globalThis.savedAllowedOrgs.size).toBe(0);
  });

  it('filters the OE legend by name and reports empty results', () => {
    const filter = document.getElementById('oeFilter');
    filter.value = 'alpha';
    filter.dispatchEvent(new Event('input'));
    const [a, b] = document.querySelectorAll('#legend .legend-list > li');
    expect(a.style.display).toBe('');
    expect(b.style.display).toBe('none');

    filter.value = 'zzz';
    filter.dispatchEvent(new Event('input'));
    expect(document.querySelector('#legend .no-matches-message')).not.toBeNull();
    filter.value = '';
    filter.dispatchEvent(new Event('input'));
    expect(document.querySelector('#legend .no-matches-message')).toBeNull();
  });

  it('direction halves re-render via applyFromUI', () => {
    document.querySelector('#directionToggle .direction-up').click();
    document.querySelector('#directionToggle .direction-down').click();
    expect(globalThis.applyFromUI).toHaveBeenCalled();
  });

  it('attribute visibility toggle only redraws circles', () => {
    const btn = document.getElementById('toggleAttributesVisibility');
    globalThis.updateAttributeCircles.mockClear();
    btn.click();
    expect(globalThis.attributesVisible).toBe(false);
    expect(globalThis.updateAttributeCircles).toHaveBeenCalled();
    btn.click();
    expect(globalThis.attributesVisible).toBe(true);
  });

  it('fit button delegates to fitToViewport', () => {
    document.querySelector('#fit').click();
    expect(globalThis.fitToViewport).toHaveBeenCalled();
  });
});
