/* Does a slow frame still advance the ground by a slow frame's worth?
 *
 * The bug this exists to catch was reported as "the rover never reaches the
 * marker", and every obvious reading of that was wrong. The markers are
 * reachable: driving at the hardest one in each of six systems, with the
 * rover's real steering rate rather than a teleported heading, every single
 * one arrives — a median of three simulated minutes and a worst of nine. The
 * sites do not move; `Sites.at` memoises on `body._sites`. The surface chart
 * does not block the throttle; the ground map is deliberately not in `uiOpen`.
 *
 * What was wrong was the exchange rate between simulated seconds and the
 * player's. The frame loop clamped every step to 1/15 s, so below 15 fps the
 * world advanced at fps/15 of real time, and the ground — by far the most
 * expensive scene in the game, and the only place with a continuous
 * kilometres-long journey — ran in slow motion precisely when it could least
 * afford to. At 5 fps that nine-minute drive takes twenty-seven real minutes
 * of holding W with the distance barely moving.
 *
 * No browser here on purpose. The policy is arithmetic, and the machine this
 * runs on is the last thing that should decide whether the test can tell.
 * Trying to measure it through a real frame rate is how it stayed hidden:
 * on a fast machine the clamp never engages and everything looks fine.
 *
 *   npm run framecheck
 */
import { MAX_DT, SUB, MAX_SUB, planFrame } from '../src/core/frame.js';

let pass = 0, fail = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { pass++; console.log(`ok    ${what}${detail ? '  · ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${what}${detail ? '  · ' + detail : ''}`); }
};
const total = (steps) => steps.reduce((a, b) => a + b, 0);

console.log('— in space, one clamped step —');
ok(planFrame(1 / 60, false).length === 1, 'a fast frame is one step');
ok(Math.abs(total(planFrame(1 / 60, false)) - 1 / 60) < 1e-9,
  'and advances exactly what it took', `${total(planFrame(1 / 60, false)).toFixed(5)}s`);
ok(Math.abs(total(planFrame(0.25, false)) - MAX_DT) < 1e-9,
  'a slow frame is clamped, because a ship on rails does not care',
  `0.25s in → ${total(planFrame(0.25, false)).toFixed(4)}s`);

console.log('\n— on the ground, real time is kept —');
/* The regression, stated as the player experienced it. A fifth of a second is
   a 5 fps machine, which is what the landed scene measured at dusk. */
const slow = planFrame(0.2, true);
ok(Math.abs(total(slow) - 0.2) < 1e-9,
  'a 5 fps frame advances the ground a whole 5 fps frame',
  `0.2s in → ${total(slow).toFixed(4)}s out`);
ok(total(slow) > MAX_DT * 2.9,
  'which is three times what the old clamp allowed — the slow motion itself',
  `${total(slow).toFixed(4)}s vs ${MAX_DT.toFixed(4)}s clamped`);
ok(slow.every((h) => h <= SUB + 1e-9),
  'and no single step is bigger than the collision was written for',
  `${slow.length} steps, largest ${Math.max(...slow).toFixed(4)}s`);

/* The reason it is many small steps and not one big one. Rover._collide pushes
   a capsule out of a circle and is not swept, so a step that carries the hull
   further than its own radius can pass straight through a trunk. HULL_R is
   1.12 m and the top speed is 22 m/s. */
const MAX_FWD = 22, HULL_R = 1.12;
ok(SUB * MAX_FWD < HULL_R * 2,
  'a full-speed sub-step moves less than the hull diameter, so nothing tunnels',
  `${(SUB * MAX_FWD).toFixed(2)} m per step vs ${(HULL_R * 2).toFixed(2)} m of hull`);

console.log('\n— and it still refuses to spiral —');
ok(Math.abs(total(planFrame(10, true)) - SUB * MAX_SUB) < 1e-9,
  'a ten-second stall is capped rather than replayed',
  `10s in → ${total(planFrame(10, true)).toFixed(3)}s out`);
ok(planFrame(10, true).length === MAX_SUB, 'at exactly the cap', `${MAX_SUB} steps`);
ok(planFrame(0, true).length === 0 && planFrame(-1, true).length === 0,
  'a zero or negative frame does nothing');

console.log('\n— a stepped capture is not disturbed —');
/* judgeset shoots the landed frames through ?record=30, which calls the loop
   with exactly 1/30. If that ever planned as more than one step the review set
   would move, and every frame in it would have to be re-baselined. */
const rec = planFrame(1 / 30, true);
ok(rec.length === 1 && Math.abs(rec[0] - 1 / 30) < 1e-12,
  'record-mode 1/30 is still a single 1/30 advance on the ground',
  `${rec.length} step of ${rec[0].toFixed(6)}s`);

console.log(`\n${pass}/${pass + fail} ok`);
process.exit(fail ? 1 : 0);
