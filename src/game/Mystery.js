/* ============================================================================
   The question.

   Why is there a nebula here?

   The Long Silence answered its own mystery with seven instruments and an
   Aperture, and told you so in directives. This fork answers it the way
   Starflight did: nobody hands you the story. Four cultures each hold a piece
   and each one is *certain*, and three of the four are wrong in a way that is
   still useful. What you get is evidence — corroborated hearsay, attuned
   Tines, worlds you scanned, lucent you burned — and the Archive does the
   clerking. The believing is yours.

   The shape of it, which the player assembles rather than reads:

     The Hush did not die and were not killed. They were *listening* for
     something, and the seven Tines are one instrument in seven pieces,
     tuned across eighty light-years because that is the aperture a wave that
     long requires. When the thing they were listening for finally arrived,
     they did the only thing that would let them hear it properly: they stopped
     being matter that scatters it.

     Nine hundred worlds of civilisation, converted, is the nebula. You have
     been flying through them. The dust that chokes your drive is the Hush.

     And lucent — the fuel, the thing you mine out of dead worlds and burn to
     cross the dark, the reason anyone comes out this far — is what they leave
     where they were densest. Every jump you have made has been powered by
     somebody. The Registry prices it at fourteen credits the tonne.

   That last turn is why the fuel had to be a real resource in M4 before this
   milestone could land. The twist only works on a player who has spent hours
   being glad to find lucent.
   ========================================================================== */

const SAVE_KEY = 'star-universe.mystery.v1';

/**
 * What each culture believes, and will tell you. Exactly one is right, and the
 * three wrong ones are wrong in the direction of their own interests — which
 * is the tell, if the player is paying attention rather than counting votes.
 */
export const CLAIMS = {
  institute: {
    species: 'institute',
    claim: 'weapon',
    text: 'Registry position: the Stillness was an event, not an act. Something '
      + 'passed through and the Hush were in its way. Nine hundred worlds is '
      + 'what a weapon looks like when nobody survives to name it.',
    truth: false,
  },
  vess: {
    species: 'vess',
    claim: 'exodus',
    text: 'The Combine holds that the Hush simply left — packed nine hundred '
      + 'worlds into whatever they built the Tines to open, and went. The '
      + 'dust is what they did not take. There is no mystery, only freight.',
    truth: false,
  },
  korrim: {
    species: 'korrim',
    claim: 'plague',
    text: 'The lodges say a sickness took them, and the dust is a quarantine '
      + 'they laid over their own graves. They will tell you not to breathe it, '
      + 'and they mean it as advice rather than as history.',
    truth: false,
  },
  szethi: {
    species: 'szethi',
    claim: 'listening',
    text: 'The Drift says the Hush are not gone and were never buried. They '
      + 'went thin on purpose, to hear something that only arrives once, and '
      + 'the nebula is the shape they took to hear it. The Drift does not '
      + 'expect to be believed.',
    truth: true,
  },
};

/**
 * The revelations, in order. Each is gated on evidence the player accumulates
 * by *playing the game they were already playing* — no fetch quests, no keys.
 * `test` reads the live world; the Archive shows locked ones as questions
 * rather than as blanks, so the player knows what they are missing.
 */
export const REVELATIONS = [
  {
    id: 'instrument',
    title: 'One instrument, in seven pieces',
    need: 'Attune two Tines',
    test: (g) => g.cantos.length >= 2,
    text: 'The Tines are not seven devices. Their harmonics are the same '
      + 'harmonics, phase-shifted by exactly the light-time between them: they '
      + 'are one instrument, strung across eighty light-years, because that is '
      + 'the aperture a wave that long needs. Whatever the Hush built this to '
      + 'hear, it was not local and it was not quick.',
  },
  {
    id: 'notdead',
    title: 'Nobody died here',
    need: 'Hear two different accounts of the Stillness',
    test: (g) => g.mystery.distinctClaims().length >= 2,
    text: 'Every account contradicts every other, but they all share a hole: '
      + 'no remains. Not a body, not a grave, not a ship left in a parking '
      + 'orbit with anyone still in it. Nine hundred worlds emptied in four '
      + 'days without a single thing left behind that used to be alive. That '
      + 'is not how anything dies. It is how something *changes*.',
  },
  {
    id: 'census',
    title: 'The dust is not dust',
    need: 'Chart six lanes and scan four worlds',
    test: (g) => g.lanes.charted.size >= 6 && g.discoveries.size >= 4,
    text: 'Run the density field against the Hush census and the correlation '
      + 'is not subtle: the nebula is thickest exactly where the population '
      + 'was. Not near it. Not around it. *At* it, world for world, to the '
      + 'decimal. You have been flying through them for hours.',
  },
  {
    id: 'lucent',
    title: 'What you have been burning',
    need: 'Burn twelve tonnes of lucent',
    test: (g) => g.mystery.lucentBurned >= 12,
    text: 'Lucent occurs where the dust is densest, which is to say where the '
      + 'cities were. It is not a mineral and it does not form. It is residue, '
      + 'and its lattice carries structure that is periodic in a way nothing '
      + 'geological is. Every fold you have made was powered by somebody. The '
      + 'Registry prices it at fourteen credits the tonne, and the yards will '
      + 'sell you a bigger tank.',
  },
  {
    id: 'aperture',
    title: 'The Aperture was never a door',
    need: 'Attune all seven Tines',
    test: (g) => g.cantos.length >= 7,
    text: 'The seventh Tone completes the phase and the instrument finally '
      + 'resolves what it was built to hear — and it is not a signal. It is '
      + 'the sound of the Hush, still listening, spread thin across eighty '
      + 'light-years, waiting for a thing that has not arrived yet. The '
      + 'Aperture does not open. It is the ear. You are standing inside it, '
      + 'and it has been open the whole time.',
  },
];

