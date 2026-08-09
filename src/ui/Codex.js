import { CANTOS, LOGS, TYPE_INFO, STAR_INFO, ANOMALY_INFO } from '../game/lore.js';
import { fmtDist } from './HUD.js';
import { t, tx, onLangChange } from './i18n.js';
import { REVELATION_COUNT } from '../game/Mystery.js';

/* The archive: everything you have scanned, plus everything the Hush left. */

export class Codex {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('codex');
    this.nav = document.getElementById('codexNav');
    this.main = document.getElementById('codexMain');
    this.open = false;
    this.sel = 'overview';
    this.dirty = true;
    onLangChange(() => this.markDirty());
  }

  markDirty() { this.dirty = true; if (this.open) this.render(); }

  toggle() { this.open ? this.close() : this.show(); }

  show(section) {
    if (section) this.sel = section;
    this.open = true;
    clearTimeout(this._closeT);
    this.root.classList.remove('hidden', 'closing');
    this.render();
  }

  /* Held in the DOM for the length of the fade-out. Snapping it away was the
     one place the UI cut rather than moved, and it showed. */
  close() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('closing');
    clearTimeout(this._closeT);
    this._closeT = setTimeout(() => {
      this.root.classList.remove('closing');
      this.root.classList.add('hidden');
    }, 220);
  }

  /** Off now, with no transition — for scene set-ups that teleport. */
  hide() {
    this.open = false;
    clearTimeout(this._closeT);
    this.root.classList.remove('closing');
    this.root.classList.add('hidden');
  }

  render() {
    const g = this.game;
    const scanned = g.bodies.filter((b) => b.scanned);

    const groups = [
      {
        title: t('cx.survey'), items: [
          { id: 'overview', label: t('cx.expedition') },
          ...scanned.map((b) => ({ id: 'body:' + b.id, label: b.name })),
        ],
      },
      {
        title: t('cx.cantos'), items: CANTOS.map((c, i) => ({
          id: 'canto:' + c.id, label: tx(`lore.${c.id}.title`, c.title),
          locked: !g.cantos.includes(c.id),
        })),
      },
      {
        title: t('cx.records'), items: LOGS.map((l) => ({
          id: 'log:' + l.id, label: tx(`lore.${l.id}.title`, l.title), locked: !g.logsFound.has(l.id),
        })),
      },
      ...(g.mystery ? [{
        title: t('cx.question'), items: [{
          id: 'question',
          label: `${t('cx.questionLabel')} (${g.mystery.found.size}/${REVELATION_COUNT})`,
        }],
      }] : []),
      ...(g.rumors && g.rumors.heard.length ? [{
        title: t('cx.rumors'), items: [{ id: 'rumors', label: `${t('cx.rumorsLabel')} (${g.rumors.heard.length})` }],
      }] : []),
    ];

    this.nav.innerHTML = groups.map((gr) =>
      `<div class="cx-grp">${gr.title}</div>` + gr.items.map((it) =>
        `<button class="cx-item${it.id === this.sel ? ' on' : ''}${it.locked ? ' locked' : ''}"
           data-id="${it.id}">${it.locked ? t('cx.sealed') : it.label}</button>`).join('')
    ).join('');

    this.nav.querySelectorAll('.cx-item').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.classList.contains('locked')) return;
        this.sel = b.dataset.id;
        this.render();
      });
    });

    this.main.innerHTML = this.renderEntry(this.sel);
    this.dirty = false;
  }

  renderEntry(id) {
    const g = this.game;

    if (id === 'overview') {
      const total = g.galaxy.length;
      const visited = g.galaxy.filter((s) => s.visited).length;
      return `
        <h1 class="cx-title">STAR UNIVERSE</h1>
        <div class="cx-sub">${t('cx.commission')}</div>
        <div class="cx-stats">
          ${stat(t('cx.s.charted'), `${visited} / ${total}`)}
          ${stat(t('cx.s.lanes'), `${g.lanes.charted.size} / ${g.lanes.edges.size}`)}
          ${stat(t('cx.s.ledger'), `${g.economy.credits.toLocaleString('en-US')} cr`)}
          ${stat(t('cx.s.bodies'), g.discoveries.size)}
          ${stat(t('cx.s.resonance'), `${g.state.resonance} / 7`)}
          ${stat(t('cx.s.system'), g.system.star.name)}
          ${stat(t('cx.s.star'), `${g.system.star.cls} · ${Math.round(g.system.star.temp)} K`)}
          ${stat(t('cx.s.hull'), `${Math.round(g.ship.hull * 100)} %`)}
        </div>
        <div class="cx-text">
          <p>${t('cx.overview1')}</p>
          <p>${t('cx.overview2')}</p>
          <p class="q">${t('cx.overviewQ')}</p>
        </div>`;
    }

    if (id.startsWith('canto:')) {
      const c = CANTOS.find((x) => 'canto:' + x.id === id);
      if (!c) return '';
      return `<h1 class="cx-title">${tx(`lore.${c.id}.title`, c.title).toUpperCase()}</h1>
        <div class="cx-sub">${tx(`lore.${c.id}.sub`, c.sub)}</div>
        <div class="cx-text">${c.body.map((p, i) =>
    `<p>${tx(`lore.${c.id}.b${i}`, p)}</p>`).join('')}
        <p class="q">${tx(`lore.${c.id}.q`, c.q)}</p></div>`;
    }

    if (id === 'question') {
      const M = g.mystery;
      /* Mystery.js owns the readings — their ids, their gates and their
         English. Only the three fields that get printed cross the language
         boundary, keyed by the reading's own id. */
      const rev = M.ledger().map((r) => (r.known
        ? `<div class="cx-rev"><h3>${tx(`my.${r.id}.title`, r.title)}</h3>
             <p>${tx(`my.${r.id}.text`, r.text)}</p></div>`
        : `<div class="cx-rev locked"><h3>${t('cx.q.locked')}</h3>
             <p>${tx(`my.${r.id}.need`, r.need)}.</p></div>`)).join('');

      const said = M.testimony();
      const claims = said.length
        ? said.map((c) => `<div class="cx-rumor">
            <p>${tx(`my.claim.${c.species}`, c.text)}</p>
            <div class="cx-rmeta">${c.sources.join(' · ').toUpperCase()}
              ${said.length > 1 ? ` · <b class="cx-contest">${t('cx.q.contested')}</b>` : ` · ${t('cx.q.unchallenged')}`}</div>
          </div>`).join('')
        : `<div class="cx-note">${t('cx.q.nobody')}</div>`;

      return `<h1 class="cx-title">${t('cx.q.title')}</h1>
        <div class="cx-sub">${t('cx.q.sub')}</div>
        <div class="cx-stats">
          ${stat(t('cx.s.understood'), `${M.found.size} / ${REVELATION_COUNT}`)}
          ${stat(t('cx.s.tines'), `${g.cantos.length} / 7`)}
          ${stat(t('cx.s.burned'), `${Math.round(M.lucentBurned)} t`)}
          ${stat(t('cx.s.accounts'), said.length)}
        </div>
        <h3 class="cx-h3">${t('cx.q.said')}</h3>
        <div class="cx-text"><p>${t('cx.q.intro')}</p></div>
        ${claims}
        <h3 class="cx-h3">${t('cx.q.worked')}</h3>
        ${rev}`;
    }

    if (id === 'rumors') {
      const rs = [...g.rumors.heard].reverse();
      const rows = rs.map((r) => {
        const cor = g.rumors.isCorroborated(r);
        return `<div class="cx-rumor${cor ? ' cor' : ''}">
          <p>${r.text}</p>
          <div class="cx-rmeta">${r.source.toUpperCase()}
            ${cor ? ` · <b>${t('cx.r.cor')}</b>` : ` · ${t('cx.r.uncor')}`}</div>
        </div>`;
      }).join('');
      return `<h1 class="cx-title">${t('cx.r.title')}</h1>
        <div class="cx-sub">${t('cx.r.sub')}</div>
        <div class="cx-text"><p>${t('cx.r.intro')}</p></div>${rows}`;
    }

    if (id.startsWith('log:')) {
      const l = LOGS.find((x) => 'log:' + x.id === id);
      if (!l) return '';
      return `<h1 class="cx-title">${tx(`lore.${l.id}.title`, l.title).toUpperCase()}</h1>
        <div class="cx-sub">${tx(`lore.${l.id}.sub`, l.sub)}</div>
        <div class="cx-text">${l.body.map((p, i) =>
    `<p>${tx(`lore.${l.id}.b${i}`, p)}</p>`).join('')}</div>`;
    }

    if (id.startsWith('body:')) {
      const b = g.bodies.find((x) => 'body:' + x.id === id);
      if (!b) return `<div class="cx-empty">${t('cx.noRecord')}</div>`;
      const d = b.absPos.distanceTo(g.ship.absPos);

      if (b.kind === 'star') {
        const s = b.spec;
        return `<h1 class="cx-title">${b.name.toUpperCase()}</h1>
          <div class="cx-sub">${s.desc.toUpperCase()} · ${t('cx.s.class')} ${s.cls}</div>
          <div class="cx-stats">
            ${stat(t('cx.s.temp'), `${Math.round(s.temp)} K`)}
            ${stat('RADIUS', `${(s.radius / 1000).toFixed(0)} Mm`)}
            ${stat(t('cx.s.lum'), `${s.luminosity.toFixed(2)} L☉`)}
            ${stat('RANGE', fmtDist(d))}
          </div>
          <div class="cx-text"><p>${tx(`lore.star.${s.cls}`, STAR_INFO[s.cls] || '')}</p></div>`;
      }

      if (b.kind === 'anomaly') {
        const info = ANOMALY_INFO[b.anomalyType];
        return `<h1 class="cx-title">${b.name.toUpperCase()}</h1>
          <div class="cx-sub">${tx(`lore.anom.${b.anomalyType}.label`, info.label)} · ${t('cx.nonNatural')}</div>
          <div class="cx-stats">
            ${stat(t('cx.s.classif'), tx(`lore.anom.${b.anomalyType}.label`, info.label))}
            ${stat('RANGE', fmtDist(d))}
            ${stat(t('cx.s.inSystem'), g.system.star.name)}
          </div>
          <div class="cx-text"><p>${tx(`lore.anom.${b.anomalyType}.text`, info.text)}</p></div>`;
      }

      const s = b.spec;
      const info = TYPE_INFO[s.type];
      const g0 = (s.radius / 6371) * 1.0;
      /* What the scan found underneath. This is the whole return on the
         scanner: before it, a world is a colour; after it, a manifest. */
      /* The surface manifest. It used to list deposits with a bearing that
         went nowhere — the drone worked whatever was under the ship, so the
         degrees were decoration. Now every row is a place with a range on it,
         and the range is why the rover is in the bay. */
      const deps = g.prospect ? g.prospect.deposits(b) : [];
      const sites = g.sites ? g.sites.manifest(b) : [];
      const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
      const rows = sites.map((s) => {
        const left = s.kind === 'seam' ? g.prospect.remaining(b, s.dep) : 0;
        const spent = s.kind === 'seam' ? left <= 0 : s.done;
        const what = s.kind === 'seam'
          ? (left ? `${left} t ${s.dep.grade}` : t('cx.workedOut'))
          : s.done ? t('cx.site.done') : t(`cx.site.${s.kind}`);
        return `<div class="cx-dep${spent ? ' spent' : ''}">
            <b>${s.kind === 'seam' ? s.name : t(`cx.site.${s.kind}`)}</b>
            <span>${what}</span>
            <em>${t('cx.bearing')} ${s.bearing}° · ${km(s.range)}</em></div>`;
      }).join('');
      const depBlock = sites.length ? `<h3 class="cx-h3">${t('cx.sites')}</h3>
        <div class="cx-deps">${rows}</div>
        <div class="cx-note">${t('cx.sitesNote')}</div>`
        : `<h3 class="cx-h3">${t('cx.sites')}</h3><div class="cx-note">${
          deps.length ? t('cx.nothingWorth') : t('cx.nothingWorth')}</div>`;
      return `<h1 class="cx-title">${b.name.toUpperCase()}</h1>
        <div class="cx-sub">${tx(`lore.type.${s.type}.label`, info.label).toUpperCase()}${b.kind === 'moon' ? ` · ${t('cx.satellite')}` : ''}</div>
        <div class="cx-stats">
          ${stat('RADIUS', `${Math.round(s.radius)} km`)}
          ${stat(t('cx.s.gravity'), `${g0.toFixed(2)} g`)}
          ${stat(t('cx.s.orbit'), fmtDist(s.orbitR))}
          ${stat(t('cx.s.tilt'), `${(s.tilt * 57.3).toFixed(1)}°`)}
          ${stat(t('cx.s.rot'), `${(6.283 / Math.abs(s.spinRate) / 3600).toFixed(1)} h`)}
          ${stat(t('cx.s.atmo'), s.atmo ? t('cx.v.present') : t('cx.v.negligible'))}
          ${stat(t('cx.s.hydro'), (s.type === 'terran' || s.type === 'ocean') ? `${Math.round(s.sea * 100)} %` : t('cx.v.none'))}
          ${stat(t('cx.s.rings'), s.rings ? t('cx.v.yes') : t('cx.v.no'))}
        </div>
        <div class="cx-text">
          <p>${tx(`lore.type.${s.type}.text`, info.text)}</p>
          ${s.night ? `<p class="q">${t('cx.night')}</p>` : ''}
        </div>
        ${depBlock}`;
    }

    return `<div class="cx-empty">${t('cx.noRecord')}</div>`;
  }
}

function stat(label, value) {
  return `<div class="cx-stat"><label>${label}</label><b>${value}</b></div>`;
}
