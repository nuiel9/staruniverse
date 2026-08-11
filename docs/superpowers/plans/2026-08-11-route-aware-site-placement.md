# Route-aware Site Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop putting sites behind faces that take ten minutes to climb, by scoring the approach at placement time and keeping the least punishing of a small set of seeded candidates.

**Architecture:** Extract the height field's construction out of the `Surface` constructor so it can be built from a world's `spec` alone, and have `Surface` consume that same function so there is only ever one derivation. Score a candidate route by walking the straight line and applying the rover's own grade curve, with the drive constants moved to a module both `Rover` and `Sites` import. Score the rolled position first and only search a candidate lattice when it comes back punishing.

**Tech Stack:** Vanilla ES modules, three.js 0.185, Playwright for the browser-side checkers. No unit-test runner exists in this repo and this plan does not add one — checks are `tools/*.mjs` scripts run through `npm run`, which is the established pattern.

**Spec:** `docs/superpowers/specs/2026-08-11-route-aware-site-placement-design.md`. Read it first. Every number here comes from it.

## Global Constraints

- **The extracted field must be the one `Surface` uses.** If the constructor keeps its own copy of the derivation, sites get placed against one landing site and driven against another. Extraction exists to remove the second copy, not merely to make the field reachable.
- **`groundField` takes no quality argument and must not grow one.** `uLodK` is read by `jMeshLod`, never by `jTerrainRaw`, which takes `lod` as a parameter. If placement depended on the quality tier, changing graphics settings would move every site in the galaxy.
- **Candidates are derived, never rolled.** `_isSurvivorHost` → `_wreckCountOf` (`src/world/Sites.js:186-198`) reproduces `at()`'s roll sequence draw for draw — its comment says *"Burn exactly the rolls `at()` burns"*. One extra `rnd()` inside `place()` moves the survivor to a different world.
- **Seams keep `dep.bearing`.** `Sites.js:109-113` says why: *"Honour it rather than rolling a second one, or the survey text and the ground disagree."* Only their range may move.
- **Range stays inside `RANGE_MIN` (700) and `RANGE_MAX` (6200).** Candidates outside are dropped, never clamped — clamping piles candidates onto the boundary.
- **The lattice:** bearing offsets `0, ±10, ±20` degrees; range factors `0.88, 1.0, 1.12`. 15 candidates, of which the rolled position is one.
- **The route sample:** step **25 m**, `lod` **14** (the rover's own `GRADE_LOD`).
- **Site `id`s never change.** Saved surveyed/worked state is keyed by id.
- **Cost gate:** if the added work makes opening the Codex on an unlanded world hitch, stop and report the number rather than shipping it.
- **House style, enforced in review:** comments explain WHY a decision was made, in full sentences, at length. Commit messages are prose explaining why, with no Conventional Commits prefixes.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/world/Surface.js` | Gains `export function groundField(spec)`; the constructor consumes it; `heightAt` delegates to it. | 1 |
| `tools/sitecheck.mjs` | **New.** The checker, grown one stage per task: field agreement, then the drive-time distribution, then determinism. | 1, 3, 4 |
| `package.json` | `sitecheck` script. | 1 |
| `src/ship/driveModel.js` | **New.** The grade→speed curve and its constants, owned by neither `Rover` nor `Sites`. | 2 |
| `src/ship/Rover.js` | Imports the constants instead of declaring them. | 2 |
| `src/world/Sites.js` | `routeTime`, the candidate lattice, and the score-once-then-search gate in `place()`. | 3, 4 |
| `tools/expedition.mjs` | One marker-reachability assertion. | 5 |
| `HANDOFF.md` | Closes the open item. | 5 |

`Surface.js` is organised by *law* — the GLSL chunk, then its JS twin, then the class. `groundField` belongs beside the JS twin, above the class, because it is a property of the field rather than of the renderer.

---

### Task 1: `groundField(spec)`, consumed by `Surface`, and the cost gate

The whole design rests on the extracted field being the same field you drive on. That is proved here, before anything is built on it — and the cost that could sink the design is measured here too, at the earliest point it can be.

**Files:**
- Modify: `src/world/Surface.js` — new export beside the JS field twin; constructor and `heightAt` changed to use it
- Create: `tools/sitecheck.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `pickSite`, `jTerrainRaw`, `jSmoothstep`, `J_VSCALE` — all existing module-scope in `Surface.js`.
- Produces:
  - `groundField(spec) -> { site: [number, number], datum: [number, number], seaY: number, heightAt(x, z, lod?) -> number }`
  - `surface._field` — the same object, on the instance.

- [ ] **Step 1: Read what the constructor does today**

Find the block in the `Surface` constructor that computes the landing site. It is immediately after `this.U = U;` and reads roughly:

```js
    this._datum = [0, 0];
    this._site = pickSite(U);
    jTerrainRaw(this._site[0], this._site[1], 0.26, U, this._datum);
    U.uDatum.value.set(this._datum[0], this._datum[1], this._site[0], this._site[1]);
    this._seaY = Math.min((spec.sea - this._datum[0]) * J_VSCALE, spec.garden ? -26 : -40);
```

Also read `heightAt` near the end of the class, and `pickSite`. Note exactly which `U` fields each touches — you are about to reproduce that set and nothing more. Do not trust this plan's list over the code.

- [ ] **Step 2: Write the failing checker — `tools/sitecheck.mjs`, stage 0**

```js
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
import { bootGame } from './boot.mjs';

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

const bad = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - bad}/${checks.length} ok`);
await browser.close();
process.exit(bad ? 1 : 0);
```

- [ ] **Step 3: Add the npm script**

In `package.json`, after the `treecheck` line:

```json
    "sitecheck": "node tools/sitecheck.mjs",
