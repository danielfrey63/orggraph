// The build assembly is the one place that knows how the deliverable is laid
// out: which module syntax is stripped, in which order the sections land in
// index.html and which line of a section ends up on which line of the file.
// Three consumers depend on that mapping (verify.js, remap-coverage.js and the
// e2e coverage merge) and two of them used to replay it with their own copy —
// both copies silently went wrong when the @@AGE@@ slot was added. These tests
// pin the mapping against the real artifact instead of against a copy.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assembleIndexHtml, stripSection } from '../../build.js';
import { coverageLineMap } from '../../remap-coverage.js';

const norm = (s) => s.replace(/\r\n?/g, '\n');

const sourceCache = new Map();
const sourceLines = (file) => {
  if (!sourceCache.has(file)) sourceCache.set(file, readFileSync(`src/sections/${file}`, 'utf8').split('\n'));
  return sourceCache.get(file);
};
// What the build does to a kept line: only the leading export keyword goes.
const asBuilt = (line) => line.replace(/^export (?=(const|let|var|function|async function|class)\b)/, '');

describe('build.js — module stripping and its line map', () => {
  it('drops imports, re-exports and v8 markers, keeps the declaration line', () => {
    const code = [
      "import { a } from './x.js';",
      'export const keep = 1;',
      '/* v8 ignore start */',
      'const hidden = 2;',
      '/* v8 ignore stop */',
      'export { keep };',
      '',
    ].join('\n');
    const { text, map, ignored } = stripSection(code);
    expect(text).toBe('const keep = 1;\nconst hidden = 2;\n');
    expect(map.get(1)).toBeNull();   // import line
    expect(map.get(2)).toBe(0);      // export keyword stripped, line survives
    expect(map.get(3)).toBeNull();   // ignore marker
    expect(map.get(4)).toBe(1);
    expect(map.get(5)).toBeNull();
    expect(map.get(6)).toBeNull();   // re-export line
    expect(map.has(7)).toBe(false); // the empty string after the final newline is not a line
    expect([...ignored]).toEqual([4]);
  });

  it('refuses a line map that disagrees with the stripped text', () => {
    // An import without a trailing newline: the regex strip keeps it, the
    // line predicate would drop it — exactly the drift the check guards.
    expect(() => stripSection("const a = 1;\nimport x from './y.js';")).toThrow(/out of sync/);
  });
});

describe('build.js — the assembled deliverable', () => {
  const { html, sections } = assembleIndexHtml();

  // Line endings and the APP_VERSION literal are masked: the version is
  // bumped in the template by the versioning hooks, so between a bump and the
  // next build it differs for reasons that have nothing to do with the
  // assembly. The exact in-sync check belongs to `npm run verify`.
  it('reproduces the committed index.html line for line', () => {
    const mask = (s) => norm(s).replace(/(APP_VERSION = ')[^'\n]*(')/, '$1x$2');
    expect(mask(html)).toBe(mask(readFileSync('index.html', 'utf8')));
  });

  it('leaves no template slot unfilled', () => {
    expect(html.match(/@@[A-Z0-9_]+@@/)).toBeNull();
  });

  it('concatenates every section exactly once, in lexicographic order', () => {
    const files = sections.map((s) => s.file);
    expect(files).toEqual([...files].sort());
    expect(new Set(files).size).toBe(files.length);
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i].startLine).toBe(sections[i - 1].endLine + 1);
    }
  });

  it('places every section line on the index.html line the map claims', () => {
    const htmlLines = html.split('\n');
    const { htmlLineToSection, appStart, appEnd } = coverageLineMap(sections);
    expect(htmlLineToSection.size).toBeGreaterThan(1000);
    const wrong = [];
    for (const [line, { file, srcLine }] of htmlLineToSection) {
      if (line < appStart || line > appEnd) wrong.push(`${file}:${srcLine} outside the app span`);
      else if (htmlLines[line - 1] !== asBuilt(sourceLines(file)[srcLine - 1])) {
        wrong.push(`${file}:${srcLine} -> index.html:${line}`);
      }
      if (wrong.length > 5) break;
    }
    expect(wrong).toEqual([]);
  });

  it('counts only block content as v8-ignored, never the markers themselves', () => {
    const withBlocks = sections.filter((s) => s.ignored.size);
    expect(withBlocks.length).toBeGreaterThan(0);
    for (const section of withBlocks) {
      const src = sourceLines(section.file);
      const starts = src.flatMap((l, i) => (/^\/\* v8 ignore start \*\/$/.test(l) ? [i + 1] : []));
      const stops = src.flatMap((l, i) => (/^\/\* v8 ignore stop \*\/$/.test(l) ? [i + 1] : []));
      expect(starts.length).toBe(stops.length);
      for (const line of section.ignored) {
        expect(src[line - 1]).not.toMatch(/^\/\* v8 ignore (start|stop) \*\/$/);
      }
      expect(Math.min(...section.ignored)).toBeGreaterThan(starts[0]);
      expect(Math.max(...section.ignored)).toBeLessThan(stops[stops.length - 1]);
    }
  });
});
