import { mulberry32 } from '../world/generate.js';

/* ============================================================================
   The species.

   Four cultures share the nebula, and each one is a *trading posture made
   flesh*: who they are is inseparable from how you have to talk to them and
   what they think your cargo is worth. That is the Starflight inheritance —
   an alien is a negotiation, not a texture.

   The rules of contact:

   **Posture is the first move.** Before anything else you choose how to
   address them, and the same stance lands differently everywhere: the Vess
   read flattery as weakness and price it accordingly; the Korrim hear a hard
   voice as a compliment; the Szethi leave the channel the moment anyone
   growls. There is no universally safe opening — that is the game.

   **Bias is the margin.** Every species undervalues what it has and
   overvalues what it wants, in ways stations do not. A hold of alloys is
   worth one thing on a Vess board and another thing entirely to a Korrim
   quartermaster a lane away. Traders who learn the biases stop needing luck.

   **Territory is geography.** Species hold clusters of systems, dealt from
   the same seed as everything else: the far anchors of the chart go to the
   three cultures, and every system belongs to whoever is nearest. The home
   cluster stays with the Institute, which is why the early game sounds like
   home and the deep game does not.
   ========================================================================== */

export const SPECIES = {
  institute: {
    id: 'institute',
    name: 'The Institute',
    adj: 'Institute',
    desc: 'Your own registry. Surveyors, patrols and haulers on the ledger.',
    // Straight dealers: posture barely matters, nothing is negotiable.
    posture: { friendly: 1, businesslike: 1, obsequious: 0, hostile: -2 },
    bias: {},
    stubborn: 0.5,
    truth: 0.95,
    rumorKinds: ['demand', 'lane', 'origin'],
  },
  vess: {
    id: 'vess',
    name: 'The Vess Combine',
    adj: 'Vess',
    desc: 'Mercantile clans who price everything, including your manners.',
    posture: { friendly: 1, businesslike: 2, obsequious: -2, hostile: -1 },
    bias: { luxuries: 1.3, medicine: 1.25, ore: 0.72, volatiles: 0.75 },
    stubborn: 0.35,
    truth: 0.85,
    rumorKinds: ['demand', 'demand', 'lane', 'origin'],
  },
  korrim: {
    id: 'korrim',
    name: 'The Korrim Lodges',
    adj: 'Korrim',
    desc: 'Proud martial lodges. They respect iron — in a hull or in a voice.',
    posture: { friendly: 0, businesslike: 1, obsequious: -3, hostile: 2 },
    bias: { machinery: 1.3, alloys: 1.2, fuel: 1.15, luxuries: 0.7 },
    stubborn: 0.6,
    truth: 0.9,
    rumorKinds: ['lane', 'demand', 'resonator', 'origin'],
  },
  szethi: {
    id: 'szethi',
    name: 'The Szethi Drift',
    adj: 'Szethi',
    desc: 'Reclusive listeners at the nebula’s edge. Softly, or not at all.',
    posture: { friendly: 2, businesslike: 0, obsequious: 1, hostile: -3 },
    bias: { volatiles: 1.25, food: 1.2, machinery: 0.75 },
    stubborn: 0.2,
    truth: 0.6,
    rumorKinds: ['resonator', 'lane', 'demand', 'origin', 'origin'],
  },
};

export const POSTURES = ['friendly', 'businesslike', 'obsequious', 'hostile'];

/* ------------------------------------------------------------------ voices */