```

- [ ] **Step 4: Run it and watch it fail**

```bash
npm run dev
```

```bash
npm run sitecheck
```

Expected: `groundField is not exported`, exit 1.

- [ ] **Step 5: Write `groundField`**

In `src/world/Surface.js`, immediately after the `__woodyJS` export (the end of the "same law, twice" section) and before the class:

```js
/* ------------------------------------------------------- the field, alone
 *
 * Everything above answers "how high is the ground" given a set of uniforms and
 * a landing site. Both of those come from the world's spec, so the answer does
 * not actually need a Surface — and something does need it without one: site
 * placement scores the drive to a candidate position before the player has
 * landed, and the Codex lists a world's sites for worlds nobody has visited.
 *
 * So the derivation lives here, and **the Surface constructor calls it**. That
 * is the whole point rather than a tidiness argument. Two copies of "where did
 * the ship come down" would put sites on one version of a world and drive them
 * on another, and the two would drift the first time either was touched — which
 * is the failure this file already carries two checkers for. There is one
 * derivation; tools/sitecheck.mjs proves the class still uses it.
 *
 * Note what is NOT here: uLodK, and any notion of quality. jTerrainRaw takes
 * its lod as a parameter and reads only uSeed and uRelief; uLodK belongs to
 * meshLod, which is about how finely the mesh is *drawn*. If this function ever
 * grew a quality argument, a player changing graphics settings would move every
 * site in the galaxy.
 *
 * @param {object} spec  a world spec — seed, relief, radius, typeId, sea, garden
 * @returns {{site:number[], datum:number[], seaY:number,
 *            heightAt:(x:number, z:number, lod?:number)=>number}}
 */
export function groundField(spec) {
  /* The uniform bag pickSite and jTerrainRaw expect, and nothing else in it.
     Shaped like three's uniforms because that is what those two read. */
  const U = {
    uSeed: { value: spec.seed },
    uRelief: { value: spec.relief },
    uPlanetR: { value: spec.radius * 1000 },
    uType: { value: spec.typeId | 0 },
  };
  const site = pickSite(U);
  const datum = [0, 0];
  jTerrainRaw(site[0], site[1], 0.26, U, datum);
  const seaY = Math.min((spec.sea - datum[0]) * J_VSCALE, spec.garden ? -26 : -40);
  const type = U.uType.value | 0;
  const R2 = 2 * U.uPlanetR.value;
  const scratch = [0, 0];

  /* The one implementation of heightAt. Surface delegates to this rather than
     keeping its own, so the class and the bare field cannot answer differently.
     Metres, +Y up, relative to the landing site, horizon bend included. */
  const heightAt = (x, z, lod = 1.0) => {
    jTerrainRaw(x + site[0], z + site[1], lod, U, scratch);
    const h = scratch[0], fine = scratch[1];
    const d = Math.sqrt(x * x + z * z);
    const pad = jSmoothstep(11, 42, d);
    let y = (h - datum[0]) * J_VSCALE * pad
          + (fine - datum[1]) * J_VSCALE * (0.34 + 0.66 * pad);
    if (type === 0 || type === 5) y = Math.max(y, seaY);
    return y - (x * x + z * z) / R2;
  };

  return { site, datum, seaY, heightAt, U };
}
```

- [ ] **Step 6: Have the constructor consume it**

Replace the constructor block from Step 1 with:

```js
    /* One derivation, shared with anything that needs the ground without a
       renderer — see groundField. The uniforms it builds are its own; the ones
       below are this Surface's, and only the four the field reads have to
       agree, which they do because both come off the same spec. */
    this._field = groundField(spec);
    this._site = this._field.site;
    this._datum = this._field.datum;
    this._seaY = this._field.seaY;
    U.uDatum.value.set(this._datum[0], this._datum[1], this._site[0], this._site[1]);
