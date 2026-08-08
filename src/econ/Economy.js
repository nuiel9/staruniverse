import { mulberry32 } from '../world/generate.js';

/* ============================================================================
   The economy.

   Eight commodities, priced per station. A station is either a *producer* of
   a good (cheap, deep stock), a *consumer* (dear, wants everything you have),
   or neither (fair price, thin stock). Which is which falls out of the system
   seed — but not independently per station: the roles are dealt around a
   single shuffled deck so that what one station makes, a neighbour wants.
   That guarantee is the whole game at this stage. Random independent prices
   would leave some systems with no profitable run at all, and a trading game
   where trading might not work is not a trading game.

   Prices are alive now: each good at each station drifts on two slow seeded
   sines, so a price is a function of *when you ask*. That matters because
   nothing here moves information faster than a hull — what a dock's board
   shows about other stations is the price as of when a freighter last left
   there, computed by evaluating the same price function at (now − travel
   time). Old news is the trader's edge: outrun it and the margin is yours.
   ========================================================================== */

export const COMMODITIES = [
  { id: 'volatiles', name: 'Volatiles', base: 12, unit: 't', desc: 'Water ice, ammonia and frozen gases, scooped and bagged.' },
  { id: 'ore', name: 'Raw Ore', base: 24, unit: 't', desc: 'Unrefined metals straight off the belt crushers.' },
  { id: 'alloys', name: 'Alloys', base: 58, unit: 't', desc: 'Refined structural stock. Every yard is hungry for it.' },
  { id: 'fuel', name: 'Fuel Cells', base: 42, unit: 'u', desc: 'Sealed reaction mass. Stations burn it; so do you.' },
  { id: 'food', name: 'Provisions', base: 18, unit: 't', desc: 'Grown under lamps, vacuum-packed, nearly edible.' },
  { id: 'medicine', name: 'Medicine', base: 90, unit: 'u', desc: 'Cold-chain pharmaceuticals. Light, dear, always wanted.' },
  { id: 'machinery', name: 'Machinery', base: 130, unit: 'u', desc: 'Pumps, printers, drive parts. Civilisation in crates.' },
  { id: 'luxuries', name: 'Luxuries', base: 210, unit: 'u', desc: 'Whatever is rare where you are going.' },
];

const BY_ID = new Map(COMMODITIES.map((c) => [c.id, c]));
export const commodity = (id) => BY_ID.get(id);

/** Producer/consumer price multipliers. The gap between them, across two
 *  stations, is the margin the player lives on. */
const PRODUCE_MULT = 0.55;
const DEMAND_MULT = 1.65;

const SAVE_KEY = 'star-universe.v1';

/** How fast news rides the lanes, in light-years per second of game time.
 *  Twenty light-years of lane ≈ seventeen minutes stale. */
export const NEWS_LY_PER_SEC = 0.02;

/** Price drift: two incommensurate sines per good per station, ±26% at the
 *  worst alignment. Deterministic in t, so the past is recomputable — which
 *  is the whole trick behind dated traffic reports. */
function drift(phaseSeed, t) {
  const rnd = mulberry32(phaseSeed >>> 0);
  const p1 = rnd() * Math.PI * 2, p2 = rnd() * Math.PI * 2;
  return 1 + 0.16 * Math.sin(t / 210 + p1) + 0.10 * Math.sin(t / 47 + p2);
}

/**
 * Deal the commodity deck around a system's stations.
 * Station `idx` produces deck[2i..2i+1] and demands deck[2i+2..2i+3] (mod 8),
 * so each station's demands are exactly the next station's produce. With the
 * usual two stations that means one *strong* run (buy B's produce at 0.55×,
 * sell into A's demand at 1.65×) and one decent one back (A's produce into
 * B's neutral price) — profitable both ways, by construction, in every
 * inhabited system.
 */
export function buildMarket(systemSeed, idx) {
  const rnd = mulberry32((systemSeed ^ 0x9e3779b9) >>> 0);
  const deck = COMMODITIES.map((c) => c.id);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const at = (k) => deck[((k % deck.length) + deck.length) % deck.length];
  const produces = new Set([at(idx * 2), at(idx * 2 + 1)]);
  const demands = new Set([at(idx * 2 + 2), at(idx * 2 + 3)]);

  // Per-station jitter so two producers of the same good still disagree a
  // little. Seeded off the station's own slot in the system.
  const jrnd = mulberry32((systemSeed + idx * 977) >>> 0);
  const goods = COMMODITIES.map((c, gi) => {
    const role = produces.has(c.id) ? 'produces' : demands.has(c.id) ? 'demands' : null;
    const mult = role === 'produces' ? PRODUCE_MULT : role === 'demands' ? DEMAND_MULT : 1;
    const jitter = 0.88 + jrnd() * 0.24;
    const stock = role === 'produces' ? 40 + Math.floor(jrnd() * 40)
      : role === 'demands' ? Math.floor(jrnd() * 4)
        : 4 + Math.floor(jrnd() * 10);
    return {
      id: c.id,
      // The dealt price — what this station charges when its drift is flat.
      price: Math.max(1, Math.round(c.base * mult * jitter)),
      phase: (systemSeed * 31 + idx * 7919 + gi * 104729) >>> 0,
      stock,
      role,
    };
  });
  return { goods, byId: new Map(goods.map((g) => [g.id, g])) };
}

