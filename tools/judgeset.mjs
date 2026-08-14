// Rebuild the review set an independent judge looks at.
//
// The survey exists to catch regressions; this exists to be *judged*. It runs
// the same set-pieces, then adds the two the survey cannot stage from a single
// boot — standing on a planet, and the same planet at a different hour — and
// copies everything into shots/judge/ so a reviewer has one directory to read.
//
//   node tools/judgeset.mjs
//   node tools/judgeset.mjs --only z-landed --out /tmp/check
//
/* --only exists because of how this set has failed in the past. Three of the
   frames were shipped for judging showing something other than what they were
   named for — a duplicate of the shot before it, an empty starfield, a pair of
   landing legs hanging in the sky — and all three survived because nobody
   re-shot the one frame they had changed and looked at it. A full rebuild is
   twenty minutes and overwrites the directory a reviewer may be reading, which
   is a good way to talk yourself out of checking. So: name a frame, point it
   somewhere harmless, look at it. --only neither reads nor writes shots/judge/,
   and does not write shots/ either: it shoots straight into --out, which
   defaults to shots/check. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ONLY = opt('only', null);
const OUT = opt('out', ONLY ? 'shots/check' : 'shots/judge');
const want = (n) => !ONLY || n.includes(ONLY);

const FROM_SURVEY = [
  'a-spawn', 'b-terran', 'c-terran-crescent', 'x-orbit', 'd-gas', 'i-rings',
  'e-barren', 'f-ice', 'g-hot', 'h-dry', 'j-star', 'k-ship', 'u-shipclose',
  'v-station', 'm-derelict', 'l-resonator', 'w-traffic', 't-belt', 'q-jump', 'p-fold',
];

// Clear the survey directory, and do it *before* creating the output directory
// inside it. A shot the current system cannot stage does not overwrite its PNG,
// so anything left from an earlier run gets copied into the review set as if it
// were current — a frame of a different system, at a different revision,
// presented for judging beside the real ones.
if (!ONLY) {
  console.log('— survey —');
  /* The survey's own frames, and only those.
     This used to be rmSync('shots'), which is right when the review set is
     being rebuilt in place and destructive when it is not: a build pointed
     somewhere else with --out still deleted shots/judge on its way past. That
     is how a review set that had just been handed over was wiped by a run that
     had no business touching it — and the run reported success, because from
     its own point of view nothing had gone wrong.
     The stale-frame hazard the wipe exists for is only about the PNGs the
     survey itself writes, which are the files sitting directly in shots/. Take
     those, leave the directories alone, and a build writing elsewhere cannot
     reach into a set it was not asked to touch. */
  fs.mkdirSync('shots', { recursive: true });
  for (const f of fs.readdirSync('shots', { withFileTypes: true }).filter((e) => e.isFile())) {
    if (f.name.endsWith('.png')) fs.rmSync(`shots/${f.name}`, { force: true });
  }
}
fs.mkdirSync(OUT, { recursive: true });
/* The survey is a single boot that walks every set-piece in order, so under
   --only it is worth running at all only if the frame asked for comes out of
   it — and then it is worth running with the same filter, which is minutes
   rather than the whole walk.

   It is also pointed straight at OUT and the copy below is skipped, which
   matters more than it looks. Left writing to shots/ a spot-check would drop a
   frame into the survey directory taken under different conditions from the
   run that filled it — standalone t-belt jumps system, so shots/t-belt.png
   would come back showing a *different star system* than the rest of that
   directory. That is the exact poison the header comment above is about, and
   there is no reason for a check to be able to introduce it. */
if (!ONLY) {
  execFileSync('node', ['tools/survey.mjs', '--frozen', '--w', '1600', '--h', '900'], { stdio: 'inherit' });
  for (const n of FROM_SURVEY) {
    const src = `shots/${n}.png`;
    if (fs.existsSync(src)) fs.copyFileSync(src, `${OUT}/${n}.png`);
  }
} else if (FROM_SURVEY.some(want)) {
  execFileSync('node', ['tools/survey.mjs', '--only', ONLY, '--out', OUT, '--frozen',
    '--w', '1600', '--h', '900'], { stdio: 'inherit' });
}

