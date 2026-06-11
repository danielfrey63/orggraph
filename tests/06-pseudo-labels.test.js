import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPseudoName,
  getPseudoOrgLabel,
  getDisplayLabel,
  getDisplayOrgLabel,
} from '../src/sections/06-pseudo-labels.js';
import { orgDepth } from '../src/sections/08-color-geometry.js';
import { guessIdFromInput } from '../src/sections/10-combo.js';

beforeEach(() => {
  globalThis.pseudoData = null;
  globalThis.pseudoNameMapping = new Map();
  globalThis.pseudoNameIndex = 0;
  globalThis.pseudoOrgMapping = new Map();
  globalThis.pseudoOrgIndices = new Map();
  globalThis.pseudonymizationEnabled = false;
  globalThis.orgDepth = orgDepth;
  globalThis.parentOf = new Map([['o2', 'o1']]);
  globalThis.byId = new Map([
    ['p1', { id: 'p1', label: 'Alice', type: 'person' }],
    ['o1', { id: 'o1', label: 'Company', type: 'org' }],
    ['o2', { id: 'o2', label: 'Team', type: 'org' }],
  ]);
  globalThis.raw = {
    nodes: [
      { id: 'p1', label: 'Alice', type: 'person' },
      { id: 'p2', label: 'Bob', type: 'person' },
      { id: 'o1', label: 'Company', type: 'org' },
    ],
  };
});

describe('getPseudoName', () => {
  it('returns the original when no pseudo data is loaded', () => {
    expect(getPseudoName('Alice')).toBe('Alice');
  });

  it('assigns pseudo names cyclically and keeps the mapping stable', () => {
    globalThis.pseudoData = { names: ['Px', 'Py'] };
    expect(getPseudoName('Alice')).toBe('Px');
    expect(getPseudoName('Bob')).toBe('Py');
    expect(getPseudoName('Carol')).toBe('Px'); // cycle
    expect(getPseudoName('Alice')).toBe('Px'); // stable
  });
});

describe('getPseudoOrgLabel', () => {
  it('returns the original when no pseudo data is loaded', () => {
    expect(getPseudoOrgLabel('Team', 1)).toBe('Team');
  });

  it('maps org labels per level, stable across calls', () => {
    globalThis.pseudoData = { organizationalUnits1: [{ name: 'OrgA' }, { name: 'OrgB' }] };
    expect(getPseudoOrgLabel('Team', 1)).toBe('OrgA');
    expect(getPseudoOrgLabel('Crew', 1)).toBe('OrgB');
    expect(getPseudoOrgLabel('Team', 1)).toBe('OrgA');
  });

  it('falls back to the closest available level', () => {
    globalThis.pseudoData = { organizationalUnits1: [{ name: 'L1' }] };
    expect(getPseudoOrgLabel('Deep Org', 3)).toBe('L1');
  });

  it('returns the original when pseudo data has no org lists', () => {
    globalThis.pseudoData = { names: ['x'] };
    expect(getPseudoOrgLabel('Team', 1)).toBe('Team');
  });
});

describe('getDisplayLabel', () => {
  it('returns empty string for missing node and original when disabled', () => {
    expect(getDisplayLabel(null)).toBe('');
    expect(getDisplayLabel({ id: 'p1', label: 'Alice', type: 'person' })).toBe('Alice');
  });

  it('falls back to the id when the node has no label', () => {
    expect(getDisplayLabel({ id: 'p9', type: 'person' })).toBe('p9');
  });

  it('pseudonymizes persons and orgs when enabled', () => {
    globalThis.pseudonymizationEnabled = true;
    globalThis.pseudoData = { names: ['Px'], organizationalUnits1: [{ name: 'OrgA' }] };
    expect(getDisplayLabel({ id: 'p1', label: 'Alice', type: 'person' })).toBe('Px');
    expect(getDisplayLabel({ id: 'o2', label: 'Team', type: 'org' }, 1)).toBe('OrgA');
  });

  it('derives the org level via orgDepth when not provided', () => {
    globalThis.pseudonymizationEnabled = true;
    globalThis.pseudoData = { organizationalUnits1: [{ name: 'Lvl1' }] };
    // o2 has parent o1 -> depth 1
    expect(getDisplayLabel({ id: 'o2', label: 'Team', type: 'org' })).toBe('Lvl1');
  });
});

describe('getDisplayOrgLabel', () => {
  it('returns the org id when unknown', () => {
    expect(getDisplayOrgLabel('ghost')).toBe('ghost');
  });

  it('returns the display label of a known org', () => {
    expect(getDisplayOrgLabel('o2')).toBe('Team');
  });
});

describe('guessIdFromInput', () => {
  it('prefers exact label over exact id', () => {
    globalThis.raw.nodes.push({ id: 'Alice', label: 'Someone else', type: 'person' });
    expect(guessIdFromInput('Alice')).toBe('p1');
  });

  it('matches exact id when no label matches', () => {
    expect(guessIdFromInput('p2')).toBe('p2');
  });

  it('falls back to case-insensitive partial label match', () => {
    expect(guessIdFromInput('comp')).toBe('o1');
  });

  it('returns null for empty input or no match', () => {
    expect(guessIdFromInput('')).toBeNull();
    expect(guessIdFromInput('zzz')).toBeNull();
  });
});
