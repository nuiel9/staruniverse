import { mulberry32 } from './generate.js';

/* ============================================================================
   Prospecting: what a world is worth, and the work of getting it out.

   The chain is three steps, and each one is a different verb in a different
   place, which is the point — a resource loop that happens entirely inside one
   menu is a spreadsheet:

     **Scan from orbit** and the world's deposits appear in the survey. Until
     then a planet is a colour; afterwards it is a manifest with tonnages on
     it. This is what finally pays for the scanner you have been carrying since
     the first minute of the game.

     **Land near one** — the deposit closest to your set-down point is the one
     you can work, so where you choose to put the ship down matters.

     **Run the drone**, which takes time you have to stand there for, and comes
     up with ore by the tonne until the seam is spent. Deposits deplete and do
     not come back, so a rich world is a place you return to until it is not.

   What is down there falls out of the planet's type: iron worlds carry metal,
   ice carries volatiles, lava carries the heavy elements that make alloys, and
   only a very few worlds carry lucent — which is the fuel, and the reason
   anyone flies out this far. All of it is seeded, so a world is the same world
   every time you come back to it, and two players with the same seed can
   compare notes.
   ========================================================================== */

/** What each kind of world can hold, and how likely it is to hold it.
 *  Weights are relative within a type; the yield multiplier scales tonnage. */
const BY_TYPE = {
  iron:   [['ore', 5, 1.5], ['alloys', 2, 0.7], ['machinery', 1, 0.3]],
  barren: [['ore', 4, 1.0], ['volatiles', 2, 0.8], ['lucent', 1, 0.5]],
  lava:   [['alloys', 4, 1.1], ['ore', 3, 1.0], ['lucent', 2, 0.6]],
  ice:    [['volatiles', 5, 1.6], ['fuel', 2, 0.8], ['lucent', 1, 0.4]],
  desert: [['ore', 3, 0.9], ['alloys', 2, 0.7], ['luxuries', 1, 0.25]],
  terran: [['food', 3, 1.0], ['medicine', 2, 0.5], ['volatiles', 2, 0.8]],
  ocean:  [['volatiles', 4, 1.3], ['food', 3, 1.0], ['medicine', 1, 0.4]],
  toxic:  [['medicine', 3, 0.6], ['volatiles', 2, 0.9], ['lucent', 2, 0.7]],
};

/** Worlds with nothing worth the fuel to reach them still get an entry, so
 *  "scanned and empty" is a real answer rather than a missing one. */
const DEFAULT_TABLE = [['ore', 2, 0.6], ['volatiles', 1, 0.5]];

const SAVE_KEY = 'star-universe.ground.v1';

export class Prospecting {
  constructor(game) {
    this.game = game;
    this.worked = {};      // 'systemId:bodyId:i' -> tonnes already taken
    this.load();
  }

  /** The deposits a world holds. Deterministic in its seed; the same list
   *  every time, whether or not anyone has looked. */
  deposits(body) {
    if (!body || !body.spec || body.planet?.isGas) return [];
    if (body._deposits) return body._deposits;
    const spec = body.spec;
    /* `spec.seed` is a float in 0..100, so XOR-ing it straight into the
       generator truncates a world down to one of a hundred values and
       neighbouring planets come out holding identical seams. Hash the body's
       identity in alongside the fractional part. */
    const h = [...(body.id || spec.name || 'x')]
      .reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 2166136261);
    const rnd = mulberry32((h ^ Math.floor((spec.seed ?? 0) * 1e6)) >>> 0);
    const table = BY_TYPE[spec.type] || DEFAULT_TABLE;
    const total = table.reduce((s, t) => s + t[1], 0);

    const n = 1 + Math.floor(rnd() * 3);             // one to three seams
    const out = [];
    for (let i = 0; i < n; i++) {
      let roll = rnd() * total;
      let pick = table[0];
      for (const t of table) { roll -= t[1]; if (roll <= 0) { pick = t; break; } }
      const [id, , mult] = pick;
      // Richness in tonnes. Small enough that a hold is several trips.
      const tonnes = Math.round((6 + rnd() * 22) * mult);
      if (tonnes < 1) continue;
      out.push({
        i, id, tonnes,
        // Where on the surface, in the same bearing/range the landing site
        // uses. Purely for the survey text — the drone works whatever is
        // under the ship — but it makes a manifest read like a place.
        bearing: Math.round(rnd() * 360),
        grade: tonnes > 24 ? 'rich' : tonnes > 12 ? 'workable' : 'thin',
      });
    }
    body._deposits = out;
    return out;
  }

  key(body, dep) {
    return `${this.game.currentSystemId}:${body.id}:${dep.i}`;
  }

  /** What is left in a seam after everything anyone has taken out of it. */
  remaining(body, dep) {
    return Math.max(0, dep.tonnes - (this.worked[this.key(body, dep)] || 0));
  }

  /** The seam the drone would work where the ship is standing: the richest
   *  one still holding anything. */
  workable(body) {
    if (!body) return null;
    let best = null;
    for (const d of this.deposits(body)) {
      const left = this.remaining(body, d);
      if (left > 0 && (!best || left > this.remaining(body, best))) best = d;
    }
    return best;
  }

  /**
   * Take one tonne. Returns the commodity id on success, null if the seam is
   * spent, the hold is full, or there is nothing under the ship.
   */
  extract(body, dep) {
    const d = dep || this.workable(body);
    if (!d) return null;
    const eco = this.game.economy;
    if (eco.cargoUsed() >= eco.cargoCap) return null;
    if (this.remaining(body, d) <= 0) return null;
    const k = this.key(body, d);
    this.worked[k] = (this.worked[k] || 0) + 1;
    if (d.id === 'lucent') {
      // Lucent goes to the tank, not the hold: it is not cargo, it is range.
      this.game.ship.fuel = Math.min(this.game.ship.fuelCap, this.game.ship.fuel + 1);
    } else {
      eco.cargo[d.id] = (eco.cargo[d.id] || 0) + 1;
      eco.save();
    }
    this.save();
    return d.id;
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ worked: this.worked })); }
    catch { /* ephemeral run */ }
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.worked && typeof s.worked === 'object') this.worked = s.worked;
    } catch { /* a corrupt save is just a new game */ }
  }
}
