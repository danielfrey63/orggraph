import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createSubmenuItem,
  ensureNodeMenu,
  showNodeMenu,
} from '../src/sections/12-legend-org.js';
import * as section12 from '../src/sections/12-legend-org.js';
import { colorForCategoryAttribute } from '../src/sections/08-color-geometry.js';

let downloads;

beforeEach(() => {
  document.body.innerHTML = '';
  downloads = [];
  globalThis.colorForCategoryAttribute = colorForCategoryAttribute;
  globalThis.personAttributes = new Map();
  globalThis.attributeTypes = new Map();
  globalThis.activeAttributes = new Set();
  globalThis.emptyCategories = new Set();
  globalThis.modifiedCategories = new Set();
  globalThis.categorySourceFiles = new Map();
  globalThis.byId = new Map([['p1', { id: 'p1', label: 'Alice', email: 'alice@x.ch' }]]);
  globalThis.debugMode = false;
  globalThis.selectedRootIds = [];
  globalThis.nodeMenuEl = null;
  globalThis.buildAttributeLegend = vi.fn();
  globalThis.updateAttributeStats = vi.fn();
  globalThis.updateAttributeCircles = vi.fn();
  globalThis.showTemporaryNotification = vi.fn();
  globalThis.prompt = vi.fn();
  globalThis.idbStore = new Map();
  globalThis.idbPut = vi.fn(async (k, v) => { globalThis.idbStore.set(k, v); });
  globalThis.putStored = vi.fn(async (k, v) => { globalThis.idbStore.set(k, v); });
  vi.stubGlobal('Blob', class FakeBlob {
    constructor(parts, opts) { this.content = parts.join(''); this.type = opts?.type; }
  });
  URL.createObjectURL = vi.fn((blob) => { downloads.push({ blob }); return '#blob-mock'; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    downloads[downloads.length - 1].download = this.download;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('node context menu', () => {
  it('supports the legacy function signature with a single hide item', () => {
    const onHide = vi.fn();
    showNodeMenu(10, 20, onHide);
    const menu = globalThis.nodeMenuEl;
    expect(menu.style.display).toBe('block');
    const items = menu.querySelectorAll('.menu-item');
    expect(items).toHaveLength(1);
    items[0].click();
    expect(onHide).toHaveBeenCalled();
    expect(menu.style.display).toBe('none');
    expect(ensureNodeMenu()).toBe(menu); // singleton
  });

  it('builds the unified E24 menu: five fixed entries, inapplicable ones disabled', () => {
    globalThis.selectedRootIds = ['p1', 'p2'];
    const actions = {
      onHideSubtree: vi.fn(),
      onSetAsRoot: vi.fn(),
      onRemoveRoot: vi.fn(),
      isRoot: true,
      nodeId: 'p1',
    };
    showNodeMenu(0, 0, actions);
    const labels = Array.from(globalThis.nodeMenuEl.querySelectorAll('.menu-item-label')).map((l) => l.textContent);
    expect(labels).toEqual(['Ausblenden', 'Einblenden', 'Nur direkte Kinder anzeigen', 'Als Root definieren', 'Als Root entfernen']);
    const items = globalThis.nodeMenuEl.querySelectorAll('.menu-item');
    expect(items[1].classList.contains('disabled')).toBe(true); // no unhide handler -> disabled, never hidden
    expect(items[2].classList.contains('disabled')).toBe(true); // no direct-children handler
    expect(items[3].classList.contains('disabled')).toBe(true); // already root
    expect(items[4].classList.contains('disabled')).toBe(false); // multi-root: removable
    // attribute submenu is gone (E24/§9.3)
    expect(labels).not.toContain('Attribute');
  });

  it('last root is not removable: entry disabled with a single root', () => {
    globalThis.selectedRootIds = ['p1'];
    showNodeMenu(0, 0, { onHideSubtree: vi.fn(), onRemoveRoot: vi.fn(), isRoot: true });
    const items = globalThis.nodeMenuEl.querySelectorAll('.menu-item');
    expect(items[4].classList.contains('disabled')).toBe(true);
  });



});

// The attribute add/save/export complex was torn down with the v1 attribute
// round-trip (§9.3/§9.4, E24/E25): absence proof in the repo's teardown style.
describe('legacy attribute menu/save complex stays removed', () => {
  it.each([
    'addNodeToAttribute',
    'addAttributeSubmenu',
    'createCategorySubmenuItem',
    'saveCategory',
    'exportSingleAttribute',
    'exportCategoryAsTSV',
    'promptNewAttribute',
    'promptNewCategory',
    'showLegendMenu',
    'ensureLegendMenu',
    'triggerDownload',
    'buildCategoryLines',
    'writeCategoryFile',
  ])('%s is no longer exported', (name) => {
    expect(section12[name]).toBeUndefined();
  });
});
