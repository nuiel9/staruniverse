import { COMMODITIES } from '../econ/Economy.js';

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
      + `<span class="dk-hold${held >= eco.cargoCap ? ' full' : ''}">HOLD ${held}/${eco.cargoCap}</span>`;

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
        report ${age}</em></td><td class="dk-repcell">${cells}</td></tr>`;
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
      ${repBlock}`;
  }
}
