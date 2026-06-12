import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  addNodeToAttribute,
  createSubmenuItem,
  createCategorySubmenuItem,
  saveCategory,
  exportSingleAttribute,
  exportCategoryAsTSV,
  promptNewAttribute,
  promptNewCategory,
  ensureNodeMenu,
  showNodeMenu,
} from '../src/sections/12-legend-org.js';
import { colorForCategoryAttribute } from '../src/sections/08-color-geometry.js';
import { ATTR_PREFIX } from '../src/sections/04-storage.js';

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
  globalThis.ATTR_PREFIX = ATTR_PREFIX;
  globalThis.idbStore = new Map();
  globalThis.idbPut = vi.fn(async (k, v) => { globalThis.idbStore.set(k, v); });
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

describe('addNodeToAttribute', () => {
  it('registers the attribute, activates it and marks the category modified', () => {
    globalThis.emptyCategories = new Set(['Team']);
    addNodeToAttribute('p1', 'Team', 'Coach');
    expect(globalThis.personAttributes.get('p1').get('Team::Coach')).toBe('1');
    expect(globalThis.attributeTypes.has('Team::Coach')).toBe(true);
    expect(globalThis.activeAttributes.has('Team::Coach')).toBe(true);
    expect(globalThis.emptyCategories.has('Team')).toBe(false);
    expect(globalThis.modifiedCategories.has('Team')).toBe(true);
    expect(globalThis.showTemporaryNotification).toHaveBeenCalledWith('"Coach" zu Alice hinzugefügt');
  });

  it('reuses the existing type registration on repeated adds', () => {
    addNodeToAttribute('p1', 'Team', 'Coach');
    const color = globalThis.attributeTypes.get('Team::Coach');
    addNodeToAttribute('p2', 'Team', 'Coach', '5');
    expect(globalThis.attributeTypes.get('Team::Coach')).toBe(color);
    expect(globalThis.personAttributes.get('p2').get('Team::Coach')).toBe('5');
  });
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

  it('builds the action menu with root handling and an attributes submenu entry', () => {
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
    expect(labels).toEqual(['Ausblenden', 'Als Root definieren', 'Als Root entfernen', 'Attribute']);
    const items = globalThis.nodeMenuEl.querySelectorAll('.menu-item');
    expect(items[1].classList.contains('disabled')).toBe(true); // already root
    expect(items[3].querySelector('.menu-item-arrow')).not.toBeNull();
  });

  it('opens the attribute submenu with sorted categories and a new-category entry', () => {
    globalThis.attributeTypes = new Map([['Team::Coach', 'red'], ['Rolle::Dev', 'blue']]);
    showNodeMenu(0, 0, { nodeId: 'p1' });
    const attrItem = globalThis.nodeMenuEl.querySelector('.menu-item');
    attrItem.click();
    const submenu = document.querySelector('.node-context-menu[data-level="2"]');
    const labels = Array.from(submenu.querySelectorAll('.menu-item-label')).map((l) => l.textContent);
    expect(labels).toEqual(['Rolle', 'Team', '+ neue Kategorie ...']);
  });

  it('offers only the new-category entry when nothing is registered', () => {
    showNodeMenu(0, 0, { nodeId: 'p1' });
    globalThis.nodeMenuEl.querySelector('.menu-item').click();
    const submenu = document.querySelector('.node-context-menu[data-level="2"]');
    expect(submenu.querySelectorAll('.menu-item')).toHaveLength(1);
    expect(submenu.textContent).toContain('+ neue Kategorie ...');
  });

  it('adds an attribute via the category sub-submenu and closes all menus', () => {
    globalThis.attributeTypes = new Map([['Team::Coach', 'red']]);
    showNodeMenu(0, 0, { nodeId: 'p1' });
    globalThis.nodeMenuEl.querySelector('.menu-item').click();
    const catItem = document.querySelector('.node-context-menu[data-level="2"] .menu-item');
    catItem.dispatchEvent(new MouseEvent('mouseenter'));
    const level3 = document.querySelector('.node-context-menu[data-level="3"]');
    const labels = Array.from(level3.querySelectorAll('.menu-item-label')).map((l) => l.textContent);
    expect(labels).toEqual(['Coach', '+ neues Attribut ...']);
    level3.querySelector('.menu-item').click();
    expect(globalThis.personAttributes.get('p1').get('Team::Coach')).toBe('1');
    expect(document.querySelector('.node-context-menu[data-level="2"]')).toBeNull();
    expect(globalThis.nodeMenuEl.style.display).toBe('none');
  });
});

