#!/usr/bin/env node
// Fold Playwright-collected V8 coverage (coverage/e2e-raw/*.json, written by
// e2e/base.mjs under E2E_COVERAGE=1) into the index.html record of
// coverage/lcov.info. V8 reports byte ranges per inline script; the script
// source is located inside index.html to get its line offset, ranges become
// per-line hit counts, and lines merge via max() with the unit-test record —
// max keeps repeated merges idempotent. Only lines inside the app-section
// span are merged (vendor D3 stays out of the denominator). Zero deps.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const LCOV = 'coverage/lcov.info';
const RAW = 'coverage/e2e-raw';
if (!existsSync(LCOV)) {
  console.error('coverage/lcov.info not found — run `npm run test:coverage` first');
  process.exit(1);
}
if (!existsSync(RAW)) {
  console.error(`${RAW} not found — run the e2e suites with E2E_COVERAGE=1 first (npm run coverage:e2e)`);
  process.exit(1);
}

const read = (p) => readFileSync(p, 'utf8');
const countLines = (s) => (s.match(/\n/g) || []).length;
// The HTML parser replaces raw NUL bytes with U+FFFD, so a script source
// reported by the browser can differ from the file — normalize both sides
// the same way (1 char -> 1 char, offsets stay valid).
const nulToFffd = (s) => s.replace(/\u0000/g, '�');
const html = nulToFffd(read('index.html').replace(/\r\n?/g, '\n'));

// App span inside index.html: from the first section's first line to the end
// of the last section (replayed like remap-coverage.js).
const isStrippedLine = (line) =>
  /^import /.test(line) || /^export \{[^}]*\};?$/.test(line) || /^\/\* v8 ignore (start|stop) \*\/$/.test(line);
const stripModuleSyntax = (code) => code
  .replace(/^import .*\n/gm, '')
  .replace(/^export \{[^}]*\};?\n/gm, '')
  .replace(/^export (?=(const|let|var|function|async function|class)\b)/gm, '')
  .replace(/^\/\* v8 ignore (start|stop) \*\/\n/gm, '');

const sections = readdirSync('src/sections').filter((f) => f.endsWith('.js')).sort();
const template = read('index.template.html');
const [beforeCss, afterCss] = template.split('@@CSS@@');
const [betweenCssD3, afterD3] = afterCss.split('@@D3@@');
const [betweenD3App] = afterD3.split('@@APP@@');
let assembled = beforeCss + read('src/styles.css') + betweenCssD3 + read('vendor/d3.v7.min.js') + betweenD3App;
const appStart = countLines(assembled) + 1;
const ignoredHtmlLines = new Set(); // index.html lines inside /* v8 ignore */ blocks
const htmlLineToSection = new Map(); // index.html line -> { file, srcLine } (back-translation)
for (const f of sections) {
  const src = read(`src/sections/${f}`);
  const start = countLines(assembled) + 1;
  let kept = 0;
  let inIgnore = false;
  src.split('\n').forEach((line, i) => {
    if (isStrippedLine(line)) {
      if (/^\/\* v8 ignore start \*\/$/.test(line)) inIgnore = true;
      if (/^\/\* v8 ignore stop \*\/$/.test(line)) inIgnore = false;
      return;
    }
    if (inIgnore) ignoredHtmlLines.add(start + kept);
    htmlLineToSection.set(start + kept, { file: f, srcLine: i + 1 });
    kept++;
  });
  assembled += stripModuleSyntax(src);
}
const appEnd = countLines(assembled);

// --- V8 ranges -> line hits ------------------------------------------------

// Precomputed char offset of every html line start (1-based lines).
const htmlLineStarts = [0];
for (let i = 0; i < html.length; i++) if (html[i] === '\n') htmlLineStarts.push(i + 1);
const lineOfHtmlOffset = (off) => {
  let lo = 0, hi = htmlLineStarts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (htmlLineStarts[mid] <= off) lo = mid; else hi = mid - 1; }
  return lo + 1;
};

const e2eDa = new Map(); // index.html line -> max hit count
const sourceOffsets = new Map(); // script source -> html char offset (cache)

