import { mulberry32 } from './generate.js';
import { LOGS, OWN_LOG } from '../game/lore.js';
import { groundField } from './Surface.js';
import { driveSpeedAt, MAX_FWD } from '../ship/driveModel.js';

/** How the route is sampled. 25 m steps at the rover's own grade LOD.
 *
 *  Both numbers exist to keep grit out of the answer. `heightAt` carries a fine
 *  band whatever the LOD, and over a short baseline that band is rubble rather
 *  than landform — the trap that made the rover itself crawl on flat ground
 *  until its grade baseline was lengthened, measured as 261 m of a 3.5 km run.
 *  A route scored at two metres would find a mountain in every gravel bed. */
export const ROUTE_STEP = 25;
const ROUTE_LOD = 14;

/* What counts as ground the drive has given up on.
 *
 * A quarter of full speed. Working back through the curve, a bite of 0.25 is a
 * climb of about 0.48 — some twenty-five degrees — which is a face you steer
 * around rather than up. Below this the vehicle is visibly crawling, and a
 * player watching it crawl is the entire reason this feature exists: the report
 * that started it said the rover had stopped, and it had not, it was doing
 * 2.2 m/s up a forty-eight degree slope.
 *
 * Note this is a speed and not a grade, so it follows the drive model wherever
 * that goes rather than having to be re-derived if the curve is retuned. */
const WALL_SPEED = MAX_FWD * 0.25;

/**
 * What the drive from (x0, z0) to (x1, z1) costs, two ways.
 *
 * `secs` is the whole trip. `wall` is the longest **continuous** stretch, in
 * metres, that the drive has effectively given up on — and that second number
 * is the one placement ranks on, because it is the one a player experiences.
 * Total time dilutes a wall: five hundred metres of forty-eight degree face
 * inside an otherwise flat five kilometres comes out at 1.9x a flat-out run,
 * which is unremarkable, while the five hundred metres in the middle of it is
 * the thing that gets reported as a broken vehicle. Measured over 35 sites
 * before this was written; see tools/sitecheck.mjs.
 *
 * Contiguous rather than total, because two separate fifty-metre pinches are a
 * drive with some character in it and one four-hundred-metre pinch is a wall.
 *
 * The straight line, because that is the line a player instinctively takes and
 * the one that produced the complaint. Nothing here finds a path or suggests
 * one; it measures how much the ground would argue.
 *
 * Only climbing costs, exactly as the drive does — which is what makes a site
 * on the near side of a ridge score better than the same site on the far side.
 *
 * @param {{heightAt:(x:number,z:number,lod?:number)=>number}} field
 * @returns {{secs:number, wall:number}} seconds, and metres of the worst stretch
 */
export function routeCost(field, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1) return { secs: 0, wall: 0 };
  const n = Math.max(1, Math.round(len / ROUTE_STEP));
  const sx = dx / n, sz = dz / n, step = len / n;
  let secs = 0, wall = 0, run = 0;
  let h0 = field.heightAt(x0, z0, ROUTE_LOD);
  for (let i = 1; i <= n; i++) {
    const x = x0 + sx * i, z = z0 + sz * i;
    const h1 = field.heightAt(x, z, ROUTE_LOD);
    const v = driveSpeedAt((h1 - h0) / step);
    secs += step / v;
    if (v <= WALL_SPEED) { run += step; if (run > wall) wall = run; } else run = 0;
    h0 = h1;
  }
  return { secs, wall };
}

