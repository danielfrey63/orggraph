import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ICON, setIcon } from '../src/sections/02-icons.js';
import {
  INPUT_COMBO_ID, LIST_COMBO_ID, STATUS_ID, INPUT_DEPTH_ID, SVG_ID,
} from '../src/sections/01-config-status.js';
import { KEY_DATA, ATTR_PREFIX } from '../src/sections/04-storage.js';

const d3Src = readFileSync('vendor/d3.v7.min.js', 'utf8');
const d3Mod = { exports: {} };
new Function('exports', 'module', d3Src)(d3Mod.exports, d3Mod);

const ENV = {
  TOOLBAR_MANAGEMENT_ACTIVE: false,
  TOOLBAR_LABELS_ACTIVE: 'attributes',
  TOOLBAR_SIMULATION_ACTIVE: true,
  TOOLBAR_DEPTH_DEFAULT: 4,
  TOOLBAR_DIRECTION_DEFAULT: 'up',
  TOOLBAR_HIERARCHY_ACTIVE: true,
  TOOLBAR_PSEUDO_ACTIVE: true,
  TOOLBAR_PSEUDO_PASSWORD: 'pw',
  LEGEND_ATTRIBUTES_ACTIVE: false,
  GRAPH_START_ID_DEFAULT: ['p1', 'ghost'],
  LEGEND_HIDDEN_ROOTS_DEFAULT: ['p1', 'nope'],
};

const FIXTURE = `
  <input id="comboInput"><ul id="comboList" hidden></ul>
  <div id="status"></div><button id="apply"></button>
  <input id="depth" value="2">
  <div id="directionToggle">
    <span class="direction-up"></span><span class="direction-down active"></span>
  </div>
  <button id="toggleAttributesVisibility" class="active"><span data-icon="eye"></span></button>
  <button id="toggleManagement" class="active"></button>
  <button id="toggleHierarchy"></button>
  <button id="toggleLabels" class="active"><span data-icon="tag"></span></button>
  <button id="togglePseudonymization" class="active"></button>
  <button id="toggleSimulation"></button>
  <button id="debugBtn"></button>
  <svg id="graph"></svg>
  <div class="footer-stats"></div>
  <div id="legend"></div><div id="attributeLegend"></div><div id="hiddenLegend"></div>
  <input id="attributeFileInput" type="file" style="display:none">
  <button id="loadAttributes"></button>`;

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(async () => {
  document.body.innerHTML = FIXTURE;
  globalThis.d3 = d3Mod.exports;
  globalThis.ICON = ICON;
  globalThis.setIcon = setIcon;
  globalThis.INPUT_COMBO_ID = INPUT_COMBO_ID;
  globalThis.LIST_COMBO_ID = LIST_COMBO_ID;
  globalThis.STATUS_ID = STATUS_ID;
  globalThis.INPUT_DEPTH_ID = INPUT_DEPTH_ID;
  globalThis.SVG_ID = SVG_ID;
  globalThis.KEY_DATA = KEY_DATA;
  globalThis.ATTR_PREFIX = ATTR_PREFIX;
  globalThis.envConfig = null;
  globalThis.pseudonymizationEnabled = true;
  globalThis.oesVisible = true;
  globalThis.savedAllowedOrgs = new Set();
  globalThis.allowedOrgs = new Set();
  globalThis.raw = { orgs: [], nodes: [], links: [] };
  globalThis.byId = new Map([['p1', { id: 'p1', label: 'Alice', type: 'person' }]]);
  globalThis.attributeTypes = new Map();
  globalThis.activeAttributes = new Set(['Team::Coach']);
  globalThis.collapsedCategories = new Set();
  globalThis.hiddenCategories = new Set();
  globalThis.managementEnabled = true;
  globalThis.continuousSimulation = false;
  globalThis.currentSimulation = { alpha: () => ({ restart: () => {} }) };
  globalThis.currentSubgraph = null;
  globalThis.searchDebounceTimer = null;
  globalThis.labelsVisible = 'all';
  globalThis.attributesVisible = true;
  globalThis.debugMode = false;
  globalThis.hiddenByRoot = new Map();
  globalThis.hiddenNodes = new Set();
  globalThis.selectedRootIds = [];
  globalThis.currentSelectedId = null;
  globalThis.lastSingleRootId = null;
  globalThis.currentLayoutMode = 'force';
  globalThis.filteredItems = [];
  globalThis.activeIndex = -1;
  globalThis.legendMenuEl = null;
  globalThis.nodeMenuEl = null;
  globalThis.Logger = { log: () => {} };
  globalThis.getDisplayLabel = vi.fn((n) => n?.label || '');

  globalThis.loadEnvConfig = vi.fn(async () => { globalThis.envConfig = ENV; return true; });
  globalThis.loadPseudoData = vi.fn(async () => true);
  globalThis.loadData = vi.fn(async () => true);
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
  globalThis.notifyAttributeVisibilityChanged = vi.fn();
  globalThis.updateAttributeStats = vi.fn();
  globalThis.updateGlobalHiddenVisibilityButton = vi.fn();
  globalThis.toggleAllHiddenVisibility = vi.fn();
  globalThis.initializeExport = vi.fn();
  globalThis.buildHiddenLegend = vi.fn();
  globalThis.buildOrgLegend = vi.fn();
  globalThis.applyLegendScope = vi.fn();
  globalThis.updateFooterStats = vi.fn();
  globalThis.recomputeHiddenNodes = vi.fn();
  globalThis.collectReportSubtree = vi.fn(() => new Set(['p1']));
  globalThis.renderFullView = vi.fn();
  globalThis.setActive = vi.fn();
  globalThis.chooseItem = vi.fn();
  globalThis.initializeChevronIcons = vi.fn();
  globalThis.initializeLegendCollapsedStates = vi.fn();
  globalThis.initializeCollapsibleLegends = vi.fn();
  globalThis.installGlobalDrop = vi.fn();
  globalThis.showDropZone = vi.fn();
  globalThis.hideDropZone = vi.fn();
  globalThis.requestPersistence = vi.fn(async () => true);
  globalThis.loadAttributesFromFile = vi.fn(async () => true);
  globalThis.idbPut = vi.fn(async () => {});
  globalThis.putStored = vi.fn(async () => {});
  globalThis.idbClear = vi.fn(async () => {});
  globalThis.setStatus = vi.fn();
  globalThis.showTemporaryNotification = vi.fn();
  globalThis.showPasswordDialog = vi.fn();
  globalThis.setSingleRoot = vi.fn();
  globalThis.storeEntries = vi.fn(async () => ({ stored: [], unknown: [], missing: [], ignored: [] }));
  vi.stubGlobal('location', { reload: vi.fn() });

  await import('../src/sections/18-files-reset.js');
  window.dispatchEvent(new Event('DOMContentLoaded'));
  await flush(); await flush(); await flush();
});

