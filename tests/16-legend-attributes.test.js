import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCheckboxSVG,
  getChevronSVG,
  getCheckAllSVG,
  getEyeSVG,
  getSaveSVG,
  getDownloadSVG,
  updateCheckboxIcon,
  initializeChevronIcons,
  initializeLegendCollapsedStates,
  buildAttributeLegend,
} from '../src/sections/16-legend-attributes.js';
import { ICON, setIcon } from '../src/sections/02-icons.js';
import { colorToTransparent } from '../src/sections/08-color-geometry.js';
import {
  createLegendRow,
  createLegendDepthSpacer,
  createLegendTreeSpacer,
  createLegendChip,
  createLegendIconButton,
  createLegendChevron,
} from '../src/sections/12-legend-org.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="attributeLegend"></div><span id="stats-attributes-count">0</span>';
  globalThis.ICON = ICON;
  globalThis.setIcon = setIcon;
  globalThis.colorToTransparent = colorToTransparent;
  globalThis.createLegendRow = createLegendRow;
  globalThis.createLegendDepthSpacer = createLegendDepthSpacer;
  globalThis.createLegendTreeSpacer = createLegendTreeSpacer;
  globalThis.createLegendChip = createLegendChip;
  globalThis.createLegendIconButton = createLegendIconButton;
  globalThis.createLegendChevron = createLegendChevron;
  globalThis.getChevronSVG = getChevronSVG;
  globalThis.updateAttributeStats = vi.fn();
  globalThis.updateAttributeCircles = vi.fn();
  globalThis.notifyAttributeVisibilityChanged = vi.fn();
  globalThis.exportCategoryAsTSV = vi.fn();
  globalThis.saveCategory = vi.fn();
  globalThis.attributeTypes = new Map();
  globalThis.emptyCategories = new Set();
  globalThis.personAttributes = new Map();
  globalThis.activeAttributes = new Set();
  globalThis.collapsedCategories = new Set();
  globalThis.hiddenCategories = new Set();
  globalThis.modifiedCategories = new Set();
  globalThis.categorySourceFiles = new Map();
  globalThis.envConfig = null;
  globalThis.debugMode = false;
});

describe('SVG getters', () => {
  it('map states to the central icon registry', () => {
    expect(getCheckboxSVG(true)).toBe(ICON.check);
    expect(getCheckboxSVG(false)).toBe(ICON.close);
    expect(getChevronSVG()).toBe(ICON.chevronDown);
    expect(getCheckAllSVG()).toBe(ICON.checkAll);
    expect(getEyeSVG(false)).toBe(ICON.eye);
    expect(getEyeSVG(true)).toBe(ICON.eyeClosed);
    expect(getSaveSVG()).toBe(ICON.save);
    expect(getDownloadSVG()).toBe(ICON.cloudDownload);
  });
});

describe('updateCheckboxIcon', () => {
  it('adds and removes the checked class with matching icon', () => {
    const el = document.createElement('span');
    el.className = 'cb';
    updateCheckboxIcon(el, true);
    expect(el.className).toBe('cb checked');
    expect(el.innerHTML).toContain('points="20 6 9 17 4 12"'); // check icon
    updateCheckboxIcon(el, false);
    expect(el.className).toBe('cb');
    expect(el.querySelectorAll('line')).toHaveLength(2); // close icon
  });
});

describe('initializeChevronIcons / initializeLegendCollapsedStates', () => {
  it('injects the chevron SVG into all legend chevrons', () => {
    document.body.innerHTML = '<button class="legend-chevron"></button><button class="legend-chevron"></button>';
    initializeChevronIcons();
    for (const btn of document.querySelectorAll('.legend-chevron')) {
      expect(btn.innerHTML).toContain('points="6 9 12 15 18 9"'); // chevron icon
    }
  });

  it('applies env-driven collapsed states and skips non-boolean values', () => {
    document.body.innerHTML = `
      <button class="legend-chevron expanded" data-target="legend"></button><div id="legend"></div>
      <button class="legend-chevron collapsed" data-target="attributeContainer"></button><div id="attributeContainer" class="collapsed"></div>
      <button class="legend-chevron expanded" data-target="hiddenLegend"></button><div id="hiddenLegend"></div>`;
    globalThis.envConfig = {
      LEGEND_OES_COLLAPSED: true,
      LEGEND_ATTRIBUTES_COLLAPSED: false,
      LEGEND_HIDDEN_COLLAPSED: 'nope',
    };
    initializeLegendCollapsedStates();
    expect(document.getElementById('legend').classList.contains('collapsed')).toBe(true);
    expect(document.getElementById('attributeContainer').classList.contains('collapsed')).toBe(false);
    expect(document.querySelector('[data-target="hiddenLegend"]').className).toBe('legend-chevron expanded');
  });
});

