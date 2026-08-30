import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildAttributeLegend,
} from '../src/sections/16-legend-attributes.js';
import { ICON, setIcon } from '../src/sections/02-icons.js';
import { setLegendSectionCollapsed, setLegendIconButtonState, setLegendRowActive, legendChipText, legendChipTitle } from '../src/sections/12-legend-org.js';
import { cssNumber } from '../src/sections/08-color-geometry.js';
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
  globalThis.setLegendSectionCollapsed = setLegendSectionCollapsed;
    globalThis.setLegendIconButtonState = setLegendIconButtonState;
    globalThis.setLegendRowActive = setLegendRowActive;
  globalThis.legendChipText = legendChipText;
  globalThis.legendChipTitle = legendChipTitle;
  globalThis.cssNumber = cssNumber;
  globalThis.createLegendRow = createLegendRow;
  globalThis.createLegendDepthSpacer = createLegendDepthSpacer;
  globalThis.createLegendTreeSpacer = createLegendTreeSpacer;
  globalThis.createLegendChip = createLegendChip;
  globalThis.createLegendIconButton = createLegendIconButton;
  globalThis.createLegendChevron = createLegendChevron;
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
    expect(eyeBtn.className).toBe('legend-icon-btn dimmed');
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
