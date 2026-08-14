// Is the review set reproducible? Build it twice and diff it frame by frame.
//
// "Deterministic" is a measured claim here or it is nothing. Every frame the
// judge looks at exists to be compared against another revision of itself, so a
// frame that differs from *itself* between two runs cannot support a verdict —
// and for most of this set, that is what was happening. Measured before
// tools/frozen.mjs existed: y-landed came back 6.8% different from itself run
// to run, and the set as a whole ran to 42.3% on e-barren and 36.7% on
// m-derelict. A reviewer comparing those was reading a different world.
//
//   node tools/reprocheck.mjs                  # whole set, twice
//   node tools/reprocheck.mjs --only z-landed  # one frame
//
// A frozen frame should come back byte-identical: 0.000% and max=0. Anything
// above the threshold is a real leak of wall-clock time or unseeded randomness
// into a rendered frame, and is reported as a failure with the frame named.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ONLY = opt('only', null);
/* Zero, and it has to be zero.
   The first version of this allowed 0.02% for "driver noise in the last bit of
   a filtered texture fetch", which sounds reasonable and was wrong. It passed
   z-landed-dusk at 0.018% — and that 0.018% was a real defect: two runs had
   simulated a different number of frames, because the set-piece drove frames
   while the settle pump was also driving them, and whichever won came down to
   the wall clock. Same pinned hour, same camera matrix to the last digit, 969
   pixels of foliage in different places. A tolerance is a place for exactly
   that kind of fault to live, so there isn't one. Raise it only with evidence
   that a specific frame is non-deterministic below the renderer. */
const THR = +opt('thr', 0);

const runs = ['a', 'b'].map((tag) => `/tmp/reprocheck-${tag}`);
for (const dir of runs) fs.rmSync(dir, { recursive: true, force: true });

for (const [i, dir] of runs.entries()) {
  console.log(`— build ${i + 1} of 2 → ${dir}`);
  // --out keeps both builds away from shots/judge, so a reviewer reading that
  // directory is not having it rebuilt underneath them mid-check.
  const a = ['tools/judgeset.mjs', '--out', dir];
  if (ONLY) a.push('--only', ONLY);
  execFileSync('node', a, { stdio: 'inherit' });
}

const names = fs.readdirSync(runs[0]).filter((f) => f.endsWith('.png')).sort();
if (!names.length) { console.error('no frames were produced'); process.exit(1); }

const rows = [];
let worst = 0, failed = 0, missing = 0;
for (const n of names) {
  const b = `${runs[1]}/${n}`;
  if (!fs.existsSync(b)) { rows.push(`${n.padEnd(20)} MISSING from run 2`); missing++; continue; }
  const out = execFileSync('node', ['tools/imgdiff.mjs', `${runs[0]}/${n}`, b],
    { encoding: 'utf8' }).trim();
  const pct = parseFloat(out) || 0;
  if (pct > worst) worst = pct;
  /* The percentage alone is not the whole claim. imgdiff counts pixels that
     differ by MORE THAN TEN LEVELS, so a frame that is off by two everywhere
     reports a spotless 0.000% — which is how the two interface frames read
     while they were still being captured on wall-clock settles. "Reproducible"
     here means the same picture, so the largest single difference has to be
     zero as well. */
  const max = +(/max=(\d+)/.exec(out)?.[1] ?? 0);
  const bad = pct > THR || max > 0;
  if (bad) failed++;
  rows.push(`${bad ? 'FAIL' : 'ok  '} ${n.padEnd(20)} ${out}`);
}
console.log('\n— reproducibility —');
console.log(rows.join('\n'));
console.log(`\n${names.length - failed - missing}/${names.length} frames reproduced `
  + `identically (worst ${worst.toFixed(3)}% of pixels >10; any max above 0 fails)`);
process.exit(failed || missing ? 1 : 0);
