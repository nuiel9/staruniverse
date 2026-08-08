import { mulberry32 } from '../world/generate.js';

/* ============================================================================
   Crew.

   Starflight's crew were six roles and a training budget. Here they are five
   people with names, hired one at a time out of whatever a station's bar has
   in it that week, and each one is a *verb you already use*, done better: the
   surveyor makes scans faster, the prospector makes the drone quicker, the
   navigator makes folds cheaper, the quartermaster widens the band you can
   haggle in, and the engineer makes the drive recharge sooner.

   They are deliberately not a party you manage. There is no morale, no
   rations, no permadeath: hiring someone is a purchase that changes a number,
   and the number is one the player has already felt for hours. What they add
   is *presence* — the ship stops being empty, the Archive lists who is aboard,
   and the deep game is quieter with four people in it than it was alone.

   Who is available is seeded per station per week-long bucket, so the bar has
   different faces when you come back, and a crew member you walked past is
   genuinely gone.
   ========================================================================== */

const SAVE_KEY = 'star-universe.crew.v1';

/** How long a station's roster stands before new faces come through. */
const ROSTER_PERIOD = 1200;

export const ROLES = {
  surveyor: {
    id: 'surveyor', title: 'Surveyor',
    blurb: 'Reads a world faster than the array was built to.',
    effect: 'Scans complete 35% sooner', scanMul: 1.35, fee: 900,
  },
  prospector: {
    id: 'prospector', title: 'Prospector',
    blurb: 'Knows where to put the drill without being told.',
    effect: 'The drone works 40% faster', droneMul: 1.4, fee: 1100,
  },
  navigator: {
    id: 'navigator', title: 'Navigator',
    blurb: 'Finds the thin part of a dust bank by instinct.',
    effect: 'Folds burn 25% less lucent', fuelMul: 0.75, fee: 1500,
  },
  quartermaster: {
    id: 'quartermaster', title: 'Quartermaster',
    blurb: 'Has haggled with worse than the Vess, and won.',
    effect: 'Better opening prices in every negotiation', barter: 1, fee: 1300,
  },
  engineer: {
    id: 'engineer', title: 'Engineer',
    blurb: 'Keeps the coil inside its tolerances, mostly.',
    effect: 'Fold charge recovers 40% faster', regenMul: 1.4, fee: 1200,
  },
};

const ORDER = Object.keys(ROLES);

const FIRST = ['Sana', 'Voll', 'Idris', 'Marek', 'Tessin', 'Oyelaran', 'Kesh', 'Auri',
  'Delane', 'Rho', 'Sabri', 'Ythe', 'Corrin', 'Nkemi', 'Vasso'];
const LAST = ['Adeyemi', 'Kalvert', 'Osei', 'Renn', 'Thorsdottir', 'Vane', 'Quill',
  'Achebe', 'Lindqvist', 'Marr', 'Iwu', 'Sable', 'Duarte', 'Nakamura'];

export class Crew {
  constructor(game) {
    this.game = game;
    this.aboard = [];
    this.load();
  }

  /** Who is drinking at this station this week. */
  roster(systemId, idx, t) {
    const bucket = Math.floor(t / ROSTER_PERIOD);
    const rnd = mulberry32(((systemId * 31337) ^ (idx * 6151) ^ (bucket * 2971215073)) >>> 0);
    const out = [];
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const role = ROLES[ORDER[Math.floor(rnd() * ORDER.length)]];
      const name = `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`;
      // People price themselves differently. A tenth either way is enough to
      // make a player wait for the next station.
      const fee = Math.round(role.fee * (0.9 + rnd() * 0.2) / 10) * 10;
      out.push({ id: `${systemId}:${idx}:${bucket}:${i}`, role: role.id, name, fee });
    }
    return out;
  }

  has(roleId) { return this.aboard.some((c) => c.role === roleId); }

  hire(rec) {
    const eco = this.game.economy;
    // One of each speciality: a second surveyor has nothing to do.
    if (this.has(rec.role) || this.aboard.length >= 4) return false;
    if (eco.credits < rec.fee) return false;
    eco.credits -= rec.fee;
    this.aboard.push({ ...rec });
    eco.save();
    this.save();
    this.apply();
    return true;
  }

  /** Product of everyone's bonus for one field. */
  mul(field) {
    return this.aboard.reduce((m, c) => m * (ROLES[c.role][field] ?? 1), 1);
  }

  /** Push crew bonuses onto the ship. Called after hiring and on boot, and
   *  after Outfitting.apply — the outfit sets the base, crew scales it. */
  apply() {
    const g = this.game;
    if (!g.outfit) return;
    g.ship.scanRate = g.outfit.spec('scanner').scanRate * this.mul('scanMul');
    g.ship.foldRegen = g.outfit.spec('drive').foldRegen * this.mul('regenMul');
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ aboard: this.aboard })); }
    catch { /* ephemeral run */ }
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && Array.isArray(s.aboard)) {
        this.aboard = s.aboard.filter((c) => c && ROLES[c.role]);
      }
    } catch { /* a corrupt save is just a new game */ }
  }
}