export class Mystery {
  constructor(game) {
    this.game = game;
    this.found = new Set();      // revelation ids already surfaced
    this.lucentBurned = 0;
    this.load();
  }

  /** The distinct accounts heard. Each culture holds exactly one claim, so
   *  two accounts are always two *different* accounts — the contradiction is
   *  the evidence, not the agreement. Gating this on corroboration instead
   *  would have made the revelation unreachable forever, because no two
   *  species ever say the same thing. */
  distinctClaims() {
    return [...new Set(this.game.rumors.heard
      .filter((r) => r.kind === 'origin').map((r) => r.claim))];
  }

  /** Kept for the ledger: a claim two mouths would repeat, if any ever did. */
  corroboratedClaims() {
    const heard = this.game.rumors.heard.filter((r) => r.kind === 'origin');
    const byClaim = {};
    for (const r of heard) {
      (byClaim[r.claim] ??= new Set()).add(r.source);
    }
    return Object.entries(byClaim)
      .filter(([, sources]) => sources.size >= 2)
      .map(([claim]) => claim);
  }

  /** Origin claims heard at all, with who said what and whether it holds up. */
  testimony() {
    const heard = this.game.rumors.heard.filter((r) => r.kind === 'origin');
    const seen = new Map();
    for (const r of heard) {
      if (!seen.has(r.claim)) {
        const c = Object.values(CLAIMS).find((x) => x.claim === r.claim);
        seen.set(r.claim, { ...c, sources: new Set() });
      }
      seen.get(r.claim).sources.add(r.source);
    }
    return [...seen.values()].map((c) => ({ ...c, sources: [...c.sources] }));
  }

  /** Called whenever lucent leaves the tank. The twist needs a count of what
   *  the player has spent, not what they have. */
  burn(tonnes) {
    if (!(tonnes > 0)) return;
    this.lucentBurned += tonnes;
    this.save();
  }

  /** Which revelations the evidence now supports. Surfaces new ones once. */
  update() {
    const g = this.game;
    const fresh = [];
    for (const r of REVELATIONS) {
      if (this.found.has(r.id)) continue;
      let ok = false;
      try { ok = r.test(g); } catch { ok = false; }
      if (!ok) continue;
      this.found.add(r.id);
      fresh.push(r);
    }
    if (fresh.length) {
      this.save();
      g.codex?.markDirty();
      for (const r of fresh) {
        g.hud?.log(`THE QUESTION · ${r.title.toUpperCase()}`, 'hi');
      }
      // The last one is the ending, and it is allowed to take the frame.
      const last = fresh[fresh.length - 1];
      if (last.id === 'aperture') g.onAperture?.();
    }
    return fresh;
  }

  /** For the Archive: every revelation, with what is still needed. */
  ledger() {
    return REVELATIONS.map((r) => ({
      ...r, known: this.found.has(r.id),
    }));
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        found: [...this.found], burned: this.lucentBurned,
      }));
    } catch { /* ephemeral run */ }
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s) return;
      if (Array.isArray(s.found)) for (const id of s.found) this.found.add(id);
      if (Number.isFinite(s.burned)) this.lucentBurned = s.burned;
    } catch { /* a corrupt save is just a new game */ }
  }
}
