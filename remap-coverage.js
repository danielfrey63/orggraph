// Remap section-level coverage onto the built index.html so editor gutters
// also work when viewing the deliverable. Replays the exact build assembly
// (same stripping rules as build.js) to translate line numbers, then appends
// an SF:index.html record to coverage/lcov.info. Idempotent, zero deps.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const LCOV = 'coverage/lcov.info';
if (!existsSync(LCOV)) {
  console.error('coverage/lcov.info not found — run `npm run test:coverage` first');
  process.exit(1);
}

const read = (path) => readFileSync(path, 'utf8');
const countLines = (s) => (s.match(/\n/g) || []).length;

const isStrippedLine = (line) =>
  /^import /.test(line) ||
  /^export \{[^}]*\};?$/.test(line) ||
  /^\/\* v8 ignore (start|stop) \*\/$/.test(line);

// Per section: map original line number -> line index within the stripped
// section (0-based), or null when the line is removed by the build.
const sectionLineMap = (code) => {
  const map = new Map();
  let kept = 0;
  code.split('\n').forEach((line, i) => {
    if (isStrippedLine(line)) {
      map.set(i + 1, null);
    } else {
      map.set(i + 1, kept);
      kept++;
    }
  });
  return map;
};

const stripModuleSyntax = (code) =>
  code
    .replace(/^import .*\n/gm, '')
    .replace(/^export \{[^}]*\};?\n/gm, '')
    .replace(/^export (?=(const|let|var|function|async function|class)\b)/gm, '')
    .replace(/^\/\* v8 ignore (start|stop) \*\/\n/gm, '');

// Replay the build to find each section's first line in the final file.
const sections = readdirSync('src/sections').filter((f) => f.endsWith('.js')).sort();
const template = read('index.template.html');
const [beforeCss, afterCss] = template.split('@@CSS@@');
const [betweenCssD3, afterD3] = afterCss.split('@@D3@@');
const [betweenD3App, afterApp] = afterD3.split('@@APP@@');

let assembled =
  beforeCss + read('src/styles.css') + betweenCssD3 + read('vendor/d3.v7.min.js') + betweenD3App;

const sectionStartLine = new Map(); // section file -> 1-based line in index.html
for (const f of sections) {
  sectionStartLine.set(f, countLines(assembled) + 1);
  assembled += stripModuleSyntax(read(`src/sections/${f}`));
}
assembled += afterApp;

// Sanity check: the replayed assembly must equal the actual build output.
if (assembled !== read('index.html').replace(/\r\n?/g, '\n')) {
  console.error('assembly mismatch — run `node build.js` first, then retry');
  process.exit(1);
}

// Translate every DA entry of every section record onto index.html lines.
const lcov = read(LCOV).replace(/\r\n?/g, '\n');
const records = lcov.split('end_of_record\n').filter((r) => r.trim());
const da = new Map(); // index.html line -> hits

for (const record of records) {
  const sf = record.match(/^SF:(.+)$/m)?.[1]?.replace(/\\/g, '/');
  const file = sf?.match(/^src\/sections\/(.+\.js)$/)?.[1];
  if (!file || !sectionStartLine.has(file)) continue;
  const map = sectionLineMap(read(`src/sections/${file}`));
  const start = sectionStartLine.get(file);
  for (const m of record.matchAll(/^DA:(\d+),(\d+)$/gm)) {
    const stripped = map.get(Number(m[1]));
    if (stripped == null) continue;
    const line = start + stripped;
    da.set(line, (da.get(line) || 0) + Number(m[2]));
  }
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
console.log(`index.html record appended to ${LCOV} (${hit}/${lines.length} lines covered)`);
