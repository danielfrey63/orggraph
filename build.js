// Assemble the single-file deliverable index.html from template + sources.
// Zero dependencies — runs with plain `node build.js`, no npm install needed.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

// App sections are concatenated in lexicographic order (numeric prefixes).
const app = readdirSync('src/sections')
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((f) => read(`src/sections/${f}`))
  .join('');

const out = read('index.template.html')
  .replace('@@CSS@@', () => read('src/styles.css'))
  .replace('@@D3@@', () => read('vendor/d3.v7.min.js'))
  .replace('@@APP@@', () => app);

writeFileSync('index.html', out);
console.log(`index.html written (${out.length} bytes)`);
