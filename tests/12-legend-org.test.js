import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cssNumber } from '../src/sections/08-color-geometry.js';

globalThis.cssNumber = cssNumber;
import {
  buildHiddenLegend,
  initLegendCollapsedItems,
  buildOrgLegend,
  buildScopedOrgLegend,
  applyLegendScope,
  updateLegendChips,
  updateLegendRowColors,
  collectSubtree,
} from '../src/sections/12-legend-org.js';
import { getDisplayLabel } from '../src/sections/06-pseudo-labels.js';
import { colorForOrg } from '../src/sections/08-color-geometry.js';
import { setIcon, ICON } from '../src/sections/02-icons.js';
import { idOf, drawKindOf } from '../src/sections/09-data-load.js';

// Org tree: o1 -> (o2, o3), o2 -> o4
const setupOrgState = () => {
  globalThis.byId = new Map([
    ['o1', { id: 'o1', label: 'Company', type: 'org' }],
    ['o2', { id: 'o2', label: 'Division', type: 'org' }],
    ['o3', { id: 'o3', label: 'Staff', type: 'org' }],
    ['o4', { id: 'o4', label: 'Team', type: 'org' }],
    ['p1', { id: 'p1', label: 'Alice', type: 'person' }],
  ]);
  globalThis.orgChildren = new Map([
    ['o1', new Set(['o2', 'o3'])],
    ['o2', new Set(['o4'])],
  ]);
  globalThis.orgParent = new Map([['o2', 'o1'], ['o3', 'o1'], ['o4', 'o2']]);
  globalThis.orgRoots = ['o1'];
  globalThis.raw = {
    orgs: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }, { id: 'o4' }],
    links: [
      { source: 'o1', target: 'o2' },
      { source: 'o1', target: 'o3' },
      { source: 'o2', target: 'o4' },
    ],
  };
};

beforeEach(() => {
  document.body.innerHTML = '<div id="legend"></div><div id="hiddenLegend"></div>';
  setupOrgState();
  globalThis.ICON = ICON;
  globalThis.setIcon = setIcon;
  globalThis.idOf = idOf;
  globalThis.drawKindOf = drawKindOf;
  globalThis.getDisplayLabel = getDisplayLabel;
  globalThis.colorForOrg = colorForOrg;
  globalThis.pseudonymizationEnabled = false;
  globalThis.pseudoData = null;
  globalThis.parentOf = new Map();
  globalThis.selectedRootIds = [];
  globalThis.removeRoot = () => {};
  globalThis.allowedOrgs = new Set();
  globalThis.oesVisible = true;
  globalThis.orgLegendNodes = new Map();
  globalThis.syncGraphAndLegendColors = vi.fn();
  globalThis.showLegendMenu = vi.fn();
  globalThis.legendMenuEl = null;
  globalThis.nodeMenuEl = null;
  globalThis.hiddenByRoot = new Map();
  globalThis.allHiddenTemporarilyVisible = false;
  globalThis.temporarilyVisibleRoots = new Set();
  globalThis.updateHiddenLegendTitle = vi.fn();
  globalThis.updateGlobalHiddenVisibilityButton = vi.fn();
  globalThis.unhideSubtree = vi.fn();
  globalThis.toggleHiddenRootVisibility = vi.fn();
});

const legendLis = () => document.querySelectorAll('#legend li');
const liFor = (oid) => document.querySelector(`#legend li[data-oid="${oid}"]`);

describe('collectSubtree', () => {
  it('collects the full subtree and respects an optional scope', () => {
    expect(Array.from(collectSubtree('o1', globalThis.orgChildren)).sort()).toEqual(['o1', 'o2', 'o3', 'o4']);
    const scoped = collectSubtree('o1', globalThis.orgChildren, new Set(['o1', 'o2']));
    expect(Array.from(scoped).sort()).toEqual(['o1', 'o2']);
  });
});

describe('buildOrgLegend', () => {
  it('renders the whole tree with depth spacers and chevrons only for parents', () => {
    buildOrgLegend();
    expect(legendLis()).toHaveLength(4);
    expect(liFor('o4').querySelector('.legend-depth-spacer').style.width).toBe('32px');
    expect(liFor('o1').querySelector('.legend-tree-chevron')).not.toBeNull();
    expect(liFor('o3').querySelector('.legend-tree-chevron')).toBeNull();
    expect(globalThis.orgLegendNodes.size).toBe(4);
    expect(globalThis.syncGraphAndLegendColors).toHaveBeenCalled();
  });

  it('derives hierarchy from raw links when global maps are empty', () => {
    globalThis.orgChildren = new Map();
    globalThis.orgRoots = [];
    buildOrgLegend();
    expect(legendLis()).toHaveLength(4);
    expect(liFor('o2').querySelector('ul li[data-oid="o4"]')).not.toBeNull();
  });

  it('toggles org visibility on row click', () => {
    buildOrgLegend();
    const row = liFor('o3').querySelector('.legend-row');
    row.click();
    expect(globalThis.allowedOrgs.has('o3')).toBe(true);
    row.click();
    expect(globalThis.allowedOrgs.has('o3')).toBe(false);
  });

  it('collapses and expands a subtree via the chevron', () => {
    buildOrgLegend();
    const chevron = liFor('o2').querySelector('.legend-tree-chevron');
    const sub = liFor('o2').querySelector('ul');
    chevron.click();
    expect(sub.style.display).toBe('none');
    chevron.click();
    expect(sub.style.display).toBe('');
  });

  it('opens the unified E24 menu and applies its row actions', () => {
    buildOrgLegend();
    const openMenu = () => {
      liFor('o1').querySelector('.legend-row')
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const menu = globalThis.nodeMenuEl;
      expect(menu.style.display).toBe('block');
      return menu.querySelectorAll('.menu-item');
    };

    // E24 order: Ausblenden / Einblenden / Nur direkte Kinder / Als Root
    // definieren / Als Root entfernen — rows share the node menu.
    let items = openMenu();
    const labels = Array.from(globalThis.nodeMenuEl.querySelectorAll('.menu-item-label')).map((l) => l.textContent);
    expect(labels).toEqual(['Ausblenden', 'Einblenden', 'Nur direkte Kinder anzeigen', 'Als Root definieren', 'Als Root entfernen']);
    items[1].click(); // Einblenden (onShowAll semantics)
    expect(Array.from(globalThis.allowedOrgs).sort()).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(globalThis.nodeMenuEl.style.display).toBe('none');

    items = openMenu();
    items[0].click(); // Ausblenden (onHideAll semantics)
    expect(globalThis.allowedOrgs.size).toBe(0);

    items = openMenu();
    items[2].click(); // Nur direkte Kinder anzeigen
    expect(Array.from(globalThis.allowedOrgs).sort()).toEqual(['o1', 'o2', 'o3']);
    // grandchild subtree is visually collapsed
    expect(liFor('o2').querySelector('ul').style.display).toBe('none');
  });
});

