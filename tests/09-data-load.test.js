import { describe, it, expect } from 'vitest';
import { idOf, drawKindOf } from '../src/sections/09-data-load.js';

// The legacy processData intake was torn down with the v1 data path
// (§9.3/E25): stock globals are filled exclusively by og2SyncStockGlobals
// from the tenant store. What remains here are the pure helpers.

describe('idOf', () => {
  it('stringifies plain ids', () => {
    expect(idOf('p-1')).toBe('p-1');
    expect(idOf(42)).toBe('42');
  });

  it('extracts the id from object references', () => {
    expect(idOf({ id: 'o-7' })).toBe('o-7');
    expect(idOf({ id: 9 })).toBe('9');
  });

  it('stringifies null/undefined like String()', () => {
    expect(idOf(null)).toBe('null');
    expect(idOf(undefined)).toBe('undefined');
  });
});

describe('drawKindOf (§9.2)', () => {
  it('prefers the explicit v2 kind', () => {
    expect(drawKindOf({ kind: 'cluster', type: 'Person' })).toBe('cluster');
    expect(drawKindOf({ kind: 'node', type: 'org' })).toBe('node');
  });

  it('falls back to the legacy structural tag', () => {
    expect(drawKindOf({ type: 'org' })).toBe('cluster');
    expect(drawKindOf({ type: 'person' })).toBe('node');
    expect(drawKindOf(null)).toBeNull();
  });
});