describe('prompts', () => {
  it('promptNewAttribute adds the trimmed attribute and ignores cancel/blank', () => {
    globalThis.prompt.mockReturnValueOnce('  Coach  ');
    promptNewAttribute('p1', 'Team');
    expect(globalThis.personAttributes.get('p1').has('Team::Coach')).toBe(true);
    globalThis.prompt.mockReturnValueOnce(null);
    promptNewAttribute('p1', 'Team');
    globalThis.prompt.mockReturnValueOnce('   ');
    promptNewAttribute('p1', 'Team');
    expect(globalThis.personAttributes.get('p1').size).toBe(1);
  });

  it('promptNewCategory asks for category and attribute name', () => {
    globalThis.prompt.mockReturnValueOnce(' Neu ').mockReturnValueOnce('Erst');
    promptNewCategory('p1');
    expect(globalThis.personAttributes.get('p1').has('Neu::Erst')).toBe(true);
    globalThis.prompt.mockReturnValueOnce('Cat').mockReturnValueOnce(null);
    promptNewCategory('p1');
    expect(globalThis.personAttributes.get('p1').size).toBe(1);
  });
});

describe('exports', () => {
  beforeEach(() => {
    globalThis.personAttributes = new Map([
      ['p1', new Map([['Team::Coach', '1'], ['Rolle::Dev', '1']])],
      ['p9', new Map([['Team::PL', '1']])], // no byId entry -> falls back to id
    ]);
  });

  it('saveCategory persists to IndexedDB, clears the flag and downloads', async () => {
    globalThis.categorySourceFiles = new Map([['Team', { filename: 'Team.tsv', format: 'tab' }]]);
    globalThis.modifiedCategories = new Set(['Team']);
    expect(await saveCategory('Team')).toBe(true);
    // IndexedDB updated under the imported file's key (reload-safe)
    expect(globalThis.idbStore.get(ATTR_PREFIX + 'Team.tsv')).toBe('alice@x.ch\tCoach\np9\tPL');
    expect(globalThis.idbStore.get(ATTR_PREFIX + 'Team.tsv::name')).toBe('Team.tsv');
    expect(globalThis.categorySourceFiles.get('Team').originalText).toBe('alice@x.ch\tCoach\np9\tPL');
    expect(globalThis.modifiedCategories.has('Team')).toBe(false);
    expect(globalThis.buildAttributeLegend).toHaveBeenCalled();
    // jsdom has no showSaveFilePicker -> download fallback
    expect(downloads[0].blob.content).toBe('alice@x.ch\tCoach\np9\tPL');
    expect(downloads[0].download).toBe('Team.tsv');
  });

  it('saveCategory creates a source entry for UI-created categories', async () => {
    globalThis.modifiedCategories = new Set(['Team']);
    expect(await saveCategory('Team')).toBe(true);
    expect(globalThis.categorySourceFiles.get('Team')).toMatchObject({ filename: 'Team.tsv', format: 'tab', url: null });
    expect(globalThis.idbStore.get(ATTR_PREFIX + 'Team.tsv')).toContain('Coach');
  });

  it('saveCategory keeps the modified flag when the IndexedDB write fails', async () => {
    globalThis.idbPut = vi.fn(async () => { throw new Error('quota'); });
    globalThis.modifiedCategories = new Set(['Team']);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await saveCategory('Team')).toBe(false);
    expect(globalThis.modifiedCategories.has('Team')).toBe(true);
    expect(downloads).toHaveLength(0);
  });

  it('exportSingleAttribute downloads a sanitized per-attribute file', () => {
    exportSingleAttribute('Team::Coach');
    expect(downloads[0].blob.content).toBe('alice@x.ch\tCoach');
    expect(downloads[0].download).toBe('Team_Coach.tsv');
    exportSingleAttribute('Team::Ghost');
    expect(downloads).toHaveLength(1); // nothing for unknown attribute
  });

  it('exportCategoryAsTSV sanitizes the category filename', () => {
    globalThis.personAttributes = new Map([['p1', new Map([['My Cat::X', '1']])]]);
    exportCategoryAsTSV('My Cat');
    expect(downloads[0].download).toBe('My_Cat.tsv');
    expect(downloads[0].blob.content).toBe('alice@x.ch\tX');
    exportCategoryAsTSV('Leer');
    expect(downloads).toHaveLength(1);
  });
});
