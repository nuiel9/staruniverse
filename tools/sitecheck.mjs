/* Does the height field you can build from a spec match the one you land on?
 *
 * Site placement is about to score routes before the player lands, using a
 * field built from the world's spec alone. If that field and the one the
 * Surface actually constructs ever differ, sites are placed on a world nobody
 * drives on — and every later check in this file would be measuring the wrong
 * planet while passing.
 *
 * After Task 1 they are the same code, so this is cheap insurance rather than
 * a second fieldcheck. It is still worth running: "the same code" is a claim
 * about a refactor, and refactors are exactly where it stops being true.
 *
 *   npm run dev            in one terminal
 *   npm run sitecheck      in another
 */
import { chromium } from 'playwright';
import { ROUTE_STEP } from '../src/world/Sites.js';

const URL = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const b = document.getElementById('bootStart'); return b && !b.hidden;
}, undefined, { timeout: 120000 });
await page.evaluate(() => document.getElementById('bootStart').click());
await page.waitForFunction(() => window.__game && window.__game.time > 0.5,
  undefined, { timeout: 180000 });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push([name, !!ok, detail]);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
};

/* Three worlds rather than one. The extraction has to hold across world types,
   because seaY branches on spec.garden and heightAt branches on uType. */
const agree = await page.evaluate(async () => {
  const g = window.__game;
  const surfMod = await import('/src/world/Surface.js');
  if (typeof surfMod.groundField !== 'function') return { err: 'groundField is not exported' };
  const solid = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas);
  const out = [];
  for (const body of solid.slice(0, 3)) {
    g.pose({ bodyRef: body, dist: 1.6, phase: 70, elev: 8 });
    g.land(body, { now: true });
    g.director.stop();
    if (!g.landed) { out.push({ body: body.name, err: 'land refused' }); continue; }
    const S = g.surface;
    const f = surfMod.groundField(body.spec);
    let worstY = 0, worstAt = null;
    /* Scattered rather than gridded, and out to the range a site can sit at,
       because that is the ground the score will be walked over. */
    for (let i = 0; i < 400; i++) {
      const a = i * 2.399963229, r = 40 + (i / 400) * 6200;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      for (const lod of [1, 14, 40]) {
        const d = Math.abs(f.heightAt(x, z, lod) - S.heightAt(x, z, lod));
        if (d > worstY) { worstY = d; worstAt = [Math.round(x), Math.round(z), lod]; }
      }
    }
    out.push({
      body: body.name, type: body.spec.type,
      siteDx: Math.abs(f.site[0] - S._site[0]) + Math.abs(f.site[1] - S._site[1]),
      datumDx: Math.abs(f.datum[0] - S._datum[0]) + Math.abs(f.datum[1] - S._datum[1]),
      seaDx: Math.abs(f.seaY - S._seaY),
      worstY, worstAt,
    });
    await g.liftOff({ now: true });
  }
  return { out };
});

if (agree.err) { console.error(agree.err); await browser.close(); process.exit(1); }
for (const r of agree.out) {
  if (r.err) { check(`field agrees on ${r.body}`, false, r.err); continue; }
  /* Exact, not close. The two are the same function after Task 1, so any
     difference at all means the constructor kept a second derivation. */
  check(`the landing site agrees on ${r.body} (${r.type})`, r.siteDx === 0 && r.datumDx === 0 && r.seaDx === 0,
    `site ${r.siteDx} · datum ${r.datumDx} · sea ${r.seaDx}`);
  check(`heights agree on ${r.body} (${r.type})`, r.worstY === 0,
    `worst ${r.worstY} m${r.worstAt ? ` at ${r.worstAt[0]},${r.worstAt[1]} lod ${r.worstAt[2]}` : ''}`);
}