beforeEach(() => {
  globalThis.applyFromUI.mockClear();
  globalThis.showTemporaryNotification.mockClear();
});

describe('env-driven bootstrap with loaded data', () => {
  it('applies env defaults: depth, management, labels, simulation, layout, attributes', () => {
    expect(document.getElementById('depth').value).toBe('4');
    // E22: TOOLBAR_DIRECTION_DEFAULT is ignored — legacy markup stays untouched
    expect(document.querySelector('.direction-up').classList.contains('active')).toBe(false);
    expect(globalThis.managementEnabled).toBe(false);
    expect(document.getElementById('toggleManagement').classList.contains('active')).toBe(false);
    expect(globalThis.labelsVisible).toBe('attributes');
    expect(globalThis.continuousSimulation).toBe(true);
    expect(document.getElementById('toggleSimulation').classList.contains('active')).toBe(true);
    expect(globalThis.currentLayoutMode).toBe('hierarchy');
    expect(globalThis.attributesVisible).toBe(false);
  });

  it('applies start roots, reports invalid ids and triggers the initial render', () => {
    expect(globalThis.selectedRootIds).toEqual(['p1']);
    expect(globalThis.currentSelectedId).toBe('p1');
    expect(globalThis.hideDropZone).toHaveBeenCalled();
    expect(globalThis.showDropZone).not.toHaveBeenCalled();
  });

  it('seeds default hidden roots from env, skipping unknown ids', () => {
    expect(Array.from(globalThis.hiddenByRoot.keys())).toEqual(['p1']);
    expect(globalThis.recomputeHiddenNodes).toHaveBeenCalled();
  });

  it('management toggle flips state and re-renders', () => {
    const mgmt = document.getElementById('toggleManagement');
    mgmt.click();
    expect(globalThis.managementEnabled).toBe(true);
    expect(globalThis.applyFromUI).toHaveBeenCalledWith('toggleManagement');
    mgmt.click();
    expect(globalThis.managementEnabled).toBe(false);
  });

  it('label toggle cycles through three states while attributes are active', () => {
    globalThis.attributesVisible = true; // enable the 3-state cycle
    const btn = document.getElementById('toggleLabels');
    const svg = document.querySelector('#graph');
    btn.click(); // attributes -> none
    expect(globalThis.labelsVisible).toBe('none');
    expect(svg.classList.contains('labels-hidden')).toBe(true);
    btn.click(); // none -> all
    expect(globalThis.labelsVisible).toBe('all');
    btn.click(); // all -> attributes
    expect(globalThis.labelsVisible).toBe('attributes');
    expect(svg.classList.contains('labels-attributes-only')).toBe(true);
  });

  it('simulation toggle keeps the simulation running when re-enabled', () => {
    const btn = document.getElementById('toggleSimulation');
    btn.click(); // off
    expect(globalThis.continuousSimulation).toBe(false);
    btn.click(); // on again
    expect(globalThis.continuousSimulation).toBe(true);
    expect(globalThis.keepSimulationRunning).toHaveBeenCalled();
  });

  it('de-pseudonymization requires the env password', () => {
    const btn = document.getElementById('togglePseudonymization');
    btn.click(); // disabling -> password dialog
    expect(globalThis.showPasswordDialog).toHaveBeenCalled();
    expect(globalThis.pseudonymizationEnabled).toBe(true); // unchanged yet
    const callback = globalThis.showPasswordDialog.mock.calls[0][0];
    callback('pw');
    expect(globalThis.pseudonymizationEnabled).toBe(false);
    expect(globalThis.refreshAllLabels).toHaveBeenCalled();

    btn.click(); // enabling needs no password
    expect(globalThis.pseudonymizationEnabled).toBe(true);
  });

  it('debug toggle relabels nodes and updates the zoom display', () => {
    const btn = document.getElementById('debugBtn');
    btn.click();
    expect(globalThis.debugMode).toBe(true);
    expect(globalThis.updateDebugZoomDisplay).toHaveBeenCalled();
    btn.click();
    expect(globalThis.debugMode).toBe(false);
  });

  it('hierarchy toggle switches the layout on the running simulation', () => {
    const btn = document.getElementById('toggleHierarchy');
    btn.click();
    expect(globalThis.switchLayout).toHaveBeenCalledWith('hierarchy', globalThis.currentSimulation);
  });

  it('keyboard navigation chooses items and Enter re-renders', () => {
    globalThis.filteredItems = [{ id: 'p1' }];
    globalThis.activeIndex = -1;
    const input = document.getElementById('comboInput');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    expect(globalThis.setActive).toHaveBeenCalledWith(0);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(globalThis.chooseItem).toHaveBeenCalledWith(0, false);
    expect(globalThis.applyFromUI).toHaveBeenCalledWith('keyEnter');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(document.getElementById('comboList').hidden).toBe(true);
  });

  it('attribute file input loads and persists the chosen file', async () => {
    const fileInput = document.getElementById('attributeFileInput');
    const file = { name: 'Team.tsv', text: async () => 'a\tb' };
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    await flush(); await flush();
    expect(globalThis.loadAttributesFromFile).toHaveBeenCalledWith(file);
    expect(globalThis.putStored).toHaveBeenCalledWith(ATTR_PREFIX + 'Team.tsv', 'a\tb');
    expect(globalThis.putStored).toHaveBeenCalledWith(ATTR_PREFIX + 'Team.tsv::name', 'Team.tsv');
  });

  it('creates the footer reset button which clears and reloads', async () => {
    const resetBtn = document.getElementById('resetData');
    expect(resetBtn).not.toBeNull();
    resetBtn.click();
    await flush();
    expect(globalThis.idbClear).toHaveBeenCalled();
    expect(globalThis.location.reload).toHaveBeenCalled();
  });
});