export const VOICE = {
  institute: {
    greet: {
      warm: 'Pale Seeker. Good to see Institute iron out here. What do you need?',
      cool: 'Registry confirmed, Seeker. Keep it brief, we are on schedule.',
      cold: 'This is a working channel, Seeker. State your business or clear it.',
    },
    rumorGive: 'Off the log: %s',
    rumorPaid: 'The bulletin service is not free, even for you. %d credits.',
    rumorRefuse: 'Nothing for you today. File a request at the Gate.',
    tradeOpen: 'We are not a market stall, Seeker. Try the stations.',
    farewell: 'Vigil out. Fly straight.',
    insulted: 'Logged. Do not do that again.',
  },
  vess: {
    greet: {
      warm: 'A ledger walks in with legs. Speak, Seeker — time is margin.',
      cool: 'Combine hull. We are listening, provisionally.',
      cold: 'You are costing us attention. It is not cheap.',
    },
    rumorGive: 'Consider this a free sample: %s',
    rumorPaid: 'Information is stock like any other. %d credits and it is yours.',
    rumorRefuse: 'Our news is not priced for you today.',
    tradeSell: 'Surplus manifest: %d %s. %d a unit and we both walk away smiling.',
    tradeBuy: 'We are short %d %s. Name of the game: %d a unit, paid on the arm.',
    counterGood: 'Hnh. You have clerked before. %d, then.',
    counterBad: 'Amusing. %d. That number only moves toward you slower now.',
    accept: 'Sealed. The Combine remembers a clean deal.',
    walk: 'No deal. The margin walks with you.',
    insulted: 'Grovelling is a discount you pay us. Channel closed.',
    farewell: 'Margins to you, Seeker.',
  },
  korrim: {
    greet: {
      warm: 'You speak like someone worth answering. Go on, Seeker.',
      cool: 'A lodge does not chatter. Say your piece.',
      cold: 'Soft words from a soft hull. Careful.',
    },
    rumorGive: 'Hear it once: %s',
    rumorPaid: 'Knowledge is spoils. %d credits, tribute.',
    rumorRefuse: 'You have earned nothing. The lodge keeps its own.',
    tradeSell: 'The lodge sheds %d %s. %d a unit. Do not haggle like a merchant.',
    tradeBuy: 'The lodge requires %d %s. %d a unit, and the debt is acknowledged.',
    counterGood: 'Ha! Iron in you after all. %d.',
    counterBad: 'You test a lodge’s patience. %d. Last word.',
    accept: 'Done. Struck like a blade.',
    walk: 'Then we are finished. No shame in it.',
    insulted: 'Bowing and scraping. The channel is unworthy of us.',
    farewell: 'Strength to your hull.',
  },
  szethi: {
    greet: {
      warm: 'Ah — the loud little ship that listens. We hear you gently, Seeker.',
      cool: 'The Drift hears you. Speak as the dust settles, slowly.',
      cold: 'So much noise in so small a hull. Softly, or go.',
    },
    rumorGive: 'The dust says, and we repeat it imperfectly: %s',
    rumorPaid: 'A tithe for the listening. %d credits, given not taken.',
    rumorRefuse: 'The dust is quiet where you are concerned.',
    tradeSell: 'We are carrying %d %s we no longer need to carry. %d each, and lightness.',
    tradeBuy: 'The Drift hungers, quietly, for %d %s. %d each, offered kindly.',
    counterGood: 'The current bends. %d, then, and no further unkindness.',
    counterBad: 'You pull too hard against the drift. %d.',
    accept: 'It is settled, softly.',
    walk: 'Then it drifts on past us both.',
    insulted: 'No. The silence is better company than this.',
    farewell: 'Drift well between the lights.',
  },
};

/* ------------------------------------------------------------- territories */

/**
 * Deal the chart to the cultures. Three far anchors go to the alien species
 * (greedy farthest-point pick, so they spread), the home system anchors the
 * Institute, and every system belongs to its nearest anchor. Deterministic in
 * the galaxy seed like everything else.
 */
export function assignTerritories(galaxy, seed) {
  const rnd = mulberry32((seed ^ 0x5ec1e5) >>> 0);
  const aliens = ['vess', 'korrim', 'szethi'];
  // shuffle which culture gets which anchor, so the seed decides the map
  for (let i = aliens.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [aliens[i], aliens[j]] = [aliens[j], aliens[i]];
  }

  const anchors = [{ sysId: 0, species: 'institute' }];
  const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  for (const sp of aliens) {
    let best = null;
    for (const s of galaxy) {
      if (anchors.some((a) => a.sysId === s.id)) continue;
      const nearest = Math.min(...anchors.map((a) => d2(s, galaxy[a.sysId])));
      if (!best || nearest > best.nearest) best = { sysId: s.id, nearest };
    }
    anchors.push({ sysId: best.sysId, species: sp });
  }

  const owner = galaxy.map((s) => {
    let best = null;
    for (const a of anchors) {
      const dd = d2(s, galaxy[a.sysId]);
      if (!best || dd < best.dd) best = { dd, species: a.species };
    }
    return best.species;
  });
  return { owner, anchors };
}

/** Posture fit: the species' read of your stance, plus what they remember of
 *  you. Clamped so reputation seasons a meeting but never replaces manners. */
export function postureFit(species, posture, rep = 0) {
  const base = species.posture[posture] ?? 0;
  return base + Math.max(-1, Math.min(1, rep));
}
