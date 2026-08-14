// Deterministic capture: the same request produces the same picture.
//
// The review set is there to be *compared* — this revision against the last,
// one renderer against another. That only means something if the two captures
// differ by the thing you changed and by nothing else, and for a long time they
// did not. Measured before this file existed: y-landed differed from itself by
// 6.8% of pixels between two runs on the same machine, and by 92% against the
// frame that had been shipped for judging. A reviewer looking at those two was
// reading a different world, not a different renderer.
//
// Three separate things were moving.
//
//   1. The settle was measured in MILLISECONDS, so a capture sampled whatever
//      framerate the machine produced that minute. Every clock in the game
//      rides on that: the sun's elevation, a body's rotation phase, a crane
//      camera easing toward its mark. 3.2 seconds is 2.2 degrees of sun.
//   2. Dynamic resolution reacts to the measured framerate, so a slow run
//      rendered at a lower pixel ratio — different sharpness, different
//      aliasing, everywhere at once.
//   3. The world itself was not reproducible. See src/core/clock.js.
//
// (3) is fixed in the game. (1) and (2) are fixed here, by borrowing main.js's
// ?record=N mode: it replaces the rAF loop with window.__step(n), one frame per
// call at exactly 1/N of a second, and skips engine.adapt so the resolution
// stops chasing the clock. A frozen capture therefore asks for a number of
// FRAMES rather than a number of milliseconds.
//
// Boot is frame-exact for free: main.js runs exactly one step at module load
// and `game.started` is set synchronously by the click, so no wall-clock time
// leaks in before the first thing we ask for.

/** Frames per simulated second. Everything downstream derives from this. */
export const RECORD_FPS = 30;

/** Simulated seconds to hold at after boot, before any set-piece is staged. */
export const CANON_BOOT_T = 4.0;

/** Millisecond settles become frame counts, so old call sites keep their timing. */
export const framesFor = (ms) => Math.max(1, Math.round((ms / 1000) * RECORD_FPS));

/** The query string that puts the page in stepped mode. */
export const recordQuery = (q = null) =>
  (q ? `q=${q}&` : '') + `record=${RECORD_FPS}`;

/**
 * Boot the page under stepped time and hold at a canonical simulated instant.
 * Wall-clock waits here are fine — they wait for *loading*, which makes no
 * frames. Only __step advances the world.
 */
export async function frozenBoot(page) {
  await page.waitForFunction(() => {
    const b = document.getElementById('bootStart');
    return b && !b.hidden;
  }, undefined, { timeout: 180000 });
  await page.evaluate(() => document.getElementById('bootStart').click());
  /* The title card fades out on a one-second wall-clock timer and is a
     full-screen element. Stepping through that would put a semi-transparent
     overlay over the first capture, by an amount that depends on how fast the
     machine got here — so wait it out in real time, where it costs nothing. */
  await page.waitForFunction(
    () => document.getElementById('boot').style.display === 'none',
    undefined, { timeout: 30000 });
  await page.evaluate(({ fps, canon }) => {
    if (!window.__step) throw new Error('page is not in record mode — no window.__step');
    /* One simulated frame at a time until the canonical instant. Every run adds
       the same 1/fps from the same start, so every run exits at the same step
       count and the same float value. */
    let guard = 0;
    while (window.__game.time < canon) {
      /* Say so rather than settling for whatever instant we reached. A boot
         that stopped advancing produces a plausible-looking frame at the wrong
         moment, and this set has shipped enough of those. */
      if (guard++ > 10000) {
        throw new Error(`the clock stopped advancing at t=${window.__game.time} `
          + `(wanted ${canon}) — the game is not stepping`);
      }
      window.__step(1);
    }
  }, { fps: RECORD_FPS, canon: CANON_BOOT_T });
}

/**
 * Run a set-piece under stepped time.
 *
 * Some set-pieces return a promise driven by the simulation itself — t-belt
 * waits on `hyperjump(id)`, which only completes as the arrival sequence is
 * updated. Awaiting that with nothing stepping is a deadlock, so pump frames
 * until it settles. The frame at which it resolves is a property of the
 * sequence, not of the machine, so that much stays deterministic.
 *
 * The rule that makes it deterministic is: EITHER the set-piece drives frames
 * (by awaiting `__frame`) OR this pump does. Never both.
 *
 * Both at once is a race, and it cost real measurements before the rule went
 * in. z-landed-dusk awaits eight frames while searching for its framing; the
 * pump yields on a macrotask between steps; whether the search's await or the
 * pump's timer won came down to the wall clock. Two captures of it simulated
 * 9.567 s and 9.467 s — three frames apart — and came back with 969 pixels of
 * foliage in different places, while every other frame in the set was
 * byte-identical. The state dump is unambiguous: same pinned landed.t, same
 * camera matrix to the last digit, different g.time.
 *
 * So `__frame` resolves on a microtask rather than a real animation frame, and
 * microtasks drain completely before this pump's timer can fire — a set-piece
 * that drives its own frames runs to completion having stepped exactly the
 * frames it asked for, and the pump adds none. A set-piece that instead blocks
 * on genuine async work never touches `__frame`, and the pump is the only
 * thing stepping. A set-piece that tried to do both would be a race again, so
 * it is refused by name rather than left to drift.
 */
