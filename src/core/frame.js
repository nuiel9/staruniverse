/* How much world a frame is allowed to advance.
 *
 * There are two answers and the game needs both.
 *
 * In space, one clamped step. A frame that took a quarter of a second must not
 * advance the world a quarter of a second, or the physics steps through things
 * trying to catch up — the classic spiral. A ship on rails does not care that
 * the last frame was slow, so clamping is free there.
 *
 * On the ground, catch up. The rover is the one thing in this game you drive
 * continuously for kilometres, and under the clamp the world advanced at
 * fps/15 of real time — so below 15 fps the ground ran in slow motion. The
 * ground is also by far the most expensive scene there is, which puts the slow
 * motion exactly where it hurts: at 5 fps a drive that takes nine simulated
 * minutes takes twenty-seven real ones. It was reported as a marker that could
 * never be reached, and measured as one — every marker in six systems is
 * reachable in a median of three simulated minutes, and no amount of driving
 * got the player there.
 *
 * Raising the clamp fixes the clock and breaks the collision: at an eighth of a
 * second the rover covers 2.75 m per step, and the capsule push-out in
 * Rover._collide is not swept, so it would drive through the trunks it is meant
 * to hit. So the ground gets many small steps instead of one big one — every
 * step stays at the size the collision was written against, and wall-clock and
 * simulated time track each other.
 *
 * MAX_SUB is what remains of the spiral guard. Past a third of a second of
 * catch-up the world does fall behind, which is the right failure: behind is
 * recoverable, locked up is not.
 */

export const MAX_DT = 1 / 15;   // space: the old clamp, unchanged
export const SUB = 1 / 30;      // ground: the step the collision assumes
export const MAX_SUB = 8;       // ground: most catch-up steps in one frame

/**
 * The sub-steps a frame should run, in order.
 *
 * Returned as a list rather than a total so the caller cannot accidentally
 * apply it as one big step, which is the bug this exists to prevent.
 *
 * @param {number} dt      real seconds since the last frame
 * @param {boolean} landed on the ground, where catching up matters
 * @returns {number[]}     step sizes, each at most SUB on the ground
 */
export function planFrame(dt, landed) {
  if (!(dt > 0)) return [];
  if (!landed) return [Math.min(dt, MAX_DT)];
  const out = [];
  let left = Math.min(dt, SUB * MAX_SUB);
  while (left > 1e-6) { const h = Math.min(SUB, left); out.push(h); left -= h; }
  return out;
}
