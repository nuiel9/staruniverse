import { mulberry32 } from '../world/generate.js';
import { buildMarket, commodity } from '../econ/Economy.js';
import { SPECIES } from './Species.js';
import { CLAIMS } from './Mystery.js';

/* ============================================================================
   Rumors.

   A rumor is *structured data wearing prose*: every one is generated against
   the real world state — a station that genuinely pays a premium, a lane that
   genuinely runs clear, a system that genuinely holds a Resonator — and then
   a truthfulness roll decides whether the teller repeats it straight or bends
   it. A bent rumor still names real places; it just lies about them. That is
   what makes cross-referencing worth doing.

   **Corroboration is the mechanic.** Two independent tellings about the same
   subject that agree get marked corroborated in the ledger; a claim that
   contradicts one you already hold flags both. The codex does the clerking —
   the player does the believing.

   There are no quest markers anywhere in this. A rumor is a sentence, the
   sentence names a place, and the place is where you go.
   ========================================================================== */

const SAVE_KEY = 'star-universe.contacts.v1';

let nextLocalId = 1;

export class Rumors {
  constructor(game) {
    this.game = game;
    this.heard = [];                  // [{id, kind, text, source, subjectKey, claim, truth, heardT}]
    this.rep = {};                    // species id -> remembered standing
    this.load();
  }

  /**
   * Generate one rumor from a teller of `speciesId`, seeded by `seed` so a
   * given contact always knows the same thing. Returns the stored record.
   */
  generate(speciesId, seed) {
    const g = this.game;
    const sp = SPECIES[speciesId];
    const rnd = mulberry32((seed ^ 0x52d7a3) >>> 0);
    const kind = sp.rumorKinds[Math.floor(rnd() * sp.rumorKinds.length)];
    const honest = rnd() < sp.truth;

    let r = null;
    if (kind === 'demand') r = this._demandRumor(rnd, honest);
    if (!r && kind === 'lane') r = this._laneRumor(rnd, honest);
    if (!r && kind === 'resonator') r = this._resonatorRumor(rnd);
    if (!r && kind === 'origin') r = this._originRumor(speciesId);
    if (!r) r = this._demandRumor(rnd, true) || this._laneRumor(rnd, true);
    if (!r) return null;

    r.source = sp.name;
    r.heardT = g.time;
    return r;
  }

  /* A station that really pays a premium — or, bent, one that really doesn't. */
  _demandRumor(rnd, honest) {
    const g = this.game;
    const sys = g.galaxy[Math.floor(rnd() * g.galaxy.length)];
    const idx = rnd() < 0.5 ? 0 : 1;
    const market = buildMarket(sys.seed, idx);
    const pool = market.goods.filter((x) => (honest ? x.role === 'demands' : x.role !== 'demands'));
    if (!pool.length) return null;
    const good = pool[Math.floor(rnd() * pool.length)];
    const stName = `${sys.name} ${idx === 0 ? 'GATE' : 'ANCHORAGE'}`;
    return {
      kind: 'demand',
      subjectKey: `demand:${sys.id}:${idx}:${good.id}`,
      claim: 'pays-well',
      truth: honest,
      systemId: sys.id,
      goodId: good.id,
      text: `${stName} is paying over the odds for ${commodity(good.id).name.toLowerCase()}.`,
    };
  }

  /* A lane that really runs clear — or a dense one sold as clear. */
  _laneRumor(rnd, honest) {
    const g = this.game;
    const edges = [...g.lanes.edges.values()]
      .filter((e) => (honest ? e.density < 0.35 : e.density > 0.5));
    if (!edges.length) return null;
    const e = edges[Math.floor(rnd() * edges.length)];
    return {
      kind: 'lane',
      subjectKey: `lane:${e.key}`,
      claim: 'runs-clear',
      truth: honest,
      edgeKey: e.key,
      text: `The ${g.galaxy[e.a].name}–${g.galaxy[e.b].name} passage runs clearer than the old charts claim.`,
    };
  }

  /* What this culture believes happened to the Choir. Every species has an
     answer and every answer is delivered with total confidence; only one is
     right, and the rumor carries no flag saying which. Corroboration in the
     ledger is the player's only instrument, and it measures *agreement*, not
     truth — two cultures can be wrong together. */
  _originRumor(speciesId) {
    const c = CLAIMS[speciesId];
    if (!c) return null;
    return {
      kind: 'origin',
      subjectKey: `origin:${c.claim}`,
      claim: c.claim,
      truth: c.truth,
      text: c.text,
    };
  }

  /* Where something old is singing. The Szethi are never wrong about this —
     only vague. */
  _resonatorRumor(rnd) {
    const g = this.game;
    const ids = [...g.resonatorSystems].filter((id) => !g.galaxy[id].visited);
    if (!ids.length) return null;
    const id = ids[Math.floor(rnd() * ids.length)];
    return {
      kind: 'resonator',
      subjectKey: `resonator:${id}`,
      claim: 'sings',
      truth: true,
      systemId: id,
      text: `Something very old is still singing in ${g.galaxy[id].designation}. The dust bends around it.`,
    };
  }

  /** File a heard rumor. Repeats corroborate rather than duplicate. */
  hear(r) {
    if (!r) return null;
    r.id = `r${nextLocalId++}`;
    const prior = this.heard.filter((h) => h.subjectKey === r.subjectKey);
    r.agrees = prior.filter((h) => h.claim === r.claim && h.source !== r.source).length;
    this.heard.push(r);
    this.save();
    this.game.codex?.markDirty();
    return r;
  }

  /** Corroborated: told the same thing by two different mouths. */
  isCorroborated(r) {
    return this.heard.filter((h) => h.subjectKey === r.subjectKey
      && h.claim === r.claim && h.source !== r.source).length > 0;
  }

  bumpRep(speciesId, delta) {
    this.rep[speciesId] = Math.max(-3, Math.min(3, (this.rep[speciesId] || 0) + delta));
    this.save();
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        heard: this.heard, rep: this.rep, n: nextLocalId,
      }));
    } catch { /* ephemeral run */ }
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s) return;
      if (Array.isArray(s.heard)) this.heard = s.heard.filter((r) => r && r.subjectKey);
      if (s.rep && typeof s.rep === 'object') this.rep = s.rep;
      if (Number.isInteger(s.n)) nextLocalId = s.n;
    } catch { /* a corrupt save is just a new game */ }
  }
}