describe('buildScopedOrgLegend / applyLegendScope', () => {
  it('renders only scoped nodes with scope-roots at the top', () => {
    buildScopedOrgLegend(new Set(['o2', 'o4']));
    expect(legendLis()).toHaveLength(2);
    expect(document.querySelector('#legend > ul > li').dataset.oid).toBe('o2');
    expect(liFor('o3')).toBeNull();
  });

  it('clears the legend for an empty scope', () => {
    buildOrgLegend();
    buildScopedOrgLegend(new Set());
    expect(legendLis()).toHaveLength(0);
  });

  it('applyLegendScope expands the scope by ancestor chains', () => {
    applyLegendScope(new Set(['o4']));
    expect(liFor('o1')).not.toBeNull();
    expect(liFor('o2')).not.toBeNull();
    expect(liFor('o4')).not.toBeNull();
    expect(liFor('o3')).toBeNull();
  });

  it('initLegendCollapsedItems pre-collapses siblings that have children', () => {
    initLegendCollapsedItems(new Set(['o1', 'o2', 'o3', 'o4']));
    buildScopedOrgLegend(new Set(['o1', 'o2', 'o3', 'o4']));
    expect(liFor('o2').querySelector('ul').style.display).toBe('none');
    expect(liFor('o2').querySelector('.legend-tree-chevron').className).toContain('collapsed');
  });
});

describe('updateLegendChips / updateLegendRowColors', () => {
  it('syncs allowedOrgs from checkboxes while OEs are visible', () => {
    buildOrgLegend();
    document.querySelector('#org_o2').checked = true;
    updateLegendChips();
    expect(Array.from(globalThis.allowedOrgs)).toEqual(['o2']);
  });

  it('leaves allowedOrgs untouched while OEs are hidden', () => {
    buildOrgLegend();
    globalThis.allowedOrgs = new Set(['o1']);
    globalThis.oesVisible = false;
    updateLegendChips();
    expect(Array.from(globalThis.allowedOrgs)).toEqual(['o1']);
  });

  it('marks active rows and applies org colors as CSS custom properties', () => {
    buildOrgLegend();
    globalThis.allowedOrgs = new Set(['o2']);
    updateLegendRowColors();
    const activeRow = liFor('o2').querySelector('.legend-row');
    const inactiveRow = liFor('o3').querySelector('.legend-row');
    expect(activeRow.classList.contains('active')).toBe(true);
    expect(inactiveRow.classList.contains('active')).toBe(false);
    expect(activeRow.style.getPropertyValue('--org-stroke')).toMatch(/^hsla\(/);
    expect(document.querySelector('#org_o2').checked).toBe(true);
  });
});

describe('buildHiddenLegend', () => {
  it('clears the legend when nothing is hidden', () => {
    buildHiddenLegend();
    expect(document.querySelector('#hiddenLegend').innerHTML).toBe('');
    expect(globalThis.updateHiddenLegendTitle).toHaveBeenCalled();
    expect(globalThis.updateGlobalHiddenVisibilityButton).toHaveBeenCalled();
  });

  it('lists hidden roots with counts and wires unhide/eye buttons', () => {
    globalThis.byId.set('p1', { id: 'p1', label: 'Alice', type: 'person' });
    globalThis.hiddenByRoot = new Map([['p1', new Set(['p1', 'x'])]]);
    globalThis.temporarilyVisibleRoots = new Set(['p1']);
    buildHiddenLegend();
    const chip = document.querySelector('#hiddenLegend .legend-label-chip');
    expect(chip.textContent).toBe('Alice (2)');
    const [removeBtn, eyeBtn] = document.querySelectorAll('#hiddenLegend button');
    expect(eyeBtn.classList.contains('active')).toBe(true);
    removeBtn.click();
    expect(globalThis.unhideSubtree).toHaveBeenCalledWith('p1');
    eyeBtn.click();
    expect(globalThis.toggleHiddenRootVisibility).toHaveBeenCalledWith('p1');
  });
});
