// Generates a dependency-free, single-file standalone build at app/index.html.
// Deterministic concatenation of src modules + vendored d3 + inlined codicon
// font (base64). No runtime build step: the output opens directly via file://.
//
// Run: node make-standalone.js   (idempotent — safe to re-run)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const r = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const rb = (...p) => readFileSync(join(ROOT, ...p));

// ---- 1. Vendored assets ----
const d3Js = r('node_modules', 'd3', 'dist', 'd3.min.js');

// ---- 2. App styles ----
const appCss = r('src', 'style.css');

// ---- 3. App modules: strip ESM import/export, concatenate in dependency order ----
function stripModule(src) {
  let s = src;
  // Side-effect imports: import './style.css';
  s = s.replace(/^[ \t]*import\s+['"][^'"]+['"];?[ \t]*\r?\n/gm, '');
  // Named / namespace imports (single or multi-line): import ... from '...';
  s = s.replace(/^[ \t]*import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*\r?\n/gm, '');
  // Drop the `export ` keyword in front of declarations.
  s = s.replace(/^([ \t]*)export\s+(?=(default\s+)?(const|let|var|function|async\s+function|class)\b)/gm, '$1');
  // Remove standalone re-export statements: export { a, b };
  s = s.replace(/^[ \t]*export\s*\{[^}]*\}\s*;?[ \t]*\r?\n/gm, '');
  return s;
}

const moduleOrder = [
  ['src', 'constants.js'],
  ['src', 'utils.js'],
  ['src', 'icons.js'],
  ['src', 'export.js'],
  ['src', 'storage.js'],
  ['src', 'dropzone.js'],
  ['src', 'app.js'],
];

const appBundle = moduleOrder
  .map(p => `\n// ===== ${p.join('/')} =====\n` + stripModule(r(...p)))
  .join('\n');

// ---- 4. Assemble HTML from the existing index.html template ----
let html = r('index.html');

// Remove the external codicon stylesheet <link> (now inlined).
html = html.replace(/^[ \t]*<link[^>]*codicon[^>]*>\s*\r?\n/m, '');
// Remove the ES-module script tag (now inlined as a classic script).
html = html.replace(/^[ \t]*<script\s+type="module"[^>]*><\/script>\s*\r?\n/m, '');

const styleBlock = `  <style>\n${appCss}\n  </style>\n`;

// Inject styles before </head>. NOTE: use a replacer FUNCTION, never a string —
// d3/CSS/base64 content can contain `$`-sequences that String.replace would
// otherwise interpret ($&, $', $`, $$), corrupting and bloating the output.
html = html.replace('</head>', () => styleBlock + '</head>');

// Inject scripts before </body>: d3 (global) first, then the app bundle.
const scriptBlock =
  `  <script>${d3Js}</script>\n` +
  `  <script>\n${appBundle}\n</script>\n`;
html = html.replace('</body>', () => scriptBlock + '</body>');

// ---- 5. Write output ----
mkdirSync(join(ROOT, 'app'), { recursive: true });
const out = join(ROOT, 'app', 'index.html');
writeFileSync(out, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log(`Wrote ${out} (${kb} KB)`);
