import { describe, it, expect } from 'vitest';
import {
  SVG_ID,
  STATUS_ID,
  INPUT_COMBO_ID,
  LIST_COMBO_ID,
  INPUT_DEPTH_ID,
  BTN_APPLY_ID,
  WIDTH,
  HEIGHT,
  MAX_DROPDOWN_ITEMS,
  MIN_SEARCH_LENGTH,
  MAX_ROOTS,
  BFS_LEVEL_ANIMATION_DELAY_MS,
} from '../src/sections/01-config-status.js';

describe('config constants', () => {
  it('exposes the DOM selector ids', () => {
    expect(SVG_ID).toBe('#graph');
    expect(STATUS_ID).toBe('#status');
    expect(INPUT_COMBO_ID).toBe('#comboInput');
    expect(LIST_COMBO_ID).toBe('#comboList');
    expect(INPUT_DEPTH_ID).toBe('#depth');
    expect(BTN_APPLY_ID).toBe('#apply');
  });

  it('exposes numeric layout and behavior constants', () => {
    expect(WIDTH).toBe(1200);
    expect(HEIGHT).toBe(800);
    expect(MAX_DROPDOWN_ITEMS).toBe(100);
    expect(MIN_SEARCH_LENGTH).toBe(2);
    expect(MAX_ROOTS).toBe(5);
    expect(BFS_LEVEL_ANIMATION_DELAY_MS).toBe(1000);
  });
});