describe('buildAttributeLegend', () => {
  const setupAttrs = () => {
    globalThis.attributeTypes = new Map([
      ['Team::Coach', 'hsl(0, 65%, 50%)'],
      ['Team::PL', 'hsl(40, 65%, 50%)'],
      ['Rolle::Dev', 'hsl(80, 65%, 50%)'],
    ]);
    globalThis.personAttributes = new Map([
      ['p1', new Map([['Team::Coach', '1'], ['Rolle::Dev', '1']])],
      ['p2', new Map([['Team::Coach', '1']])],
    ]);
    globalThis.activeAttributes = new Set(['Team::Coach']);
  };

  it('renders nothing but stats for an empty registry', () => {
    buildAttributeLegend();
    expect(document.querySelector('#attributeLegend').innerHTML).toBe('');
    expect(globalThis.updateAttributeStats).toHaveBeenCalled();
  });

  it('renders sorted categories with counts and active rows', () => {
    setupAttrs();
    buildAttributeLegend();
    const chips = Array.from(document.querySelectorAll('#attributeLegend > ul > li > .legend-row .legend-label-chip'))
      .map((c) => c.textContent);
    expect(chips[0]).toBe('Rolle (1)');
    expect(chips[1]).toBe('Team (2)'); // Coach 2x, PL 0x
    const activeRows = document.querySelectorAll('#attributeLegend .legend-row.active');
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].textContent).toContain('Coach (2)');
  });

  it('lists empty categories as placeholders', () => {
    globalThis.emptyCategories = new Set(['Leer']);
    buildAttributeLegend();
    expect(document.querySelector('#attributeLegend').textContent).toContain('Leer (0)');
  });

  it('toggles an attribute on row click and redraws', () => {
    setupAttrs();
    buildAttributeLegend();
    const devRow = Array.from(document.querySelectorAll('#attributeLegend ul ul .legend-row'))
      .find((r) => r.textContent.includes('Dev'));
    devRow.click();
    expect(globalThis.activeAttributes.has('Rolle::Dev')).toBe(true);
    expect(devRow.classList.contains('active')).toBe(true);
    devRow.click();
    expect(globalThis.activeAttributes.has('Rolle::Dev')).toBe(false);
    expect(globalThis.updateAttributeCircles).toHaveBeenCalledTimes(2);
  });

  it('toggles category visibility via the eye button', () => {
    setupAttrs();
    buildAttributeLegend();
    const eyeBtn = document.querySelector('#attributeLegend .legend-icon-btn[title="Kategorie ausblenden"]');
    eyeBtn.click();
    expect(globalThis.hiddenCategories.size).toBe(1);
    expect(eyeBtn.className).toBe('legend-icon-btn hidden');
    eyeBtn.click();
    expect(globalThis.hiddenCategories.size).toBe(0);
  });

  it('collapses and expands categories via the chevron', () => {
    setupAttrs();
    buildAttributeLegend();
    const catLi = document.querySelector('#attributeLegend > ul > li');
    const chevron = catLi.querySelector('.legend-tree-chevron');
    const sub = catLi.querySelector('ul');
    chevron.click();
    expect(sub.style.display).toBe('none');
    expect(globalThis.collapsedCategories.size).toBe(1);
    chevron.click();
    expect(sub.style.display).toBe('');
    expect(globalThis.collapsedCategories.size).toBe(0);
  });

  it('renders collapsed categories closed — without TSV download or save buttons (§9.4)', () => {
    setupAttrs();
    globalThis.collapsedCategories = new Set(['Team']);
    buildAttributeLegend();
    const teamLi = Array.from(document.querySelectorAll('#attributeLegend > ul > li'))
      .find((li) => li.textContent.includes('Team'));
    expect(teamLi.querySelector('ul').style.display).toBe('none');
    // the attribute round-trip is gone: no per-category download/save controls
    expect(document.querySelector('#attributeLegend .legend-icon-btn[title*="TSV"]')).toBeNull();
    expect(document.querySelector('#attributeLegend .save-btn')).toBeNull();
  });
});
