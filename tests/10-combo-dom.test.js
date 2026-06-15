import { describe, it, expect, beforeEach, vi } from 'vitest';
import { matchesWordPrefixes, populateCombo, setActive, chooseItem } from '../src/sections/10-combo.js';
import { getDisplayLabel } from '../src/sections/06-pseudo-labels.js';
import {
  INPUT_COMBO_ID, LIST_COMBO_ID, MIN_SEARCH_LENGTH, MAX_DROPDOWN_ITEMS,
} from '../src/sections/01-config-status.js';

beforeEach(() => {
  document.body.innerHTML = '<input id="comboInput"><ul id="comboList" hidden></ul>';
  globalThis.INPUT_COMBO_ID = INPUT_COMBO_ID;
  globalThis.LIST_COMBO_ID = LIST_COMBO_ID;
  globalThis.MIN_SEARCH_LENGTH = MIN_SEARCH_LENGTH;
  globalThis.MAX_DROPDOWN_ITEMS = MAX_DROPDOWN_ITEMS;
  globalThis.getDisplayLabel = getDisplayLabel;
  globalThis.pseudonymizationEnabled = false;
  globalThis.pseudoData = null;
  globalThis.filteredItems = [];
  globalThis.activeIndex = -1;
  globalThis.allNodesUnique = [
    { id: 'p1', label: 'Alice', type: 'person' },
    { id: 'p2', label: 'Bob', type: 'person' },
    { id: 'o1', label: 'Alpha Org', type: 'org' },
  ];
  globalThis.Logger = { log: () => {} };
  globalThis.debugMode = false;
  globalThis.selectedRootIds = [];
  globalThis.currentSelectedId = null;
  globalThis.lastSingleRootId = null;
  globalThis.raw = { nodes: globalThis.allNodesUnique };
  globalThis.addRoot = vi.fn(() => true);
  globalThis.setSingleRoot = vi.fn();
  globalThis.applyFromUI = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const list = () => document.querySelector('#comboList');

describe('populateCombo', () => {
  it('hides and clears the list for an empty term', () => {
    populateCombo('');
    expect(list().hidden).toBe(true);
    expect(list().innerHTML).toBe('');
    expect(globalThis.filteredItems).toEqual([]);
  });

  it('shows a minimum-length hint below MIN_SEARCH_LENGTH', () => {
    populateCombo('a');
    expect(list().hidden).toBe(false);
    expect(list().textContent).toContain(`Mindestens ${MIN_SEARCH_LENGTH} Zeichen`);
    expect(globalThis.filteredItems).toEqual([]);
  });

  it('filters by label and id, case-insensitively, sorted by label', () => {
    populateCombo('al');
    const texts = Array.from(list().children).map((li) => li.textContent);
    expect(texts).toEqual(['Alice — p1', 'Alpha Org — o1']);
    expect(list().children[0].getAttribute('data-id')).toBe('p1');
    expect(list().hidden).toBe(false);
  });

  it('matches word-beginning prefixes ("B Berg" → "Beat Berger")', () => {
    globalThis.allNodesUnique = [
      { id: 'p1', label: 'Beat Berger', type: 'person' },
      { id: 'p2', label: 'Barbara Berg', type: 'person' },
      { id: 'p3', label: 'Chris Müller', type: 'person' },
    ];
    populateCombo('B Berg');
    const labels = globalThis.filteredItems.map(n => n.label);
    expect(labels).toContain('Beat Berger');
    expect(labels).toContain('Barbara Berg');
    expect(labels).not.toContain('Chris Müller');
  });

  it('matches ids too and hides the list when nothing matches', () => {
    populateCombo('p2');
    expect(Array.from(list().children).map((li) => li.textContent)).toEqual(['Bob — p2']);
    populateCombo('zz');
    expect(list().hidden).toBe(true);
  });

  it('truncates at MAX_DROPDOWN_ITEMS and appends a hint', () => {
    globalThis.allNodesUnique = Array.from({ length: MAX_DROPDOWN_ITEMS + 20 }, (_, i) => ({
      id: `p${i}`, label: `Same Name ${String(i).padStart(3, '0')}`, type: 'person',
    }));
    populateCombo('same');
    expect(globalThis.filteredItems).toHaveLength(MAX_DROPDOWN_ITEMS);
    expect(list().children).toHaveLength(MAX_DROPDOWN_ITEMS + 1);
    expect(list().lastChild.textContent).toContain(`erste ${MAX_DROPDOWN_ITEMS} Ergebnisse`);
  });

  it('selects an item on mousedown (shift adds as root)', () => {
    populateCombo('alice');
    list().children[0].dispatchEvent(new MouseEvent('mousedown', { shiftKey: true }));
    expect(globalThis.addRoot).toHaveBeenCalledWith('p1');
    expect(globalThis.applyFromUI).toHaveBeenCalledWith('comboSelect');
  });
});

describe('setActive', () => {
  it('marks exactly the given index as active', () => {
    populateCombo('al');
    setActive(1);
    const items = Array.from(list().children);
    expect(items[0].classList.contains('is-active')).toBe(false);
    expect(items[1].classList.contains('is-active')).toBe(true);
    expect(globalThis.activeIndex).toBe(1);
    expect(items[1].scrollIntoView).toHaveBeenCalled();
  });

  it('clears all when index is -1', () => {
    populateCombo('al');
    setActive(0);
    setActive(-1);
    expect(list().querySelectorAll('.is-active')).toHaveLength(0);
  });
});

describe('chooseItem', () => {
  beforeEach(() => populateCombo('al'));

  it('replaces the root selection without addMode', () => {
    chooseItem(0, false);
    expect(globalThis.setSingleRoot).toHaveBeenCalledWith('p1');
    expect(globalThis.currentSelectedId).toBe('p1');
    expect(document.querySelector('#comboInput').value).toBe('Alice');
    expect(list().hidden).toBe(true);
    expect(globalThis.applyFromUI).toHaveBeenCalledWith('comboSelect');
  });

  it('seeds the multi-root from the current selection in addMode', () => {
    globalThis.currentSelectedId = 'p2';
    chooseItem(0, true);
    expect(globalThis.selectedRootIds).toEqual(['p2']);
    expect(globalThis.addRoot).toHaveBeenCalledWith('p1');
  });

  it('seeds from a guessed input value when nothing is selected', () => {
    document.querySelector('#comboInput').value = 'Bob';
    chooseItem(0, true);
    expect(globalThis.selectedRootIds).toEqual(['p2']);
  });

  it('ignores out-of-range indices', () => {
    chooseItem(99, false);
    expect(globalThis.setSingleRoot).not.toHaveBeenCalled();
  });
});

describe('matchesWordPrefixes', () => {
  it('single term falls back to substring match', () => {
    expect(matchesWordPrefixes(['berg'], 'beat berger')).toBe(true);
    expect(matchesWordPrefixes(['eat'], 'beat berger')).toBe(true);
    expect(matchesWordPrefixes(['xyz'], 'beat berger')).toBe(false);
  });

  it('matches word-beginning prefixes across multiple terms', () => {
    expect(matchesWordPrefixes(['b', 'berger'], 'beat berger')).toBe(true);
    expect(matchesWordPrefixes(['b', 'berg'], 'beat berger')).toBe(true);
    expect(matchesWordPrefixes(['be', 'be'], 'beat berger')).toBe(true);
    expect(matchesWordPrefixes(['beat', 'berger'], 'beat berger')).toBe(true);
  });

  it('rejects when a term does not match any word start', () => {
    expect(matchesWordPrefixes(['x', 'berger'], 'beat berger')).toBe(false);
    expect(matchesWordPrefixes(['beat', 'x'], 'beat berger')).toBe(false);
  });

  it('does not reuse the same word for two terms', () => {
    expect(matchesWordPrefixes(['b', 'b', 'b'], 'beat berger')).toBe(false);
  });

  it('returns false for empty term list', () => {
    expect(matchesWordPrefixes([], 'beat berger')).toBe(false);
  });
});
