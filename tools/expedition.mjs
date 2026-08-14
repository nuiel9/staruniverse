// M7 acceptance: the expedition. A world holds things at coordinates, the
// rover crosses the ground to reach them, the pack is finite and symmetric,
// what you find feeds the archive and the mystery, and one reading in the
// game cannot be obtained without landing.
//
//   node tools/expedition.mjs [url]        default http://localhost:4173/
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { MAX_FWD } from '../src/ship/driveModel.js';

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

// ------------------------------------------------- markers are drivable to
/* The distribution moving is not the claim a player cares about. This is: pick
   the marker on a landed world and drive at it, and require arrival inside a
   budget that scales with how far the marker actually is — see the budget
   comment below for why a fixed wall-clock cap was the wrong shape for this
   assertion — and that is tight enough to still catch the ten-minute
   switchback the placement exists to prevent. */
const reach = await page.evaluate(async (MAX_FWD) => {
  const g = window.__game;
  /* The hardest marker in the home system, not whichever world's bodies
     happen to sort first. Picking the first world with any marker at all is
     picking by iteration order, and a regression in the worst case can hide
     behind a seed where the easy marker gets asked about instead. Picking the
     greatest range means the check always exercises the site this feature
     has the least room to help — see the budget comment for why range, not
     difficulty, is what actually varies here. */
  const solid = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas);
  let body = null, best = null;
  for (const b of solid) {
    for (const s of g.sites.at(b)) {
      if (s.kind === 'marker' && (!best || s.range > best.range)) { body = b; best = s; }
    }
  }
  if (!body) return { skipped: 'no world with a marker' };
  if (g.landed) await g.liftOff({ now: true });
  g.pose({ bodyRef: body, dist: 1.6, phase: 70, elev: 8 });
  g.land(body, { now: true });
  g.director.stop();
  if (!g.landed) return { skipped: 'land refused' };
  if (!g.landed.driving) g.toggleRover();
  const m = g.sites.at(body).find((s) => s.kind === 'marker');
  const R = g.rover;
  R.charge = 1;
  const input = { held: (a) => a === 'thrUp', touch: false };
  const DT = 1 / 30;
  const flatSecs = m.range / MAX_FWD;
  /* A budget, not a stopwatch. An absolute cap measures how FAR the marker is,
     which placement cannot change, and blames it on how HARD the route is,
     which is the only thing placement affects — two markers on this seed sit
     over four minutes away at full speed on dead-flat ground. So the budget is
     a multiple of a flat-out run: 2.6x, above the 2.37x worst that
     `npm run sitecheck` measures across every one of the 35 sites in this
     home system, and far below the 10x a route pinned at the crawl floor would
     reach. A failure here means the ground is fighting the drive, which is
     the thing this branch is about. The flat +30 s covers steering overhead
     near the target, where the "aim straight at it" loop below is not the
     shortest possible path even on flat ground.

     **This budget is calibrated on the home system, and that is the only
     system this suite ever stands in.** Once sitecheck learned to walk the
     galaxy it measured a worst of 4.46x over 457 sites — well past 2.6 — so if
     anything ever teaches this suite to jump, the budget has to be re-derived
     before it is trusted, not merely re-run. It is not loose here: it is
     scoped, and the scope is load-bearing. */
  const budget = flatSecs * 2.6 + 30;
  // A runaway guard, not a claim about difficulty: nothing in the budget
  // above should ever reach this, but a stuck rover should still stop the
  // suite in twenty minutes rather than hang it.
  const HARD_CAP = 20 * 60 * 30;
  const CAP = Math.min(Math.ceil(budget * 30), HARD_CAP);
  let steps = 0;
  while (steps < CAP) {
    // steer at it each step, as a player aiming for a marker does
    R.yaw = Math.atan2(-(m.x - R.pos.x), -(m.z - R.pos.z));
    R.update(DT, input, false);
    steps++;
    if (Math.hypot(R.pos.x - m.x, R.pos.z - m.z) <= m.reach) break;
  }
  const dist = Math.hypot(R.pos.x - m.x, R.pos.z - m.z);
  const seconds = steps / 30;
  const result = {
    body: body.name, range: m.range, dist: Math.round(dist),
    seconds: Math.round(seconds), arrived: dist <= m.reach,
    charge: +R.charge.toFixed(2),
    /* And whether the pack can still get home, which this check measured and
       never asked about. It reset R.charge to 1 before driving — right, since
       that is what a deployed rover has — and then reported the remainder as
       a statistic beside the verdict rather than as part of it. Two markers in
       six systems spent over half the pack one-way, so arriving was the end of
       the trip; the suite watched that happen and called it a pass. */
    canReturn: R.canReturn(),
    homeM: Math.round(Math.hypot(R.pos.x, R.pos.z)),
    flatSecs: Math.round(flatSecs), budgetSecs: Math.round(budget),
    ratio: +(seconds / flatSecs).toFixed(2),
  };
  /* Leave the rover parked at the ship rather than kilometres out at the
     marker. This section's own physics loop never yields to a drawn frame —
     it is thousands of synchronous `R.update` calls inside one evaluate — so
     the ground scene's chase camera does not move a metre while it runs; the
     camera only starts catching up to the rover once real frames resume
     afterwards. Left at the marker, that catch-up becomes the trees section's
     problem two subjects later, because on this galaxy the only world with
     enough vegetation for a tree band is also the world this check just
     landed on, so its own `liftOff`+`land` fires on the very body the camera
     is still kilometres from converging on. `Surface.treesNear` looks up
     trees around the *stashed* camera position, not the rover's, and a camera
     that has not caught up answers from an empty patch of ground — measured
     directly, with a scratch probe that teleports the rover instead of
     driving it (so the physics loop is not a variable): every one of three
     runs with no reset at all failed the trees checks below with "no tree
     found in range"; this reset alone, with no extra frames, cut that to
     roughly one run in three. */
  R.pos.set(0, 0, 0);
  return result;
}, MAX_FWD);

