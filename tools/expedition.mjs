// M7 acceptance: the expedition. A world holds things at coordinates, the
// rover crosses the ground to reach them, the pack is finite and symmetric,
// what you find feeds the archive and the mystery, and one reading in the
// game cannot be obtained without landing.
//
//   node tools/expedition.mjs [url]        default http://localhost:4173/
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:4173/';
const exe = process.env.CHROMIUM
  || ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));
const mac = process.platform === 'darwin';

const browser = await chromium.launch({
  headless: !mac,
  executablePath: mac ? undefined : exe,
  args: mac
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
});
const ctx = await browser.newContext({ viewport: { width: mac ? 1280 : 800, height: mac ? 720 : 450 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const SLOW = 300000;
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
} catch {
  console.error(`cannot reach ${URL}\n`
    + '  The acceptance suites run against the BUILT bundle, not the dev server.\n'
    + '  Either:  npm run verify            (builds, serves, runs all of them)\n'
    + '  or:      npm run build && npm run preview   in another terminal first.');
  await browser.close();
  process.exit(1);
}
await page.waitForFunction(() => {
  const b = document.getElementById('bootStart'); return b && !b.hidden;
}, undefined, { timeout: SLOW });
await page.evaluate(() => {
  for (const k of ['v1', 'lanes.v1', 'contacts.v1', 'ground.v1', 'outfit.v1',
    'sites.v1', 'mystery.v1']) {
    localStorage.removeItem(`star-universe.${k}`);
  }
});
await page.evaluate(() => document.getElementById('bootStart').click());
await page.waitForFunction(() => window.__game && window.__game.time > 0.5,
  undefined, { timeout: SLOW });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push([name, !!ok, detail]);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
};

// --------------------------------------------------------------- the sites
const sites = await page.evaluate(() => {
  const g = window.__game;
  const solid = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas);
  const all = solid.map((b) => g.sites.at(b));
  const flat = all.flat();
  const kinds = [...new Set(flat.map((s) => s.kind))];
  // Determinism: the same world asked twice is the same world.
  const first = solid[0];
  const a = JSON.stringify(g.sites.at(first).map((s) => [s.id, s.x | 0, s.z | 0]));
  delete first._sites;
  const b2 = JSON.stringify(g.sites.at(first).map((s) => [s.id, s.x | 0, s.z | 0]));
  return {
    worlds: solid.length,
    total: flat.length,
    kinds,
    deterministic: a === b2,
    // Everything must be far enough that walking is not the answer, and
    // near enough that one pack reaches it and comes back.
    minRange: Math.min(...flat.map((s) => s.range)),
    maxRange: Math.max(...flat.map((s) => s.range)),
    // A site's stored position must agree with its own bearing and range.
    consistent: flat.every((s) => Math.abs(Math.hypot(s.x, s.z) - s.range) < 1.5),
    sample: flat.slice(0, 3).map((s) => `${s.kind} ${s.bearing}° ${s.range}m`),
  };
});
check('worlds hold sites at real coordinates', sites.total > 0,
  `${sites.total} across ${sites.worlds} worlds · ${sites.sample.join(' | ')}`);
check('sites are deterministic', sites.deterministic);
check('position agrees with bearing and range', sites.consistent);
check('nothing is within walking distance', sites.minRange >= 700, `nearest ${sites.minRange} m`);
check('everything is inside one pack round trip', sites.maxRange * 2 < 14000,
  `farthest ${sites.maxRange} m of a 14000 m pack`);

// --------------------------------------------------- seams are now places
const seam = await page.evaluate(async () => {
  const g = window.__game;
  const body = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas)
    .find((b) => g.sites.at(b).some((s) => s.kind === 'seam'));
  /* `land` refuses from orbit — it wants the ship inside 2.6 radii — and it
     refuses *silently*, returning a resolved promise. Picking a world and
     calling land on it therefore looks like it worked and leaves `landed`
     null, which is exactly the sort of thing a suite must not paper over.
     Fly there first, the same way the capture tools do. */
  g.pose({ bodyRef: body, dist: 1.6, phase: 70, elev: 8 });
  g.land(body, { now: true });
  g.director.stop();
  if (!g.landed) return { failed: 'land refused', body: body.name };
  const s = g.sites.at(body).find((x) => x.kind === 'seam');
  // Parked at the origin, the drone must find nothing: the seam is elsewhere.
  const atShip = g.sites.nearest(body, 0, 0);
  const held0 = g.economy.cargo[s.dep.id] || 0;
  g.updateDrone(2.0, true);
  g.updateDrone(2.0, true);
  const heldAfterParked = g.economy.cargo[s.dep.id] || 0;
  return {
    body: body.name,
    seamRange: s.range,
    nothingAtShip: !atShip || atShip.kind !== 'seam',
    minedFromShip: heldAfterParked - held0,
  };
});
check('the ship sets down', !seam.failed, seam.failed || seam.body);
check('the ship does not land on top of a seam', seam.nothingAtShip,
  `${seam.body}: nearest seam ${seam.seamRange} m out`);
