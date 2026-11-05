#!/usr/bin/env node
// Fold Playwright-collected V8 coverage (coverage-e2e/*.json, written by
// e2e/base.mjs under E2E_COVERAGE=1) into the index.html record of
// coverage/lcov.info. V8 reports byte ranges per inline script; the script
// source is located inside index.html to get its line offset, ranges become
// per-line hit counts, and lines merge via max() with the unit-test record —
// max keeps repeated merges idempotent. Only lines inside the app-section
// span are merged (vendor D3 and the age bundle stay out of the denominator).
// Zero deps.
//
// The mapping between index.html lines and section lines comes from
// remap-coverage.js / build.js. This script used to replay the assembly
// itself and only knew the @@CSS@@, @@D3@@ and @@APP@@ slots, so since the
// @@AGE@@ bundle was added every line it back-translated was 46 lines off.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleIndexHtml } from '../build.js';
import {
  LCOV, coverageLineMap, splitRecords, isIndexRecord, sectionFileOf, daOfRecord,
  lcovRecord, normalizeEol, pct,
} from '../remap-coverage.js';

const RAW = 'coverage-e2e'; // outside coverage/ — vitest wipes that directory
const read = (p) => readFileSync(p, 'utf8');

// The HTML parser replaces raw NUL bytes with U+FFFD, so a script source
// reported by the browser can differ from the file — normalize both sides the
// same way (1 char -> 1 char, offsets stay valid).
export const nulToFffd = (s) => s.replace(/\u0000/g, '�');
// The version bump changes the APP_VERSION literal on every commit, which
// would invalidate all dumps. Mask the version LENGTH-NEUTRALLY on both sides
// so dumps survive bumps of equal-length versions (offsets stay valid).
export const maskVersion = (s) =>
  s.replace(/(APP_VERSION = ')[^'\n]*(')/, (m, a, b) => a + '0'.repeat(m.length - a.length - b.length) + b);
export const normalizeSource = (s) => maskVersion(nulToFffd(normalizeEol(s)));

// 1-based line number of a character offset in `text`.
export function lineIndexer(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (off) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

// V8 byte ranges of one inline script -> hits per line of that script
// (0-based line index, only lines with a hit). Ranges are applied in report
// order so later (nested) ranges override, the same convention v8-to-istanbul
// uses; a line then counts as the maximum of its characters.
export function lineHitsOfEntry(source, functions = []) {
  const counts = new Uint32Array(source.length);
  for (const fn of functions) {
    for (const range of fn.ranges || []) {
      counts.fill(range.count, Math.max(0, range.startOffset), Math.min(source.length, range.endOffset));
    }
  }
  const hits = new Map();
  let lineStart = 0;
  let lineIdx = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i === source.length || source[i] === '\n') {
      let max = 0;
      for (let j = lineStart; j < i; j++) if (counts[j] > max) max = counts[j];
      if (max > 0) hits.set(lineIdx, max);
      lineStart = i + 1;
      lineIdx++;
    }
  }
  return hits;
}

// All dump entries -> hits per index.html line, restricted to the app span.
export function foldEntries(entries, html, { appStart, appEnd }) {
  const lineOf = lineIndexer(html);
  const offsets = new Map(); // script source -> offset in html (cache)
  const da = new Map();
  for (const entry of entries) {
    const source = normalizeSource(entry.source || '');
    if (!source) continue;
    if (!offsets.has(source)) offsets.set(source, html.indexOf(source));
    const base = offsets.get(source);
    if (base < 0) continue; // not one of our inline scripts (extensions etc.)
    let offsetOfLine = base;
    const lines = source.split('\n');
    const hits = lineHitsOfEntry(source, entry.functions || []);
    for (let i = 0; i < lines.length; i++) {
      const hit = hits.get(i);
      if (hit) {
        const htmlLine = lineOf(offsetOfLine);
        if (htmlLine >= appStart && htmlLine <= appEnd && hit > (da.get(htmlLine) || 0)) da.set(htmlLine, hit);
      }
      offsetOfLine += lines[i].length + 1;
    }
  }
  return da;
}

// index.html hits -> per-section source hits, so editor gutters on
// src/sections/*.js show the combined truth too (same max() idempotency).
export function hitsBySection(e2eDa, htmlLineToSection) {
  const bySection = new Map();
  for (const [htmlLine, hits] of e2eDa) {
    const target = htmlLineToSection.get(htmlLine);
    if (!target) continue;
    let map = bySection.get(target.file);
    if (!map) { map = new Map(); bySection.set(target.file, map); }
    map.set(target.srcLine, Math.max(map.get(target.srcLine) || 0, hits));
  }
  return bySection;
}

// Fold extra hits into one section record. Returns the rewritten record text
// and the before/after counts for the summary.
export function mergeIntoRecord(record, extra) {
  const da = daOfRecord(record);
  const beforeHit = [...da.values()].filter((v) => v > 0).length;
  const beforeTotal = da.size;
  for (const [srcLine, hits] of extra) da.set(srcLine, Math.max(da.get(srcLine) || 0, hits));
  const lines = [...da.keys()].sort((a, b) => a - b);
  const afterHit = lines.filter((l) => da.get(l) > 0).length;
  const head = record
    .split('\n')
    .filter((l) => !/^DA:\d+,\d+$/.test(l) && !/^LF:\d+$/.test(l) && !/^LH:\d+$/.test(l) && l !== '')
    .join('\n');
  const text = `${head}\n${lines.map((l) => `DA:${l},${da.get(l)}`).join('\n')}\nLF:${lines.length}\nLH:${afterHit}\nend_of_record\n`;
  return { text, beforeHit, beforeTotal, afterHit, afterTotal: lines.length };
}

function main() {
  // --if-present (used by npm run test:coverage): silently skip when there are
  // no or stale e2e dumps instead of failing — the unit numbers stay valid.
  const ifPresent = process.argv.includes('--if-present');
  const bail = (msg) => {
    console[ifPresent ? 'log' : 'error'](msg);
    process.exit(ifPresent ? 0 : 1);
  };
  if (!existsSync(LCOV)) bail(`${LCOV} not found — run \`npm run test:coverage\` first`);
  if (!existsSync(RAW)) bail(`e2e coverage not merged (${RAW} missing) — run \`npm run coverage:e2e\` for the combined number`);

  const { html: assembled, sections } = assembleIndexHtml();
  if (assembled !== normalizeEol(read('index.html'))) bail('index.html is stale — run `node build.js` first, then retry');
  const html = normalizeSource(read('index.html'));
  const { appStart, appEnd, htmlLineToSection, ignoredHtmlLines } = coverageLineMap(sections);

  const entries = readdirSync(RAW).filter((f) => f.endsWith('.json')).flatMap((f) => {
    try { return JSON.parse(read(`${RAW}/${f}`)); } catch { return []; }
  });
  const e2eDa = foldEntries(entries, html, { appStart, appEnd });
  if (e2eDa.size === 0) {
    bail('e2e coverage not merged (dumps are stale for this build, e.g. after a version bump) — run `npm run coverage:e2e` to refresh');
  }

  const records = splitRecords(read(LCOV));
  const unitDa = new Map();
  for (const record of records) if (isIndexRecord(record)) for (const [l, h] of daOfRecord(record)) unitDa.set(l, h);
  const unitCovered = [...unitDa.values()].filter((v) => v > 0).length;

  const merged = new Map(unitDa);
  let e2eOnlyLines = 0;
  let ignoredNowCovered = 0;
  for (const [line, hits] of e2eDa) {
    if (!merged.has(line)) e2eOnlyLines++;
    if (ignoredHtmlLines.has(line)) ignoredNowCovered++;
    merged.set(line, Math.max(merged.get(line) || 0, hits));
  }
  const hit = [...merged.values()].filter((v) => v > 0).length;

  const bySection = hitsBySection(e2eDa, htmlLineToSection);
  const touched = new Map();
  const rewritten = records
    .filter((r) => !isIndexRecord(r))
    .map((record) => {
      const file = sectionFileOf(record);
      const extra = file && bySection.get(file);
      if (!extra) return record + 'end_of_record\n';
      const res = mergeIntoRecord(record, extra);
      touched.set(file, res);
      return res.text;
    })
    .join('');
  writeFileSync(LCOV, rewritten + lcovRecord(resolve('index.html'), merged));

  console.log(`index.html record merged with e2e coverage: ${hit}/${merged.size} = ${pct(hit, merged.size)}% combined`);
  console.log(`  unit only was ${unitCovered}/${unitDa.size}; e2e added ${e2eOnlyLines} lines to the denominator, covered ${ignoredNowCovered}/${ignoredHtmlLines.size} previously v8-ignored lines`);
  console.log(`  section records updated with e2e hits: ${touched.size} (NOTE: the vitest table/HTML report above stays unit-only — the combined truth lives in lcov.info and the editor gutters)`);
  const gainers = [...touched.entries()]
    .map(([file, s]) => ({ file, ...s, gain: (100 * s.afterHit) / s.afterTotal - (100 * s.beforeHit) / s.beforeTotal }))
    .filter((s) => s.gain > 0.5)
    .sort((a, b) => b.gain - a.gain);
  for (const s of gainers.slice(0, 8)) {
    console.log(`    ${s.file.padEnd(26)} ${pct(s.beforeHit, s.beforeTotal)}% -> ${pct(s.afterHit, s.afterTotal)}%  (+${s.gain.toFixed(1)})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
