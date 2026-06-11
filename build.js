// Assemble the single-file deliverable index.html from template + sources.
// Zero dependencies — runs with plain `node build.js`, no npm install needed.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

// Sections are ES modules for dev/tests; the deliverable inlines them as one
// classic script. Convention: imports are single-line, export keywords sit at
// column 0 — both are stripped here, which exactly reverses the module syntax.
const stripModuleSyntax = (code) =>
  code
    .replace(/^import .*\n/gm, '')
    .replace(/^export \{[^}]*\};?\n/gm, '')
    .replace(/^export (?=(const|let|var|function|async function|class)\b)/gm, '');

// App sections are concatenated in lexicographic order (numeric prefixes).
const app = readdirSync('src/sections')
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((f) => stripModuleSyntax(read(`src/sections/${f}`)))
  .join('');

const out = read('index.template.html')
  .replace('@@CSS@@', () => read('src/styles.css'))
  .replace('@@D3@@', () => read('vendor/d3.v7.min.js'))
  .replace('@@APP@@', () => app);

writeFileSync('index.html', out);
console.log(`index.html written (${out.length} bytes)`);