export class Economy {
  constructor(game) {
    this.game = game;
    this.credits = 400;
    this.cargoCap = 16;
    this.cargo = {};                    // commodity id -> units held
    this.known = [];                    // stations whose boards you can quote
    this.load();
  }

  cargoUsed() {
    let n = 0;
    for (const id in this.cargo) n += this.cargo[id];
    return n;
  }

  /** The price of a good at a market at moment `t`. Pass a past `t` and you
   *  get the past price — that is not a convenience, it is the news system. */
  priceAt(market, id, t) {
    const g = market.byId.get(id);
    if (!g) return 0;
    return Math.max(1, Math.round(g.price * drift(g.phase, t)));
  }

  /** @returns {n, price} — units transacted at what unit price. n=0 refused. */
  buy(market, id, qty = 1) {
    const g = market.byId.get(id);
    if (!g) return { n: 0, price: 0 };
    const price = this.priceAt(market, id, this.game.time);
    const n = Math.min(qty, g.stock, this.cargoCap - this.cargoUsed(),
      Math.floor(this.credits / price));
    if (n <= 0) return { n: 0, price };
    g.stock -= n;
    this.credits -= n * price;
    this.cargo[id] = (this.cargo[id] || 0) + n;
    this.save();
    return { n, price };
  }

  /** @returns {n, price} — units sold at what unit price. */
  sell(market, id, qty = 1) {
    const g = market.byId.get(id);
    const held = this.cargo[id] || 0;
    if (!g || !held) return { n: 0, price: 0 };
    const price = this.priceAt(market, id, this.game.time);
    const n = Math.min(qty, held);
    g.stock += n;
    this.credits += n * price;
    this.cargo[id] = held - n;
    if (!this.cargo[id]) delete this.cargo[id];
    this.save();
    return { n, price };
  }

  /* --------------------------------------------------- who you know */

  /** Remember a station so its board can be quoted elsewhere. Docking in a
   *  system teaches you both its stations — the local board is shared. */
  learnStation(rec) {
    if (this.known.some((k) => k.key === rec.key)) return;
    this.known.push(rec);
    this.save();
  }

  /**
   * The traffic report: every known station's board, as fresh as a freighter
   * can make it. Prices are the *real* price function evaluated at
   * (now − lane distance / news speed): perfectly honest, always late.
   */
  reports(currentSystemId, t, excludeKey) {
    const lanes = this.game.lanes;
    const out = [];
    for (const k of this.known) {
      if (k.key === excludeKey) continue;                        // it IS the board
      const ly = lanes ? lanes.graphDist(currentSystemId, k.systemId) : Infinity;
      if (!Number.isFinite(ly)) continue;                        // no lane, no news
      const age = ly / NEWS_LY_PER_SEC;
      const market = buildMarket(k.systemSeed, k.idx);
      const goods = market.goods
        .filter((g) => g.role)
        .map((g) => ({ id: g.id, role: g.role, price: this.priceAt(market, g.id, t - age) }));
      out.push({ ...k, age, ly, goods });
    }
    return out.sort((a, b) => a.ly - b.ly);
  }

  /* The ledger survives the tab; the markets do not — they are re-dealt from
     the seed on every system load, so a revisited station has forgotten what
     you sold it. Fine while prices are static; M2 gives stock a memory. */
  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        credits: this.credits, cargo: this.cargo, known: this.known,
      }));
    } catch { /* private browsing, quota — the run just becomes ephemeral */ }
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s) return;
      if (Number.isFinite(s.credits)) this.credits = s.credits;
      if (s.cargo && typeof s.cargo === 'object') {
        this.cargo = {};
        for (const id in s.cargo) {
          const n = s.cargo[id];
          if (BY_ID.has(id) && Number.isInteger(n) && n > 0) this.cargo[id] = n;
        }
      }
      if (Array.isArray(s.known)) this.known = s.known.filter((k) => k && k.key);
    } catch { /* a corrupt save is just a new game */ }
  }
}
