// Bump the app version in package.json (single source of truth).
// Zero dependencies — runs with plain `node bump-version.js <mode>`.
//
// Modes:
//   build → increment the third segment (every deliverable build, see build.js)
//   minor → increment the second segment and reset the build counter to 0
//           (every commit, see .githooks/pre-commit)
//
// The version line is replaced via regex on the raw file to keep the diff
// minimal and the existing formatting untouched.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function bumpVersion(mode) {
  const raw = readFileSync('package.json', 'utf8');
  const out = raw.replace(/"version":\s*"(\d+)\.(\d+)\.(\d+)"/, (_, major, minor, build) => {
    const next =
      mode === 'minor'
        ? `${major}.${Number(minor) + 1}.0`
        : `${major}.${minor}.${Number(build) + 1}`;
    return `"version": "${next}"`;
  });
  if (out === raw) throw new Error('package.json: no MAJOR.MINOR.BUILD version field found');
  writeFileSync('package.json', out);
  return JSON.parse(out).version;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const mode = process.argv[2];
  if (mode !== 'build' && mode !== 'minor') {
    console.error('usage: node bump-version.js build|minor');
    process.exit(1);
  }
  console.log(`version ${bumpVersion(mode)}`);
}
