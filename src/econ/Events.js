import { mulberry32 } from '../world/generate.js';

/* ============================================================================
   Events: the galaxy carrying on without you.

   A mine floods, a station declares a festival, a lodge blockades a lane. Each
   one moves prices where it happens, and — because prices already travel at
   freighter speed — the *knowledge* of it spreads outward from there at the
   pace of hulls. Arriving somewhere the news has not reached yet is the whole
   game: you can be the first person at that dock who knows.

   **Everything here is a pure function of (system, time).** No ticking, no
   stored state, no simulation running in the background. That is not laziness,
   it is the requirement: M2's traffic reports quote remote boards by
   evaluating the price function at (now − travel time), so an event that only
   existed as mutable state would vanish from history the moment it ended, and
   every dated quote in the game would silently become a lie. Asking what was
   happening at Ithirka four minutes ago has to be answerable forever, which
   means it has to be *computed*, never remembered.

   The schedule is therefore a seeded cycle per system: each window of time
   holds at most one event, and which one falls out of the window index. O(1)
   to evaluate at any instant, past or future, on any machine.
   ========================================================================== */

/** How long one slot lasts. An event fills part of its slot and the rest is
 *  quiet, so a system is eventful perhaps a third of the time. */
const CYCLE = 900;          // seconds of game time

export const EVENT_TYPES = {
  glut: {
    id: 'glut',
    label: 'Glut',
    // A surplus: what the system produces goes cheap, and stays cheap until
    // the hulls have carried it away.
    line: (s) => `${s} is drowning in surplus — anything they make is going cheap.`,
    affects: 'produces', mult: 0.62, risk: 0,
  },
  shortage: {
    id: 'shortage',
    label: 'Shortage',
    line: (s) => `${s} is short. They are paying over the odds for what they need.`,
    affects: 'demands', mult: 1.55, risk: 0,
  },
  festival: {
    id: 'festival',
    label: 'Festival',
    line: (s) => `${s} is keeping a festival. Luxuries and provisions, at any price.`,
    affects: 'luxury', mult: 1.7, risk: 0,
  },
  strike: {
    id: 'strike',
    label: 'Yard strike',
    line: (s) => `The yards at ${s} have stopped. Nothing is being made and everything costs.`,
    affects: 'all', mult: 1.28, risk: 0.1,
  },
  blockade: {
    id: 'blockade',
    label: 'Blockade',
    line: (s) => `Someone is stopping hulls around ${s}. The lanes there are not safe.`,
    affects: 'demands', mult: 1.35, risk: 0.55,
  },
};

const ORDER = Object.keys(EVENT_TYPES);

/** Goods a festival cares about — the one event keyed to commodities rather
 *  than to a station's role in its system. */
const LUXURY = new Set(['luxuries', 'food', 'medicine']);

export class Events {
  constructor(game, seed) {
    this.game = game;
    this.seed = seed >>> 0;
  }

  /**
   * The event running at `systemId` at moment `t`, or null. Deterministic and
   * O(1): the slot index seeds everything about it.
   */
  at(systemId, t) {
    if (t < 0) return null;
    const slot = Math.floor(t / CYCLE);
    const rnd = mulberry32((this.seed ^ (systemId * 2654435761) ^ (slot * 40503)) >>> 0);
    // Most slots are quiet. A galaxy where something is always happening
    // everywhere has no news in it, only noise.
    if (rnd() > 0.42) return null;
    const type = EVENT_TYPES[ORDER[Math.floor(rnd() * ORDER.length)]];
    const start = slot * CYCLE + rnd() * CYCLE * 0.4;
    const dur = CYCLE * (0.25 + rnd() * 0.35);
    if (t < start || t > start + dur) return null;
    return { ...type, systemId, start, ends: start + dur, remaining: start + dur - t };
  }

  /** What an event does to one good's price at one station. */
  priceMult(systemId, goodId, role, t) {
    const e = this.at(systemId, t);
    if (!e) return 1;
    if (e.affects === 'all') return e.mult;
    if (e.affects === 'luxury') return LUXURY.has(goodId) ? e.mult : 1;
    return role === e.affects ? e.mult : 1;
  }

  /** How dangerous the space around a system is right now, 0..1. Contracts
   *  price this in, and it is what makes a quiet run worth less than a bad
   *  one. */
  risk(systemId, t) {
    const e = this.at(systemId, t);
    return e ? e.risk : 0;
  }

  /** Everything happening right now, for the map and the boards. */
  active(t) {
    const out = [];
    for (const s of this.game.galaxy) {
      const e = this.at(s.id, t);
      if (e) out.push({ ...e, name: s.name });
    }
    return out;
  }
}
