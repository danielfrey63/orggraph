// Verify the built index.html against the immutable baseline, ignoring line
// endings (the legacy file had mixed CRLF/LF; EOLs are behavior-neutral in
// HTML/CSS/JS). Zero dependencies — plain `node verify.js`.
import { readFileSync } from 'node:fs';

const norm = (path) => readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');

const built = norm('index.html');
const baseline = norm('reference/index.baseline.html');

if (built === baseline) {
  console.log('OK: index.html matches the baseline (modulo line endings)');
} else {
  const a = built.split('\n');
  const b = baseline.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.error(`MISMATCH at line ${i + 1}`);
      console.error(`built   : ${JSON.stringify((a[i] ?? '<missing>').slice(0, 160))}`);
      console.error(`baseline: ${JSON.stringify((b[i] ?? '<missing>').slice(0, 160))}`);
      break;
    }
  }
  process.exit(1);
}