/* And give the camera the real frames it needs to actually get back there.
   The reset above moves the rover instantly; the camera that trees section
   depends on eases toward it, and it does that easing across genuine
   animation frames, which only run between `page.evaluate` calls, not inside
   one. Measured empirically on the same probe: zero explicit frames left the
   intermittent failure from the reset alone; eight got every run to pass but
   left the camera itself some 170 m adrift, closer than the failing case but
   not converged; twelve settled it to within about twenty metres on every
   run tried — comfortably inside the 300 m radius the parking step searches
   and the 210 m half-period the tiling wraps at, which is the margin that
   actually matters here rather than the exact distance. */
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => new Promise((res) => {
    requestAnimationFrame(() => requestAnimationFrame(res));
  }));
}

check('a Hush marker is drivable to in a reasonable time', !reach.skipped && reach.arrived,
  reach.skipped || `${reach.body} ${reach.range} m: ${reach.seconds} s driven vs `
  + `${reach.flatSecs} s flat-out (${reach.ratio}x), budget ${reach.budgetSecs} s, `
  + `${Math.round(reach.charge * 100)}% pack left`);

/* Getting there is half the claim. A marker is the only evidence in the game
   that has to be fetched in person, so it is the one site a player will drive
   at whatever the readout says — and a marker sited past a round trip is not a
   risk they chose, it is a place the pack could never have brought them back
   from. See MARKER_RANGE_MAX in src/world/Sites.js for the bound and how it
   was derived. */
check('and the pack can still get home from it', !reach.skipped && reach.canReturn,
  reach.skipped || `${reach.body}: ${Math.round(reach.charge * 100)}% left at `
  + `${reach.homeM} m out, ${Math.round((1 - reach.charge) * 100)}% spent getting there`);

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

/* The "no return" flag has to answer the journey the player actually makes:
   here to the site, then the site to the ship. It used to double the distance
   from the rover, which is the cost of going out and coming back to the patch
   of ground you are standing on — a trip nobody takes, and one that reads as
   twice as expensive as the real one whenever you have already driven most of
   the way there. It was reported from play as a site the chart said could not
   be reached while the player was steadily approaching it.

   Driven from the game rather than scraped from the DOM, because what is being
   tested is the arithmetic and the DOM would only prove a string got written. */
