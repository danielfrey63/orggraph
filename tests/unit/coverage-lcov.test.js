// The two coverage post-processors (remap-coverage.js for the unit numbers,
// scripts/merge-e2e-coverage.mjs for the Playwright dumps) rewrite lcov.info
// and are the reason editor gutters work on the built index.html. Neither had
// a test, and both broke silently: the remapper aborted on every run, the
// merge mapped every line 46 lines off. These tests cover the pure pieces —
// line translation, V8 range folding, the max() merge and its idempotency.
import { describe, it, expect } from 'vitest';
import {
  coverageLineMap, splitRecords, isIndexRecord, sectionFileOf, daOfRecord,
  remapSectionRecords, lcovRecord, withIndexRecord,
} from '../../remap-coverage.js';
import {
  lineHitsOfEntry, lineIndexer, foldEntries, hitsBySection, mergeIntoRecord,
  maskVersion, normalizeSource,
} from '../../scripts/merge-e2e-coverage.mjs';

// One section starting on line 100 of the deliverable: source line 1 -> 100,
// line 2 dropped by the strip, line 3 -> 101, line 4 inside a v8-ignore block.
const section = {
  file: '42-demo.js',
  startLine: 100,
  endLine: 102,
  map: new Map([[1, 0], [2, null], [3, 1], [4, 2]]),
  ignored: new Set([4]),
};

describe('remap-coverage — lcov surgery', () => {
  it('splits records and recognises index and section records', () => {
    const lcov = 'SF:src/sections/42-demo.js\nDA:1,3\nend_of_record\nSF:/abs/index.html\nDA:100,3\nend_of_record\n';
    const records = splitRecords(lcov);
    expect(records).toHaveLength(2);
    expect(sectionFileOf(records[0])).toBe('42-demo.js');
    expect(isIndexRecord(records[0])).toBe(false);
    expect(isIndexRecord(records[1])).toBe(true);
    expect([...daOfRecord(records[0])]).toEqual([[1, 3]]);
  });

  it('accepts the backslash paths v8 writes on Windows', () => {
    expect(sectionFileOf('SF:src\\sections\\42-demo.js\nDA:1,1\n')).toBe('42-demo.js');
  });

  it('translates section lines onto deliverable lines and skips stripped ones', () => {
    const records = splitRecords('SF:src/sections/42-demo.js\nDA:1,5\nDA:2,9\nDA:3,0\nend_of_record\n');
    const da = remapSectionRecords(records, [section]);
    expect([...da]).toEqual([[100, 5], [101, 0]]);
  });

  it('ignores records of files that are not sections of this build', () => {
    const records = splitRecords('SF:src/other/99-x.js\nDA:1,5\nend_of_record\n');
    expect(remapSectionRecords(records, [section]).size).toBe(0);
  });

  it('writes LF/LH from the translated lines', () => {
    expect(lcovRecord('/abs/index.html', new Map([[100, 5], [101, 0]])))
      .toBe('SF:/abs/index.html\nDA:100,5\nDA:101,0\nLF:2\nLH:1\nend_of_record\n');
  });

  it('replaces a previous index record instead of adding a second one', () => {
    const records = splitRecords(
      'SF:src/sections/42-demo.js\nDA:1,1\nend_of_record\nSF:/abs/index.html\nDA:100,1\nLF:1\nLH:1\nend_of_record\n');
    const once = withIndexRecord(records, lcovRecord('/abs/index.html', new Map([[100, 2]])));
    const twice = withIndexRecord(splitRecords(once), lcovRecord('/abs/index.html', new Map([[100, 2]])));
    expect(twice).toBe(once);
    expect(once.match(/^SF:.*index\.html$/gm)).toHaveLength(1);
    expect(once).toContain('SF:src/sections/42-demo.js');
  });

  it('exposes the app span, the back-translation and the ignored lines', () => {
    const { appStart, appEnd, htmlLineToSection, ignoredHtmlLines } = coverageLineMap([section]);
    expect([appStart, appEnd]).toEqual([100, 102]);
    expect(htmlLineToSection.get(101)).toEqual({ file: '42-demo.js', srcLine: 3 });
    expect(htmlLineToSection.has(99)).toBe(false);
    expect([...ignoredHtmlLines]).toEqual([102]);
  });
});