check('the drone reaches nothing from the parking spot', seam.minedFromShip === 0);

// ------------------------------------------------------------- the rover
const drive = await page.evaluate(() => {
  const g = window.__game;
  const body = g.landed.body;
  const s = g.sites.at(body).find((x) => x.kind === 'seam');
  g.toggleRover();
  const deployed = g.landed.driving && g.rover.deployed;
  const c0 = g.rover.charge;

  // Drive there. The controller is exercised rather than teleported to:
  // steer onto the bearing, then hold the throttle.
  const input = { held: (a) => a === 'thrUp', touch: false };
  /* Forward at yaw y is (-sin y, -cos y) — the same convention `Player` uses —
     so pointing the nose at (s.x, s.z) is atan2(-x, -z), with no half turn.
     The half turn belongs to the *mesh*, which is authored nose-toward +Z. */
  g.rover.yaw = Math.atan2(-s.x, -s.z);
  let steps = 0;
  /* Enough simulated time to actually get there: 6.2 km is the farthest a
     site can be and 22 m/s is the flat-ground top speed, so the ceiling has
     to clear ~280 s with room for the climbs. The first cut allowed 133 s and
     reported a failure that was only ever the clock running out. */
  let worstLow = 0, maxSpread = 0;
  while (Math.hypot(g.rover.pos.x - s.x, g.rover.pos.z - s.z) > s.reach * 0.7
         && steps < 12000 && g.rover.charge > 0) {
    g.rover.update(1 / 30, input, false);
    if (steps % 20 === 0) {
      const c = g.rover.contacts();
      if (Math.abs(c.low) > Math.abs(worstLow)) worstLow = c.low;
      if (c.spread > maxSpread) maxSpread = c.spread;
    }
    steps++;
  }
  const dist = Math.hypot(g.rover.pos.x - s.x, g.rover.pos.z - s.z);
  const travelled = Math.hypot(g.rover.pos.x, g.rover.pos.z);
  return {
    deployed, arrived: dist <= s.reach, dist: Math.round(dist),
    travelled: Math.round(travelled), target: s.range,
    chargeUsed: +(c0 - g.rover.charge).toFixed(3),
    seconds: Math.round(steps / 30),
    /* Against the field the wheels are seated on. Comparing the body centre
       to the *fine* field measured a disagreement between two LODs rather
       than anything about the vehicle, and the wheel check below is the real
       assertion in any case. */
    onGround: Math.abs(g.rover.pos.y
      - g.surface.heightAt(g.rover.pos.x, g.rover.pos.z, 3.0)) < 1.5,
    /* The centre matching the ground under the centre proves almost nothing —
       a tilted body can match at the middle and hang clear at every wheel,
       which is exactly what "the rover floats" looks like. What matters is
       the gap under the *lowest* wheel, sampled the whole way. */
    worstLow: +worstLow.toFixed(2),
    maxSpread: +maxSpread.toFixed(2),
  };
});
check('the rover deploys from the parked ship', drive.deployed);
check('it drives to a site under its own power', drive.arrived,
  `${drive.travelled} m of a ${drive.target} m run, ${drive.seconds} s`);
check('it sits on the terrain, not through it', drive.onGround);
check('it stays planted for the whole drive — no floating, no sinking',
  Math.abs(drive.worstLow) < 0.05 && drive.maxSpread < 2.0,
  `lowest wheel off by at most ${drive.worstLow} m`
  + ` · terrain asked for ${drive.maxSpread} m of articulation`);
check('driving costs charge in proportion to distance', drive.chargeUsed > 0.02,
  `${Math.round(drive.chargeUsed * 100)}% of the pack for ${drive.travelled} m`);