const reachFlag = await page.evaluate(() => {
  const g = window.__game;
  if (!g.landed) return { skipped: true };
  const body = g.landed.body;
  const R = g.rover;
  const keep = { x: R.pos.x, z: R.pos.z, charge: R.charge };
  const sites = g.sites.at(body);
  const near = sites.slice().sort((a, b) => a.range - b.range)[0];
  const far = sites.slice().sort((a, b) => b.range - a.range)[0];
  if (!near || !far) { return { skipped: 'not enough sites' }; }

  const judge = (site, reach) => {
    const row = g.sites.manifest(body, R.pos.x, R.pos.z).find((s) => s.id === site.id);
    return { dist: row.dist, range: row.range,
      now: row.dist + row.range <= reach, old: row.dist * 2 <= reach };
  };

  /* Pessimistic, and this is the one that was reported from play: drive well
     past a close-in site, so the site is nearer the ship than it is to you.
     Doubling your own distance then invents a journey half again as long as
     the real one and calls the site unreachable while you are approaching it. */
  R.pos.x = far.x * 0.92; R.pos.z = far.z * 0.92;
  let d = Math.hypot(near.x - R.pos.x, near.z - R.pos.z);
  R.charge = ((d + near.range) * 1.15) / 14000;
  const pess = judge(near, R.metresLeft());

  /* Optimistic, and the more dangerous of the two: stand close to a site that
     is a long way from the ship. Doubling your own distance then understates
     the trip home and calls it reachable when it would strand you. */
  R.pos.x = far.x * 0.85; R.pos.z = far.z * 0.85;
  d = Math.hypot(far.x - R.pos.x, far.z - R.pos.z);
  R.charge = (d * 2.2) / 14000;
  const opt = judge(far, R.metresLeft());

  R.pos.x = keep.x; R.pos.z = keep.z; R.charge = keep.charge;
  return { pess, opt };
});
check('a site you have nearly reached is not called unreachable',
  reachFlag.skipped || (reachFlag.pess.now && !reachFlag.pess.old),
  reachFlag.skipped ? String(reachFlag.skipped)
    : `${Math.round(reachFlag.pess.dist)} m to it + ${Math.round(reachFlag.pess.range)} m home`
      + ` — the old rule charged ${Math.round(reachFlag.pess.dist * 2)} m and said no`);
check('and a site that really would strand you still says so',
  reachFlag.skipped || (!reachFlag.opt.now && reachFlag.opt.old),
  reachFlag.skipped ? String(reachFlag.skipped)
    : `${Math.round(reachFlag.opt.dist)} m to it + ${Math.round(reachFlag.opt.range)} m home`
      + ` — the old rule charged only ${Math.round(reachFlag.opt.dist * 2)} m and said yes`);

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

/* One instrumented driving segment, and the instrument is the whole point.
 *
 * `Rover.update` moves the body by precisely `speed * dt` along its heading and
 * nothing else does — `_settle` writes only pos.y — so with steering held at
 * zero the heading is constant and the step is exactly predictable. Any
 * discrepancy between where the drive said the rover would be and where it
 * ended up therefore IS a collision push-out, and every push-out has to have a
 * trunk overlapping the capsule. That is the assertion this branch exists to
 * make: *the rover is never impeded by something the index does not report*.
 *
 * The prediction reads `speed` *after* the step rather than before it, which is
 * the difference between an instrument and a noise source: `update` applies the
 * acceleration and only then moves the body by the new speed, so a prediction
 * made on the way in is wrong by ACCEL*dt² — about 1.2 cm a frame, every frame
 * the rover is not yet at its cap. Measured against a build with no collision
 * in it at all, reading it beforehand reported 482 push-outs in 900 steps and
 * every one of them unexplained, which is a broken ruler and not a finding.
 * Read afterwards, the same build reports zero.
 *
 * One function rather than two because both phases below need it. The
 * drive-at-a-tree phase is where a push-out is *guaranteed*, so it is where the
 * "a push happened, therefore a trunk must be overlapping" branch actually gets
 * exercised; the clear-bearing phase is where an invisible wall would show up.
 * A run that only ever measured the second would be reporting success on a
 * mechanism it never invoked.
 */
