import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  showFuzzyMatchDialog,
  finalizeFuzzyMatching,
  exportUnmatchedEntries,
} from '../src/sections/17-fuzzy-dialog.js';
import { hashCode } from '../src/sections/08-color-geometry.js';

let downloads;

const makeFuzzyMatches = () => new Map([
  ['ghost@x.ch', {
    attrs: new Map([['Team::Coach', '1']]),
    potentialMatches: [
      { id: 'p1', label: 'Alice', email: 'alice@x.ch', similarity: 0.1, matchedOn: 'E-Mail' },
      { id: 'p2', label: 'Bob', email: '', similarity: 0.25, matchedOn: 'Name' },
    ],
  }],
]);

beforeEach(() => {
  // exportUnmatchedEntries removes its download anchor via setTimeout(100);
  // fake timers let afterEach flush that cleanup while the DOM still exists.
  vi.useFakeTimers();
  document.body.innerHTML = '';
  downloads = [];
  globalThis.hashCode = hashCode;
  globalThis.personAttributes = new Map();
  globalThis.activeAttributes = new Set();
  globalThis.currentSubgraph = null;
  globalThis.buildAttributeLegend = vi.fn();
  globalThis.updateAttributeStats = vi.fn();
  globalThis.updateAttributeCircles = vi.fn();
  globalThis.notifyAttributeVisibilityChanged = vi.fn();
  globalThis.showTemporaryNotification = vi.fn();
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
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dialog = () => document.querySelector('.fuzzy-match-dialog-container');

describe('showFuzzyMatchDialog', () => {
  it('renders one row per fuzzy entry, defaulting to unmatched', () => {
    const unmatched = new Map();
    showFuzzyMatchDialog(makeFuzzyMatches(), unmatched, new Map(), new Map());
    expect(dialog().textContent).toContain('Mögliche Übereinstimmungen gefunden');
    expect(dialog().querySelector('.fuzzy-identifier').textContent).toBe('ghost@x.ch');
    expect(dialog().querySelector('.fuzzy-attrs').textContent).toBe('Team::Coach');
    expect(unmatched.has('ghost@x.ch')).toBe(true);
    const options = document.querySelectorAll('body > .combo-list li');
    expect(options).toHaveLength(3); // none-match + 2 candidates
    expect(options[1].textContent).toContain('Alice');
    expect(options[1].textContent).toContain('90%');
  });

  it('assigns attributes when a candidate is chosen', () => {
    const unmatched = new Map();
    const assigned = new Map();
    showFuzzyMatchDialog(makeFuzzyMatches(), unmatched, assigned, new Map());
    document.querySelectorAll('body > .combo-list li')[1].click(); // Alice
    expect(assigned.get('p1').get('Team::Coach')).toBe('1');
    expect(unmatched.has('ghost@x.ch')).toBe(false);
    expect(document.querySelector('.combo-input').value).toContain('Alice');
  });

  it('filters candidates while typing and offers keyboard selection', () => {
    showFuzzyMatchDialog(makeFuzzyMatches(), new Map(), new Map(), new Map());
    const input = document.querySelector('.combo-input');
    input.value = 'bob';
    input.dispatchEvent(new Event('input'));
    const visible = Array.from(document.querySelectorAll('body > .combo-list li'))
      .filter((li) => li.style.display !== 'none');
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toContain('Bob');

    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelector('.no-results')).not.toBeNull();
  });

  it('selects the active candidate via ArrowDown + Enter', () => {
    const assigned = new Map();
    showFuzzyMatchDialog(makeFuzzyMatches(), new Map(), assigned, new Map());
    const input = document.querySelector('.combo-input');
    input.value = 'alice';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(assigned.has('p1')).toBe(true);
  });

  it('cancels without changes via the close button and cleans up dropdowns', () => {
    showFuzzyMatchDialog(makeFuzzyMatches(), new Map(), new Map(), new Map());
    document.querySelector('.fuzzy-match-close-btn').click();
    expect(dialog()).toBeNull();
    expect(document.querySelectorAll('body > .combo-list')).toHaveLength(0);
    expect(globalThis.showTemporaryNotification).toHaveBeenCalledWith('Import abgebrochen - keine Änderungen vorgenommen');
  });

  it('cancels via Escape and via overlay click', () => {
    showFuzzyMatchDialog(makeFuzzyMatches(), new Map(), new Map(), new Map());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dialog()).toBeNull();

    showFuzzyMatchDialog(makeFuzzyMatches(), new Map(), new Map(), new Map());
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog()).toBeNull();
  });

  it('confirms: exports unmatched, finalizes and closes', () => {
    const unmatched = new Map();
    const assigned = new Map([['p1', new Map([['Team::Coach', '1']])]]);
    const types = new Map();
    showFuzzyMatchDialog(makeFuzzyMatches(), unmatched, assigned, types);
    document.querySelector('.fuzzy-match-confirm-btn').click();
    expect(dialog()).toBeNull();
    expect(downloads).toHaveLength(1); // unmatched export ran
    expect(downloads[0].download).toMatch(/^unmatched_attributes_.*\.csv$/);
    expect(globalThis.personAttributes).toBe(assigned); // finalize applied
    expect(types.has('Team::Coach')).toBe(true);
  });
});

describe('finalizeFuzzyMatching', () => {
  it('registers colors for new types, activates them and applies attributes', () => {
    const assigned = new Map([['p1', new Map([['Neu::X', '1']])]]);
    const types = new Map();
    finalizeFuzzyMatching(assigned, types);
    expect(types.get('Neu::X')).toMatch(/^hsl\(\d+, 70%, 50%\)$/);
    expect(globalThis.activeAttributes.has('Neu::X')).toBe(true);
    expect(globalThis.personAttributes).toBe(assigned);
    expect(globalThis.buildAttributeLegend).toHaveBeenCalled();
    expect(globalThis.updateAttributeCircles).not.toHaveBeenCalled(); // no subgraph
  });
});

describe('exportUnmatchedEntries', () => {
  it('writes a quoted CSV with header and notifies', () => {
    exportUnmatchedEntries(new Map([
      ['a"b@x.ch', new Map([['Team::Coach', '1']])],
    ]));
    expect(downloads[0].blob.content).toBe('Identifier,Attribute,Wert\n"a""b@x.ch","Team::Coach","1"\n');
    expect(downloads[0].download).toMatch(/^unmatched_attributes_.*\.csv$/);
    expect(globalThis.showTemporaryNotification.mock.calls[0][0]).toContain('1 nicht zugeordnete');
  });

  it('does nothing for an empty map', () => {
    exportUnmatchedEntries(new Map());
    expect(downloads).toHaveLength(0);
  });
});
