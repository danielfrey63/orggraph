import { describe, it, expect, beforeEach } from 'vitest';
import {
  levenshteinDistance,
  normalizedLevenshteinDistance,
  fuzzySearch,
  parseAttributeList,
  findPersonIdsByIdentifier,
} from '../src/sections/15-ui-apply-search.js';

beforeEach(() => {
  globalThis.raw = {
    persons: [
      { id: 'p-1', label: 'Alice Meier', email: 'alice@example.com' },
      { id: 'p-2', label: 'Bob Muster', email: 'bob@example.com' },
      { id: 'p-3', label: 'Carla' },
    ],
  };
});

describe('levenshteinDistance', () => {
  it('is 0 for identical strings and length for empty vs word', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('counts substitutions, insertions and deletions', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('flaw', 'lawn')).toBe(2);
  });
});

describe('normalizedLevenshteinDistance', () => {
  it('normalizes by the longer string length', () => {
    expect(normalizedLevenshteinDistance('abc', 'abd')).toBeCloseTo(1 / 3);
    expect(normalizedLevenshteinDistance('abc', 'abc')).toBe(0);
  });

  it('returns 0 for two empty strings', () => {
    expect(normalizedLevenshteinDistance('', '')).toBe(0);
  });
});

describe('parseAttributeList', () => {
  it('parses tab-separated identifier/attribute pairs', () => {
    const r = parseAttributeList('a@b.ch\tCoach\nc@d.ch\tPL\n');
    expect(r.count).toBe(2);
    expect(r.types.sort()).toEqual(['Coach', 'PL']);
    expect(r.attributes.get('a@b.ch').get('Coach')).toBe('1');
    expect(r.isEmpty).toBe(false);
  });

  it('parses comma-separated lines and optional values', () => {
    const r = parseAttributeList('a@b.ch,Role,Senior');
    expect(r.attributes.get('a@b.ch').get('Role')).toBe('Senior');
  });

  it('detects the separator per line', () => {
    const r = parseAttributeList('a@b.ch\tTab\nc@d.ch,Comma');
    expect(r.attributes.get('a@b.ch').has('Tab')).toBe(true);
    expect(r.attributes.get('c@d.ch').has('Comma')).toBe(true);
  });

  it('skips lines without a second column', () => {
    const r = parseAttributeList('only-one-column\na@b.ch\tOk');
    expect(r.count).toBe(1);
  });

  it('flags empty input as an empty category', () => {
    const r = parseAttributeList('\n  \n');
    expect(r).toMatchObject({ count: 0, isEmpty: true });
    expect(r.attributes.size).toBe(0);
  });

  it('collects multiple attributes per identifier', () => {
    const r = parseAttributeList('a@b.ch\tX\na@b.ch\tY');
    expect(Array.from(r.attributes.get('a@b.ch').keys()).sort()).toEqual(['X', 'Y']);
  });
});

describe('findPersonIdsByIdentifier', () => {
  it('finds by exact id, case-insensitively', () => {
    expect(findPersonIdsByIdentifier('P-1')).toEqual(['p-1']);
  });

  it('finds by exact email', () => {
    expect(findPersonIdsByIdentifier('BOB@example.com')).toEqual(['p-2']);
  });

  it('returns empty for no match and handles persons without email', () => {
    expect(findPersonIdsByIdentifier('nobody@nowhere')).toEqual([]);
  });
});

describe('fuzzySearch', () => {
  it('returns near matches sorted by similarity', async () => {
    const matches = await fuzzySearch('alice@example.com', 0.3);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]).toMatchObject({ id: 'p-1', matchedOn: 'E-Mail' });
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i].similarity).toBeGreaterThanOrEqual(matches[i - 1].similarity);
    }
  });

  it('matches on label when that is closest', async () => {
    const matches = await fuzzySearch('carla', 0.3);
    expect(matches[0]).toMatchObject({ id: 'p-3', matchedOn: 'Name', similarity: 0 });
  });

  it('returns empty for blank input', async () => {
    expect(await fuzzySearch('   ')).toEqual([]);
    expect(await fuzzySearch('')).toEqual([]);
  });

  it('respects the abort flag', async () => {
    expect(await fuzzySearch('alice', 0.3, null, { aborted: true })).toEqual([]);
  });

  it('finds nothing above the threshold', async () => {
    expect(await fuzzySearch('zzzzzzzzzzzz', 0.1)).toEqual([]);
  });
});
