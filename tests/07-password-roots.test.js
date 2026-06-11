import { describe, it, expect, beforeEach } from 'vitest';
import { MAX_ROOTS } from '../src/sections/01-config-status.js';
import {
  isRoot,
  setSingleRoot,
  addRoot,
  removeRoot,
} from '../src/sections/07-password-roots.js';

beforeEach(() => {
  globalThis.Logger = { log: () => {} };
  globalThis.MAX_ROOTS = MAX_ROOTS;
  globalThis.selectedRootIds = [];
  globalThis.lastSingleRootId = null;
  globalThis.currentSelectedId = null;
  globalThis.showTemporaryNotification = () => {};
});

describe('setSingleRoot / isRoot', () => {
  it('replaces the selection with a single root', () => {
    setSingleRoot('p-1');
    expect(globalThis.selectedRootIds).toEqual(['p-1']);
    expect(globalThis.lastSingleRootId).toBe('p-1');
    expect(isRoot('p-1')).toBe(true);
    expect(isRoot('p-2')).toBe(false);
  });

  it('stringifies ids', () => {
    setSingleRoot(7);
    expect(isRoot('7')).toBe(true);
  });
});

describe('addRoot', () => {
  it('seeds the multi-root from the current selection', () => {
    globalThis.currentSelectedId = 'p-1';
    expect(addRoot('p-2')).toBe(true);
    expect(globalThis.selectedRootIds).toEqual(['p-1', 'p-2']);
  });

  it('retro-seeds from the last single root when nothing is selected', () => {
    globalThis.lastSingleRootId = 'p-1';
    expect(addRoot('p-2')).toBe(true);
    expect(globalThis.selectedRootIds).toEqual(['p-1', 'p-2']);
  });

  it('is idempotent for an already-present root', () => {
    globalThis.selectedRootIds = ['p-1'];
    expect(addRoot('p-1')).toBe(true);
    expect(globalThis.selectedRootIds).toEqual(['p-1']);
  });

  it('rejects additions beyond MAX_ROOTS', () => {
    globalThis.selectedRootIds = ['a', 'b', 'c', 'd', 'e'];
    expect(addRoot('f')).toBe(false);
    expect(globalThis.selectedRootIds).toHaveLength(MAX_ROOTS);
  });

  it('does not seed when adding the same id as the seed candidate', () => {
    globalThis.currentSelectedId = 'p-1';
    expect(addRoot('p-1')).toBe(true);
    expect(globalThis.selectedRootIds).toEqual(['p-1']);
  });
});

describe('removeRoot', () => {
  it('removes only the given root', () => {
    globalThis.selectedRootIds = ['p-1', 'p-2'];
    removeRoot('p-1');
    expect(globalThis.selectedRootIds).toEqual(['p-2']);
    removeRoot('missing');
    expect(globalThis.selectedRootIds).toEqual(['p-2']);
  });
});