// ------------------------------------------------------- walking the galaxy
/* Every system, not just the one the game boots into.
 *
 * This used to score the home system alone, because that is where `bootGame`
 * leaves you and nothing here ever moved. It was never a small sample — thirty
 * five sites over twelve worlds — but it was one system of fourteen, and both
 * of the numbers this branch tuned (`WALL_TRIGGER`, and the acceptance suite's
 * budget multiplier) were read off that one distribution and then applied to
 * the whole galaxy. A sample, presented as a census.
 *
 * `loadSystem` rather than `hyperjump`: the jump wraps the same call in a
 * 420 ms wait, a screen flash, a sound, and contract, mystery and event ticks,
 * none of which a checker wants and all of which cost time thirteen times over.
 *
 * One consequence worth knowing rather than discovering. `loadSystem` tears the
 * old system's bodies down and builds new objects, so the caches that hang off
 * a body — `_sites`, `_field`, `_wreckN` — do not survive the move. Every
 * system therefore pays its derivation once, which is the honest cost and is
 * what the timing below reports.
 *
 * Both stages read one walk. They used to make a pass each over the same
 * bodies computing overlapping things; stage 1 wants what the ground demands
 * now and stage 2 wants that beside what it demanded before easing, and the
 * second is a superset of the first. One walk, ~80 ms of route scoring a
 * system rather than two lots of it. */
const LIMIT = Number(process.argv[3] || 0);      // 0 = the whole galaxy
const rows = [];
const perSystem = [];
let survivorAt = null;
const notStable = [];
const wreckBad = [];
let orderTested = 0;
const orderBad = [];

const systemCount = await page.evaluate(() => window.__game.galaxy.length);
const walkTo = LIMIT > 0 ? Math.min(LIMIT, systemCount) : systemCount;
const walkT0 = Date.now();

