import { COMMODITIES } from '../econ/Economy.js';
import { OUTFITS } from '../ship/Outfitting.js';
import { ROLES } from '../game/Crew.js';

/* ============================================================================
   The dock screen: what you see with your ship on a berth.

   One table is the whole interface. Every row answers the only three
   questions a trader has — what does it cost here, do they have any, and do I
   have any — and the two verbs sit on the row itself. No modes, no
   confirmation dialogs: a click moves one unit, shift-click moves five, and
   the ledger at the top reacts on the same frame. Regret is handled by the
   opposite button, which is faster than any dialog.

   PRODUCES and WANTED tags are printed right on the rows. The player's first
   profitable run should be legible from a single screen: buy the green rows
   here, fly to the neighbour, sell into their green rows.
   ========================================================================== */

/** What a station charges for a tonne of lucent. Flat everywhere: fuel is
 *  infrastructure, not a commodity to arbitrage — that is what the hold is
 *  for. Mining it out of a dead world is what makes it free. */
const FUEL_PRICE = 14;

export class DockScreen {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('dock');
    this.head = document.getElementById('dockName');
    this.sub = document.getElementById('dockSub');
    this.ledger = document.getElementById('dockLedger');
    this.main = document.getElementById('dockMain');
    this.open = false;
    this.station = null;                // the station *body* we are docked at

