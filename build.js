// Assemble the single-file deliverable index.html from template + sources.
// Zero dependencies — runs with plain `node build.js`, no npm install needed.
import { readFileSync, writeFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

const out = read('index.template.html')
  .replace('@@CSS@@', () => read('src/styles.css'))
  .replace('@@D3@@', () => read('vendor/d3.v7.min.js'))
  .replace('@@APP@@', () => read('src/app.js'));

writeFileSync('index.html', out);
console.log(`index.html written (${out.length} bytes)`);