for (let id = 0; id < walkTo; id++) {
  const sys = await page.evaluate(async (id) => {
    const g = window.__game;
    if (g.currentSystemId !== id) await g.loadSystem(id);
    const surfMod = await import('/src/world/Surface.js');
    const sitesMod = await import('/src/world/Sites.js');
    const solid = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas);
    const out = [];
    let survivor = null;
    const t0 = performance.now();
    for (const body of solid) {
      const f = surfMod.groundField(body.spec);
      for (const s of g.sites.at(body)) {
        const now = sitesMod.routeCost(f, 0, 0, s.x, s.z);
        const was = s._rolled ? sitesMod.routeCost(f, 0, 0, s._rolled.x, s._rolled.z) : null;
        out.push({
          system: g.galaxy[id].name, body: body.name, kind: s.kind, id: s.id,
          wall: now.wall, secs: now.secs,
          wasWall: was ? was.wall : null, wasSecs: was ? was.secs : null,
          range: s.range, bearing: s.bearing,
          moved: !!s._rolled && (s._rolled.bearing !== s.bearing || s._rolled.range !== s.range),
          seamKeptBearing: s.kind !== 'seam' || (s.dep && s.bearing === s.dep.bearing),
        });
      }
      if (g.sites.at(body).some((s) => s.kind === 'survivor')) survivor = body.name;
    }
    const ms = performance.now() - t0;

    /* The ranking is a total order, so the lattice can be walked in any order
       and land on the same site — tested rather than asserted, because the
       version before this one did not have the property. A tolerance that
       accepts a candidate up to half a step worse also moves the bound the next
       one is compared against, so the winner depended on which candidate came
       first. A fixed loop made that reproducible, which is not the same as well
       defined, and stops being true the moment somebody reorders a loop for
       tidiness.

       Rebuilt here rather than exported, because what is being tested is the
       ordering rule and a rule shared with the thing under test would agree
       with it by construction. Three searched sites a system: running the whole
       lattice twice for every one of them would cost eight times the walk, and
       a spread across fourteen systems says more than an exhaustive pass over
       one. */
    const nOf = (m) => Math.round(m / sitesMod.ROUTE_STEP);
    const BEAR = [0, -10, 10, -20, 20], FAC = [1.0, 0.88, 1.12];
    const pick = (f, s, bears, facs) => {
      const b0 = sitesMod.routeCost(f, 0, 0, s._rolled.x, s._rolled.z);
      let bn = nOf(b0.wall), bs = b0.secs;
      let bb = s._rolled.bearing, br = s._rolled.range;
      for (const db of bears) {
        for (const fr of facs) {
          const rng = s._rolled.range * fr;
          if (rng < 700 || rng > 6200) continue;
          const bear = s._rolled.bearing + (s.kind === 'seam' ? 0 : db);
          const a = bear * Math.PI / 180;
          const c = sitesMod.routeCost(f, 0, 0, Math.sin(a) * rng, Math.cos(a) * rng);
          const n = nOf(c.wall);
          if (n < bn || (n === bn && c.secs < bs)) { bn = n; bs = c.secs; bb = bear; br = rng; }
        }
      }
      return `${Math.round(bb)}@${Math.round(br)}`;
    };
    let tested = 0;
    const orderDisagreed = [];
    for (const body of solid) {
      if (tested >= 3) break;
      const f = surfMod.groundField(body.spec);
      for (const st of g.sites.at(body)) {
        if (tested >= 3 || !st._rolled) continue;
        if (sitesMod.routeCost(f, 0, 0, st._rolled.x, st._rolled.z).wall <= 75) continue;
        tested++;
        const fwd = pick(f, st, BEAR, FAC);
        const rev = pick(f, st, BEAR.slice().reverse(), FAC.slice().reverse());
        if (fwd !== rev) orderDisagreed.push(`${body.name} ${st.kind} ${fwd} vs ${rev}`);
      }
    }

    /* Determinism, per system rather than once: drop every cache and rebuild.
       The same seed must give the same sites in the same places. This is what
       an extra rnd() in place() would break. */
    const snap = () => solid.map((b) => g.sites.at(b)
      .map((s) => `${s.id}@${s.x | 0},${s.z | 0}`).join('|')).join('#');
    const before = snap();
    for (const b of solid) { delete b._sites; delete b._wreckN; delete b._field; }
    const stable = before === snap();

    /* And the draw sequence itself, on every world. `_wreckCountOf` replays
       what `at()` draws; if the two disagree the survivor has moved. */
    const bad = [];
    for (const b of solid) {
      delete b._wreckN;
      const predicted = g.sites._wreckCountOf(b);
      const actual = g.sites.at(b).filter((s) => s.kind === 'wreck').length;
      if (predicted !== actual) bad.push(`${g.galaxy[id].name}/${b.name} says ${predicted}, has ${actual}`);
    }

    return { name: g.galaxy[id].name, worlds: solid.length, rows: out, survivor, stable, bad, ms,
      orderTested: tested, orderDisagreed };
  }, id);

  rows.push(...sys.rows);
  perSystem.push({ name: sys.name, worlds: sys.worlds, sites: sys.rows.length, ms: sys.ms });
  if (sys.survivor) survivorAt = `${sys.name}/${sys.survivor}`;
  if (!sys.stable) notStable.push(sys.name);
  wreckBad.push(...sys.bad);
  orderTested += sys.orderTested;
  orderBad.push(...sys.orderDisagreed);
}

const walkSecs = (Date.now() - walkT0) / 1000;
const worlds = perSystem.reduce((a, s) => a + s.worlds, 0);
console.log(`\n  walked ${perSystem.length}/${systemCount} systems`
  + ` · ${worlds} worlds · ${rows.length} sites · ${walkSecs.toFixed(1)} s`
  + ` (${Math.round(perSystem.reduce((a, s) => a + s.ms, 0) / perSystem.length)} ms of scoring a system)`);

const dist = { rows, worlds };

// ------------------------------- stage 1: what the ground actually demands