    this.root.querySelector('[data-depart]').addEventListener('click', () => {
      this.game.undock();
    });
    // Buy/sell is one delegated listener; rows re-render too often to own any.
    this.main.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled) return;
      const eco = this.game.economy;
      if (b.dataset.act === 'charts') {
        const paid = this.game.lanes.sellAt(this.stationKey());
        this.game.audio.ping(paid ? 'objective' : 'deny');
        if (paid) {
          eco.credits += paid;
          eco.save();
          this.game.hud.log(`CHARTS SOLD · +${paid} cr`, 'ok');
          this.render();
        }
        return;
      }
      if (b.dataset.act === 'fit') {
        const ok = this.game.outfit.buy(b.dataset.id);
        this.game.audio.ping(ok ? 'objective' : 'deny');
        if (ok) {
          this.game.hud.log(`FITTED · ${OUTFITS[b.dataset.id].name.toUpperCase()}`, 'ok');
          this.render();
        }
        return;
      }
      if (b.dataset.act === 'take') {
        const offer = this._offers.find((o) => o.id === b.dataset.id);
        const ok = offer && this.game.contracts.accept(offer);
        this.game.audio.ping(ok ? 'objective' : 'deny');
        if (ok) {
          this.game.hud.log(`CONTRACT TAKEN · ${this.game.contracts.label(offer)}`, 'ok');
          this.render();
        }
        return;
      }
      if (b.dataset.act === 'deliver') {
        const c = this.game.contracts.taken.find((x) => String(x.ref) === b.dataset.id);
        const paid = c && this.game.contracts.deliver(c);
        this.game.audio.ping(paid ? 'objective' : 'deny');
        if (paid) {
          this.game.hud.log(`DELIVERED · +${paid} cr`, 'ok');
          this.render();
        }
        return;
      }
      if (b.dataset.act === 'hire') {
        const rec = this._hires.find((h) => h.id === b.dataset.id);
        const ok = rec && this.game.crew.hire(rec);
        this.game.audio.ping(ok ? 'objective' : 'deny');
        if (ok) {
          this.game.hud.log(`SIGNED ON · ${rec.name.toUpperCase()}`, 'ok');
          this.render();
        }
        return;
      }
      if (b.dataset.act === 'fuel') {
        const ship = this.game.ship;
        const want = e.shiftKey ? 10 : 1;
        const room = Math.floor(ship.fuelCap - ship.fuel);
        const n = Math.min(want, room, Math.floor(eco.credits / FUEL_PRICE));
        if (n <= 0) { this.game.audio.ping('deny'); return; }
        eco.credits -= n * FUEL_PRICE;
        ship.fuel += n;
        eco.save();
        this.game.audio.ping('ui');
        this.render();
        return;
      }
      const qty = e.shiftKey ? 5 : 1;
      const market = this.station.station.market;
      const { n } = b.dataset.act === 'buy'
        ? eco.buy(market, b.dataset.id, qty)
        : eco.sell(market, b.dataset.id, qty);
      this.game.audio.ping(n ? 'ui' : 'deny');
      if (n) this.render();
    });
  }

  stationKey() {
    return `${this.game.currentSystemId}:${this.station.station.idx}`;
  }

  /** Prices move while you read them; keep the board honest at ~1 Hz. */
  update() {
    if (!this.open) return;
    if ((this._tick = (this._tick || 0) + 1) % 60) return;
    this.render();
  }

  show(stationBody) {
    this.station = stationBody;
    this.open = true;
    clearTimeout(this._closeT);
    this.root.classList.remove('hidden', 'closing');
    this.render();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.station = null;
    this.root.classList.add('closing');
    clearTimeout(this._closeT);
    this._closeT = setTimeout(() => {
      this.root.classList.remove('closing');
      this.root.classList.add('hidden');
    }, 220);
  }

  render() {
    const g = this.game;
    const eco = g.economy;
    const st = this.station;
    const market = st.station.market;
    const held = eco.cargoUsed();
    const t = g.time;

    this.head.textContent = st.name;
    this.sub.textContent = 'BERTH GRANTED · MARKET LINK OPEN';
    this.ledger.innerHTML =
      `<span class="dk-cr">${eco.credits.toLocaleString('en-US')} <i>cr</i></span>`
      + `<span class="dk-hold${held >= eco.cargoCap ? ' full' : ''}">HOLD ${held}/${eco.cargoCap}</span>`
      + `<span class="dk-hold${g.ship.fuel < 8 ? ' full' : ''}">LUCENT ${Math.floor(g.ship.fuel)}/${g.ship.fuelCap}</span>`;

    const rows = COMMODITIES.map((c) => {
      const gd = market.byId.get(c.id);
      const price = eco.priceAt(market, c.id, t);
      const have = eco.cargo[c.id] || 0;
      const canBuy = gd.stock > 0 && eco.credits >= price && held < eco.cargoCap;
      const tag = gd.role === 'produces' ? '<i class="dk-tag prod">PRODUCES</i>'
        : gd.role === 'demands' ? '<i class="dk-tag want">WANTED</i>' : '';
      return `<tr class="${gd.role || ''}">
        <td class="dk-name">${c.name}${tag}<em>${c.desc}</em></td>
        <td class="dk-num">${price} <i>cr</i></td>
        <td class="dk-num">${gd.stock || '—'}</td>
        <td class="dk-num">${have || '—'}</td>
        <td class="dk-act">
          <button data-act="buy" data-id="${c.id}" ${canBuy ? '' : 'disabled'}>BUY</button>
          <button data-act="sell" data-id="${c.id}" ${have ? '' : 'disabled'}>SELL</button>
        </td></tr>`;
    }).join('');

    /* Charts: surveys this dock has not bought yet. */
    const sellable = g.lanes.sellableAt(this.stationKey());
    const chartValue = sellable.reduce((s, e) => s + g.lanes.chartValue(e), 0);
    const chartsBtn = sellable.length
      ? `<div class="dk-charts"><span>${sellable.length} lane survey${sellable.length > 1 ? 's' : ''} aboard —
          ${sellable.map((e) => `${g.galaxy[e.a].name}–${g.galaxy[e.b].name}`).join(' · ')}</span>
         <button data-act="charts">SELL CHARTS · ${chartValue} cr</button></div>`
      : '';

    /* The yard. Fuel first, because a ship that cannot leave has no use for
       anything else on this screen. */
    const ship = g.ship;
    const dry = ship.fuelCap - ship.fuel;
    const fuelBlock = `<h3 class="dk-h3">THE YARD</h3>
      <div class="dk-charts">
        <span>Lucent, ${FUEL_PRICE} cr the tonne — tank at
          ${Math.floor(ship.fuel)} of ${ship.fuelCap}</span>
        <button data-act="fuel" ${dry >= 1 && eco.credits >= FUEL_PRICE ? '' : 'disabled'}>
          REFUEL · 1 t${dry >= 10 && eco.credits >= FUEL_PRICE * 10 ? ' · SHIFT for 10' : ''}</button>
      </div>`;

    const fitRows = Object.entries(OUTFITS).map(([id, o]) => {
      const cur = g.outfit.spec(id);
      const nx = g.outfit.next(id);
      const afford = nx && eco.credits >= nx.cost;
      return `<tr>
        <td class="dk-name">${o.name}<em>${o.blurb}</em></td>
        <td class="dk-num">${cur.label}</td>
        <td class="dk-act">${nx
    ? `<button data-act="fit" data-id="${id}" ${afford ? '' : 'disabled'}>
             ${nx.label} · ${nx.cost.toLocaleString('en-US')} cr</button>`
    : '<span class="dk-max">FULLY FITTED</span>'}</td></tr>`;
    }).join('');
    const fitBlock = `<table class="dk-table"><thead><tr>
        <th>SYSTEM</th><th class="dk-num">FITTED</th><th></th></tr></thead>
      <tbody>${fitRows}</tbody></table>`;

    /* The board. Deliveries you can settle right here come first — a player
       holding finished cargo should never have to hunt for the button. */
    const C = g.contracts;
    C.expire(t);
    const due = C.deliverable(g.currentSystemId, t);
    const dueBlock = due.length ? due.map((c) => `<div class="dk-charts">
        <span>Consignment ready: ${C.label(c)}</span>
        <button data-act="deliver" data-id="${c.ref}">DELIVER · ${c.pay.toLocaleString('en-US')} cr</button>
      </div>`).join('') : '';

    this._offers = C.offers(g.currentSystemId, st.station.idx, t);
    const mins = (secs) => `${Math.max(0, Math.round(secs / 60))} min`;
    const offerRows = this._offers.map((o) => {
      const taken = C.isTaken(o.id);
      const holding = eco.cargo[o.goodId] || 0;
      return `<tr>
        <td class="dk-name">${C.label(o)}
          <em>${o.ly.toFixed(1)} ly · due in ${mins(o.due - t)}${o.risk > 0.2 ? ' · <b class="dk-risk">HAZARD PAY</b>' : ''}
          · holding ${holding}/${o.qty}</em></td>
        <td class="dk-num">${o.pay.toLocaleString('en-US')} <i>cr</i></td>
        <td class="dk-act">${taken
    ? '<span class="dk-max">ACCEPTED</span>'
    : `<button data-act="take" data-id="${o.id}">TAKE</button>`}</td></tr>`;
    }).join('');
    const boardBlock = `<h3 class="dk-h3">THE BOARD${C.taken.length ? ` · ${C.taken.length} IN HAND` : ''}</h3>
      ${dueBlock}
      <table class="dk-table"><thead><tr>
        <th>CONSIGNMENT</th><th class="dk-num">FEE</th><th></th></tr></thead>
      <tbody>${offerRows}</tbody></table>`;

    /* The bar. One of each speciality, four berths, and whoever is drinking
       here this week. */
    this._hires = g.crew.roster(g.currentSystemId, st.station.idx, t);
    const hireRows = this._hires.map((h) => {
      const role = ROLES[h.role];
      const have = g.crew.has(h.role);
      const full = g.crew.aboard.length >= 4;
      return `<tr>
        <td class="dk-name">${h.name}<em>${role.title} — ${role.blurb}</em></td>
        <td class="dk-num">${role.effect}</td>
        <td class="dk-act">${have ? '<span class="dk-max">BERTH FILLED</span>'
    : `<button data-act="hire" data-id="${h.id}" ${full || eco.credits < h.fee ? 'disabled' : ''}>
             SIGN ON · ${h.fee.toLocaleString('en-US')} cr</button>`}</td></tr>`;
    }).join('');
    const crewBlock = `<h3 class="dk-h3">THE BAR${g.crew.aboard.length
      ? ` · ${g.crew.aboard.length}/4 ABOARD` : ''}</h3>
      <table class="dk-table"><tbody>${hireRows}</tbody></table>`;

    /* The traffic report: other boards, as stale as their distance. */
    const reports = eco.reports(g.currentSystemId, t, this.stationKey());
    const repRows = reports.map((r) => {
      const age = r.age < 1 ? 'live'
        : r.age < 90 ? `${Math.round(r.age)}s old`
          : `${Math.round(r.age / 60)}m old`;
      const cells = r.goods.map((x) =>
        `<span class="dk-rep ${x.role === 'demands' ? 'want' : 'prod'}">
          ${x.id.toUpperCase()} ${x.price}<i>cr</i></span>`).join('');
      return `<tr><td class="dk-name">${r.name}<em>${r.ly.toFixed(1)} ly by lane ·
        report ${age}${r.event ? ` · <b class="dk-risk">${r.event.label.toUpperCase()}</b>` : ''}</em></td>
        <td class="dk-repcell">${cells}</td></tr>`;
    }).join('');
    const repBlock = reports.length
      ? `<h3 class="dk-h3">TRAFFIC REPORTS</h3>
         <table class="dk-table dk-reptable"><tbody>${repRows}</tbody></table>
         <div class="dk-note">quotes ride the freighters — the farther the board, the older the news</div>`
      : '';

    this.main.innerHTML = `<table class="dk-table">
      <thead><tr><th>COMMODITY</th><th class="dk-num">PRICE</th>
        <th class="dk-num">STOCK</th><th class="dk-num">HELD</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
      ${chartsBtn}
      <div class="dk-note">click trades one unit · <kbd>SHIFT</kbd>-click trades five
      · <kbd>ESC</kbd> departs</div>
      ${boardBlock}
      ${crewBlock}
      ${fuelBlock}
      ${fitBlock}
      ${repBlock}`;
  }
}
