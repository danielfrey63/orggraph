import { describe, it, expect } from 'vitest';
import {
  SVG_ID,
  STATUS_ID,
  INPUT_COMBO_ID,
  LIST_COMBO_ID,
  INPUT_DEPTH_ID,
  WIDTH,
  HEIGHT,
  MAX_DROPDOWN_ITEMS,
  MIN_SEARCH_LENGTH,
  MAX_ROOTS,
  setStatus,
} from '../src/sections/01-config-status.js';

describe('config constants', () => {
  it('exposes the DOM selector ids', () => {
    expect(SVG_ID).toBe('#graph');
    expect(STATUS_ID).toBe('#status');
    expect(INPUT_COMBO_ID).toBe('#comboInput');
    expect(LIST_COMBO_ID).toBe('#comboList');
    expect(INPUT_DEPTH_ID).toBe('#depth');
  });

  it('exposes numeric layout and behavior constants', () => {
    expect(WIDTH).toBe(1200);
    expect(HEIGHT).toBe(800);
    expect(MAX_DROPDOWN_ITEMS).toBe(100);
    expect(MIN_SEARCH_LENGTH).toBe(2);
    expect(MAX_ROOTS).toBe(5);
    });
});

describe('setStatus', () => {
  it('writes the message into the status element and tolerates its absence', () => {
    document.body.innerHTML = '<span id="status">Bereit</span>';
    setStatus('Projektion gekappt');
    expect(document.getElementById('status').textContent).toBe('Projektion gekappt');
    document.body.innerHTML = '';
    expect(() => setStatus('ohne Ziel')).not.toThrow();
  });
});
