import { mulberry32 } from '../world/generate.js';
import { commodity } from '../econ/Economy.js';
import { SPECIES, VOICE, POSTURES, postureFit } from './Species.js';
import { t, tx, goodName } from '../ui/i18n.js';

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
      if (!b || b.disabled) return;
      this._act(b.dataset.do, b.dataset.arg);
    });
  }

  /** Species of a contact: patrols and Registry hulls answer to the
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
    this.sub.textContent = `${sp.name} · ${t('comms.open')}`;
    this.feed.innerHTML = '';
    this._dealEl = null;              // orphaned by the innerHTML clear above
    this._line(t('comms.hailing', { '%N': contact.name }), 'sys');
    this._buttons(POSTURES.map((p) => ({ do: 'posture', arg: p, label: t(`comms.${p}`) })));
    g.audio.ping('ui');
  }

  /** One lot per contact: what their culture sheds cheap or hungers for. */
  _makeOffer(sp, seed) {
    const rnd = mulberry32((seed ^ 0x0ffe12) >>> 0);
    const ids = Object.keys(sp.bias);
    if (!ids.length) return null;                    // the Registry doesn't deal
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

  /** What the player just said, in their own half of the transcript.
   *
   *  The screen used to record only the contact's side, which made an
   *  encounter unreadable the moment you looked away: four amber paragraphs
   *  with no record of the posture that provoked them, and the posture is the
   *  one irreversible choice in the whole exchange. It echoes the verb rather
   *  than inventing prose for it, so it costs no new writing and no new
   *  translation — the button already carries a translated string, and that
   *  string is a perfectly good record of what was sent.
   *
   *  It is raised here inside _act rather than read off the clicked element
   *  on purpose: _act is also driven directly by tools/judgeset.mjs and by the
   *  keyboard, and an echo that only works when a mouse was involved would be
   *  missing from exactly the frames that get judged. */
  _said(text) {
    this._line(`▸ ${text}`, 'you');
  }

  /** The deal, as a number.
   *
   *  One strip, always the last thing in the transcript, replaced rather than
   *  stacked — a counter-offer is a correction to the quote, not a second
   *  quote, and three of them piling up would bury the live one. Removing and
   *  re-appending is also what keeps it directly above the verb row after the
   *  contact has said something in between. */
  _deal(html) {
    if (this._dealEl) this._dealEl.remove();
    this._dealEl = null;
    if (!html) return;
    const d = document.createElement('div');
    d.className = 'cm-deal';
    d.innerHTML = html;
    this.feed.appendChild(d);
    this._dealEl = d;
    this.feed.scrollTop = this.feed.scrollHeight;
  }

  /** The live quote, priced against the commodity's standard value.
   *
   *  Which way "good" points depends on the direction of the trade: when they
   *  are selling, under standard is the player's win; when they are buying,
   *  over standard is. Getting that backwards would be worse than showing
   *  nothing, so it is derived from o.mode rather than from the sign. */
  _dealStrip() {
    const s = this.state;
    const o = s.offer;
    if (!o || !s.price) return this._deal('');
    const base = commodity(o.id).base;
    const dev = Math.round((s.price / base - 1) * 100);
    const good = o.mode === 'sell' ? dev < 0 : dev > 0;
    /* The strip states the offer — the whole lot, at the price on the table.
       What the player can actually move out of it is a different number and it
       lives on the ACCEPT button, so the two read as "here is the deal" and
       "here is what pressing this does" rather than as the same figure printed
       twice sixty pixels apart. */
    this._deal(`<b>${s.price}</b><i>${t('comms.perUnit')}</i>`
      + `<em class="${Math.abs(dev) <= 4 ? '' : good ? 'good' : 'bad'}">`
      + `${t('comms.vsBase', { '%S': `${dev > 0 ? '+' : ''}${dev}%` })}</em>`
      + `<span>${o.qty} × ${s.price} = ${o.mode === 'sell' ? '−' : '+'}${(o.qty * s.price).toLocaleString('en-US')} cr</span>`);
  }

  /** How much of the lot this deal can actually move, at the price currently
   *  on the button.
   *
   *  This arithmetic used to live inside the accept handler, which meant the
   *  screen let you commit to a lot of five, then took two and told you why
   *  afterwards — or refused outright, after the click, with the reason in a
   *  system line you had to go back and read. It is four comparisons; there is
   *  no reason not to know the answer before the control is drawn. */
  _fillable() {
    const s = this.state;
    const o = s.offer;
    const eco = this.game.economy;
    if (!o || !s.price) return 0;
    const cap = o.mode === 'sell'
      ? Math.min(eco.cargoCap - eco.cargoUsed(), Math.floor(eco.credits / s.price))
      : (eco.cargo[o.id] || 0);
    return Math.max(0, Math.min(o.qty, cap));
  }

  /** Why the lot cannot be moved, in the player's language, or '' if it can. */
  _blocker() {
    const s = this.state;
    const o = s.offer;
    const eco = this.game.economy;
    if (this._fillable() > 0) return '';
    if (o.mode !== 'sell') return t('comms.noneHeld');
    return eco.cargoCap - eco.cargoUsed() <= 0 ? t('comms.holdFull') : t('comms.shortLedger');
  }

  /** ACCEPT / COUNTER / WALK, differentiated and honest about what they do. */
  _dealButtons(canCounter) {
    const s = this.state;
    const o = s.offer;
    const n = this._fillable();
    const why = this._blocker();
    const list = [{
      do: 'accept',
      cls: 'pri',
      off: !!why,
      label: `${t('comms.accept')} · ${s.price}/u`,
      /* What pressing it does, in the two numbers that matter: how much of the
         lot moves and what the ledger does. A partial fill says so here —
         "2/5" is the whole warning — instead of being discovered afterwards in
         a system line, which is how it worked before and is the difference
         between a screen that answers itself and one that surprises you. */
      sub: why || (n < o.qty ? `${n}/${o.qty} · ` : '')
        + `${o.mode === 'sell' ? '−' : '+'}${(n * s.price).toLocaleString('en-US')} cr`,
    }];
    if (canCounter) list.push({ do: 'counter', label: t('comms.counter') });
    list.push({ do: 'walk', cls: 'ghost', label: t('comms.walk') });
    return this._buttons(list);
  }

  _buttons(list) {
    this.acts.innerHTML = list.map((b) =>
      `<button data-do="${b.do}"${b.arg ? ` data-arg="${b.arg}"` : ''}`
      + `${b.cls ? ` class="${b.cls}"` : ''}${b.off ? ' disabled' : ''}>`
      + `${b.label}${b.sub ? `<em>${b.sub}</em>` : ''}</button>`).join('');
  }

  /** The one string for "open the lot", so the button and the echo of pressing
   *  it cannot drift apart. */
  _tradeLabel() {
    const o = this.state.offer;
    const noun = goodName(o.id, commodity(o.id).name).toUpperCase();
    return `${o.mode === 'sell' ? t('comms.theySell') : t('comms.theyBuy')} ${o.qty} ${noun}`;
  }

  _menu() {
    const s = this.state;
    const list = [];
    if (!s.rumorGiven) list.push({ do: 'ask', label: t('comms.ask') });
    if (s.offer && s.fit > CUT) list.push({ do: 'trade', label: this._tradeLabel() });
    list.push({ do: 'end', cls: 'ghost', label: t('comms.end') });
    this._buttons(list);
  }

  _act(what, arg) {
    const s = this.state;
    if (!s) return;
    if (what === 'close') return this.close();
    if (s.done) return;
    const g = this.game;
    const v = VOICE[s.sp.id];
    /* Species.js owns the voices and their English; only the line that gets
       spoken crosses over, keyed by species and field. One accessor rather
       than fourteen call sites each remembering to ask. */
    const say = (path, fallback) => tx(`voice.${s.sp.id}.${path}`, fallback);

    if (what === 'posture') {
      s.posture = arg;
      this._said(t(`comms.${arg}`));
      s.fit = postureFit(s.sp, arg, g.rumors.rep[s.sp.id] || 0);
      if (s.fit <= CUT) {
        this._line(say('insulted', v.insulted), 'them');
        return this._end(-1);
      }
      const tier = s.fit >= WARM ? 'warm' : s.fit >= COLD ? 'cool' : 'cold';
      this._line(say(`greet.${tier}`, v.greet[tier]), 'them');
      g.audio.ping('switch');
      return this._menu();
    }

    if (what === 'ask') {
      this._said(t('comms.ask'));
      s.rumorGiven = true;
      if (s.fit < COLD) {
        this._line(say('rumorRefuse', v.rumorRefuse), 'them');
      } else {
        const rumor = g.rumors.generate(s.sp.id, s.seed);
        if (!rumor) {
          this._line(say('rumorRefuse', v.rumorRefuse), 'them');
        } else if (s.fit >= WARM) {
          g.rumors.hear(rumor);
          this._line(fmt(say('rumorGive', v.rumorGive), rumor.text), 'them');
          this._line(t('comms.filed'), 'sys');
        } else {
          const fee = 20 + Math.floor(s.rnd() * 40);
          if (g.economy.credits < fee) {
            this._line(fmt(say('rumorPaid', v.rumorPaid), fee), 'them');
            this._line(t('comms.cannotPay'), 'sys');
          } else {
            g.economy.credits -= fee;
            g.economy.save();
            g.rumors.hear(rumor);
            this._line(fmt(say('rumorPaid', v.rumorPaid), fee), 'them');
            this._line(t('comms.paidFiled', { '%F': fee }), 'sys');
          }
        }
      }
      return this._menu();
    }

    if (what === 'trade') {
      if (!s.offer) { this._line(say('tradeOpen', v.tradeOpen), 'them'); return this._menu(); }
      const o = s.offer;
      this._said(this._tradeLabel());
      const noun = goodName(o.id, commodity(o.id).name).toLowerCase();
      // Their walk starts padded away from a reservation you never see.
      const res = o.fair * o.bias * (o.mode === 'sell' ? 0.95 - 0.03 * s.fit : 1.05 + 0.03 * s.fit);
      const pad = 0.30 + 0.25 * s.sp.stubborn - 0.05 * s.fit;
      s.reservation = res;
      s.price = Math.max(1, Math.round(o.mode === 'sell' ? res * (1 + pad) : res * (1 - pad)));
      s.rounds = 0;
      this._line(fmt(o.mode === 'sell' ? say('tradeSell', v.tradeSell) : say('tradeBuy', v.tradeBuy),
        o.qty, noun, s.price), 'them');
      this._dealStrip();
      return this._dealButtons(true);
    }

    if (what === 'counter') {
      const o = s.offer;
      this._said(t('comms.counter'));
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
        this._line(fmt(tx(`voice.${s.sp.id}.counterBad`, VOICE[s.sp.id].counterBad), s.price), 'them');
        this._dealStrip();
        return this._dealButtons(false);
      }
      this._line(fmt(tx(`voice.${s.sp.id}.counterGood`, VOICE[s.sp.id].counterGood), s.price), 'them');
      this._dealStrip();
      return this._dealButtons(true);
    }

    if (what === 'accept') {
      const o = s.offer;
      const eco = g.economy;
      const noun = goodName(o.id, commodity(o.id).name);
      this._said(`${t('comms.accept')} · ${s.price}/u`);
      /* The control is disabled when this cannot go through, so reaching here
         means either the keyboard path or a harness driving _act directly.
         The guard stays — refusing silently would be worse than saying why —
         but it is no longer how a player finds out. */
      const n = this._fillable();
      if (n <= 0) {
        this._line(this._blocker(), 'sys');
        this._deal('');
        return this._buttons([{ do: 'walk', cls: 'ghost', label: t('comms.walk') }]);
      }
      if (o.mode === 'sell') {
        eco.credits -= n * s.price;
        eco.cargo[o.id] = (eco.cargo[o.id] || 0) + n;
        eco.save();
        this._line(t('comms.aboard', { '%N': n, '%G': noun, '%C': n * s.price }), 'sys');
      } else {
        eco.cargo[o.id] = (eco.cargo[o.id] || 0) - n;
        if (!eco.cargo[o.id]) delete eco.cargo[o.id];
        eco.credits += n * s.price;
        eco.save();
        this._line(t('comms.away', { '%N': n, '%G': noun, '%C': n * s.price }), 'sys');
      }
      this._line(tx(`voice.${s.sp.id}.accept`, VOICE[s.sp.id].accept), 'them');
      g.audio.ping('objective');
      s.offer = null;
      this._deal('');                   // the lot is gone; so is the quote
      return this._menu();
    }

    if (what === 'walk') {
      this._said(t('comms.walk'));
      this._line(tx(`voice.${s.sp.id}.walk`, VOICE[s.sp.id].walk), 'them');
      this._deal('');
      return this._menu();
    }

    if (what === 'end') {
      this._said(t('comms.end'));
      return this._end(s.fit >= COLD ? 1 : 0);
    }
  }

  _end(repDelta) {
    const s = this.state;
    const g = this.game;
    if (repDelta) g.rumors.bumpRep(s.sp.id, repDelta);
    if (s.contact.craft) s.contact.craft.talked = true;    // channel spent
    s.done = true;
    this._deal('');
    this._line(tx(`voice.${s.sp.id}.farewell`, VOICE[s.sp.id].farewell), 'them');
    this._buttons([{ do: 'close', cls: 'ghost', label: t('comms.close') }]);
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