// Landing has to be shot separately: it swaps the whole scene, so the survey
// cannot follow it with anything else from the same boot.
//
/* Both of these have to put the settle timer on the floor, and until now
   neither did. `land(b, {now:true})` skips the *approach*, not the touchdown:
   it still seeds landed.settle = SETTLE_TIME (4.2 s) and updateSurface eases
   the hull down SETTLE_HEIGHT over that, cubically. So every landing frame in
   the set was shot while the ship was still in the air. Measured: three
   seconds after `land`, the hull's world Y in the ground scene was 192.8 m,
   and a second capture caught it at 157.9 — against a crane camera that orbits
   at 107-154 m out and 13-24 m up and aims at 23 m. That is why y-landed is a
   photograph of a meadow with no ship in it, and why z-landed-dusk has two
   landing-gear feet dangling into the top of frame with the hull above the
   edge: the ship was 150 m overhead, on its way down. It is also why the frame
   was not reproducible — where the hull was depended on how many frames the
   capture machine had managed in the meantime.
   Zero the timer and the hull is parked on its gear at Y = 14.6 m, which is
   where the crane has been pointing all along. */
const LANDINGS = [
  ['y-landed', `g.landed.settle = 0;`],
  /* Dusk, not midnight — and a dusk the ship is actually *in*.
     The sky and the camera are the same clock: updateSurface turns the sun by
     landed.t * 0.012 and the crane sets its azimuth from 0.7 + landed.t * 0.030,
     so you cannot choose the hour and the angle independently. What you can do
     is choose the *day*: the sun is exactly periodic in landed.t with a period
     of 2*pi/0.012 = 523.6 s, while the crane's azimuth advances 5*pi per day
     and its radius and height run on 89.8 s and 125.7 s besides — so every
     sunset is a different composition of the same sky.
     So walk the days and measure. Eight of them, hull bounding box projected to
     NDC each time, at sun elevation 0.06 throughout:
       day  hull w x h   ndc x span     unblocked   verdict
        0    59% x 29%   -0.50 .. 0.67     80%      ok, small
        1    76% x 36%   -0.97 .. 0.55     74%      nose on the left edge
        2    83% x 43%   -0.75 .. 0.90     79%      crowding the right edge
        3    96% x 45%   -1.25 .. 0.67     76%      clipped outright
        4    69% x 35%   -0.61 .. 0.77     84%      clean
        5    65% x 30%   -0.81 .. 0.48     76%      ok
        6    59% x 29%   -0.50 .. 0.67     80%      ok
        7    76% x 36%   -0.97 .. 0.55     72%      nose on the left edge
     Take the biggest hull that still clears +/-0.85 of the frame — day 4 here,
     which a raycast against the ground scene also scores as the least blocked
     by the near-field scatter: 84% of hull sample points unobstructed, against
     72-80% for the rest, and this planet's shrubs are entirely willing to park
     themselves across the bow (day 0 at close range is the one to watch).
     Derived rather than written down, because the number that comes out is a
     property of this landing site and would be a lie in any other world.
     Then *pin* the clock. Left running it drifts through the whole settle — 3.2
     seconds is 2.2 degrees of sun and 5.5 degrees of crane — so the frame the
     judge sees depends on the capture machine's framerate. The game's own
     setSunElevation comment says verification needs the same sky twice; this is
     what it takes to get it. framing.mjs pins freeLook the same way. */
  ['z-landed-dusk', `g.landed.settle = 0;
     const DAY = 2 * Math.PI / 0.012;
     const t0 = g.setSunElevation(0.06);
     const V = g.origin.constructor;
     /* Under a frozen capture a bare requestAnimationFrame returns without the
        world having moved, so the search would measure all eight days through
        one stale camera. __frame steps the simulation; see tools/frozen.mjs. */
     const frame = window.__frame
       || (() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
     let best = null;
     for (let k = 0; k < 8; k++) {
       g.landed.t = t0 + DAY * k;
       /* Hold the lens still while measuring. updateCamera eases the field of
          view toward the crane's 44 at dt*2 a frame, and a landing arrives at
          it from the seated 68, so a search run straight after touchdown reads
          its first candidates through a wider lens than its last — and picks a
          different day on a fast machine than on a slow one. Two captures
          disagreed on the day until this line went in. Writing g.fov makes the
          ease a no-op, since it eases toward the value it already holds. */
       g.fov = 44;
       await frame();
       const cam = g.camera; cam.updateMatrixWorld(true);
       cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
       const m = g.ship.model; m.updateWorldMatrix(true, true);
       let mn = [9, 9], mx = [-9, -9];
       m.traverse((o) => {
         if (!o.isMesh || !o.geometry) return;
         o.geometry.computeBoundingBox();
         const bb = o.geometry.boundingBox;
         for (let i = 0; i < 8; i++) {
           const p = new V(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y,
                           i & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld).project(cam);
           for (let c = 0; c < 2; c++) { const v = p.getComponent(c);
             if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
         }
       });
       const w = mx[0] - mn[0];
       const clear = mn[0] > -0.85 && mx[0] < 0.85 && mn[1] > -0.85 && mx[1] < 0.85;
       if (clear && (!best || w > best.w)) best = { t: t0 + DAY * k, w, k };
     }
     /* No day framed it? Then say so and take the sunset anyway — a landscape
        at dusk is a worse frame than a ship at dusk, but it is a far better one
        than a ship sliced by the frame edge. */
     const T = best ? best.t : t0;
     g.landed.t = T; g.updateSurface(0);
     Object.defineProperty(g.landed, 't', { get: () => T, set: () => {}, configurable: true });`],
];
console.log('— landings —');
/* The approach is common to both and now lives here rather than being repeated:
   same world, same site, same pose, so the two frames differ only by the hour.
   Async, because picking the dusk below has to let real frames render between
   candidates — probe.mjs hands whatever this returns to page.evaluate, which
   awaits a promise. */
