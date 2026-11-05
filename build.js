// Assemble the single-file deliverable index.html from template + sources.
// Zero dependencies — runs with plain `node build.js`, no npm install needed.
//
// The assembly is exported (assembleIndexHtml) so that everything which needs
// to know HOW the deliverable is laid out — verify.js, remap-coverage.js —
// reuses it instead of replaying it. A replayed copy silently drifts: when the
// @@AGE@@ slot was added for the tenant encryption, the coverage remapper's own
// copy of the assembly stopped matching and dropped the index.html record.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const read = (path) => readFileSync(path, 'utf8');
const countLines = (s) => (s.match(/\n/g) || []).length;

// Sections are ES modules for dev/tests; the deliverable inlines them as one
// classic script. Convention: imports are single-line, export keywords sit at
// column 0 — both are stripped here, which exactly reverses the module syntax.
// Coverage-ignore markers (function-level demarcation of decision-free DOM/D3
// applicators) are dev/test-only and stripped from the deliverable as well.
export const stripModuleSyntax = (code) =>
  code
    .replace(/^import .*\n/gm, '')
    .replace(/^export \{[^}]*\};?\n/gm, '')
    .replace(/^export (?=(const|let|var|function|async function|class)\b)/gm, '')
    .replace(/^\/\* v8 ignore (start|stop) \*\/\n/gm, '');

// Which lines stripModuleSyntax removes entirely (the `export` keyword rule
// above only shortens its line and is therefore not listed here).
const isDroppedLine = (line) =>
  /^import /.test(line) ||
  /^export \{[^}]*\};?$/.test(line) ||
  /^\/\* v8 ignore (start|stop) \*\/$/.test(line);

// One section, stripped, plus what the stripping implies for coverage:
//   map     original 1-based line -> 0-based line within the stripped text,
//           or null when the line is gone
//   ignored original 1-based lines inside /* v8 ignore */ blocks (markers
//           excluded) — they carry no DA entry, so coverage reporting needs
//           them to state an honest gross total
// The consistency check keeps the map honest if the strip rules above ever
// grow a case the predicate does not mirror.
export function stripSection(code) {
  const text = stripModuleSyntax(code);
  const map = new Map();
  const ignored = new Set();
  let kept = 0;
  let inIgnore = false;
  code.split('\n').forEach((line, i) => {
    if (/^\/\* v8 ignore start \*\/$/.test(line)) inIgnore = true;
    else if (/^\/\* v8 ignore stop \*\/$/.test(line)) inIgnore = false;
    else if (inIgnore) ignored.add(i + 1);
    if (isDroppedLine(line)) map.set(i + 1, null);
    else map.set(i + 1, kept++);
  });
  if (kept !== text.split('\n').length) {
    throw new Error(`strip line map out of sync: ${kept} kept lines vs ${text.split('\n').length} in the stripped text`);
  }
  // The empty string after a file's final newline is not a line of that file:
  // in the deliverable its slot is the next section's first line. Mapping it
  // would claim foreign lines for this section (and for the last section a
  // line past the app span altogether).
  const lines = code.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') map.delete(lines.length);
  return { text, map, ignored };
}

// Build the deliverable. Returns the html and, per app section, its 1-based
// start line inside that html and the line map of its stripping.
// The app version lives solely in index.template.html's APP_VERSION constant
// (bumped by the AI-Toolbox hooks) and the header renders it at runtime —
// build.js never reads or stamps a version.
export function assembleIndexHtml() {
  // App sections are concatenated in lexicographic order (numeric prefixes).
  const files = readdirSync('src/sections').filter((f) => f.endsWith('.js')).sort();
  const stripped = files.map((f) => ({ file: f, ...stripSection(read(`src/sections/${f}`)) }));
  const app = stripped.map((s) => s.text).join('');

  // The sections share ONE classic-script scope: a top-level name declared
  // twice (or an import line the strip missed, e.g. CRLF endings) is a
  // SyntaxError that would only surface as a blank app in the browser — parse
  // here instead.
  try {
    new vm.Script(app, { filename: 'index.html (app sections)' });
  } catch (err) {
    throw new Error(`the concatenated app does not parse: ${err.message}`);
  }

  // Everything except the app slot: CSS, D3 and age-encryption (E77, bundled
  // by `npm run bundle:age`) are inlined first, so the head below is exactly
  // what precedes the first section in the final file.
  const filled = read('index.template.html')
    .replace('@@CSS@@', () => read('src/styles.css'))
    .replace('@@D3@@', () => read('vendor/d3.v7.min.js'))
    .replace('@@AGE@@', () => read('vendor/age.min.js'));
  const slot = filled.indexOf('@@APP@@');
  if (slot < 0) throw new Error('index.template.html has no @@APP@@ slot');
  const head = filled.slice(0, slot);
  const html = head + app + filled.slice(slot + '@@APP@@'.length);
  // A slot the template gained but the assembly above does not fill would ship
  // a literal placeholder into the deliverable — and silently shift every line
  // number the coverage remap depends on. Fail here instead.
  const leftover = html.match(/@@[A-Z0-9_]+@@/);
  if (leftover) throw new Error(`unfilled template slot ${leftover[0]} — add it to assembleIndexHtml`);

  let line = countLines(head) + 1;
  const sections = stripped.map((s) => {
    const startLine = line;
    line += countLines(s.text);
    return { file: s.file, startLine, endLine: line - 1, map: s.map, ignored: s.ignored };
  });
  return { html, sections };
}

function main() {
  let out;
  try {
    out = assembleIndexHtml().html;
  } catch (err) {
    console.error(`BUILD ABORTED — ${err.message}`);
    process.exit(1);
  }
  writeFileSync('index.html', out);
  console.log(`index.html written (${out.length} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