{
  const secs = dist.rows.map((r) => r.secs).sort((a, b) => a - b);
  const q = (p) => secs.length ? secs[Math.min(secs.length - 1, Math.floor(secs.length * p))] : 0;
  /* A flat-out run is range / MAX_FWD. The ratio is the honest measure of how
     much the ground is costing, and it is scale-free, so a 6 km site and a
     700 m one are comparable. */
  const ratios = dist.rows.map((r) => r.secs / (r.range / 22)).sort((a, b) => a - b);
  const rq = (p) => ratios.length ? ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * p))] : 0;
  console.log(`\n  ${dist.rows.length} sites over ${dist.worlds} worlds`);
  console.log(`  drive seconds   median ${q(0.5).toFixed(0)}  p90 ${q(0.9).toFixed(0)}  worst ${q(1).toFixed(0)}`);
  console.log(`  vs flat out     median ${rq(0.5).toFixed(2)}x  p90 ${rq(0.9).toFixed(2)}x  worst ${rq(1).toFixed(2)}x`);
  const worst = dist.rows.slice().sort((a, b) => b.secs - a.secs).slice(0, 5);
  for (const w of worst) {
    console.log(`    ${w.body} ${w.kind} ${w.range} m -> ${w.secs.toFixed(0)} s`);
  }
  const walls = dist.rows.map((r) => r.wall).sort((a, b) => a - b);
  const wq = (p) => walls.length ? walls[Math.min(walls.length - 1, Math.floor(walls.length * p))] : 0;
  console.log(`  worst stretch   median ${wq(0.5).toFixed(0)} m  p75 ${wq(0.75).toFixed(0)} m`
    + `  p90 ${wq(0.9).toFixed(0)} m  worst ${wq(1).toFixed(0)} m`);
  const walled = dist.rows.slice().sort((a, b) => b.wall - a.wall).slice(0, 5);
  for (const w of walled) console.log(`    ${w.body} ${w.kind} ${w.range} m -> ${w.wall.toFixed(0)} m of wall`);
  check('every site scores a finite, positive drive time', dist.rows.length > 0
    && dist.rows.every((r) => r.secs > 0 && Number.isFinite(r.secs)),
    `${dist.rows.length} sites`);
  /* Sanity on the units: nothing can beat flat out, and the crawl floor caps
     how bad it can get at MAX_FWD/(MAX_FWD*CRAWL_FLOOR) = 10x. */
  check('drive times sit between flat out and the crawl floor',
    rq(0) >= 0.99 && rq(1) <= 10.01, `${rq(0).toFixed(2)}x to ${rq(1).toFixed(2)}x`);
}

/* Only climbing costs. The two checks above pass on a score that ignores
   terrain completely, so this is the one that has teeth: run a real route
   both ways. Downhill must be strictly cheaper than uphill over the same
   ground, and the flat-out time is the floor neither can beat. A sign error,
   a missing max(0, ...), or a terrain-blind stub all fail here. */
const dir = await page.evaluate(async () => {
  const g = window.__game;
  const surfMod = await import('/src/world/Surface.js');
  const sitesMod = await import('/src/world/Sites.js');
  const body = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas)[0];
  const f = surfMod.groundField(body.spec);
  /* Search for a leg with real relief on it, so the comparison is not being
     made across flat ground where both directions legitimately tie. */
  let best = null;
  for (let a = 0; a < 32 && !best; a++) {
    const th = a * Math.PI / 16, R = 3000;
    const x = Math.cos(th) * R, z = Math.sin(th) * R;
    const up = sitesMod.routeCost(f, 0, 0, x, z);
    const down = sitesMod.routeCost(f, x, z, 0, 0);
    if (Math.abs(up.secs - down.secs) > 1) best = { up: up.secs, down: down.secs, flat: R / 22 };
  }
  return best;
});
check('the score is directional — climbing costs and descending does not',
  !!dir && dir.up !== dir.down && Math.min(dir.up, dir.down) >= dir.flat - 0.01,
  dir ? `up ${dir.up.toFixed(0)} s vs down ${dir.down.toFixed(0)} s, flat out ${dir.flat.toFixed(0)} s`
    : 'no leg with relief found');

