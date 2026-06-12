// Verify that the committed build artifact (index.html) is in sync with the
// sources: re-run the build and compare the result with the previous content,
// ignoring line endings (EOLs are behavior-neutral in HTML/CSS/JS).
// Historical reference states live in git history — no separate baseline file.
// Zero dependencies — plain `node verify.js`.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const norm = (s) => s.replace(/\r\n?/g, '\n');

const before = norm(readFileSync('index.html', 'utf8'));
execSync('node build.js --no-bump', { stdio: 'inherit' });
const after = norm(readFileSync('index.html', 'utf8'));

if (before === after) {
  console.log('OK: index.html is in sync with the sources (modulo line endings)');
} else {
  const a = before.split('\n');
  const b = after.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.error(`OUT OF SYNC at line ${i + 1} — index.html was stale; the build regenerated it.`);
      console.error(`was now : ${JSON.stringify((b[i] ?? '<missing>').slice(0, 160))}`);
      console.error(`was old : ${JSON.stringify((a[i] ?? '<missing>').slice(0, 160))}`);
      console.error('Review the diff and commit the rebuilt index.html.');
      break;
    }
  }
  process.exit(1);
}