// ------------------------------------------------- and now the drone works
const mined = await page.evaluate(() => {
  const g = window.__game;
  const body = g.landed.body;
  const s = g.sites.nearest(body, g.rover.pos.x, g.rover.pos.z);
  const before = { bin: g.rover.holdUsed(), hold: g.economy.cargoUsed() };
  for (let i = 0; i < 4; i++) g.updateDrone(1.6, true);
  const after = { bin: g.rover.holdUsed(), hold: g.economy.cargoUsed() };
  const lucent = s && s.dep.id === 'lucent';
  return { kind: s && s.kind, lucent, before, after };
});
check('standing in the seam, the drone works it', mined.kind === 'seam'
  && (mined.lucent || mined.after.bin > mined.before.bin),
  `bin ${mined.before.bin} → ${mined.after.bin} t`);
check('what it digs goes in the rover, not the ship',
  mined.lucent || mined.after.hold === mined.before.hold);

// ------------------------------------------------------- the pack and home
const home = await page.evaluate(() => {
  const g = window.__game;
  const out = Math.hypot(g.rover.pos.x, g.rover.pos.z);
  const left = g.rover.metresLeft();
  const canReturn = g.rover.canReturn();
  // Too far from the hull to stow: the rover is not a thing you summon.
  g.toggleRover();
  const refusedFarAway = g.landed.driving === true;
  // Bring it home and put it away.
  g.rover.pos.set(0, 0, 0);
  const binBefore = g.rover.holdUsed();
  const holdBefore = g.economy.cargoUsed();
  g.toggleRover();
  return {
    out: Math.round(out), left: Math.round(left), canReturn, refusedFarAway,
    stowed: !g.landed.driving && !g.rover.deployed,
    recharged: g.rover.charge === 1,
    binBefore, moved: g.economy.cargoUsed() - holdBefore,
    binAfter: g.rover.holdUsed(),
  };
});
check('the pack knows whether it can still get you back', home.canReturn,
  `${home.out} m out, ${home.left} m left`);
check('you cannot stow the rover from four kilometres away', home.refusedFarAway);
check('back at the ship it stows and recharges', home.stowed && home.recharged);
check('the bin empties into the hold', home.moved === home.binBefore && home.binAfter === 0,
  `${home.binBefore} t transferred`);

// ------------------------------------------------ what the ground is worth
const found = await page.evaluate(() => {
  const g = window.__game;
  const out = { wreck: null, marker: null };
  // Sweep the system for a wreck and for markers, since which world holds
  // what is seeded and this suite must not depend on one particular roll.
  const solid = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas);
  for (const b of solid) {
    for (const s of g.sites.at(b)) {
      if (s.kind === 'wreck' && !out.wreck) {
        const logsBefore = g.logsFound.size;
        const r = g.sites.visit(b, s);
        out.wreck = { newLog: r.newLog, logsBefore, logsAfter: g.logsFound.size,
          salvaged: r.salvaged };
      }
      if (s.kind === 'marker') {
        g.sites.visit(b, s);
      }
    }
  }
  out.markers = g.sites.markersSurveyed();
  out.wrecks = g.sites.wrecksOpened();
  return out;
});
check('the system holds wrecks of the ninety-four', !!found.wreck,
  found.wreck ? `salvaged ${found.wreck.salvaged} t` : 'none found');
check('a wreck files a log to the archive',
  found.wreck && found.wreck.logsAfter > found.wreck.logsBefore,
  found.wreck ? `${found.wreck.logsBefore} → ${found.wreck.logsAfter}` : '');
check('the ground carries Hush markers', found.markers > 0, `${found.markers} surveyed`);

// ------------------------------- the one reading you cannot get from orbit
const reading = await page.evaluate(() => {
  const g = window.__game;
  const M = g.mystery;
  const rev = M.ledger().find((r) => r.id === 'marker');
  // Wipe the ground record and confirm the reading goes away with it: that is
  // what makes it a *ground* reading rather than one that happens to be on.
  const withMarkers = M.found.has('marker');
  const keep = g.sites.done;
  g.sites.done = {};
  M.found.delete('marker');
  M.update();
  const withoutMarkers = M.found.has('marker');
  g.sites.done = keep;
  M.update();
  const backAgain = M.found.has('marker');
  return { exists: !!rev, withMarkers, withoutMarkers, backAgain,
    total: M.ledger().length, known: M.found.size };
});
check('there is a reading only the surface can unlock', reading.exists);
check('surveying markers unlocks it', reading.withMarkers && reading.backAgain);
check('without ground evidence it stays sealed', reading.withoutMarkers === false);
check('the archive counts six readings, not five', reading.total === 6, `${reading.total}`);

