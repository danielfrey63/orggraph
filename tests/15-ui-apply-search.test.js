import { describe, it, expect } from 'vitest';
import * as section15 from '../src/sections/15-ui-apply-search.js';

// The legacy attribute intake (TSV parser, Levenshtein fuzzy matching, file
// loader) was torn down with the v1 data path (§9.3/E25) — absence proof in
// the repo's teardown-test style: none of the removed helpers may return.
describe('legacy attribute intake stays removed (§9.3/E25)', () => {
  it.each([
    'parseAttributeList',
    'levenshteinDistance',
    'normalizedLevenshteinDistance',
    'fuzzySearch',
    'findPersonIdsByIdentifier',
    'loadAttributesFromFile',
  ])('%s is no longer exported', (name) => {
    expect(section15[name]).toBeUndefined();
  });
});
