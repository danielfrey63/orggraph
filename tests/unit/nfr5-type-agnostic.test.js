import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// AK 9 / NFR-5: no registry type name appears as a string literal in the
// engine code (src/sections/*.js + index.template.html). Registry, snapshots,
// env/VIEWS, fixtures, Playwright, migration and acceptance tests are exempt
// (§11 NFR-5 scope) — this test therefore scans ONLY the app sections and the
// template, and ONLY string literals (comments may explain examples).
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const registry = JSON.parse(readFileSync(join(root, 'schema/registry.json'), 'utf8'));
const typeNames = [...Object.keys(registry.nodeTypes || {}), ...Object.keys(registry.edgeTypes || {})];

const stripComments = (code) => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('NFR-5 — type-agnostic engine code (AK 9)', () => {
  it('registry defines type names to guard against', () => {
    expect(typeNames.length).toBeGreaterThan(0);
  });

  const sectionDir = join(root, 'src/sections');
  for (const file of readdirSync(sectionDir).filter((f) => f.endsWith('.js'))) {
    it(`${file} contains no registry type name literal`, () => {
      const code = stripComments(readFileSync(join(sectionDir, file), 'utf8'));
      const hits = [];
      for (const name of typeNames) {
        const re = new RegExp(`['"\`]${name}['"\`]`, 'g');
        if (re.test(code)) hits.push(name);
      }
      expect(hits, `type literals in ${file}: ${hits.join(', ')}`).toEqual([]);
    });
  }

  it('index.template.html contains no registry type name literal', () => {
    const code = readFileSync(join(root, 'index.template.html'), 'utf8');
    const hits = typeNames.filter((name) => new RegExp(`['"\`]${name}['"\`]`).test(code));
    expect(hits).toEqual([]);
  });
});