```

and replace the body of `heightAt` with a delegation, keeping its existing doc comment and adding a line saying where the implementation went:

```js
  heightAt(x, z, lod = 1.0) {
    return this._field.heightAt(x, z, lod);
  }
```

- [ ] **Step 7: Run and verify**

```bash
npm run sitecheck
```

Expected: 6/6 ok, with every difference reported as exactly `0`. A non-zero worst height means the constructor is still deriving something itself — find it rather than loosening the check.

- [ ] **Step 8: Measure the cost, and report the number**

This is the gate the spec sets. `pickSite` is a two-stage grid search; it used to run once per landing and now also runs whenever a site list is built for a world nobody has landed on.

Add a temporary timing probe (do NOT commit it) and record:

```js
// in the browser console, on a booted game
const m = await import('/src/world/Surface.js');
const b = __game.bodies.find((x) => x.spec && x.planet && !x.planet.isGas);
const t0 = performance.now(); m.groundField(b.spec); const t1 = performance.now();
console.log('groundField:', (t1 - t0).toFixed(1), 'ms');
```

Then measure the path that actually matters — opening the Codex on a world you have not landed on, which is where `sites.manifest()` reaches `at()` pre-landing (`src/ui/Codex.js:239`).

Write both numbers in the report. **If one `groundField` costs more than about 50 ms, stop and report before starting Task 2** — the design assumes it is paid once per body and cached, and above that the whole pre-landing approach needs rethinking rather than optimising.

- [ ] **Step 9: Commit**

```bash
git add src/world/Surface.js tools/sitecheck.mjs package.json
git commit -m "Let the ground be asked about without building a renderer

Site placement is about to score the drive to a candidate position, and
it has to do that before the player lands — the Codex lists a world's
sites for worlds nobody has visited. The height field never needed a
Surface for that; it needed a spec, a landing site and a datum, and all
three come off the spec.

So the derivation moves out and the constructor calls it. That is the
point rather than tidiness: two copies of where the ship came down would
place sites on one version of a world and drive them on another, and
they would drift the first time either was touched. heightAt delegates,
so there is one implementation of it rather than two that agree today.

sitecheck holds them to exactly zero difference across three world types
at three LODs, because after this they are the same function and
anything else means the constructor kept a copy."
```

---

### Task 2: One home for the drive model

The route score is not an approximation of how the rover climbs — it *is* how the rover climbs. So the curve gets one owner, and it is neither of its two users.

**Files:**
- Create: `src/ship/driveModel.js`
- Modify: `src/ship/Rover.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `GRADE_FREE = 0.18`, `GRADE_STALL = 0.62`, `CRAWL_FLOOR = 0.10`, `MAX_FWD = 22`
  - `driveSpeedAt(climb) -> number` — metres per second on a grade of `climb`, where `climb` is rise over run and only positive values cost anything.

- [ ] **Step 1: Create `src/ship/driveModel.js`**

```js
/* How ground resists a drive.
 *
 * This was four constants and a curve private to Rover, which was right while
 * the rover was the only thing that cared. Site placement cares now: it scores
 * the approach to a candidate position by asking how long the drive would take,
 * and a score that approximated this curve rather than using it would drift the
 * first time the curve was tuned — placing sites for a vehicle that no longer
 * exists.
 *
 * So it lives here, owned by neither. Sites reaching into the rover for
 * constants would be the wrong direction: where a place can go is a property of
 * the world and the vehicles that cross it, not of one vehicle.
 */

/* Grades. Below GRADE_FREE the drive does not care; by GRADE_STALL it has
   given up. Past about thirty degrees uphill a mountain becomes something you
   go around, which is the point — the route is the gameplay. */
export const GRADE_FREE = 0.18;       // ~10°
export const GRADE_STALL = 0.62;      // ~32°

/** The fraction of drive that survives the steepest ground. Never zero.
 *  "Go around is faster" and "you are stuck with no explanation" must not be
 *  the same experience, so the worst slope in the game can still be crawled. */
export const CRAWL_FLOOR = 0.10;

export const MAX_FWD = 22;            // m/s, about 80 km/h

/** smoothstep, in three's argument order, so this module needs no three. */
function smoothstep(x, a, b) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Metres per second the drive can hold on a given grade.
 *
 * Only climbing costs: a descent is free, which is both true and the thing that
 * makes reading the landscape worth doing. `climb` is therefore rise over run
 * with the sign already resolved by the caller — a route scorer passes
 * max(0, dy/dx), and the rover passes its grade times the sign of its throttle.
 *
 * @param {number} climb  rise over run, non-negative
 * @returns {number} m/s, never below MAX_FWD * CRAWL_FLOOR
 */
export function driveSpeedAt(climb) {
  const bite = 1 - smoothstep(Math.max(0, climb), GRADE_FREE, GRADE_STALL);
  return MAX_FWD * Math.max(CRAWL_FLOOR, bite);
}
```