// ------------------------------------------------------------- the chart
const chart = await page.evaluate(() => {
  const g = window.__game;
  if (!g.landed) return { skipped: true };
  g.groundmap.show();
  const opened = g.groundmap.open
    && !document.getElementById('groundmap').classList.contains('hidden');
  g.groundmap.draw();
  const cv = document.getElementById('gmCanvas');
  // Something was actually rasterised, rather than a panel opening on a
  // blank canvas — the failure mode a "does it open" check would miss.
  let painted = false;
  try {
    const c = cv.getContext('2d');
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) { if (d[i] > 8) { painted = true; break; } }
  } catch { painted = null; }
  const rows = document.querySelectorAll('#gmSide .gm-row').length;
  const sites = g.sites.at(g.landed.body).length;
  g.groundmap.hide();
  return { opened, painted, rows, sites, closed: !g.groundmap.open };
});
check('the surface chart opens on the ground', chart.opened);
check('it draws something', chart.painted !== false);
check('it lists every site on the world', chart.rows === chart.sites,
  `${chart.rows} rows for ${chart.sites} sites`);
check('and it closes again', chart.closed);

// ------------------------------------------------------------- persistence
const saved = await page.evaluate(() => {
  const g = window.__game;
  g.sites.save();
  const s = JSON.parse(localStorage.getItem('star-universe.sites.v1'));
  return { keys: Object.keys(s?.done || {}).length };
});
check('the ground remembers what you worked', saved.keys > 0, `${saved.keys} sites on record`);

// -------------------------------------------------------- trees are solid
/* The rover used to drive through trees, which is the first open item in
   HANDOFF.md. Both directions are asserted here and the second is the one that
   matters more: an invisible wall is worse than no collision at all, so a
   bearing the index calls clear has to actually be clear.

   Last in the file, and not — as first written — between the rover checks and
   the drone's. Trees only exist above veg 0.55 and the seam world the suite
   has been standing on since `seam` is a desert, so this section has to reach
   a *different* world; and everything between here and there is written
   against the seam world's rover, sitting in the seam it drove to. Putting the
   section in the middle broke the drone checks and asserted nothing, because
   `land` refuses outright while `landed` is already set and refuses silently,
   so it simply carried on measuring the desert and reported no band. Running
   last costs one extra landing and takes nothing else's ground away. */
const treesOn = await page.evaluate(async () => {
  const g = window.__game;
  /* A vegetated world — the trees band only exists above veg 0.55, and there
     is at least one habitable world per galaxy by construction. */
  const body = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas
    && b.spec.type === 'terran' && (b.spec.veg || 0) > 0.62)
    .sort((a, b2) => (b2.spec.veg || 0) - (a.spec.veg || 0))[0];
  if (!body) return { skipped: 'no vegetated world in this galaxy' };
  /* Off the ground before asking for another world. `land` returns a resolved
     promise and does nothing at all when `landed` is set, so without this the
     section would quietly go on testing whatever it was already standing on —
     which is the same silent-refusal trap the `seam` section documents, one
     level up. `liftOff({now: true})` runs the whole departure synchronously,
     stows the rover and disposes the surface. */
  if (g.landed) g.liftOff({ now: true });
  g.pose({ bodyRef: body, dist: 1.6, phase: 70, elev: 8 });
  g.land(body, { now: true });
  g.director.stop();
  if (!g.landed) return { skipped: 'land refused' };
  if (!g.landed.driving) g.toggleRover();
  return { body: body.name, veg: +(g.surface.veg).toFixed(2), hasBand: !!g.surface._trees };
});

/* Two real animation frames between positioning and driving, because
   treesNear reads the pair the last *drawn* frame used — and the tight
   rover.update loop below never runs the frame loop, so without this the
   index would be answering about wherever the camera was left. */
const settle = () => page.evaluate(() => new Promise((res) => {
  requestAnimationFrame(() => requestAnimationFrame(res));
}));

