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
      const qty = e.shiftKey ? 5 : 1;
      const eco = this.game.economy;
      const market = this.station.station.market;
      const n = b.dataset.act === 'buy'
        ? eco.buy(market, b.dataset.id, qty)
        : eco.sell(market, b.dataset.id, qty);
      this.game.audio.ping(n ? 'ui' : 'deny');
      if (n) this.render();
    });
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
    const eco = this.game.economy;
    const st = this.station;
    const market = st.station.market;
    const held = eco.cargoUsed();

    this.head.textContent = st.name;
    this.sub.textContent = 'BERTH GRANTED · MARKET LINK OPEN';
    this.ledger.innerHTML =
      `<span class="dk-cr">${eco.credits.toLocaleString('en-US')} <i>cr</i></span>`
      + `<span class="dk-hold${held >= eco.cargoCap ? ' full' : ''}">HOLD ${held}/${eco.cargoCap}</span>`;

    const rows = COMMODITIES.map((c) => {
      const g = market.byId.get(c.id);
      const have = eco.cargo[c.id] || 0;
      const canBuy = g.stock > 0 && eco.credits >= g.price && held < eco.cargoCap;
      const tag = g.role === 'produces' ? '<i class="dk-tag mk">PRODUCES</i>'
        : g.role === 'demands' ? '<i class="dk-tag want">WANTED</i>' : '';
      return `<tr class="${g.role || ''}">
        <td class="dk-name">${c.name}${tag}<em>${c.desc}</em></td>
        <td class="dk-num">${g.price} <i>cr</i></td>
        <td class="dk-num">${g.stock || '—'}</td>
        <td class="dk-num">${have || '—'}</td>
        <td class="dk-act">
          <button data-act="buy" data-id="${c.id}" ${canBuy ? '' : 'disabled'}>BUY</button>
          <button data-act="sell" data-id="${c.id}" ${have ? '' : 'disabled'}>SELL</button>
        </td></tr>`;
    }).join('');

    this.main.innerHTML = `<table class="dk-table">
      <thead><tr><th>COMMODITY</th><th class="dk-num">PRICE</th>
        <th class="dk-num">STOCK</th><th class="dk-num">HELD</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="dk-note">click trades one unit · <kbd>SHIFT</kbd>-click trades five
      · <kbd>ESC</kbd> departs</div>`;
  }
}