- [ ] **Step 2: Have `Rover` import them**

In `src/ship/Rover.js`, delete the local `const GRADE_FREE`, `GRADE_STALL`, `CRAWL_FLOOR` and `MAX_FWD` declarations, keeping their comments by moving them into `driveModel.js` (Step 1 already carries them). Add to the imports at the top:

```js
import { GRADE_FREE, GRADE_STALL, CRAWL_FLOOR, MAX_FWD } from './driveModel.js';
```

Leave every use site unchanged — `bite`, `authority` and `capF` in `update` still compute exactly as they did. This task must not change a single number the rover produces.

- [ ] **Step 3: Prove the rover is unchanged**

```bash
npm run build && npm run preview
```

```bash
npm run expedition
```

Expected: 35/35 and EXPEDITION PASS, with `it drives to a site under its own power` reporting the **same** metres and seconds as before the change. If any driving number moved, the import is not equivalent to what it replaced — find the difference rather than accepting it.

- [ ] **Step 4: Commit**

```bash
git add src/ship/driveModel.js src/ship/Rover.js
git commit -m "Give the drive model one home, since two things need it now

The grade curve was private to Rover, which was right while the rover
was the only thing that cared how ground resists a drive. Site placement
cares now — it scores the approach to a candidate position by asking how
long the drive takes — and a score that approximated this curve instead
of using it would drift the first time the curve was tuned, placing
sites for a vehicle that no longer exists.

It belongs to neither of them. Sites reaching into src/ship for
constants would be the wrong direction: where a place can go is a
property of the world and the things that cross it, not of one vehicle.

No number moves here. The expedition suite's drive reports the same
metres and the same seconds, which is what says so."
```

---

### Task 3: `routeTime`, and the distribution that sets the threshold

**Files:**
- Modify: `src/world/Sites.js`
- Modify: `tools/sitecheck.mjs` — append stage 1

**Interfaces:**
- Consumes: `groundField` (Task 1); `driveSpeedAt` (Task 2).
- Produces:
  - `routeTime(field, x0, z0, x1, z1) -> number` (seconds), exported from `Sites.js` for the checker.

- [ ] **Step 1: Write `routeTime`**

Near the top of `src/world/Sites.js`, after the imports:

```js
import { groundField } from './Surface.js';
import { driveSpeedAt } from '../ship/driveModel.js';

/** How the route is sampled. 25 m steps at the rover's own grade LOD.
 *
 *  Both numbers exist to keep grit out of the answer. `heightAt` carries a fine
 *  band whatever the LOD, and over a short baseline that band is rubble rather
 *  than landform — the trap that made the rover itself crawl on flat ground
 *  until its grade baseline was lengthened, measured as 261 m of a 3.5 km run.
 *  A route scored at two metres would find a mountain in every gravel bed. */
const ROUTE_STEP = 25;
const ROUTE_LOD = 14;

/**
 * How long the drive from (x0, z0) to (x1, z1) would take, in seconds.
 *
 * The straight line, because that is the line a player instinctively takes and
 * the one that produced the complaint this exists to answer. Nothing here finds
 * a path or suggests one; it measures how much the ground would argue.
 *
 * Only climbing costs, exactly as the drive does — which is what makes a site
 * on the near side of a ridge score better than the same site on the far side.
 *
 * @param {{heightAt:(x:number,z:number,lod?:number)=>number}} field
 * @returns {number} seconds
 */
export function routeTime(field, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1) return 0;
  const n = Math.max(1, Math.round(len / ROUTE_STEP));
  const sx = dx / n, sz = dz / n, step = len / n;
  let t = 0;
  let h0 = field.heightAt(x0, z0, ROUTE_LOD);
  for (let i = 1; i <= n; i++) {
    const x = x0 + sx * i, z = z0 + sz * i;
    const h1 = field.heightAt(x, z, ROUTE_LOD);
    t += step / driveSpeedAt((h1 - h0) / step);
    h0 = h1;
  }
  return t;
}
```

