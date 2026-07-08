#!/usr/bin/env node
// Run the Playwright gates with V8 coverage collection enabled and fold the
// result into coverage/lcov.info (index.html record). Cross-platform env
// handling; raw dumps are rebuilt from scratch on every run (idempotent).
import { spawnSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';

if (!existsSync('coverage/lcov.info')) {
  console.error('coverage/lcov.info not found — run `npm run test:coverage` first');
  process.exit(1);
}
rmSync('coverage/e2e-raw', { recursive: true, force: true });

const projects = process.argv.slice(2);
const args = ['playwright', 'test', ...(projects.length ? projects.flatMap((p) => ['--project', p]) : ['--project', 'smoke', '--project', 'acceptance'])];
const run = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, E2E_COVERAGE: '1' },
});
if (run.status) process.exit(run.status);

const merge = spawnSync('node', ['scripts/merge-e2e-coverage.mjs'], { stdio: 'inherit', shell: true });
process.exit(merge.status ?? 0);