/* ============================================================================
   Sites: things that are somewhere.

   Until now the ground was scenery. Seven thousand lines of height field,
   erosion, scatter and sky — and nothing existed at any coordinate on it. You
   set the ship down, held F wherever you happened to be, and tonnes came up.
   `Prospecting` even admitted it: every deposit carried a `bearing`, and the
   comment beside it said the drone works whatever is under the ship. The
   bearing was decoration.

   A place is a coordinate you have to *travel to*. That is the whole idea
   here, and it is why the rover exists: on foot you move at 1.75 m/s, so
   nothing can be put further than a hundred metres away without being cruel.
   By rover, six kilometres is a couple of minutes and a decision about
   charge — which is the difference between terrain you look at and terrain
   you cross.

   Four things are out there:

     **Seams** are the deposits that already existed, moved to the bearing
     they always claimed to have. Mining is unchanged; getting to it is not.

     **Wrecks** are the expedition ships that did not come back. The lore has
     said since the first commit that eleven hundred vessels entered the
     Stillness in two centuries and ninety-four returned; this is where the
     other thousand went. Each one carries a log, which is what finally feeds
     the archive from the ground instead of from orbital scans alone.

     **Markers** are Hush. They read as evidence, and they are the only
     evidence in the game that cannot be obtained without landing.

     **The survivor** is one person, once, in an entire galaxy. Not a
     recording — somebody still alive out here, who has been alone with the
     question longer than you have.

   Everything is seeded, in the local frame of the landing site: the ship
   touches down at the origin and a site's bearing and range are measured from
   it. That keeps this module free of planetary geodesy — a site is somewhere
   you can drive to from where you parked, which is the only sense in which
   the player experiences it.
   ========================================================================== */

const SAVE_KEY = 'star-universe.sites.v1';

/** How close counts as being there, in metres. Seams are generous because you
 *  are hunting a seam rather than a doorway; the rest want you to arrive. */
const REACH = { seam: 70, wreck: 55, marker: 45, survivor: 55 };

/** Near enough to matter, far enough that walking is not an answer. */
const RANGE_MIN = 700;
const RANGE_MAX = 6200;

const WRECK_NAMES = ['CASTELLAN', 'MERIDIAN', 'FALLOW', 'ARGENT', 'TIDE OF ASH',
  'PATIENT', 'NINE SISTERS', 'COLD HARBOUR', 'REDOUBT', 'LAST WORD'];

const SURVIVOR_NAMES = ['Yusra Adeyemi-Vane', 'Toma Lindqvist', 'Ekaterin Osei',
  'Halvard Nakamura', 'Ines Achebe'];

/** Worlds where the Hush actually settled carry more of their work. */
const MARKER_BIAS = { terran: 2, ocean: 2, desert: 1, barren: 1, ice: 1 };

export class Sites {
  constructor(game) {
    this.game = game;
    this.done = {};                  // site key -> true, for one-shot finds
    this.load();
  }

  /* ------------------------------------------------------------- the list */

  /**
   * Everything on this world, in the landing frame. Deterministic in the
   * body's identity, so a world is the same world every time you come back
   * and two players on one seed can compare notes.
   */
  at(body) {
    if (!body || !body.spec || body.planet?.isGas) return [];
    if (body._sites) return body._sites;

    /* The same identity hash `Prospecting` uses, and for the same reason:
       `spec.seed` is a float in 0..100, so XOR-ing it straight in truncates a
       world to one of a hundred values and neighbours come out identical. */
    const h = [...(body.id || body.spec.name || 'x')]
      .reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 2166136261);
    const rnd = mulberry32((h ^ Math.floor((body.spec.seed ?? 0) * 1e6) ^ 0x51735) >>> 0);
    const out = [];

    const place = (kind, i) => {
      const bearing = Math.round(rnd() * 360);
      const range = Math.round(RANGE_MIN + rnd() * (RANGE_MAX - RANGE_MIN));
      const a = bearing * Math.PI / 180;
      return {
        kind, i, bearing, range,
        // Bearing 0 is +Z and turns toward +X, which is the sense the compass
        // and the surface frame already agree on.
        x: Math.sin(a) * range,
        z: Math.cos(a) * range,
        reach: REACH[kind],
      };
    };

    /* The lattice: bearing nudges and range factors applied to the position the
       seed rolled. Both spans are deliberately small. A site that has wandered
       sixty degrees and two kilometres is not the seeded site with a gentler
       approach, it is a different site, and the layout stops meaning anything.
       This is here to step over a ridge, not to go looking for a plain.

       And they are a CONSTANT lattice, not more rolls. _wreckCountOf
       reproduces this function's draw sequence exactly — "Burn exactly the
       rolls at() burns" — so one extra rnd() here moves the survivor to a
       different world. Nothing below touches rnd(). */
    const BEARINGS = [0, -10, 10, -20, 20];
    const FACTORS = [1.0, 0.88, 1.12];