- [ ] **Step 2: Append stage 1 to `tools/sitecheck.mjs`**

Insert before the final tally block:

```js
// ------------------------------- stage 1: what the ground actually demands
/* The distribution, before anything is changed. Two jobs: it is the "before"
   half of the before/after the spec asks for, and it is where the threshold in
   Task 4 comes from — the point where the tail begins, measured rather than
   guessed at. */
const dist = await page.evaluate(async () => {
  const g = window.__game;
  const surfMod = await import('/src/world/Surface.js');
  const sitesMod = await import('/src/world/Sites.js');
  const solid = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas);
  const rows = [];
  for (const body of solid) {
    const f = surfMod.groundField(body.spec);
    for (const s of g.sites.at(body)) {
      rows.push({
        body: body.name, kind: s.kind, range: s.range,
        secs: sitesMod.routeTime(f, 0, 0, s.x, s.z),
      });
    }
  }
  return { rows, worlds: solid.length };
});

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
  check('every site scores a finite, positive drive time', dist.rows.length > 0
    && dist.rows.every((r) => r.secs > 0 && Number.isFinite(r.secs)),
    `${dist.rows.length} sites`);
  /* Sanity on the units: nothing can beat flat out, and the crawl floor caps
     how bad it can get at MAX_FWD/(MAX_FWD*CRAWL_FLOOR) = 10x. */
  check('drive times sit between flat out and the crawl floor',
    rq(0) >= 0.99 && rq(1) <= 10.01, `${rq(0).toFixed(2)}x to ${rq(1).toFixed(2)}x`);
}
```

- [ ] **Step 3: Run it**

```bash
npm run sitecheck
```

Expected: stage 0's 6 checks plus 2 more, all ok, and a printed distribution.

**Write the printed numbers into your report.** Task 4's threshold comes from them: pick the ratio where the tail visibly begins — the p90 is the natural candidate — and say which number you chose and why.

- [ ] **Step 4: Commit**

```bash
git add src/world/Sites.js tools/sitecheck.mjs
git commit -m "Measure what the ground demands, before changing where sites go

routeTime walks the straight line at the scale of the hill — 25 m steps
at the rover's own grade LOD, because a route scored at two metres finds
a mountain in every gravel bed — and applies the drive model to each
step. Only climbing costs, exactly as the drive has it, which is what
makes a site on the near side of a ridge score better than the same site
on the far side.

Nothing here moves a site. This is the before half of before-and-after,
and it is where the threshold comes from: the point at which the tail
begins is a number to be read off a distribution rather than guessed at."
```

---

### Task 4: The lattice, and the determinism it must not break

**Files:**
- Modify: `src/world/Sites.js` — `place()` and the cached field
- Modify: `tools/sitecheck.mjs` — append stage 2

**Interfaces:**
- Consumes: `routeTime` (Task 3); `groundField` (Task 1).
- Produces: nothing further. `Sites.at()`'s returned shape is unchanged apart from `x`, `z`, `bearing` and `range` values.

- [ ] **Step 1: Append stage 2 to `tools/sitecheck.mjs`**

Insert before the final tally block:

```js
// --------------------------------- stage 2: it got gentler, and stayed itself
const after = await page.evaluate(async () => {
  const g = window.__game;
  const surfMod = await import('/src/world/Surface.js');
  const sitesMod = await import('/src/world/Sites.js');
  const solid = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas);
  const rows = [];
  const ids = [];
  let survivor = null;
  for (const body of solid) {
    const f = surfMod.groundField(body.spec);
    for (const s of g.sites.at(body)) {
      /* The rolled position is recoverable: it is the lattice's own centre, and
         place() records it so this comparison is possible at all. */
      rows.push({
        body: body.name, kind: s.kind, id: s.id,
        secs: sitesMod.routeTime(f, 0, 0, s.x, s.z),
        was: s._rolled ? sitesMod.routeTime(f, 0, 0, s._rolled.x, s._rolled.z) : null,
        moved: s._rolled ? Math.hypot(s.x - s._rolled.x, s.z - s._rolled.z) : 0,
        range: s.range, bearing: s.bearing,
        seamKeptBearing: s.kind !== 'seam' || (s.dep && s.bearing === s.dep.bearing),
      });
      ids.push(`${body.name}/${s.id}`);
    }
    if (g.sites.at(body).some((s) => s.kind === 'survivor')) survivor = body.name;
  }
  return { rows, ids, survivor };
});

{
  const paired = after.rows.filter((r) => r.was !== null);
  const improved = paired.filter((r) => r.secs < r.was - 0.5).length;
  const worsened = paired.filter((r) => r.secs > r.was + 0.5);
  const med = (xs) => { const s = xs.slice().sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const p90 = (xs) => { const s = xs.slice().sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length * 0.9)] : 0; };
  console.log(`\n  median  ${med(paired.map((r) => r.was)).toFixed(0)} s -> ${med(paired.map((r) => r.secs)).toFixed(0)} s`);
  console.log(`  p90     ${p90(paired.map((r) => r.was)).toFixed(0)} s -> ${p90(paired.map((r) => r.secs)).toFixed(0)} s`);
  console.log(`  moved   ${improved}/${paired.length} sites improved`);

  /* The claim is distributional. The lattice cannot help a site that was
     already on easy ground, so demanding every site improve would be wrong —
     but the tail is what this exists for, so the tail has to move. */
  check('the tail got gentler', p90(paired.map((r) => r.secs)) < p90(paired.map((r) => r.was)),
    `p90 ${p90(paired.map((r) => r.was)).toFixed(0)} s -> ${p90(paired.map((r) => r.secs)).toFixed(0)} s`);
  /* And nothing got worse: the rolled position is in the lattice, so picking
     the cheapest can never lose to it. A regression here is a scoring bug. */
  check('no site got worse than the position it was rolled at', worsened.length === 0,
    worsened.length ? `${worsened.length} worse, e.g. ${worsened[0].body} ${worsened[0].kind}` : 'none');
  check('seams kept their deposit bearing', after.rows.every((r) => r.seamKeptBearing));
  check('every site stayed inside the range band',
    after.rows.every((r) => r.range >= 700 && r.range <= 6200),
    `${Math.min(...after.rows.map((r) => r.range))}..${Math.max(...after.rows.map((r) => r.range))} m`);
}

/* Determinism: the same seed still produces the same sites, in the same order,
   with the same ids — and the survivor is still on the same world. This is what
   would break if a single extra rnd() found its way into place(). */
const stable = await page.evaluate(async () => {
  const g = window.__game;
  const solid = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas);
  const snap = () => solid.map((b) => g.sites.at(b).map((s) => `${s.id}@${s.x | 0},${s.z | 0}`).join('|')).join('#');
  const a = snap();
  for (const b of solid) { delete b._sites; delete b._wreckN; }
  const b2 = snap();
  return { same: a === b2 };
});
check('the same seed rebuilds the same sites in the same places', stable.same);
check('the survivor is still somewhere', !!after.survivor, after.survivor || 'nowhere');
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run sitecheck
```

Expected: the new checks fail — `s._rolled` does not exist yet, so `paired` is empty and `the tail got gentler` compares 0 to 0.

- [ ] **Step 3: Add the lattice to `place()`**

In `src/world/Sites.js`, replace the body of `place` with:

```js
    /* The lattice: bearing nudges and range factors, applied to the position
       the seed rolled. Both spans are deliberately small. A site that has
       wandered sixty degrees and two kilometres is not the seeded site with a
       gentler approach, it is a different site, and the layout stops meaning
       anything. This is here to step over a ridge, not to go looking for a
       plain.

       And they are a CONSTANT lattice, not more rolls. _wreckCountOf
       reproduces this function's draw sequence exactly — "Burn exactly the
       rolls at() burns" — so one extra rnd() here moves the survivor to a
       different world. Nothing below touches rnd(). */
    const BEARINGS = [0, -10, 10, -20, 20];
    const FACTORS = [1.0, 0.88, 1.12];
    /* Where the tail begins, measured in stage 1 of tools/sitecheck.mjs rather
       than chosen. Under this, the drive is an ordinary one and the rolled
       position is kept without scoring a single alternative — which is what
       keeps this affordable, because most sites were never the problem. */
    const ORDINARY = 1.55;      // multiples of a flat-out run

    const place = (kind, i) => {
      const bearing = Math.round(rnd() * 360);
      const range = Math.round(RANGE_MIN + rnd() * (RANGE_MAX - RANGE_MIN));
      const mk = (bear, rng) => {
        const a = bear * Math.PI / 180;
        return {
          kind, i, bearing: ((bear % 360) + 360) % 360, range: Math.round(rng),
          // Bearing 0 is +Z and turns toward +X, which is the sense the compass
          // and the surface frame already agree on.
          x: Math.sin(a) * rng,
          z: Math.cos(a) * rng,
          reach: REACH[kind],
        };
      };
      return mk(bearing, range);
    };

    /* Applied after the site is otherwise built, because a seam's bearing is
       not known until its deposit has been consulted. Returns the site it was
       given, moved or not. */
    const ease = (s) => {
      const f = this._fieldFor(body);
      if (!f) return s;
      const flat = s.range / MAX_FWD;
      const base = routeTime(f, 0, 0, s.x, s.z);
      s._rolled = { x: s.x, z: s.z, bearing: s.bearing, range: s.range };
      if (base <= flat * ORDINARY) return s;

      /* Only now, and only for the sites that need it. A seam may move its
         range but never its bearing: the deposit owns that and the survey text
         quotes it — see the note where seams are built. */
      const bears = s.kind === 'seam' ? [0] : BEARINGS;
      let bestT = base, bestB = s.bearing, bestR = s.range;
      for (const db of bears) {
        for (const fr of FACTORS) {
          const rng = s.range * fr;
          // Dropped rather than clamped: clamping piles candidates onto the
          // boundary, where the ground is no better and the site is now a lie
          // about how far out it was rolled.
          if (rng < RANGE_MIN || rng > RANGE_MAX) continue;
          const bear = s.bearing + db;
          const a = bear * Math.PI / 180;
          const t = routeTime(f, 0, 0, Math.sin(a) * rng, Math.cos(a) * rng);
          if (t < bestT) { bestT = t; bestB = bear; bestR = rng; }
        }
      }
      if (bestB === s.bearing && Math.round(bestR) === s.range) return s;
      const a = bestB * Math.PI / 180;
      s.bearing = ((Math.round(bestB) % 360) + 360) % 360;
      s.range = Math.round(bestR);
      s.x = Math.sin(a) * bestR;
      s.z = Math.cos(a) * bestR;
      return s;
    };
```

Add the import of `MAX_FWD` alongside `driveSpeedAt`:

```js
import { driveSpeedAt, MAX_FWD } from '../ship/driveModel.js';
```

Add the per-body field cache as a method on the class:

```js
  /** The height field for a world, built once and kept.
   *
   *  pickSite is a two-stage grid search, so this must not be rebuilt per site
   *  — four sites a world would pay for it four times. Hung off the body beside
   *  `_sites` and `_wreckN`, which are cached the same way and for the same
   *  reason. Returns null for anything with no spec, so callers can ignore the
   *  distinction between "no field" and "no sites". */
  _fieldFor(body) {
    if (!body || !body.spec) return null;
    if (!body._field) body._field = groundField(body.spec);
    return body._field;
  }
```

Then call `ease(s)` on each site immediately before it is pushed — after `s.bearing`, `s.x` and `s.z` have their final rolled values. For seams that is after the `dep.bearing` block; for the others, straight after `place(...)`.

- [ ] **Step 4: Run and verify**

```bash
npm run sitecheck
```

Expected: all checks ok. Read these two rather than the word `ok`:

- `the tail got gentler` — the p90 must actually fall. If it moves by a second or two, the lattice is too tight or `ORDINARY` is set too high to fire; widen the lattice (per the spec, widen the lattice rather than loosening the score) and say so in your report.
- `no site got worse` — must be zero. The rolled position is inside the lattice, so picking the cheapest can never lose to it. A single regression is a scoring bug, not noise.

- [ ] **Step 5: Commit**

```bash
git add src/world/Sites.js tools/sitecheck.mjs
git commit -m "Prefer the gentler approach, for the sites that needed one

Of several equally-seeded positions, the least punishing to drive to is
the one that gets used. Not a guarantee and not a difficulty cap: sites
are never rejected and the search never widens, so a world of mountains
stays a world of mountains and the rover can always crawl.

The rolled position is scored first and kept if the drive is an ordinary
one, which is most of them — the complaint was about a tail, not a
median, and scoring fifteen candidates for a site that was already fine
would cost fifteen times as much to change nothing.

Two constraints came from the code rather than from taste. Seams keep
their deposit's bearing or the survey text and the ground disagree. And
the candidates are a constant lattice rather than more rolls, because
_wreckCountOf reproduces this function's draw sequence exactly and one
extra rnd() here would move the survivor to another world."
```

