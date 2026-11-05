// Remap section-level coverage onto the built index.html so editor gutters
// also work when viewing the deliverable. Reuses build.js's assembly (same
// stripping rules, same slot order, no replayed copy that can drift) to
// translate line numbers, then appends an SF:index.html record to
// coverage/lcov.info. Idempotent, zero deps.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assembleIndexHtml, countIgnoredLines } from './build.js';

const LCOV = 'coverage/lcov.info';
if (!existsSync(LCOV)) {
  console.error('coverage/lcov.info not found — run `npm run test:coverage` first');
  process.exit(1);
}

const read = (path) => readFileSync(path, 'utf8');
const norm = (s) => s.replace(/\r\n?/g, '\n');

// The assembly tells us where every section starts in the deliverable and
// which of its lines the build removes.
const { html, sections } = assembleIndexHtml();
if (html !== norm(read('index.html'))) {
  console.error('index.html is stale — run `node build.js` first, then retry');
  process.exit(1);
}
const bySection = new Map(sections.map((s) => [s.file, s]));

// Content lines inside /* v8 ignore */ blocks carry no DA entry — counted so
// the summary can state an honest gross total next to the net one.
const ignoredLines = sections.reduce(
  (n, s) => n + countIgnoredLines(read(`src/sections/${s.file}`)), 0);

// Translate every DA entry of every section record onto index.html lines.
const lcov = norm(read(LCOV));
const records = lcov.split('end_of_record\n').filter((r) => r.trim());
const da = new Map(); // index.html line -> hits

for (const record of records) {
  const sf = record.match(/^SF:(.+)$/m)?.[1]?.replace(/\\/g, '/');
  const file = sf?.match(/^src\/sections\/(.+\.js)$/)?.[1];
  const section = file && bySection.get(file);
  if (!section) continue;
  for (const m of record.matchAll(/^DA:(\d+),(\d+)$/gm)) {
    const stripped = section.map.get(Number(m[1]));
    if (stripped == null) continue;
    const line = section.startLine + stripped;
    da.set(line, (da.get(line) || 0) + Number(m[2]));
  }
}

if (da.size === 0) {
  console.error(`no src/sections records in ${LCOV} — nothing to remap`);
  process.exit(1);
}

const lines = Array.from(da.keys()).sort((a, b) => a - b);
const hit = lines.filter((l) => da.get(l) > 0).length;
// Absolute path: Coverage Gutters fails to match a bare single-segment
// relative path against the open editor file.
const indexRecord = [
  `SF:${resolve('index.html')}`,
  ...lines.map((l) => `DA:${l},${da.get(l)}`),
  `LF:${lines.length}`,
  `LH:${hit}`,
  'end_of_record',
  '',
].join('\n');

// Idempotent: drop any previous index.html record before appending.
const withoutOld = records
  .filter((r) => !/^SF:.*index\.html$/m.test(r))
  .map((r) => r + 'end_of_record\n')
  .join('');
writeFileSync(LCOV, withoutOld + indexRecord);
const grossTotal = lines.length + ignoredLines;
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(2) : '0.00');
console.log(`index.html record appended to ${LCOV} (${hit}/${lines.length} lines covered = ${pct(hit, lines.length)}% net; gross ${hit}/${grossTotal} = ${pct(hit, grossTotal)}% incl. ${ignoredLines} v8-ignored lines)`);