describe('merge-e2e-coverage — V8 ranges to line hits', () => {
  it('finds the line of a character offset', () => {
    const lineOf = lineIndexer('a\nbb\nccc\n');
    expect([lineOf(0), lineOf(2), lineOf(3), lineOf(5)]).toEqual([1, 2, 2, 3]);
  });

  it('takes the maximum per line and lets a nested range override', () => {
    const source = 'one();\ntwo();\nthree();\n';
    const hits = lineHitsOfEntry(source, [{
      ranges: [
        { startOffset: 0, endOffset: source.length, count: 1 },
        { startOffset: source.indexOf('two();'), endOffset: source.indexOf('two();') + 6, count: 0 },
      ],
    }]);
    expect([...hits]).toEqual([[0, 1], [2, 1]]); // the uncovered middle line is absent
  });

  it('reports nothing for a function that never ran', () => {
    expect(lineHitsOfEntry('x();\n', [{ ranges: [{ startOffset: 0, endOffset: 5, count: 0 }] }]).size).toBe(0);
  });

  it('locates the script inside index.html and keeps only the app span', () => {
    const source = 'one();\ntwo();\nthree();\n';
    const html = `<html>\n<script>\n${source}</script>\n`; // source starts on line 3
    const entry = { source, functions: [{ ranges: [{ startOffset: 0, endOffset: source.length, count: 7 }] }] };
    expect([...foldEntries([entry], html, { appStart: 3, appEnd: 5 })])
      .toEqual([[3, 7], [4, 7], [5, 7]]);
    expect([...foldEntries([entry], html, { appStart: 4, appEnd: 4 })]).toEqual([[4, 7]]);
  });

  it('skips a dump whose source is not part of this build', () => {
    const entry = { source: 'foreign();\n', functions: [{ ranges: [{ startOffset: 0, endOffset: 11, count: 1 }] }] };
    expect(foldEntries([entry], '<html>\n', { appStart: 1, appEnd: 9 }).size).toBe(0);
  });

  it('masks the version length-neutrally so dumps survive a bump', () => {
    const before = "const APP_VERSION = '1.226.373';";
    const after = "const APP_VERSION = '1.226.999';";
    expect(maskVersion(before)).toBe(maskVersion(after));
    expect(maskVersion(before)).toHaveLength(before.length);
    expect(normalizeSource('a\r\nb\u0000c')).toBe('a\nb�c');
  });
});

describe('merge-e2e-coverage — folding back into the records', () => {
  it('back-translates deliverable lines to the source lines of their section', () => {
    const { htmlLineToSection } = coverageLineMap([section]);
    const bySection = hitsBySection(new Map([[100, 4], [101, 2], [999, 8]]), htmlLineToSection);
    expect([...bySection.get('42-demo.js')]).toEqual([[1, 4], [3, 2]]);
    expect(bySection.size).toBe(1); // the unmapped line 999 is dropped
  });

  it('merges by max, rewrites LF/LH and stays idempotent', () => {
    const record = 'SF:src/sections/42-demo.js\nFNF:1\nDA:1,0\nDA:3,2\nLF:2\nLH:1\n';
    const extra = new Map([[1, 4], [3, 1], [4, 6]]);
    const merged = mergeIntoRecord(record, extra);
    expect(merged.text).toBe('SF:src/sections/42-demo.js\nFNF:1\nDA:1,4\nDA:3,2\nDA:4,6\nLF:3\nLH:3\nend_of_record\n');
    expect(merged.beforeHit).toBe(1);
    expect(merged.beforeTotal).toBe(2);
    expect(merged.afterHit).toBe(3);
    const again = mergeIntoRecord(merged.text.replace(/end_of_record\n$/, ''), extra);
    expect(again.text).toBe(merged.text);
  });
});
