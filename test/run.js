// Lance les vérifications qui ne demandent ni Discord ni navigateur.
//   npm test
const { execFileSync } = require('child_process');
const path = require('path');

const suites = ['verrou-check.js', 'sticker-check.js', 'telephone-check.js'];
let bad = 0;
for (const s of suites) {
  console.log(`\n══ ${s} ${'═'.repeat(Math.max(0, 50 - s.length))}`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  } catch { bad++; }
}
console.log(bad ? `\n${bad} suite(s) en échec.\n` : '\nToutes les suites passent.\n');
process.exit(bad ? 1 : 0);