    /* Metres of continuous crawling above which a site is worth moving.
       MEASURED, not chosen: 75 m is the middle of the only empty band in the
       distribution the checker printed before any of this moved anything. Of
       35 sites over 12 worlds, 13 had no stretch below a quarter speed at all
       and five more had exactly one 25 m sample of it — a single step of a
       hundred-and-something-step route, which is grit rather than a wall. Then
       nothing until 100 m, after which seventeen sites run in an unbroken ramp
       up to 276 m with no gap anywhere in it wider than 50 m.

       So the distribution has one real seam in it and it is at 25..100, and
       every trigger in that band selects the same seventeen sites. 75 sits in
       the middle of the band, which is the most robust place to stand: route
       samples are len/n rather than exactly 25 m, so the blips land at 24.88 to
       24.99 and the tail starts at 100.14, and a trigger at either edge would
       be decided by float jitter. A percentile would have been the worse
       reading here — p75 lands at 149.7, inside a cluster of five sites within
       half a metre of each other, and would split them arbitrarily. */
    const WALL_TRIGGER = 75;

    /* Half a route step. `wall` can only ever be a multiple of the sampling
       step, so a difference smaller than half of one is not a shorter wall, it
       is float noise in where the samples happened to land — and chasing it
       moved a seam six hundred metres further out to shave twenty-six
       millimetres. Inside the band the drive time decides, which is what the
       tie-break was always for. It also matters for determinism across
       engines: the comparison runs through Math.sin and the drive curve, and a
       sub-ulp difference in either must not be able to relocate a site. */
    const WALL_EPS = ROUTE_STEP / 2;

