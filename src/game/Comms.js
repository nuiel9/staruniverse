import { mulberry32 } from '../world/generate.js';
import { commodity } from '../econ/Economy.js';
import { SPECIES, VOICE, POSTURES, postureFit } from './Species.js';

/* ============================================================================
   Comms: hailing a ship and talking to whoever answers.

   The whole encounter is built from three moves, in order:

   **Choose a posture before anything else.** The first thing you send is a
   stance, not a sentence, and it prices the entire conversation — rumor
   access, barter bands, whether they stay on the channel at all. There is no
   take-back: hailing the same hull again gets you a spent contact.

   **Barter is a walk toward a hidden number.** A trading contact carries one
   lot — something their culture undervalues (they sell cheap) or overvalues
   (they buy dear). Their opening quote pads away from a reservation price you
   never see; each COUNTER concedes a fraction of the remaining gap, sized by
   how much they like you, and each counter past their patience risks the
   final word. Accept executes through the same ledger as any dock.

   **News is a commodity with manners for a price.** Warm contacts hand you a
   rumor; neutral ones sell it; cold ones enjoy refusing. What arrives is a
   Rumors record — structured, checkable, and sometimes a lie.
   ========================================================================== */

/** Fit thresholds: what the contact thinks of your opening. */
const WARM = 2, COLD = 0, CUT = -3;

const fmt = (tpl, ...args) => {
  let i = 0;
  return tpl.replace(/%[sd]/g, () => String(args[i++]));
};

export class Comms {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('comms');
    this.head = document.getElementById('commsName');
    this.sub = document.getElementById('commsSub');
    this.feed = document.getElementById('commsFeed');
    this.acts = document.getElementById('commsActs');
    this.open = false;
    this.state = null;

