import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  updateHiddenLegendEyeButtons,
  updateGlobalHiddenVisibilityButton,
  updateHiddenLegendTitle,
} from '../src/sections/11-graph-core.js';

beforeEach(() => {
  globalThis.setIcon = vi.fn();
  globalThis.allHiddenTemporarilyVisible = false;
  globalThis.temporarilyVisibleRoots = new Set();
  globalThis.hiddenByRoot = new Map();
  globalThis.currentHiddenCount = 0;
});

describe('updateHiddenLegendEyeButtons', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="hiddenLegend">
        <button class="legend-icon-btn" data-root-id="r1"></button>
        <button class="legend-icon-btn" data-root-id="r2"></button>
      </div>`;
  });

  it('marks per-root visible buttons active with the open eye', () => {
    globalThis.temporarilyVisibleRoots = new Set(['r1']);
    updateHiddenLegendEyeButtons();
    const [b1, b2] = document.querySelectorAll('[data-root-id]');
    expect(b1.className).toBe('legend-icon-btn active');
    expect(b1.title).toBe('Temporär ausblenden');
    expect(b2.className).toBe('legend-icon-btn');
    expect(b2.title).toBe('Temporär einblenden');
    expect(globalThis.setIcon).toHaveBeenCalledWith(b1, 'eye');
    expect(globalThis.setIcon).toHaveBeenCalledWith(b2, 'eyeClosed');
  });

  it('treats all buttons as visible under the global toggle', () => {
    globalThis.allHiddenTemporarilyVisible = true;
    updateHiddenLegendEyeButtons();
    for (const b of document.querySelectorAll('[data-root-id]')) {
      expect(b.className).toBe('legend-icon-btn active');
    }
  });

  it('does nothing without the legend container', () => {
    document.body.innerHTML = '';
    expect(() => updateHiddenLegendEyeButtons()).not.toThrow();
  });
});

describe('updateGlobalHiddenVisibilityButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="toggleAllHiddenVisibility"><span data-icon="eye"></span></button>';
  });

  it('hides the button when nothing is hidden', () => {
    updateGlobalHiddenVisibilityButton();
    expect(document.getElementById('toggleAllHiddenVisibility').style.display).toBe('none');
  });

  it('shows and styles the button according to the global toggle', () => {
    globalThis.hiddenByRoot = new Map([['r1', new Set(['x'])]]);
    updateGlobalHiddenVisibilityButton();
    const btn = document.getElementById('toggleAllHiddenVisibility');
    expect(btn.style.display).toBe('');
    expect(btn.className).toBe('legend-icon-btn');
    expect(btn.title).toBe('Alle temporär einblenden');

    globalThis.allHiddenTemporarilyVisible = true;
    updateGlobalHiddenVisibilityButton();
    expect(btn.className).toBe('legend-icon-btn active');
    expect(btn.title).toBe('Alle temporär ausblenden');
    expect(globalThis.setIcon).toHaveBeenCalledWith(btn.querySelector('[data-icon]'), 'eye');
  });
});

describe('updateHiddenLegendTitle', () => {
  beforeEach(() => {
    document.body.innerHTML = '<span id="hiddenLegendTitle"></span>';
  });

  it('shows in-view vs total hidden counts', () => {
    globalThis.hiddenByRoot = new Map([
      ['r1', new Set(['a', 'b'])],
      ['r2', new Set(['c'])],
    ]);
    globalThis.currentHiddenCount = 2;
    updateHiddenLegendTitle();
    expect(document.getElementById('hiddenLegendTitle').textContent).toBe('Ausgeblendet (2/3)');
  });

  it('falls back to the plain title when nothing is hidden', () => {
    updateHiddenLegendTitle();
    expect(document.getElementById('hiddenLegendTitle').textContent).toBe('Ausgeblendet');
  });
});