    /* Applied after a site is otherwise built, because a seam's bearing is not
       known until its deposit has been consulted. Returns the site it was
       given, moved or not. */
    const ease = (s) => {
      const f = this._fieldFor(body);
      if (!f) return s;
      const base = routeCost(f, 0, 0, s.x, s.z);
      s._rolled = { x: s.x, z: s.z, bearing: s.bearing, range: s.range };
      /* Scored once, and searched only when the rolled position has a wall in
         it. Half the sites measured never did — the complaint was about a tail,
         not a median — and scoring fifteen candidates for a site that was
         already fine would cost fifteen times as much to change nothing. */
      if (base.wall <= WALL_TRIGGER) return s;

      /* A seam may move its range but never its bearing: the deposit owns that
         and the survey text quotes it — see the note where seams are built. */
      const bears = s.kind === 'seam' ? [0] : BEARINGS;
      let bestW = base.wall, bestS = base.secs, bestB = s.bearing, bestR = s.range;
      for (const db of bears) {
        for (const fr of FACTORS) {
          const rng = s.range * fr;
          /* Dropped rather than clamped: clamping piles candidates onto the
             boundary, where the ground is no better and the site is now a lie
             about how far out it was rolled. */
          if (rng < RANGE_MIN || rng > RANGE_MAX) continue;
          const bear = s.bearing + db;
          const a = bear * Math.PI / 180;
          const c = routeCost(f, 0, 0, Math.sin(a) * rng, Math.cos(a) * rng);
          /* Ranked on the wall, with time as the tie-break. Two candidates that
             both clear the ridge should differ on how long the drive is, but a
             shorter drive through a longer wall is the wrong answer — the wall
             is what gets reported as a broken vehicle. */
          if (c.wall < bestW - WALL_EPS
              || (Math.abs(c.wall - bestW) <= WALL_EPS && c.secs < bestS)) {
            bestW = c.wall; bestS = c.secs; bestB = bear; bestR = rng;
          }
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

    // ---- seams: the deposits, finally put where they always said they were
    const deps = this.game.prospect ? this.game.prospect.deposits(body) : [];
    deps.forEach((dep, i) => {
      const s = place('seam', i);
      // The deposit owns its own bearing already. Honour it rather than
      // rolling a second one, or the survey text and the ground disagree.
      const a = dep.bearing * Math.PI / 180;
      s.bearing = dep.bearing;
      s.x = Math.sin(a) * s.range;
      s.z = Math.cos(a) * s.range;
      s.dep = dep;
      s.name = dep.id.toUpperCase();
      s.id = `seam:${i}`;
      out.push(ease(s));
    });

    // ---- wrecks of the ninety-four
    const nWreck = rnd() < 0.42 ? 1 + (rnd() < 0.22 ? 1 : 0) : 0;
    for (let i = 0; i < nWreck; i++) {
      const s = place('wreck', i);
      s.name = WRECK_NAMES[Math.floor(rnd() * WRECK_NAMES.length)];
      /* Anything but the player's own commission. A wreck handing you your
         orders back and calling it a recovered log is not a discovery, and
         the suite caught exactly that on the first world it tried. */
      const pool = LOGS.filter((l) => l.id !== OWN_LOG);
      s.logId = pool[Math.floor(rnd() * pool.length)].id;
      // Something in the hold nobody came back for. Small — this is a grave,
      // not a payday, and pricing it like a payday would cheapen it.
      s.salvage = { id: ['machinery', 'medicine', 'alloys'][Math.floor(rnd() * 3)],
        tonnes: 1 + Math.floor(rnd() * 3) };
      s.id = `wreck:${i}`;
      out.push(ease(s));
    }

    // ---- Hush markers
    const bias = MARKER_BIAS[body.spec.type] || 0;
    const nMark = bias && rnd() < 0.30 + 0.14 * bias ? 1 + (rnd() < 0.25 ? 1 : 0) : 0;
    for (let i = 0; i < nMark; i++) {
      const s = place('marker', i);
      s.name = `MARKER ${String.fromCharCode(65 + i)}`;
      s.id = `marker:${i}`;
      out.push(ease(s));
    }

    // ---- and, once in a galaxy, somebody still alive
    if (nWreck > 0 && this._isSurvivorHost(body)) {
      const s = place('survivor', 0);
      s.name = SURVIVOR_NAMES[Math.floor(rnd() * SURVIVOR_NAMES.length)];
      s.id = 'survivor:0';
      out.push(ease(s));
    }

    body._sites = out;
    return out;
  }

  /**
   * Exactly one survivor exists, and the galaxy seed decides which system
   * holds them. Within that system it is the first world carrying a wreck —
   * which is checkable locally, because bodies are built on arrival, and
   * avoids this module needing to know anything about systems it has not
   * visited yet.
   */
  _isSurvivorHost(body) {
    const g = this.game;
    if (this._sysPick === undefined) {
      const rnd = mulberry32(((g.galaxySeed ?? 1) ^ 0x5a1e) >>> 0);
      // Never the home system: the point is that they are a long way out.
      this._sysPick = 1 + Math.floor(rnd() * Math.max(1, (g.galaxy?.length || 2) - 1));
    }
    if (g.currentSystemId !== this._sysPick) return false;
    const solid = g.bodies.filter((b) => b.spec && !b.planet?.isGas
      && (b.kind === 'planet' || b.kind === 'moon'));
    for (const b of solid) {
      // Counted without building the site list, so this cannot recurse back
      // into `at()`. The first solid world carrying a wreck wins.
      if (this._wreckCountOf(b) > 0) return b.id === body.id;
    }
    return false;
  }

  /** Wreck count without building the whole site list, to break the cycle
   *  between `at()` and the survivor test. Same rolls, same order. */
  _wreckCountOf(body) {
    if (body._wreckN !== undefined) return body._wreckN;
    const h = [...(body.id || body.spec.name || 'x')]
      .reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 2166136261);
    const rnd = mulberry32((h ^ Math.floor((body.spec.seed ?? 0) * 1e6) ^ 0x51735) >>> 0);
    const deps = this.game.prospect ? this.game.prospect.deposits(body) : [];
    // Burn exactly the rolls `at()` burns before it gets to the wreck count.
    for (let i = 0; i < deps.length; i++) { rnd(); rnd(); }
    const n = rnd() < 0.42 ? 1 + (rnd() < 0.22 ? 1 : 0) : 0;
    body._wreckN = n;
    return n;
  }

  /** The height field for a world, built once and kept.
   *
   *  pickSite is a two-stage grid search — measured at about 8 ms — so this must
   *  not be rebuilt per site, or four sites a world would pay for it four times.
   *  Hung off the body beside `_sites` and `_wreckN`, which are cached the same
   *  way and for the same reason. Returns null for anything with no spec, so
   *  callers can ignore the difference between "no field" and "no sites". */
  _fieldFor(body) {
    if (!body || !body.spec) return null;
    if (!body._field) body._field = groundField(body.spec);
    return body._field;
  }

  /* --------------------------------------------------------- interactions */

  key(body, site) {
    return `${this.game.currentSystemId}:${body.id}:${site.id}`;
  }

  isDone(body, site) { return !!this.done[this.key(body, site)]; }

  /** The site you are standing in, if any. */
  nearest(body, x, z) {
    let best = null, bd = Infinity;
    for (const s of this.at(body)) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d <= s.reach && d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** Distance and bearing to every site, for the survey readout. */
  manifest(body, x = 0, z = 0) {
    return this.at(body).map((s) => ({
      ...s,
      dist: Math.hypot(s.x - x, s.z - z),
      done: this.isDone(body, s),
    })).sort((a, b) => a.dist - b.dist);
  }

  /**
   * Work the site you are in. Seams are the drone's job and are handled by
   * `Prospecting` as before; everything else here is a one-shot find.
   * Returns a result object the caller narrates, or null.
   */
  visit(body, site) {
    if (!site || site.kind === 'seam') return null;
    if (this.isDone(body, site)) return { kind: site.kind, already: true, site };
    const g = this.game;
    this.done[this.key(body, site)] = true;

    if (site.kind === 'wreck') {
      const had = g.logsFound.has(site.logId);
      g.logsFound.add(site.logId);
      const eco = g.economy;
      const room = eco.cargoCap - eco.cargoUsed();
      const took = Math.max(0, Math.min(site.salvage.tonnes, room));
      if (took > 0) {
        eco.cargo[site.salvage.id] = (eco.cargo[site.salvage.id] || 0) + took;
        eco.save();
      }
      this.save();
      g.codex?.markDirty();
      return { kind: 'wreck', site, logId: site.logId, newLog: !had,
        salvaged: took, salvageId: site.salvage.id };
    }

    if (site.kind === 'marker') {
      this.save();
      g.mystery?.update();
      g.codex?.markDirty();
      return { kind: 'marker', site, surveyed: this.markersSurveyed() };
    }

    if (site.kind === 'survivor') {
      /* They corroborate the Drift, which is the one account that happens to
         be true — but they are a second *source*, not a second claim, so this
         does not hand the player the answer. It makes the true one the only
         account anybody else backs, which is a thing you have to notice. */
      g.rumors?.hear({
        kind: 'origin', claim: 'listening', source: site.name.toUpperCase(),
        text: 'They are not dead. I have been listening to them for nineteen years.',
      });
      this.save();
      g.mystery?.update();
      g.codex?.markDirty();
      return { kind: 'survivor', site };
    }
    return null;
  }

  /** Hush markers surveyed anywhere, which is what the sixth reading counts. */
  markersSurveyed() {
    let n = 0;
    for (const k in this.done) if (k.includes(':marker:')) n++;
    return n;
  }

  /** Expedition logs pulled off the ground rather than out of orbit. */
  wrecksOpened() {
    let n = 0;
    for (const k in this.done) if (k.includes(':wreck:')) n++;
    return n;
  }

  metSurvivor() {
    for (const k in this.done) if (k.includes(':survivor:')) return true;
    return false;
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ done: this.done })); }
    catch { /* ephemeral run */ }
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.done && typeof s.done === 'object') this.done = s.done;
    } catch { /* a corrupt save is just a new game */ }
  }
}