    this.acts.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-do]');
      if (!b) return;
      this._act(b.dataset.do, b.dataset.arg);
    });
  }

  /** Species of a contact: patrols and Institute hulls answer to the
   *  registry wherever they fly; everyone else answers to whoever owns the
   *  system's sky. */
  speciesOf(contact) {
    if (contact.faction === 'institute' || contact.craftKind === 'patrol') return SPECIES.institute;
    const owner = this.game.territory.owner[this.game.currentSystemId];
    return SPECIES[owner] || SPECIES.institute;
  }

  openFor(contact, speciesId = null) {
    const g = this.game;
    const sp = speciesId ? SPECIES[speciesId] : this.speciesOf(contact);
    const seed = (g.currentSystemId * 7919 + [...contact.name].reduce((s, c) => s + c.charCodeAt(0), 0)) >>> 0;
    this.state = {
      contact, sp, seed,
      rnd: mulberry32(seed),
      posture: null, fit: 0,
      offer: this._makeOffer(sp, seed),
      rounds: 0, price: 0,
      done: false, rumorGiven: false,
    };
    this.open = true;
    this.root.classList.remove('hidden', 'closing');
    this.head.textContent = contact.name;
    this.sub.textContent = `${sp.name} · CHANNEL OPEN`;
    this.feed.innerHTML = '';
    this._line(`Hailing ${contact.name}. They are listening. Choose how you open.`, 'sys');
    this._buttons(POSTURES.map((p) => ({ do: 'posture', arg: p, label: p.toUpperCase() })));
    g.audio.ping('ui');
  }

  /** One lot per contact: what their culture sheds cheap or hungers for. */
  _makeOffer(sp, seed) {
    const rnd = mulberry32((seed ^ 0x0ffe12) >>> 0);
    const ids = Object.keys(sp.bias);
    if (!ids.length) return null;                    // the Institute doesn't deal
    const id = ids[Math.floor(rnd() * ids.length)];
    const bias = sp.bias[id];
    const mode = bias > 1 ? 'buy' : 'sell';          // they buy what they overvalue
    const qty = 2 + Math.floor(rnd() * 5);
    const fair = commodity(id).base;
    return { mode, id, qty, bias, fair, stubbornRoll: rnd() };
  }

  _line(text, cls = '') {
    const div = document.createElement('div');
    div.className = `cm-line ${cls}`;
    div.textContent = text;
    this.feed.appendChild(div);
    this.feed.scrollTop = this.feed.scrollHeight;
  }

  _buttons(list) {
    this.acts.innerHTML = list.map((b) =>
      `<button data-do="${b.do}" ${b.arg ? `data-arg="${b.arg}"` : ''}>${b.label}</button>`).join('');
  }

  _menu() {
    const s = this.state;
    const list = [];
    if (!s.rumorGiven) list.push({ do: 'ask', label: 'ASK FOR NEWS' });
    if (s.offer && s.fit > CUT) {
      const noun = commodity(s.offer.id).name.toUpperCase();
      list.push({
        do: 'trade',
        label: s.offer.mode === 'sell' ? `THEY SELL ${s.offer.qty} ${noun}` : `THEY BUY ${s.offer.qty} ${noun}`,
      });
    }
    list.push({ do: 'end', label: 'BREAK CONTACT' });
    this._buttons(list);
  }

  _act(what, arg) {
    const s = this.state;
    if (!s) return;
    if (what === 'close') return this.close();
    if (s.done) return;
    const g = this.game;
    const v = VOICE[s.sp.id];

    if (what === 'posture') {
      s.posture = arg;
      s.fit = postureFit(s.sp, arg, g.rumors.rep[s.sp.id] || 0);
      if (s.fit <= CUT) {
        this._line(v.insulted, 'them');
        return this._end(-1);
      }
      const tier = s.fit >= WARM ? 'warm' : s.fit >= COLD ? 'cool' : 'cold';
      this._line(v.greet[tier], 'them');
      g.audio.ping('switch');
      return this._menu();
    }

    if (what === 'ask') {
      s.rumorGiven = true;
      if (s.fit < COLD) {
        this._line(v.rumorRefuse, 'them');
      } else {
        const rumor = g.rumors.generate(s.sp.id, s.seed);
        if (!rumor) {
          this._line(v.rumorRefuse, 'them');
        } else if (s.fit >= WARM) {
          g.rumors.hear(rumor);
          this._line(fmt(v.rumorGive, rumor.text), 'them');
          this._line('Filed to the rumor ledger.', 'sys');
        } else {
          const fee = 20 + Math.floor(s.rnd() * 40);
          if (g.economy.credits < fee) {
            this._line(fmt(v.rumorPaid, fee), 'them');
            this._line('You cannot cover the fee.', 'sys');
          } else {
            g.economy.credits -= fee;
            g.economy.save();
            g.rumors.hear(rumor);
            this._line(fmt(v.rumorPaid, fee), 'them');
            this._line(`Paid ${fee} cr. Filed to the rumor ledger.`, 'sys');
          }
        }
      }
      return this._menu();
    }

    if (what === 'trade') {
      if (!s.offer) { this._line(v.tradeOpen, 'them'); return this._menu(); }
      const o = s.offer;
      const noun = commodity(o.id).name.toLowerCase();
      // Their walk starts padded away from a reservation you never see.
      const res = o.fair * o.bias * (o.mode === 'sell' ? 0.95 - 0.03 * s.fit : 1.05 + 0.03 * s.fit);
      const pad = 0.30 + 0.25 * s.sp.stubborn - 0.05 * s.fit;
      s.reservation = res;
      s.price = Math.max(1, Math.round(o.mode === 'sell' ? res * (1 + pad) : res * (1 - pad)));
      s.rounds = 0;
      this._line(fmt(o.mode === 'sell' ? v.tradeSell : v.tradeBuy, o.qty, noun, s.price), 'them');
      return this._buttons([
        { do: 'accept', label: `ACCEPT · ${s.price}/u` },
        { do: 'counter', label: 'COUNTER' },
        { do: 'walk', label: 'WALK AWAY' },
      ]);
    }

    if (what === 'counter') {
      const o = s.offer;
      s.rounds++;
      // Patience: three rounds warm, two neutral, one cold.
      const patience = s.fit >= WARM ? 3 : s.fit >= COLD ? 2 : 1;
      const concession = Math.max(0.15, Math.min(0.7, 0.4 + 0.1 * s.fit));
      const target = s.reservation;
      const next = o.mode === 'sell'
        ? Math.max(Math.round(target), Math.round(s.price - (s.price - target) * concession))
        : Math.min(Math.round(target), Math.round(s.price + (target - s.price) * concession));
      const moved = next !== s.price;
      s.price = next;
      if (s.rounds >= patience || !moved) {
        this._line(fmt(VOICE[s.sp.id].counterBad, s.price), 'them');
        return this._buttons([
          { do: 'accept', label: `ACCEPT · ${s.price}/u` },
          { do: 'walk', label: 'WALK AWAY' },
        ]);
      }
      this._line(fmt(VOICE[s.sp.id].counterGood, s.price), 'them');
      return this._buttons([
        { do: 'accept', label: `ACCEPT · ${s.price}/u` },
        { do: 'counter', label: 'COUNTER' },
        { do: 'walk', label: 'WALK AWAY' },
      ]);
    }

    if (what === 'accept') {
      const o = s.offer;
      const eco = g.economy;
      const noun = commodity(o.id).name;
      if (o.mode === 'sell') {
        const room = eco.cargoCap - eco.cargoUsed();
        const afford = Math.floor(eco.credits / s.price);
        const n = Math.min(o.qty, room, afford);
        if (n <= 0) {
          this._line(`You cannot take the lot — ${room <= 0 ? 'hold is full' : 'ledger is short'}.`, 'sys');
          return this._buttons([{ do: 'walk', label: 'WALK AWAY' }]);
        }
        eco.credits -= n * s.price;
        eco.cargo[o.id] = (eco.cargo[o.id] || 0) + n;
        eco.save();
        this._line(`${n} ${noun} aboard · −${n * s.price} cr.`, 'sys');
      } else {
        const held = eco.cargo[o.id] || 0;
        const n = Math.min(o.qty, held);
        if (n <= 0) {
          this._line(`You hold no ${noun.toLowerCase()} to sell.`, 'sys');
          return this._buttons([{ do: 'walk', label: 'WALK AWAY' }]);
        }
        eco.cargo[o.id] = held - n;
        if (!eco.cargo[o.id]) delete eco.cargo[o.id];
        eco.credits += n * s.price;
        eco.save();
        this._line(`${n} ${noun} away · +${n * s.price} cr.`, 'sys');
      }
      this._line(VOICE[s.sp.id].accept, 'them');
      g.audio.ping('objective');
      s.offer = null;
      return this._menu();
    }

    if (what === 'walk') {
      this._line(VOICE[s.sp.id].walk, 'them');
      return this._menu();
    }

    if (what === 'end') return this._end(s.fit >= COLD ? 1 : 0);
  }

  _end(repDelta) {
    const s = this.state;
    const g = this.game;
    if (repDelta) g.rumors.bumpRep(s.sp.id, repDelta);
    if (s.contact.craft) s.contact.craft.talked = true;    // channel spent
    s.done = true;
    this._line(VOICE[s.sp.id].farewell, 'them');
    this._buttons([{ do: 'close', label: 'CLOSE CHANNEL' }]);
    g.audio.ping('ui');
  }

  close() {
    if (!this.open) return;
    // Leaving mid-conversation still spends the contact.
    if (this.state && !this.state.done && this.state.contact.craft) {
      this.state.contact.craft.talked = true;
    }
    this.open = false;
    this.state = null;
    this.root.classList.add('closing');
    clearTimeout(this._closeT);
    this._closeT = setTimeout(() => {
      this.root.classList.remove('closing');
      this.root.classList.add('hidden');
    }, 220);
  }
}