for (const file of readdirSync(RAW).filter((f) => f.endsWith('.json'))) {
  let entries;
  try { entries = JSON.parse(read(`${RAW}/${file}`)); } catch { continue; }
  for (const entry of entries) {
    const source = nulToFffd((entry.source || '').replace(/\r\n?/g, '\n'));
    if (!source) continue;
    let base = sourceOffsets.get(source);
    if (base === undefined) {
      base = html.indexOf(source);
      sourceOffsets.set(source, base);
    }
    if (base < 0) continue; // not one of our inline scripts (extensions etc.)

    // Apply ranges in report order — later (nested) ranges override, the same
    // convention v8-to-istanbul uses. Count per char, then max per line.
    const counts = new Uint32Array(source.length);
    for (const fn of entry.functions || []) {
      for (const range of fn.ranges || []) {
        const start = Math.max(0, range.startOffset);
        const end = Math.min(source.length, range.endOffset);
        counts.fill(range.count, start, end);
      }
    }
    let lineStart = 0;
    for (let i = 0; i <= source.length; i++) {
      if (i === source.length || source[i] === '\n') {
        let max = 0;
        for (let j = lineStart; j < i; j++) if (counts[j] > max) max = counts[j];
        if (max > 0) {
          const htmlLine = lineOfHtmlOffset(base + lineStart);
          if (htmlLine >= appStart && htmlLine <= appEnd) {
            if (max > (e2eDa.get(htmlLine) || 0)) e2eDa.set(htmlLine, max);
          }
        }
        lineStart = i + 1;
      }
    }
  }
}

if (e2eDa.size === 0) {
  console.error('no e2e coverage matched the built index.html — is the build current (node build.js)?');
  process.exit(1);
}

// --- merge into the lcov index.html record ----------------------------------

const lcov = read(LCOV).replace(/\r\n?/g, '\n');
const records = lcov.split('end_of_record\n').filter((r) => r.trim());
const unitDa = new Map();
for (const record of records) {
  if (!/^SF:.*index\.html$/m.test(record)) continue;
  for (const m of record.matchAll(/^DA:(\d+),(\d+)$/gm)) unitDa.set(Number(m[1]), Number(m[2]));
}
const unitCovered = [...unitDa.values()].filter((v) => v > 0).length;

const merged = new Map(unitDa);
let e2eOnlyLines = 0;
let ignoredNowCovered = 0;
for (const [line, hits] of e2eDa) {
  if (!merged.has(line)) e2eOnlyLines++;
  if (ignoredHtmlLines.has(line)) ignoredNowCovered++;
  merged.set(line, Math.max(merged.get(line) || 0, hits));
}

const lines = [...merged.keys()].sort((a, b) => a - b);
const hit = lines.filter((l) => merged.get(l) > 0).length;
const indexRecord = [
  `SF:${resolve('index.html')}`,
  ...lines.map((l) => `DA:${l},${merged.get(l)}`),
  `LF:${lines.length}`,
  `LH:${hit}`,
  'end_of_record',
  '',
].join('\n');

// Back-translate the e2e hits onto the per-section records so editor gutters
// on src/sections/*.js show the combined truth too (same max() idempotency).
const e2eBySection = new Map(); // file -> Map(srcLine -> hits)
for (const [htmlLine, hits] of e2eDa) {
  const target = htmlLineToSection.get(htmlLine);
  if (!target) continue;
  let map = e2eBySection.get(target.file);
  if (!map) { map = new Map(); e2eBySection.set(target.file, map); }
  map.set(target.srcLine, Math.max(map.get(target.srcLine) || 0, hits));
}
const sectionsTouched = new Set();
const rewritten = records
  .filter((r) => !/^SF:.*index\.html$/m.test(r))
  .map((record) => {
    const sf = record.match(/^SF:(.+)$/m)?.[1]?.replace(/\\/g, '/');
    const file = sf?.match(/src\/sections\/(.+\.js)$/)?.[1];
    const extra = file && e2eBySection.get(file);
    if (!extra) return record + 'end_of_record\n';
    sectionsTouched.add(file);
    const da = new Map();
    for (const m of record.matchAll(/^DA:(\d+),(\d+)$/gm)) da.set(Number(m[1]), Number(m[2]));
    for (const [srcLine, hits] of extra) da.set(srcLine, Math.max(da.get(srcLine) || 0, hits));
    const daLines = [...da.keys()].sort((a, b) => a - b);
    const daHit = daLines.filter((l) => da.get(l) > 0).length;
    const body = record
      .split('\n')
      .filter((l) => !/^DA:\d+,\d+$/.test(l) && !/^LF:\d+$/.test(l) && !/^LH:\d+$/.test(l) && l !== '')
      .join('\n');
    return `${body}\n${daLines.map((l) => `DA:${l},${da.get(l)}`).join('\n')}\nLF:${daLines.length}\nLH:${daHit}\nend_of_record\n`;
  })
  .join('');
writeFileSync(LCOV, rewritten + indexRecord);

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(2) : '0.00');
console.log(`index.html record merged with e2e coverage: ${hit}/${lines.length} = ${pct(hit, lines.length)}% combined`);
console.log(`  unit only was ${unitCovered}/${unitDa.size}; e2e added ${e2eOnlyLines} lines to the denominator, covered ${ignoredNowCovered}/${ignoredHtmlLines.size} previously v8-ignored lines`);
console.log(`  section records updated with e2e hits: ${sectionsTouched.size}`);
