import { COMMODITIES } from '../econ/Economy.js';
import { OUTFITS } from '../ship/Outfitting.js';
import { ROLES } from '../game/Crew.js';
import { t, tx, goodName, goodDesc, onLangChange } from './i18n.js';

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
    onLangChange(() => { if (this.open) this.render(); });
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
          this.game.hud.log(`${t('dock.logChartsSold')} · +${paid} cr`, 'ok');
          this.render();
        }
        return;
      }
      if (b.dataset.act === 'fit') {
        const ok = this.game.outfit.buy(b.dataset.id);
        this.game.audio.ping(ok ? 'objective' : 'deny');
        if (ok) {
          this.game.hud.log(`${t('dock.logFitted')} · ${tx(`o.${b.dataset.id}.name`, OUTFITS[b.dataset.id].name).toUpperCase()}`, 'ok');
          this.render();
        }
        return;
      }
      if (b.dataset.act === 'take') {
        const offer = this._offers.find((o) => o.id === b.dataset.id);
        const ok = offer && this.game.contracts.accept(offer);
        this.game.audio.ping(ok ? 'objective' : 'deny');
        if (ok) {
          this.game.hud.log(`${t('dock.logTaken')} · ${this.game.contracts.label(offer)}`, 'ok');
          this.render();
        }
        return;
      }
      if (b.dataset.act === 'deliver') {
        const c = this.game.contracts.taken.find((x) => String(x.ref) === b.dataset.id);
        const paid = c && this.game.contracts.deliver(c);
        this.game.audio.ping(paid ? 'objective' : 'deny');
        if (paid) {
          this.game.hud.log(`${t('dock.logDelivered')} · +${paid} cr`, 'ok');
          this.render();
        }
        return;
      }
      if (b.dataset.act === 'hire') {
        const rec = this._hires.find((h) => h.id === b.dataset.id);
        const ok = rec && this.game.crew.hire(rec);
        this.game.audio.ping(ok ? 'objective' : 'deny');
        if (ok) {
          this.game.hud.log(`${t('dock.logSigned')} · ${rec.name.toUpperCase()}`, 'ok');
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
    const now = g.time;

    this.head.textContent = st.name;
    this.sub.textContent = t('dock.berth');
    this.root.querySelector('[data-depart]').textContent = t('dock.depart');
    this.ledger.innerHTML =
      `<span class="dk-cr">${eco.credits.toLocaleString('en-US')} <i>cr</i></span>`
      + `<span class="dk-hold${held >= eco.cargoCap ? ' full' : ''}">${t('dock.hold')} ${held}/${eco.cargoCap}</span>`
      + `<span class="dk-hold${g.ship.fuel < 8 ? ' full' : ''}">${t('dock.lucent')} ${Math.floor(g.ship.fuel)}/${g.ship.fuelCap}</span>`;

    const rows = COMMODITIES.map((c) => {
      const gd = market.byId.get(c.id);
      const price = eco.priceAt(market, c.id, now);
      const have = eco.cargo[c.id] || 0;
      const canBuy = gd.stock > 0 && eco.credits >= price && held < eco.cargoCap;
      const tag = gd.role === 'produces' ? `<i class="dk-tag prod">${t('dock.produces')}</i>`
        : gd.role === 'demands' ? `<i class="dk-tag want">${t('dock.wanted')}</i>` : '';
      /* The reference the price column never had. "43 cr" is not information
         to anyone who has not memorised the eight base values; "+79%" is the
         entire decision, and it is the difference between a board you read and
         a board you consult a wiki about. c.base is the commodity's standard
         value from Economy.js, which is exactly what every station's price
         oscillates around, so the deviation is a true measure of local
         scarcity rather than a comparison against some remembered station.
         Within 5% of standard it reads as par and greys out: the tolerance is
         wide enough that ordinary drift does not paint the whole column, and
         narrow enough that a genuine surplus or shortage always shows. */
      const dev = Math.round((price / c.base - 1) * 100);
      const devCls = Math.abs(dev) <= 5 ? 'par' : dev < 0 ? 'cheap' : 'dear';
      return `<tr class="${gd.role || ''}">
        <td class="dk-name">${goodName(c.id, c.name)}${tag}<em>${goodDesc(c.id, c.desc)}</em></td>
        <td class="dk-num">${price} <i>cr</i></td>
        <td class="dk-num dk-dev ${devCls}">${dev > 0 ? '+' : ''}${dev}%</td>
        <td class="dk-num">${gd.stock || '—'}</td>
        <td class="dk-num">${have || '—'}</td>
        <td class="dk-act">
          <button data-act="buy" data-id="${c.id}" ${canBuy ? '' : 'disabled'}>${t('dock.buy')}</button>
          <button data-act="sell" data-id="${c.id}" ${have ? '' : 'disabled'}>${t('dock.sell')}</button>
        </td></tr>`;
    }).join('');

    /* Charts: surveys this dock has not bought yet. */
    const sellable = g.lanes.sellableAt(this.stationKey());
    const chartValue = sellable.reduce((s, e) => s + g.lanes.chartValue(e), 0);
    const chartsBtn = sellable.length
      ? `<div class="dk-charts"><span>${sellable.length} lane survey${sellable.length > 1 ? 's' : ''} aboard —
          ${sellable.map((e) => `${g.galaxy[e.a].name}–${g.galaxy[e.b].name}`).join(' · ')}</span>
         <button data-act="charts">${t('dock.charts')} · ${chartValue} cr</button></div>`
      : '';

    /* The yard. Fuel first, because a ship that cannot leave has no use for
       anything else on this screen. */
    const ship = g.ship;
    const dry = ship.fuelCap - ship.fuel;
    const fuelBlock = `<h3 class="dk-h3">${t('dock.yard')}</h3>
      <div class="dk-charts">
        <span>${t('dock.fuelLine', { '%P': FUEL_PRICE, '%A': Math.floor(ship.fuel), '%B': ship.fuelCap })}</span>
        <button data-act="fuel" ${dry >= 1 && eco.credits >= FUEL_PRICE ? '' : 'disabled'}>
          ${t('dock.refuel')} · 1 t${dry >= 10 && eco.credits >= FUEL_PRICE * 10 ? ' · SHIFT for 10' : ''}</button>
      </div>`;

    const fitRows = Object.entries(OUTFITS).map(([id, o]) => {
      const at = g.outfit.tier[id] || 0;
      const cur = g.outfit.spec(id);
      const nx = g.outfit.next(id);
      const afford = nx && eco.credits >= nx.cost;
      return `<tr>
        <td class="dk-name">${tx(`o.${id}.name`, o.name)}<em>${tx(`o.${id}.blurb`, o.blurb)}</em></td>
        <td class="dk-num">${tx(`o.${id}.${at}`, cur.label)}</td>
        <td class="dk-act">${nx
    ? `<button data-act="fit" data-id="${id}" ${afford ? '' : 'disabled'}>
             ${tx(`o.${id}.${at + 1}`, nx.label)} · ${nx.cost.toLocaleString('en-US')} cr</button>`
    : `<span class="dk-max">${t('dock.fullyFitted')}</span>`}</td></tr>`;
    }).join('');
    const fitBlock = `<table class="dk-table"><thead><tr>
        <th>${t('dock.system')}</th><th class="dk-num">${t('dock.fitted')}</th><th></th></tr></thead>
      <tbody>${fitRows}</tbody></table>`;

    /* The board. Deliveries you can settle right here come first — a player
       holding finished cargo should never have to hunt for the button. */
    const C = g.contracts;
    C.expire(now);
    const due = C.deliverable(g.currentSystemId, now);
    const dueBlock = due.length ? due.map((c) => `<div class="dk-charts">
        <span>${t('dock.ready')}: ${C.label(c)}</span>
        <button data-act="deliver" data-id="${c.ref}">${t('dock.deliver')} · ${c.pay.toLocaleString('en-US')} cr</button>
      </div>`).join('') : '';

    this._offers = C.offers(g.currentSystemId, st.station.idx, now);
    const mins = (secs) => `${Math.max(0, Math.round(secs / 60))} ${t('dock.min')}`;
    const offerRows = this._offers.map((o) => {
      const taken = C.isTaken(o.id);
      const holding = eco.cargo[o.goodId] || 0;
      return `<tr>
        <td class="dk-name">${C.label(o)}
          <em>${o.ly.toFixed(1)} ly · ${t('dock.due')} ${mins(o.due - now)}${o.risk > 0.2 ? ` · <b class="dk-risk">${t('dock.hazard')}</b>` : ''}
          · ${t('dock.holding')} ${holding}/${o.qty}</em></td>
        <td class="dk-num">${o.pay.toLocaleString('en-US')} <i>cr</i></td>
        <td class="dk-act">${taken
    ? `<span class="dk-max">${t('dock.accepted')}</span>`
    : `<button data-act="take" data-id="${o.id}">${t('dock.take')}</button>`}</td></tr>`;
    }).join('');
    const boardBlock = `<h3 class="dk-h3">${t('dock.board')}${C.taken.length
      ? ` · ${C.taken.length} ${t('dock.inHand')}` : ''}</h3>
      ${dueBlock}
      <table class="dk-table"><thead><tr>
        <th>${t('dock.consignment')}</th><th class="dk-num">${t('dock.fee')}</th><th></th></tr></thead>
      <tbody>${offerRows}</tbody></table>`;

    /* The bar. One of each speciality, four berths, and whoever is drinking
       here this week. */
    this._hires = g.crew.roster(g.currentSystemId, st.station.idx, now);
    const hireRows = this._hires.map((h) => {
      const role = ROLES[h.role];
      const have = g.crew.has(h.role);
      const full = g.crew.aboard.length >= 4;
      return `<tr>
        <td class="dk-name">${h.name}<em>${tx(`r.${h.role}.title`, role.title)} — ${tx(`r.${h.role}.blurb`, role.blurb)}</em></td>
        <td class="dk-num">${tx(`r.${h.role}.effect`, role.effect)}</td>
        <td class="dk-act">${have ? `<span class="dk-max">${t('dock.berthFilled')}</span>`
    : `<button data-act="hire" data-id="${h.id}" ${full || eco.credits < h.fee ? 'disabled' : ''}>
             ${t('dock.signOn')} · ${h.fee.toLocaleString('en-US')} cr</button>`}</td></tr>`;
    }).join('');
    const crewBlock = `<h3 class="dk-h3">${t('dock.bar')}${g.crew.aboard.length
      ? ` · ${g.crew.aboard.length}/4 ${t('dock.aboard')}` : ''}</h3>
      <table class="dk-table"><tbody>${hireRows}</tbody></table>`;

    /* The traffic report: other boards, as stale as their distance. */
    const reports = eco.reports(g.currentSystemId, now, this.stationKey());
    const repRows = reports.map((r) => {
      const age = r.age < 1 ? t('dock.live')
        : r.age < 90 ? `${Math.round(r.age)}s ${t('dock.old')}`
          : `${Math.round(r.age / 60)}m ${t('dock.old')}`;
      const cells = r.goods.map((x) =>
        `<span class="dk-rep ${x.role === 'demands' ? 'want' : 'prod'}">
          ${x.id.toUpperCase()} ${x.price}<i>cr</i></span>`).join('');
      return `<tr><td class="dk-name">${r.name}<em>${r.ly.toFixed(1)} ly ${t('dock.byLane')} ·
        ${t('dock.report')} ${age}${r.event ? ` · <b class="dk-risk">${r.event.label.toUpperCase()}</b>` : ''}</em></td>
        <td class="dk-repcell">${cells}</td></tr>`;
    }).join('');
    const repBlock = reports.length
      ? `<h3 class="dk-h3">${t('dock.reports')}</h3>
         <table class="dk-table dk-reptable"><tbody>${repRows}</tbody></table>
         <div class="dk-note">${t('dock.reportsNote')}</div>`
      : '';

    this.main.innerHTML = `<table class="dk-table">
      <thead><tr><th>${t('dock.commodity')}</th><th class="dk-num">${t('dock.price')}</th>
        <th class="dk-num dk-dev">${t('dock.vsBase')}</th>
        <th class="dk-num">${t('dock.stock')}</th><th class="dk-num">${t('dock.held')}</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
      ${chartsBtn}
      <div class="dk-note">${t('dock.note')}</div>
      ${boardBlock}
      ${crewBlock}
      ${fuelBlock}
      ${fitBlock}
      ${repBlock}`;
  }
}
