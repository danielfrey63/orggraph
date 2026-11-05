// Remap section-level coverage onto the built index.html so editor gutters
// also work when viewing the deliverable. Reuses build.js's assembly (same
// stripping rules, same slot order, no replayed copy that can drift) to
// translate line numbers, then appends an SF:index.html record to
// coverage/lcov.info. Idempotent, zero deps.
//
// The line mapping and the lcov surgery are exported because the e2e merge
// (scripts/merge-e2e-coverage.mjs) needs exactly the same translation — it
// used to carry its own replay of the assembly, which silently mismapped
// every line by the size of the @@AGE@@ bundle.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleIndexHtml } from './build.js';

export const LCOV = 'coverage/lcov.info';

const read = (path) => readFileSync(path, 'utf8');
export const normalizeEol = (s) => s.replace(/\r\n?/g, '\n');

// Where the app lives inside index.html, line by line: the span of the
// concatenated sections, the back-translation to the source line it came from,
// and the lines inside /* v8 ignore */ blocks (no DA entries — needed for an
// honest gross total).
export function coverageLineMap(sections) {
  const htmlLineToSection = new Map(); // index.html line -> { file, srcLine }
  const ignoredHtmlLines = new Set();
  for (const section of sections) {
    for (const [srcLine, stripped] of section.map) {
      if (stripped == null) continue;
      const htmlLine = section.startLine + stripped;
      htmlLineToSection.set(htmlLine, { file: section.file, srcLine });
      if (section.ignored.has(srcLine)) ignoredHtmlLines.add(htmlLine);
    }
  }
  return {
    appStart: sections.length ? sections[0].startLine : 0,
    appEnd: sections.length ? sections[sections.length - 1].endLine : 0,
    htmlLineToSection,
    ignoredHtmlLines,
  };
}

export const splitRecords = (lcovText) =>
  normalizeEol(lcovText).split('end_of_record\n').filter((r) => r.trim());

export const isIndexRecord = (record) => /^SF:.*index\.html$/m.test(record);

export const sectionFileOf = (record) => {
  const sf = record.match(/^SF:(.+)$/m)?.[1]?.replace(/\\/g, '/');
  return sf?.match(/src\/sections\/(.+\.js)$/)?.[1] || null;
};

export function daOfRecord(record) {
  const da = new Map();
  for (const m of record.matchAll(/^DA:(\d+),(\d+)$/gm)) da.set(Number(m[1]), Number(m[2]));
  return da;
}

// Translate every DA entry of every section record onto index.html lines.
export function remapSectionRecords(records, sections) {
  const bySection = new Map(sections.map((s) => [s.file, s]));
  const da = new Map();
  for (const record of records) {
    const section = bySection.get(sectionFileOf(record));
    if (!section) continue;
    for (const [srcLine, hits] of daOfRecord(record)) {
      const stripped = section.map.get(srcLine);
      if (stripped == null) continue;
      const line = section.startLine + stripped;
      da.set(line, (da.get(line) || 0) + hits);
    }
  }
  return da;
}

// One lcov record. Absolute path: Coverage Gutters fails to match a bare
// single-segment relative path against the open editor file.
export function lcovRecord(path, da) {
  const lines = [...da.keys()].sort((a, b) => a - b);
  const hit = lines.filter((l) => da.get(l) > 0).length;
  return [
    `SF:${path}`,
    ...lines.map((l) => `DA:${l},${da.get(l)}`),
    `LF:${lines.length}`,
    `LH:${hit}`,
    'end_of_record',
    '',
  ].join('\n');
}

// Idempotent: drop any previous index.html record before appending the new one.
export function withIndexRecord(records, recordText) {
  return records
    .filter((r) => !isIndexRecord(r))
    .map((r) => r + 'end_of_record\n')
    .join('') + recordText;
}

export const pct = (n, d) => (d ? ((100 * n) / d).toFixed(2) : '0.00');

function main() {
  if (!existsSync(LCOV)) {
    console.error(`${LCOV} not found — run \`npm run test:coverage\` first`);
    process.exit(1);
  }
  const { html, sections } = assembleIndexHtml();
  if (html !== normalizeEol(read('index.html'))) {
    console.error('index.html is stale — run `node build.js` first, then retry');
    process.exit(1);
  }
  const records = splitRecords(read(LCOV));
  const da = remapSectionRecords(records, sections);
  if (da.size === 0) {
    console.error(`no src/sections records in ${LCOV} — nothing to remap`);
    process.exit(1);
  }
  const { ignoredHtmlLines } = coverageLineMap(sections);
  const hit = [...da.values()].filter((v) => v > 0).length;
  writeFileSync(LCOV, withIndexRecord(records, lcovRecord(resolve('index.html'), da)));
  const gross = da.size + ignoredHtmlLines.size;
  console.log(`index.html record appended to ${LCOV} (${hit}/${da.size} lines covered = ${pct(hit, da.size)}% net; gross ${hit}/${gross} = ${pct(hit, gross)}% incl. ${ignoredHtmlLines.size} v8-ignored lines)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