if (treesOn.skipped || !treesOn.hasBand) {
  check('trees are solid', false, treesOn.skipped || 'the landed world has no trees band');
} else {
  /* The landing counts as positioning too: the ground scene has only just been
     staged, so the stashed pair is whatever it was in orbit until a frame is
     drawn on the surface. Measured on this seed the two answers differ by a
     third — 286 candidates against 439 — because the camera's *forward* is
     part of how tileTo chooses a copy, so this is not a formality. */
  await settle();

  // find a tree the index is confident about, and park short of it
  const aimed = await page.evaluate(() => {
    const g = window.__game, S = g.surface, R = g.rover;
    const near = S.treesNear(R.pos.x, R.pos.z, 300);
    if (!near.length) return { none: true };
    /* The nearest one that is not already under the rover, so there is room to
       get up to speed before reaching it. */
    const t = near.map((q) => ({ q, d: Math.hypot(q.x - R.pos.x, q.z - R.pos.z) }))
      .filter((e) => e.d > 30 && e.d < 220).sort((a, b) => a.d - b.d)[0];
    if (!t) return { none: true };
    // 18 m short of the trunk, nose on it
    const ux = (t.q.x - R.pos.x) / t.d, uz = (t.q.z - R.pos.z) / t.d;
    R.pos.x = t.q.x - ux * 18; R.pos.z = t.q.z - uz * 18;
    R.yaw = Math.atan2(-ux, -uz);
    R.speed = 0;
    return { tx: t.q.x, tz: t.q.z, tr: t.q.r, H: +t.q.H.toFixed(1) };
  });
  await settle();

  const hit = await page.evaluate(() => {
    const g = window.__game, S = g.surface, R = g.rover;
    /* Re-ask after the frames ran: the camera moved with the rover, so the
       cell may have shifted and the tree's own position with it. */
    const near = S.treesNear(R.pos.x, R.pos.z, 40);
    const t = near.map((q) => ({ q, d: Math.hypot(q.x - R.pos.x, q.z - R.pos.z) }))
      .sort((a, b) => a.d - b.d)[0];
    if (!t) return { none: true };
    const input = { held: (a) => a === 'thrUp', touch: false };
    let steps = 0, closest = Infinity;
    while (steps < 900) {
      R.update(1 / 30, input, false);
      closest = Math.min(closest, Math.hypot(R.pos.x - t.q.x, R.pos.z - t.q.z));
      steps++;
    }
    const d = Math.hypot(R.pos.x - t.q.x, R.pos.z - t.q.z);
    return {
      trunkR: +t.q.r.toFixed(2), H: +t.q.H.toFixed(1),
      finalDist: +d.toFixed(2), closest: +closest.toFixed(2),
      clear: +(closest - t.q.r - 1.12).toFixed(2),
      speed: +Math.abs(R.speed).toFixed(2),
    };
  });

  check('driving into a tree stops the rover', !hit.none
    && hit.clear > -0.05 && hit.speed < 1.0,
    hit.none ? 'no tree found in range'
      : `stopped ${hit.clear} m clear of a ${hit.H} m tree`
        + ` (trunk r ${hit.trunkR}) at ${hit.speed} m/s`);

  /* The invisible-wall assertion, and it is NOT "sweep for a clear bearing and
     drive it". That test would flake, for a reason worth understanding: the
     tree band is tiled and the cell follows the camera, so `tileTo` lands every
     instance within half a period of a point 134.4 m down the view axis. Drive
     a few hundred metres and the cell has moved with you and brought new trees
     into existence ahead. A corridor sampled once, before the drive, is not the
     corridor the rover will be in when it gets there — so "clear now" is not a
     claim about the far end at all.

     What the design actually promises is narrower and stronger, and it can be
     measured exactly: *the rover is never impeded by something the index does
     not report*. And there is an exact instrument for "impeded", because the
     drive step is analytic — `Rover.update` moves the body by precisely
     `speed * dt` along its heading and nothing else does, so any discrepancy
     between where the step said the rover would be and where it ended up IS a
     collision push-out. Steering is left at zero so the heading is constant and
     the prediction is exact.

     So: drive, and at every step where the body did not land where the drive
     put it, require a trunk actually overlapping the capsule. Zero unexplained
     pushes is the assertion. It holds however many trees appear en route. */
  /* Off the trunk the run above is parked against, before any of that is
     measured. The liveness check at the end of this block asks that the rover
     covers ground, and a rover left nose-on against bark covers none of it —
     it would be measuring the stall the previous check just *demanded* rather
     than anything about clear ground. Observed rather than guessed: with the
     collision in and this backing-off absent, the block reported 0 m in 30 s.
     Reversing 20 m puts the trunk behind the capsule and the quarter turn
     takes the heading off it, and this counts as positioning in the same sense
     the note above means, so the frames have to run again before the drive. */
  await page.evaluate(() => {
    const R = window.__game.rover;
    const [fx, fz] = R.forward();
    R.pos.x -= fx * 20; R.pos.z -= fz * 20;
    R.yaw += Math.PI * 0.5;
    R.speed = 0;
  });
  await settle();

  const clear = await page.evaluate(() => {
    const g = window.__game, S = g.surface, R = g.rover;
    R.speed = 0; R.charge = 1;
    const x0 = R.pos.x, z0 = R.pos.z;
    const input = { held: (a) => a === 'thrUp', touch: false };
    const HULL_R = 1.12, HB = 2.9 * 0.5;
    let steps = 0, pushes = 0, unexplained = 0, worst = 0;
    for (let i = 0; i < 900; i++) {
      const [fx, fz] = R.forward();
      const sx = R.pos.x, sz = R.pos.z;
      R.update(1 / 30, input, false);
      steps++;
      /* The prediction reads `speed` *after* the step, not before it, and that
         is the whole difference between an instrument and a noise source.
         `update` applies the acceleration and only then moves the body by the
         new speed, so predicting from the speed on the way in is wrong by
         ACCEL*dt² — about 1.2 cm a frame, every frame the rover is not yet at
         its cap. Measured against a build with no collision in it at all, that
         reported 482 push-outs in 900 steps and every one of them unexplained,
         which is a broken ruler rather than a finding. Read afterwards it is
         exact: nothing but `_collide` writes pos.x or pos.z after the step
         (`_settle` only sets pos.y), so with the heading held constant a clean
         step lands on the prediction to the last bit. */
      const px = sx + fx * R.speed * (1 / 30);
      const pz = sz + fz * R.speed * (1 / 30);
      const off = Math.hypot(R.pos.x - px, R.pos.z - pz);
      if (off <= 1e-6) continue;
      pushes++;
      /* A push has to have a trunk behind it. Measure against the capsule the
         collision itself uses — the segment between the axle midpoints — not
         against the centre, or a legitimate hit on the nose reads as
         unexplained. */
      const near = S.treesNear(R.pos.x, R.pos.z, 25);
      const [gx, gz] = R.forward();
      const ax = R.pos.x + gx * HB, az = R.pos.z + gz * HB;
      const bx = R.pos.x - gx * HB, bz = R.pos.z - gz * HB;
      let best = Infinity;
      for (const t of near) {
        const abx = bx - ax, abz = bz - az;
        const L2 = abx * abx + abz * abz;
        let u = L2 > 0 ? ((t.x - ax) * abx + (t.z - az) * abz) / L2 : 0;
        u = u < 0 ? 0 : (u > 1 ? 1 : u);
        const dx = ax + abx * u - t.x, dz = az + abz * u - t.z;
        best = Math.min(best, Math.hypot(dx, dz) - (HULL_R + t.r));
      }
      // negative or ~zero means a trunk is touching the capsule, as it should be
      if (!(best <= 1e-3)) { unexplained++; worst = Math.max(worst, best); }
    }
    return {
      covered: +Math.hypot(R.pos.x - x0, R.pos.z - z0).toFixed(1),
      steps, pushes, unexplained, worst: +worst.toFixed(2),
      speed: +R.speed.toFixed(1),
    };
  });

  check('the rover is never stopped by something the index does not report',
    clear.unexplained === 0,
    `${clear.pushes} push-outs in ${clear.steps} steps, ${clear.unexplained} unexplained`
    + (clear.unexplained ? ` · furthest trunk was ${clear.worst} m clear` : '')
    + ` · covered ${clear.covered} m`);

  /* And it has to actually go somewhere, or the check above is satisfied by a
     rover that never moved. Deliberately generous: the ground may be steep and
     CRAWL_FLOOR is a tenth of full drive, so this is a liveness floor rather
     than a performance claim. */
  check('and it still covers ground', clear.covered > 60,
    `${clear.covered} m in 30 s, still making ${clear.speed} m/s`);
}

if (errs.length) console.log('pageerrors:', [...new Set(errs)].slice(0, 4).join(' | '));
const ok = checks.every((c) => c[1]) && !errs.length;
console.log(ok ? 'EXPEDITION PASS' : 'EXPEDITION FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