const driveSegment = ({ steps }) => {
  const g = window.__game, S = g.surface, R = g.rover;
  const input = { held: (a) => a === 'thrUp', touch: false };
  // The capsule the collision itself uses. R.hullR and R.halfWheelbase are
  // public on the instance for exactly this — see the comment in the Rover
  // constructor — so this suite measures the same numbers _collide does
  // rather than carrying a second copy that could drift out of step with them.
  const HB = R.halfWheelbase, DT = 1 / 30;
  let pushes = 0, unexplained = 0, worst = 0, blind = 0;
  for (let i = 0; i < steps; i++) {
    const [fx, fz] = R.forward();
    const sx = R.pos.x, sz = R.pos.z;
    R.update(DT, input, false);
    /* The prediction reads `speed` *after* the step, which is right — see the
       doc comment above — but it has one latent false positive that has
       nothing to do with trees. When the pack empties mid-step, Rover.update
       moves the body first, using the speed the frame started with, and only
       then zeroes `speed` because the charge ran out. That one frame predicts
       the *start* position (speed now reads 0) against a body that has
       already moved a full step, and it would read here as a push with
       nothing behind it. Unreachable in this suite — charge is reset to 1 for
       every run and a run costs a small fraction of a full pack — but it will
       eventually fire on a longer run, and whoever sees it should not go
       looking for a tree bug. */
    const px = sx + fx * R.speed * DT;
    const pz = sz + fz * R.speed * DT;
    if (Math.hypot(R.pos.x - px, R.pos.z - pz) <= 1e-6) continue;
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
      best = Math.min(best, Math.hypot(dx, dz) - (R.hullR + t.r));
    }
    // negative or ~zero means a trunk is touching the capsule, as it should be
    if (!(best <= 1e-3)) {
      unexplained++;
      /* Worth separating: a push with the index reporting *nothing at all* is
         the pure invisible wall, while a push with trees around but none of
         them touching is a geometry disagreement. They would be fixed in
         different places. (It also keeps `worst` a real distance — `best`
         stays Infinity when the list is empty, which used to format as
         "furthest trunk was Infinity m clear".) */
      if (!near.length) blind++; else worst = Math.max(worst, best);
    }
  }
  return {
    pushes, unexplained, blind, worst, x: R.pos.x, z: R.pos.z, speed: R.speed,
  };
};

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
  await page.evaluate(() => {
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

  /* Re-ask after the frames ran: the camera moved with the rover, so the cell
     may have shifted and the tree's own position with it. */
  const mark = await page.evaluate(() => {
    const g = window.__game, S = g.surface, R = g.rover;
    const near = S.treesNear(R.pos.x, R.pos.z, 40);
    const t = near.map((q) => ({ q, d: Math.hypot(q.x - R.pos.x, q.z - R.pos.z) }))
      .sort((a, b) => a.d - b.d)[0];
    return t ? { tx: t.q.x, tz: t.q.z, tr: t.q.r, H: t.q.H } : { none: true };
  });

  const hit = mark.none ? null
    : await page.evaluate(driveSegment, { steps: 900 });

  /* What "it stopped because of a tree" actually means, asked of the rover at
     rest rather than of the tree it was aimed at.

     The obvious version — distance to the trunk the parking step picked — is
     not the claim. `mark` re-queries the index after the settle frames and the
     nearest tree then is not necessarily the one the nose is on, and the rover
     may well be stopped by a third one it met on the way; on this seed that
     reported a perfectly true "2.85 m clear" about a tree it never touched.
     What matters is that *some* trunk the index returns is in contact with the
     capsule. That is the real claim, it does not care which tree, and it is
     the thing an invisible wall would fail. */
  const rest = mark.none ? null : await page.evaluate(() => {
    const g = window.__game, S = g.surface, R = g.rover;
    // R.hullR / R.halfWheelbase, not a local copy — see the comment in the
    // Rover constructor and the matching note in driveSegment above.
    const HB = R.halfWheelbase;
    const near = S.treesNear(R.pos.x, R.pos.z, 25);
    const [fx, fz] = R.forward();
    const ax = R.pos.x + fx * HB, az = R.pos.z + fz * HB;
    const bx = R.pos.x - fx * HB, bz = R.pos.z - fz * HB;
    let gap = Infinity, gr = 0, gH = 0;
    for (const t of near) {
      const abx = bx - ax, abz = bz - az;
      const L2 = abx * abx + abz * abz;
      let u = L2 > 0 ? ((t.x - ax) * abx + (t.z - az) * abz) / L2 : 0;
      u = u < 0 ? 0 : (u > 1 ? 1 : u);
      const dx = ax + abx * u - t.x, dz = az + abz * u - t.z;
      const d = Math.hypot(dx, dz) - (R.hullR + t.r);
      if (d < gap) { gap = d; gr = t.r; gH = t.H; }
    }
    return {
      n: near.length, gap: +gap.toFixed(3),
      r: +gr.toFixed(2), H: +gH.toFixed(1),
      speed: +Math.abs(R.speed).toFixed(2),
    };
  });

  check('driving into a tree stops the rover',
    !!rest && rest.speed < 1.0 && rest.gap <= 0.05,
    !rest ? 'no tree found in range'
      : !rest.n ? `still making ${rest.speed} m/s, and the index reports no`
        + ' tree within 25 m of where it ended up'
        : `at rest at ${rest.speed} m/s, capsule ${rest.gap} m from a ${rest.H} m`
          + ` tree's bole (trunk r ${rest.r}, ${rest.n} in range)`);

  /* The invisible-wall assertion, and it is NOT "sweep for a clear bearing and
     drive it". That test would flake, for a reason worth understanding: the
     tree band is tiled and the cell follows the camera, so `tileTo` lands every
     instance within half a period of a point 134.4 m down the view axis. Drive
     a few hundred metres and the cell has moved with you and brought new trees
     into existence ahead. A corridor sampled once, before the drive, is not the
     corridor the rover will be in when it gets there — so "clear now" is not a
     claim about the far end at all.

     So instead: drive, and at every step where the body did not land where the
     drive put it, require a trunk actually overlapping the capsule. Zero
     unexplained pushes is the assertion, and it holds however many trees appear
     en route.

     First, off the trunk the run above is parked against. The liveness check at
     the end of this block asks that the rover covers ground, and a rover left
     nose-on against bark covers none of it — it would be measuring the stall
     the previous check just *demanded* rather than anything about clear ground.
     Observed rather than guessed: with the collision in and this backing-off
     absent, the block reported 0 m in 30 s. */
  await page.evaluate(() => {
    const R = window.__game.rover;
    const [fx, fz] = R.forward();
    R.pos.x -= fx * 20; R.pos.z -= fz * 20;
    R.yaw += Math.PI * 0.5;
    R.speed = 0; R.charge = 1;
  });
  await settle();

  /* And drive it in segments, with two real animation frames between them.
   *
   * This is not a stylistic choice, it is the difference between a test and a
   * decoration. `treesNear` wraps every tiled instance into the copy nearest
   * the camera, and the camera pair it reads is the one the last *drawn* frame
   * stashed — but a tight `rover.update` loop never lets the frame loop run, so
   * the cell stays frozen where the rover started while the rover drives out of
   * it. Thirty seconds at 22 m/s is 660 m, and a 420 m cell does not reach that
   * far: measured as one unbroken loop, this phase covered 637.6 m and recorded
   * *zero* push-outs, which satisfied "no unexplained pushes" by never pushing
   * at all. Letting the frames run between segments makes the cell follow the
   * vehicle the way it does when a person is driving, which is both the honest
   * simulation and the only way the rover is still among trees at the end.
   *
   * The counters accumulate across the segments; the frames in between belong
   * to the real update loop, which coasts the rover a few centimetres with no
   * throttle held. That is outside the instrument and does not need to be. */
  const SEGMENTS = 6, SEG_STEPS = 150;      // 6 × 5 s = the same 30 s as before
  const start = await page.evaluate(() => {
    const R = window.__game.rover;
    return { x: R.pos.x, z: R.pos.z };
  });
  const clear = { steps: 0, pushes: 0, unexplained: 0, blind: 0, worst: 0 };
  let last = null;
  for (let s = 0; s < SEGMENTS; s++) {
    const seg = await page.evaluate(driveSegment, { steps: SEG_STEPS });
    clear.steps += SEG_STEPS;
    clear.pushes += seg.pushes;
    clear.unexplained += seg.unexplained;
    clear.blind += seg.blind;
    clear.worst = Math.max(clear.worst, seg.worst);
    last = seg;
    await settle();
  }
  clear.covered = +Math.hypot(last.x - start.x, last.z - start.z).toFixed(1);
  clear.speed = +last.speed.toFixed(1);

  const pushes = (hit ? hit.pushes : 0) + clear.pushes;
  const unexplained = (hit ? hit.unexplained : 0) + clear.unexplained;
  const blind = (hit ? hit.blind : 0) + clear.blind;
  const worst = Math.max(hit ? hit.worst : 0, clear.worst);

  check('the rover is never stopped by something the index does not report',
    !!hit && unexplained === 0,
    !hit ? 'no tree found in range'
      : `${pushes} push-outs (${hit.pushes} driving at a tree,`
        + ` ${clear.pushes} across ${clear.steps} steps of open ground),`
        + ` ${unexplained} unexplained`
        + (unexplained ? ` · ${blind} with the index reporting nothing,`
          + ` furthest trunk ${worst.toFixed(2)} m clear` : ''));

  /* And the mechanism has to have been exercised at all.
   *
   * A run in which nothing ever pushed the rover satisfies "no unexplained
   * push-outs" trivially, and proves precisely nothing about invisible walls —
   * the assertion above would go quietly decorative the moment a seed, a world
   * or the tiling put the drive somewhere with no trees in it, and nobody would
   * see it happen. HANDOFF.md has a whole section on the suite measuring the
   * wrong thing and passing; this is the guard against adding to it. */
  check('and something actually pushed back, or the check above proves nothing',
    pushes > 0, `${pushes} push-outs to explain`);

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