// --------------------------------- stage 2: it got gentler, and stayed itself
/* The same walk stage 1 read. Both want the cost of every site; stage 2 also
   wants what that cost was before easing moved it, which the rolled position
   still carries — so one pass serves both. */
const after = { rows, survivor: survivorAt };

{
  const paired = after.rows.filter((r) => r.wasWall !== null);
  const q = (xs, p) => { const s = xs.slice().sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
  /* Samples, not metres, because that is what the ranking orders on and what
     a wall actually is: a run of consecutive route samples. The metres are that
     count times a step of len/n, and the step is near 25 m but not exactly it
     and not the same for two candidates of different length — so two positions
     crossing the same number of samples report walls differing by centimetres.
     Comparing metres here would be re-introducing, in the assertion, the noise
     the ranking was changed to stop reading as signal.

     Counting instead makes the claim exact rather than tolerated. The rolled
     position is itself in the lattice, so the winner's count can only be less
     than or equal to it: no band, no "within", and a single sample of growth is
     a ranking bug rather than a judgement call. */
  const nOf = (m) => Math.round(m / ROUTE_STEP);
  const worsened = paired.filter((r) => nOf(r.wall) > nOf(r.wasWall));
  const sameCount = paired.filter((r) => nOf(r.wall) === nOf(r.wasWall) && r.wall > r.wasWall + 0.5);
  const helped = paired.filter((r) => nOf(r.wall) < nOf(r.wasWall));
  /* Where WALL_TRIGGER came from, kept reproducible from the committed tree.
     Stage 1 above scores the sites `at()` returns, and those are eased now, so
     the distribution the trigger was read off can only be recovered here — from
     the rolled positions stage 2 still carries. The thing to look for in the
     sorted list is the empty band: a run of sites with no crawl at all, five
     with a single sample of it, then nothing until four samples. 75 m is the
     middle of that gap, which is the one place a route step's worth of float
     jitter cannot reach. */
  const wasW = paired.map((r) => r.wasWall);
  const sortedWas = wasW.slice().sort((a, b) => a - b);
  console.log(`\n  before easing  median ${q(wasW, 0.5).toFixed(0)} m  p75 ${q(wasW, 0.75).toFixed(0)} m`
    + `  p90 ${q(wasW, 0.9).toFixed(0)} m  worst ${q(wasW, 1).toFixed(0)} m`
    + `  ·  ${wasW.filter((w) => w > 75).length}/${wasW.length} over the 75 m trigger`);
  console.log(`  sorted, m      ${sortedWas.map((w) => w.toFixed(0)).join(' ')}`);
  console.log(`  worst stretch  p90 ${q(paired.map((r) => r.wasWall), 0.9).toFixed(0)} m`
    + ` -> ${q(paired.map((r) => r.wall), 0.9).toFixed(0)} m`);
  console.log(`  worst site     ${q(paired.map((r) => r.wasWall), 1).toFixed(0)} m`
    + ` -> ${q(paired.map((r) => r.wall), 1).toFixed(0)} m`);
  /* Both numbers, because they are different claims. A site moves when any
     candidate beat the rolled one, and inside the tie band that means a shorter
     drive across the same wall; it counts as improved only when the wall itself
     lost a whole sample. Printing only the second made the first invisible, and
     it was pointless movement hiding in the gap that got caught in review. */
  console.log(`  moved          ${paired.filter((r) => r.moved).length}/${paired.length} sites,`
    + ` ${helped.length} of them to a wall at least one sample shorter`);

  /* The claim is about the tail, because the tail is the whole point — the
     lattice cannot help a site that never had a wall, so demanding every site
     improve would be wrong. The worst site is the sharpest single number. */
  check('the worst wall got shorter', q(paired.map((r) => r.wall), 1) < q(paired.map((r) => r.wasWall), 1),
    `${q(paired.map((r) => r.wasWall), 1).toFixed(0)} m -> ${q(paired.map((r) => r.wall), 1).toFixed(0)} m`);
  /* And nothing got worse: the rolled position is itself in the lattice, so
     picking the best can never lose to it. A regression is a ranking bug. */
  check('no site got a longer wall than the position it was rolled at', worsened.length === 0,
    worsened.length ? `${worsened.length} worse, e.g. ${worsened[0].body} ${worsened[0].kind}`
      + ` ${nOf(worsened[0].wasWall)} -> ${nOf(worsened[0].wall)} samples`
      : `none · ${sameCount.length} took a shorter drive across the same count`
        + sameCount.map((r) => ` (${r.body} ${r.kind} ${nOf(r.wall)} samples,`
          + ` ${r.wasSecs.toFixed(0)} -> ${r.secs.toFixed(0)} s)`).join(''));
  check('seams kept their deposit bearing', after.rows.every((r) => r.seamKeptBearing));
  /* Canonical, so a bearing has one name. `round(rnd()*360)` used to return
     0..360 inclusive, and 360 is 0 in a different costume: it prints as
     "bearing 360°" in the Codex, and easing normalised it to 0 on its way past
     a seam whose range had moved, leaving the chart contradicting the survey
     text beside it. This galaxy happens to roll none — 301 deposits and 457
     sites, all inside 0..359 — so the check below is a guard rather than a
     demonstration, and the demonstration is the mutation test further down. */
  const outOfRange = after.rows.filter((r) => !(r.bearing >= 0 && r.bearing <= 359));
  check('every bearing is canonical, 0..359', outOfRange.length === 0,
    outOfRange.length ? `${outOfRange.length} outside, e.g. ${outOfRange[0].body} ${outOfRange[0].bearing}`
      : `${after.rows.length} sites`);
  check('every site stayed inside the range band',
    after.rows.every((r) => r.range >= 700 && r.range <= 6200),
    `${Math.min(...after.rows.map((r) => r.range))}..${Math.max(...after.rows.map((r) => r.range))} m`);
}

/* Determinism: the same seed still produces the same sites, in the same order,
   with the same ids. This is what would break if a single extra rnd() found its
   way into place(). Measured on every system the walk visited, not just the one
   the game happened to boot into. */
check('the same seed rebuilds the same sites in the same places',
  notStable.length === 0,
  notStable.length ? `drifted in ${notStable.join(', ')}`
    : `${perSystem.length} system${perSystem.length === 1 ? '' : 's'} rebuild${perSystem.length === 1 ? 's' : ''} identically`);

check('the ranking gives the same winner whichever way the lattice is walked',
  orderTested > 0 && orderBad.length === 0,
  orderBad.length ? orderBad.slice(0, 3).join('; ')
    : `${orderTested} searched sites across ${perSystem.length} system`
      + `${perSystem.length === 1 ? '' : 's'} agree forwards and reversed`);

/* Easing may not rewrite a bearing it was not allowed to change — proved by
   handing it one it would have rewritten.
 *
 * The guard above cannot demonstrate this, because no deposit in this galaxy
 * rolls the value that used to break it. So force one: take a seam whose wall
 * is over the trigger (easing will run and its range will move, which is the
 * only way a seam reaches the write-back at all), set its deposit's bearing to
 * 360, rebuild, and require the site to come back still reading 360 rather than
 * the 0 the old unconditional normalise produced.
 *
 * This is the second lock rather than the first. Bearings are canonical at the
 * roll now, so 360 should never exist — but "should never exist" is what the
 * first lock is for, and this one holds even when it does. */
const b360 = await page.evaluate(async () => {
  const g = window.__game;
  for (const b of g.bodies.filter((x) => x.spec && x.planet && !x.planet.isGas)) {
    /* A seam whose range DEMONSTRABLY moved, not merely one whose wall cleared
       the trigger. Easing can run and still keep the rolled position, and a
       seam that kept it never reaches the write-back — so selecting on the
       trigger alone gave a test that passed without executing the line it
       exists to test. It did so on this check's first full-galaxy run, and
       only the detail string said so. */
    const eased = g.sites.at(b).find((s) => s.kind === 'seam'
      && s._rolled && s.range !== s._rolled.range);
    if (!eased) continue;
    const dep = g.prospect.deposits(b)[eased.i];
    const was = dep.bearing;
    /* +360 rather than a flat 360, and the difference is the whole test.
       Setting 360 outright points the seam due north — a different place, a
       different route, and easing then makes different decisions, so the
       write-back may not run at all and the test proves nothing. Adding a full
       turn to the bearing it already has leaves the direction identical to the
       last bit that matters, so every decision downstream is unchanged and the
       only thing different is that the stored number is now uncanonical. That
       is precisely the input the old unconditional normalise would have
       quietly rewritten. */
    dep.bearing = was + 360;
    delete b._sites; delete b._wreckN;
    const rebuilt = g.sites.at(b).find((s) => s.id === eased.id);
    const got = rebuilt ? rebuilt.bearing : null;
    const moved = rebuilt ? rebuilt.range !== rebuilt._rolled.range : false;
    const range = rebuilt ? rebuilt.range : null;
    const wasRange = rebuilt ? rebuilt._rolled.range : null;
    dep.bearing = was;
    delete b._sites; delete b._wreckN;
    g.sites.at(b);                                   // put the world back
    return { body: b.name, forced: was + 360, got, moved, range, wasRange,
      kept: got === was + 360 };
  }
  return { none: true };
});
/* `moved` is asserted, not merely printed. A seam that kept its rolled range
   never reaches the write-back, so a test on one of those would pass without
   running the line it is about — and this check found that out the hard way on
   its own first full-galaxy run. */
check('easing cannot rewrite a bearing it was not allowed to change',
  !b360.none && b360.kept && b360.moved,
  b360.none ? 'no seam with a moved range to test with'
    : `${b360.body}: deposit forced to ${b360.forced}, site reads ${b360.got}`
      + (b360.moved ? `, range moved ${b360.wasRange} -> ${b360.range} so the write-back ran`
        : ', but the write-back never ran — this proves nothing'));

/* Two ways at the same invariant, and walking the galaxy is what made the
   second one possible.

   The first is the sharper of the two and is checked on every world. There is a
   cycle to break — `at()` needs to know whether this world hosts the survivor,
   and the survivor test would need `at()` to count wrecks — so `_wreckCountOf`
   replays `at()`'s draw sequence without building the site list. That
   duplication is only safe while the two agree, and one extra rnd() in place()
   or ease() would shift what `at()` draws, silently move the survivor to a
   different world, and be caught here.

   The second used to be impossible to run. `_isSurvivorHost` picks one system
   off the galaxy seed and deliberately never picks the home one — the whole
   point is that they are a long way out — and this checker used to boot into
   the home system and stay there, so a presence test was permanently red for a
   reason that had nothing to do with placement. Walking the galaxy fixes that:
   somewhere out there is exactly one person still alive, and now we can say so. */
check('the survivor picker still reads the same rolls the sites were built from',
  wreckBad.length === 0,
  wreckBad.length ? wreckBad.slice(0, 3).join('; ')
    : `${worlds} worlds agree across ${perSystem.length} system${perSystem.length === 1 ? '' : 's'}`);

/* Asserted only on a full walk. There is one survivor in a galaxy and they are
   deliberately not in the home system, so a run limited to the first N systems
   can miss them for a reason that has nothing to do with placement — and a
   convenience flag that turns the suite red is a flag nobody uses. Not asserted
   is said out loud rather than quietly skipped, because a check that vanishes
   silently is how a suite starts measuring less than it claims. */
if (perSystem.length === systemCount) {
  check('there is exactly one survivor, and the walk found them',
    !!survivorAt, survivorAt || `nobody in ${systemCount} systems`);
} else {
  console.log(`--    the survivor is somewhere · not asserted, this walk covered`
    + ` ${perSystem.length} of ${systemCount} systems`);
}

const bad = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - bad}/${checks.length} ok`);
await browser.close();
process.exit(bad ? 1 : 0);
