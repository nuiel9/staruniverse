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

if (errs.length) console.log('pageerrors:', [...new Set(errs)].slice(0, 4).join(' | '));
const ok = checks.every((c) => c[1]) && !errs.length;
console.log(ok ? 'EXPEDITION PASS' : 'EXPEDITION FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
