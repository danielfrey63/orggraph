// Assemble the single-file deliverable index.html from template + sources.
// Zero dependencies — runs with plain `node build.js`, no npm install needed.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

// Sections are ES modules for dev/tests; the deliverable inlines them as one
// classic script. Convention: imports are single-line, export keywords sit at
// column 0 — both are stripped here, which exactly reverses the module syntax.
// Coverage-ignore markers (function-level boundary demarcation per AUFTRAG.md
// principle 4) are dev/test-only and stripped from the deliverable as well.
const stripModuleSyntax = (code) =>
  code
    .replace(/^import .*\n/gm, '')
    .replace(/^export \{[^}]*\};?\n/gm, '')
    .replace(/^export (?=(const|let|var|function|async function|class)\b)/gm, '')
    .replace(/^\/\* v8 ignore (start|stop) \*\/\n/gm, '');

// App sections are concatenated in lexicographic order (numeric prefixes).
const app = readdirSync('src/sections')
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((f) => stripModuleSyntax(read(`src/sections/${f}`)))
  .join('');

// Single source of truth for the app version: package.json. The versioning
// hooks bump it there; the build stamps it into the deliverable.
const version = JSON.parse(read('package.json')).version;

const out = read('index.template.html')
  .replace('@@CSS@@', () => read('src/styles.css'))
  .replace('@@D3@@', () => read('vendor/d3.v7.min.js'))
  .replace('@@APP@@', () => app)
  .replace(/@@VERSION@@/g, () => version);

writeFileSync('index.html', out);
console.log(`index.html written (${out.length} bytes)`);
