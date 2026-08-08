/* ============================================================================
   Outfitting.

   Five systems, three tiers each, bought with money and nothing else — no
   skill trees, no unlock gates. That is the Starflight bargain and it is the
   right one for a trading game: every credit you make is convertible into
   *capability*, and the player decides which capability. A trader buys hold
   space, an explorer buys tank and scanner, and both are correct.

   Each tier states its effect in the units the rest of the game already uses,
   so applying an outfit is one pass over the ship rather than a special case
   anywhere else. The hold and the tank are the two that change how the game
   feels rather than how fast it goes: sixteen tonnes is one good run between
   two stations, forty is a circuit.
   ========================================================================== */

export const OUTFITS = {
  hold: {
    name: 'Cargo Hold',
    blurb: 'Pods clamped along the spine. Every tonne is a tonne you can sell.',
    tiers: [
      { label: 'Standard bay', cargoCap: 16, cost: 0 },
      { label: 'Extended pods', cargoCap: 28, cost: 1400 },
      { label: 'Freighter frame', cargoCap: 44, cost: 5200 },
    ],
  },
  tank: {
    name: 'Lucent Tank',
    blurb: 'How far you can go before the nebula decides where you live.',
    tiers: [
      { label: 'Survey tank', fuelCap: 40, cost: 0 },
      { label: 'Long-range tank', fuelCap: 70, cost: 1100 },
      { label: 'Deep-field tank', fuelCap: 120, cost: 4300 },
    ],
  },
  scanner: {
    name: 'Survey Scanner',
    blurb: 'Faster scans, and the sensitivity to see what a world is holding.',
    tiers: [
      { label: 'Institute array', scanRate: 1, cost: 0 },
      { label: 'Phased array', scanRate: 1.6, cost: 900 },
      { label: 'Deep array', scanRate: 2.4, cost: 3600 },
    ],
  },
  drive: {
    name: 'Fold Drive',
    blurb: 'Recharges faster between jumps, and pushes harder in the dust.',
    tiers: [
      { label: 'Standard coil', foldRegen: 1, cost: 0 },
      { label: 'Tuned coil', foldRegen: 1.5, cost: 1600 },
      { label: 'Choir-pattern coil', foldRegen: 2.2, cost: 6000 },
    ],
  },
  engine: {
    name: 'Main Drive',
    blurb: 'Cruise speed in-system. Time is the resource nobody prices.',
    tiers: [
      { label: 'Standard torch', maxSpeed: 60, cost: 0 },
      { label: 'Uprated torch', maxSpeed: 84, cost: 1200 },
      { label: 'Racing torch', maxSpeed: 118, cost: 4800 },
    ],
  },
};

const SAVE_KEY = 'star-universe.outfit.v1';

export class Outfitting {
  constructor(game) {
    this.game = game;
    this.tier = {};                       // system id -> tier index
    for (const id in OUTFITS) this.tier[id] = 0;
    this.load();
  }

  spec(id) { return OUTFITS[id].tiers[this.tier[id] || 0]; }
  next(id) { return OUTFITS[id].tiers[(this.tier[id] || 0) + 1] || null; }

  /** Push every fitted tier onto the ship and the ledger. Idempotent, so it
   *  can be called on boot, after a purchase, or after a load. */
  apply() {
    const g = this.game;
    const hold = this.spec('hold');
    const tank = this.spec('tank');
    g.economy.cargoCap = hold.cargoCap;
    g.ship.fuelCap = tank.fuelCap;
    g.ship.fuel = Math.min(g.ship.fuel, g.ship.fuelCap);
    g.ship.scanRate = this.spec('scanner').scanRate;
    g.ship.foldRegen = this.spec('drive').foldRegen;
    g.ship.maxSpeed = this.spec('engine').maxSpeed;
    g.ship.setOutfit(this.tier);          // and the hardware you can see
  }

  /** @returns true if the upgrade was fitted. */
  buy(id) {
    const nx = this.next(id);
    if (!nx) return false;
    const eco = this.game.economy;
    if (eco.credits < nx.cost) return false;
    eco.credits -= nx.cost;
    this.tier[id] = (this.tier[id] || 0) + 1;
    eco.save();
    this.save();
    this.apply();
    return true;
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ tier: this.tier })); }
    catch { /* ephemeral run */ }
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s || !s.tier) return;
      for (const id in OUTFITS) {
        const t = s.tier[id];
        if (Number.isInteger(t) && t >= 0 && t < OUTFITS[id].tiers.length) this.tier[id] = t;
      }
    } catch { /* a corrupt save is just a new game */ }
  }
}
