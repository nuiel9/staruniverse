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

   Prices are static for now. They become alive in M2, when news of a glut
   travels the lanes no faster than the freighters that cause it.
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

/**
 * Deal the commodity deck around a system's stations.
 * Station `idx` produces deck[2i..2i+1] and demands deck[2i+2..2i+3] (mod 8),
 * so station 0 produces exactly what station 1 demands. One profitable run in
 * each direction, by construction, in every inhabited system.
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
  const goods = COMMODITIES.map((c) => {
    const role = produces.has(c.id) ? 'produces' : demands.has(c.id) ? 'demands' : null;
    const mult = role === 'produces' ? PRODUCE_MULT : role === 'demands' ? DEMAND_MULT : 1;
    const jitter = 0.88 + jrnd() * 0.24;
    const stock = role === 'produces' ? 40 + Math.floor(jrnd() * 40)
      : role === 'demands' ? Math.floor(jrnd() * 4)
        : 4 + Math.floor(jrnd() * 10);
    return {
      id: c.id,
      price: Math.max(1, Math.round(c.base * mult * jitter)),
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
    this.load();
  }

  cargoUsed() {
    let n = 0;
    for (const id in this.cargo) n += this.cargo[id];
    return n;
  }

  /** @returns units actually bought (0 on any refusal). */
  buy(market, id, qty = 1) {
    const g = market.byId.get(id);
    if (!g) return 0;
    const n = Math.min(qty, g.stock, this.cargoCap - this.cargoUsed(),
      Math.floor(this.credits / g.price));
    if (n <= 0) return 0;
    g.stock -= n;
    this.credits -= n * g.price;
    this.cargo[id] = (this.cargo[id] || 0) + n;
    this.save();
    return n;
  }

  /** @returns units actually sold. */
  sell(market, id, qty = 1) {
    const g = market.byId.get(id);
    const held = this.cargo[id] || 0;
    if (!g || !held) return 0;
    const n = Math.min(qty, held);
    g.stock += n;
    this.credits += n * g.price;
    this.cargo[id] = held - n;
    if (!this.cargo[id]) delete this.cargo[id];
    this.save();
    return n;
  }

  /* The ledger survives the tab; the markets do not — they are re-dealt from
     the seed on every system load, so a revisited station has forgotten what
     you sold it. Fine while prices are static; M2 gives stock a memory. */
  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        credits: this.credits, cargo: this.cargo,
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
    } catch { /* a corrupt save is just a new game */ }
  }
}