---

### Task 5: It is reachable in the game, and the handoff says so

**Files:**
- Modify: `tools/expedition.mjs`
- Modify: `HANDOFF.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Add the assertion to `tools/expedition.mjs`**

After the existing rover checks, add:

```js
// ------------------------------------------------- markers are drivable to
/* The distribution moving is not the claim a player cares about. This is: pick
   the marker on a landed world and drive at it, and require arrival inside a
   budget generous enough to allow a real hill and tight enough to catch the
   ten-minute switchback the placement exists to prevent. */
const reach = await page.evaluate(async () => {
  const g = window.__game;
  const body = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas)
    .find((b) => g.sites.at(b).some((s) => s.kind === 'marker'));
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
  let steps = 0;
  const CAP = 240 * 30;                    // four simulated minutes
  while (steps < CAP) {
    // steer at it each step, as a player aiming for a marker does
    R.yaw = Math.atan2(-(m.x - R.pos.x), -(m.z - R.pos.z));
    R.update(DT, input, false);
    steps++;
    if (Math.hypot(R.pos.x - m.x, R.pos.z - m.z) <= m.reach) break;
  }
  const dist = Math.hypot(R.pos.x - m.x, R.pos.z - m.z);
  return {
    body: body.name, range: m.range, dist: Math.round(dist),
    seconds: Math.round(steps / 30), arrived: dist <= m.reach,
    charge: +R.charge.toFixed(2),
  };
});

check('a Hush marker is drivable to in a reasonable time', !reach.skipped && reach.arrived,
  reach.skipped || `${reach.range} m in ${reach.seconds} s, ${Math.round(reach.charge * 100)}% pack left`);
```

- [ ] **Step 2: Run it**

```bash
npm run build && npm run preview
```

```bash
npm run expedition
```

Expected: the new check passes. Record the seconds it reports — if it is close to the 240 s cap, say so, because that is the tail this whole plan exists to shorten and it means the lattice needs widening rather than the cap raising.

- [ ] **Step 3: Run everything**

```bash
npm run verify
```

```bash
npm run sitecheck
```

```bash
npm run treecheck
```

Expected: all eight suites pass, sitecheck's full set passes, treecheck still 35/35. `treecheck` matters here because Task 1 rewrote how `Surface` derives its landing site, and every tree position is measured from it.

- [ ] **Step 4: Update `HANDOFF.md`**

Move the "Sites are placed without checking the route" item out of the open list and into "Closed since", recording what was built, what proves it, and what it deliberately does not do — it is not a guarantee, sites are never rejected, and a world of mountains is still a world of mountains. Renumber the remaining open items.

- [ ] **Step 5: Commit**

```bash
git add tools/expedition.mjs HANDOFF.md
git commit -m "Close the route-placement item, with a drive that proves it

A distribution moving is not the claim a player cares about, so the
acceptance suite drives at a marker and requires arrival inside a budget
loose enough for a real hill and tight enough to catch the ten-minute
switchback this was written to prevent."
```

---

## Self-Review

**Spec coverage.** §1 (extract the field, Surface consumes it) → Task 1. §2 (route score, shared drive model) → Tasks 2 and 3. §3 (lattice, seams, range band, derived not rolled) → Task 4, with the score-once-then-search gate. §4's three proofs → Task 1 (field agreement), Tasks 3 and 4 (before/after distribution), Task 5 (end-to-end), plus the determinism assertions in Task 4. §5 (cost) → Task 1, Step 8, with a hard number and a stop instruction.

**Known gaps, stated rather than hidden:**

- **`ORDINARY = 1.55` is a placeholder until Task 3 measures.** Task 3 Step 3 requires the implementer to read the distribution and choose it, and Task 4 must use the number they chose, not the one written here. If the measured p90 differs materially, the constant changes and the comment beside it must say what it was measured from.
- **`s._rolled` is retained on every site** so stage 2 can compare against the position the seed produced. It is a few bytes per site and it makes the central claim checkable, which is worth more than the tidiness — but it is diagnostic data on a gameplay object, and a reviewer may reasonably want it gated or dropped once the distribution is trusted.
- **Nothing re-scores after the pad.** `pickSite` moves the landing site, and `groundYFlat` scours a pad around the origin; routes start at (0,0) inside that pad. Over a 700 m minimum range that is under 6% of the route and it is the same for every candidate, so it cannot change which candidate wins.