for (const [name, js] of LANDINGS) {
  if (!want(name)) continue;
  execFileSync('node', ['tools/probe.mjs',
    `(async()=>{ g.mode='exterior';
       g.pose({kind:'terran', dist:1.6, phase:70, elev:8});
       g.land(g.target, {now:true}); g.director.stop();
       ${js}
       g.setLayer('hud',false); return null; })()`,
    '--shot', `${OUT}/${name}.png`, '--settle', '3200', '--frozen',
    '--w', '1600', '--h', '900'],
  { stdio: 'inherit' });
}

/* The interfaces, which the original set had no reason to carry: this fork's
   own work is a market, a negotiation and a chart, and all three are judged on
   whether they can be *read* rather than on whether they are pretty. Shot with
   the HUD left on, at dpr 2, because a sharpness verdict taken at one device
   pixel per CSS pixel is worthless — see probe.mjs. */
const INTERFACES = [
  ['ui-a-market', `g.mode='pilot';
     const st = g.bodies.filter(b=>b.kind==='station')[0];
     g.ship.absPos.copy(st.absPos); g.ship.absPos.x += st.radius*1.6; g.ship.vel.set(0,0,0);
     g.dockAt(st);
     const m = g.dockedAt.station.market;
     g.economy.buy(m, m.goods.find(x=>x.role==='produces').id, 3);
     g.dock.render();`],
  ['ui-b-chart', `g.mode='pilot'; g.starmap.show();
     /* a frontier lane charted, so both registers are in frame */
     const e = [...g.lanes.edges.values()].find(x=>!g.lanes.isCharted(x.key));
     if (e) { g.lanes.chart(e.a, e.b); g.starmap.refreshLanes(); }
     g.starmap.sel = (g.currentSystemId + 3) % g.galaxy.length;`],
  ['ui-c-comms', `g.mode='pilot';
     g.comms.openFor({kind:'craft', craftKind:'freighter', name:'BULK HAULER KESH', faction:'free'}, 'vess');
     g.comms._act('posture','businesslike'); g.comms._act('trade');`],
];
console.log('\n— interfaces —');
for (const [name, js] of INTERFACES) {
  if (!want(name)) continue;
  execFileSync('node', ['tools/probe.mjs',
    `(()=>{ ${js} return null; })()`,
    '--shot', `${OUT}/${name}.png`, '--settle', '2600', '--frozen',
    '--w', '1600', '--h', '900', '--dpr', '2'],
  { stdio: 'inherit' });
}

console.log('\n— tone —');
execFileSync('node', ['tools/levels.mjs', ...fs.readdirSync(OUT).map((f) => `${OUT}/${f}`)],
  { stdio: 'inherit' });
console.log(`\n${fs.readdirSync(OUT).length} frames in ${OUT}`);
console.log(`brief for the reviewer: tools/JUDGE.md`);
