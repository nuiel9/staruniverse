import { mulberry32 } from '../world/generate.js';
import { commodity, COMMODITIES } from '../econ/Economy.js';

/* ============================================================================
   Contracts.

   A market tells you what things are worth. A contract tells you where to go,
   which is a different and scarcer kind of information — the whole difficulty
   of an open trading game is that "anywhere" is the same as "nowhere" until
   something points. So every dock keeps a board of hauls: carry this much of
   that, to there, before then.

   Three things keep them honest:

   **The reward is the risk.** Distance sets the base, and whatever the events
   system says is happening at either end raises it. A blockade run pays
   because it is a blockade run, and the board says so without editorialising.

   **A deadline is real.** Miss it and the contract is gone, with no penalty
   beyond the cargo sitting in your hold and the fee you did not collect. The
   game never takes credits off you for being late; it simply stops paying.

   **The goods are yours to find.** A contract does not hand you the cargo — it
   names a commodity and a tonnage, and you buy it, or you dig it out of a
   world. That is what makes it a *routing* problem rather than an errand.

   Offers are seeded per station per time-bucket, so a board is stable while
   you read it and different when you come back.
   ========================================================================== */

const SAVE_KEY = 'star-universe.contracts.v1';

/** How long a board stands before it is re-dealt. */
const BOARD_PERIOD = 600;

let nextId = 1;

export class Contracts {
  constructor(game) {
    this.game = game;
    this.taken = [];        // accepted, not yet delivered or expired
    this.done = 0;          // completed, for the record
    this.load();
  }

  /** The board at a station: three offers, stable within a time bucket. */
  offers(systemId, idx, t) {
    const g = this.game;
    const bucket = Math.floor(t / BOARD_PERIOD);
    const rnd = mulberry32(((systemId * 7919) ^ (idx * 104729) ^ (bucket * 2246822519)) >>> 0);
    const out = [];
    // Only somewhere you can actually reach: a haul to a system with no lane
    // route is a joke at the player's expense.
    const reachable = g.galaxy.filter((s) => s.id !== systemId
      && Number.isFinite(g.lanes.graphDist(systemId, s.id)));
    if (!reachable.length) return out;

    for (let i = 0; i < 3; i++) {
      const dest = reachable[Math.floor(rnd() * reachable.length)];
      const good = COMMODITIES[Math.floor(rnd() * COMMODITIES.length)];
      const qty = 3 + Math.floor(rnd() * 8);
      const ly = g.lanes.graphDist(systemId, dest.id);
      const risk = Math.max(g.events.risk(systemId, t), g.events.risk(dest.id, t));
      // Base on what the cargo is worth plus what the distance costs, then
      // let danger add to it. Rounded to something a board would print.
      const pay = Math.round((good.base * qty * 0.55 + ly * 26) * (1 + risk * 0.9) / 10) * 10;
      // A deadline long enough to fly it, short enough to mean something.
      const due = t + 420 + ly * 26;
      out.push({
        id: `${systemId}:${idx}:${bucket}:${i}`,
        from: systemId, to: dest.id, toName: dest.name,
        goodId: good.id, qty, pay, due, ly, risk,
      });
    }
    return out;
  }

  isTaken(offerId) { return this.taken.some((c) => c.id === offerId); }

  accept(offer) {
    if (this.isTaken(offer.id) || this.taken.length >= 4) return false;
    this.taken.push({ ...offer, ref: nextId++ });
    this.save();
    return true;
  }

  /** Contracts whose deadline has passed, dropped. @returns how many died. */
  expire(t) {
    const before = this.taken.length;
    this.taken = this.taken.filter((c) => c.due > t);
    if (this.taken.length !== before) this.save();
    return before - this.taken.length;
  }

  /** What can be handed over here, right now, out of the hold. */
  deliverable(systemId, t) {
    const eco = this.game.economy;
    return this.taken.filter((c) => c.to === systemId && c.due > t
      && (eco.cargo[c.goodId] || 0) >= c.qty);
  }

  /** Hand one over: cargo out, credits in. @returns the fee, or 0. */
  deliver(c) {
    const eco = this.game.economy;
    if ((eco.cargo[c.goodId] || 0) < c.qty) return 0;
    eco.cargo[c.goodId] -= c.qty;
    if (!eco.cargo[c.goodId]) delete eco.cargo[c.goodId];
    eco.credits += c.pay;
    eco.save();
    this.taken = this.taken.filter((x) => x.ref !== c.ref);
    this.done++;
    this.save();
    return c.pay;
  }

  label(c) {
    return `${c.qty} ${commodity(c.goodId).name} → ${c.toName}`;
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        taken: this.taken, done: this.done, n: nextId,
      }));
    } catch { /* ephemeral run */ }
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s) return;
      if (Array.isArray(s.taken)) this.taken = s.taken.filter((c) => c && c.goodId);
      if (Number.isInteger(s.done)) this.done = s.done;
      if (Number.isInteger(s.n)) nextId = s.n;
    } catch { /* a corrupt save is just a new game */ }
  }
}
