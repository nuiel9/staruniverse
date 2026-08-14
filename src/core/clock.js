/* The scene clock, and the one random source that is allowed to exist.
 *
 * Everything about this world is derived from a seed — generate.js opens by
 * promising that "a system looks identical every time you return to it" — and
 * for the terrain, the orbits and the scatter that is true. It was not true for
 * the things that move. Six animation phases read `performance.now()` and four
 * scatters called `Math.random()`, so a station's panels, a resonator's rings,
 * a cockpit's blinking lamp, the dust in the cabin and, worst of all, *every
 * planet's rotation* started somewhere different on every page load.
 *
 * That is a bug on its own terms — the same system genuinely did not look the
 * same twice — and it is what made the review set unusable. Two captures of the
 * "same" frame came back with the planet turned to a different longitude, so a
 * judge comparing before and after was reading a different world, not a
 * different renderer. Measured on the set: y-landed differed from itself by 6.8%
 * of pixels between runs and by 92% against the shipped frame.
 *
 * Wall-clock time is also just wrong for animation here. `performance.now()`
 * keeps running while the tab is hidden and ignores the fixed step used for
 * capture, so a panel that should have advanced one frame advanced four.
 *
 * So: one simulated clock, advanced by the same dt the rest of the frame gets,
 * and one seeded generator for anything that needs a scatter. Nothing in a
 * rendered frame may call `performance.now()` or `Math.random()`.
 * (Audio is exempt and stays on Math.random — it makes no pixels, and a synth
 * line that repeats note-for-note every session is a worse thing to ship.)
 */

let t = 0;

/** Simulated seconds since boot. Advanced once per frame, by the frame's dt. */
export function clockNow() { return t; }

/** Put the clock somewhere specific — capture tooling pinning an hour. */
export function setClock(v) { t = v; }

/* Beats scheduled on the scene clock rather than on setTimeout.
 *
 * The opening narration was five setTimeouts, which is wrong for the same
 * reason the animation phases were: they ignore the frame's dt entirely. They
 * keep firing while the tab is hidden, and under a stepped capture they race
 * ahead of a world that is only advancing when asked — so which line of the
 * intro is on screen when the shutter opens depended on how long the browser
 * took to compile shaders. Two captures of the spawn view came back with
 * different lines of narration in them, one of them mid-slide. */
const beats = [];

/** Run fn once, `secs` of simulated time from now. Fire and forget. */
export function after(secs, fn) { beats.push({ at: t + secs, fn }); }

/* Somebody is *blocked* on the clock, as opposed to merely having left
   something scheduled on it. The difference is the whole point.

   Capture tooling drives frames while a sequence is waiting for the
   simulation, and must not while it is waiting for a file to load — stepping
   through a genuine load ages the world by however long the machine spent
   reading. Counting every outstanding beat conflates the two, and that is not
   a theoretical distinction: a HUD log line schedules a six-second fade
   through `after`, so by the middle of a capture walk there is nearly always
   some fade pending, and a hyperjump's loadSystem got frames driven through it
   on the strength of a fade belonging to a log line three shots earlier. It
   showed up as q-jump, t-belt and p-fold landing on one of two outcomes, and
   only in a full walk — shot on its own, q-jump had no stray fades pending and
   came back identical every time, which is a good way to be told the problem
   is fixed when it is not. */
let waiting = 0;

/** The awaitable form, for a beat in the middle of an async sequence. */
export function wait(secs) {
  waiting++;
  return new Promise((r) => after(secs, () => { waiting--; r(); }));
}

/** How many sequences are blocked on the clock right now. */
export function pendingWaits() { return waiting; }

/** Advance the scene clock and fire anything now due. */
export function tickClock(dt) {
  t += dt;
  for (let i = beats.length - 1; i >= 0; i--) {
    if (beats[i].at > t) continue;
    const { fn } = beats[i];
    beats.splice(i, 1);
    fn();
  }
}

/* mulberry32, the same generator generate.js seeds its worlds with, so a
   scatter written against this is reproducible in exactly the way the rest of
   the world already is. Kept here rather than imported from generate.js because
   the renderer should not have to pull the whole galaxy generator in to place a
   dust mote. */
export function seededRandom(seed) {
  let a = (seed * 1e6) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** One reproducible value in [0,1) from a float seed — for a single phase. */
export function seededUnit(seed) { return seededRandom(seed)(); }