export async function frozenRun(page, expr, { max = 6000 } = {}) {
  return page.evaluate(async ({ src, max: cap }) => {
    const g = window.__game;
    let done = false, val, err;
    const drove = () => (window.__frameCount || 0);
    const before = drove();
    // eslint-disable-next-line no-new-func
    Promise.resolve().then(() => new Function('g', `return (${src})`)(g))
      .then((v) => { val = v; done = true; }, (e) => { err = e; done = true; });
    for (let i = 0; i < cap; i++) {
      await new Promise((r) => setTimeout(r, 0));
      if (done) break;
      if (drove() !== before) {
        throw new Error('this set-piece both drives frames with __frame and '
          + 'blocks on async work — the two race, and the capture would not be '
          + 'reproducible. Pick one.');
      }
      /* Advance time only while the simulation is what we are waiting for.
         A hyperjump waits 0.42 s on the scene clock and then waits on
         loadSystem, which is a genuine load and takes whatever it takes. Left
         stepping through the load, the world aged by however many milliseconds
         the machine spent reading files — which is how q-jump and t-belt came
         back thirteen levels apart, and how p-fold, three shots further down
         the same boot, inherited 3.3% of a frame it never touched.

         The question is whether a sequence is BLOCKED on the clock, not
         whether anything is scheduled on it. The first version of this asked
         the looser question and stayed broken: a HUD log line schedules a
         six-second fade, so by the middle of a walk there is nearly always
         some fade pending, and loadSystem got frames driven through it on the
         strength of a fade belonging to a log line three shots earlier. That
         is also why it only ever showed up in a full walk — shot on its own,
         q-jump has no stray fades pending and came back identical every time,
         which is a good way to be told the problem is fixed when it is not. */
      if (window.__waits && window.__waits() === 0) continue;
      window.__step(1);
    }
    if (err) throw (err instanceof Error ? err : new Error(String(err)));
    if (!done) throw new Error('set-piece never settled within ' + cap + ' frames');
    return val === undefined ? null : val;
  }, { src: expr, max });
}

/**
 * Advance exactly the frames a millisecond settle used to buy.
 *
 * In batches, with a yield between them. A settle is around a hundred frames
 * and each one is a full synchronous render, so driving them in a single
 * evaluate blocks the browser's main thread for as long as that takes — on a
 * heavy ground scene, past the point where Playwright gives up on the
 * screenshot that follows. A dusk capture died exactly that way.
 *
 * Yielding here costs no determinism. The one-driver rule in frozenRun is about
 * a set-piece and the pump stepping at the same time; by the time a settle runs
 * the set-piece has finished, nothing else is driving, and the frame count is
 * whatever was asked for either way.
 */
export async function frozenSettle(page, ms, { batch = 8 } = {}) {
  let left = framesFor(ms);
  while (left > 0) {
    const n = Math.min(batch, left);
    await page.evaluate((k) => window.__step(k), n);
    left -= n;
  }
}

/**
 * Install the page-side helpers a set-piece may need.
 *
 * `__frame` is the important one. z-landed-dusk searches eight days for the
 * best framing and needs the camera re-solved between candidates; under stepped
 * time a bare requestAnimationFrame returns without the world having moved, so
 * the search would silently measure all eight days through one stale camera and
 * pick garbage. Set-pieces should reach for `window.__frame` and fall back to
 * rAF when it is absent, so they work in both modes.
 *
 * It deliberately does NOT wait for a real animation frame. `__step` renders
 * synchronously, so by the time it returns the world has already moved and
 * there is nothing left to wait for — and resolving on a microtask instead is
 * what keeps the pump in frozenRun from interleaving steps of its own. See the
 * one-driver rule there.
 */
export async function installHelpers(page) {
  await page.evaluate(() => {
    window.__frameCount = 0;
    window.__frame = async () => {
      window.__frameCount++;
      if (window.__step) window.__step(1);
    };
  });
}
