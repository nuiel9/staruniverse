import { CANTOS, LOGS, TYPE_INFO, STAR_INFO, ANOMALY_INFO } from '../game/lore.js';
import { fmtDist } from './HUD.js';
import { t, onLangChange } from './i18n.js';

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
          { id: 'overview', label: 'Expedition' },
          ...scanned.map((b) => ({ id: 'body:' + b.id, label: b.name })),
        ],
      },
      {
        title: t('cx.cantos'), items: CANTOS.map((c, i) => ({
          id: 'canto:' + c.id, label: c.title,
          locked: !g.cantos.includes(c.id),
        })),
      },
      {
        title: t('cx.records'), items: LOGS.map((l) => ({
          id: 'log:' + l.id, label: l.title, locked: !g.logsFound.has(l.id),
        })),
      },
      ...(g.mystery ? [{
        title: t('cx.question'), items: [{
          id: 'question',
          label: `${t('cx.questionLabel')} (${g.mystery.found.size}/5)`,
        }],
      }] : []),
      ...(g.rumors && g.rumors.heard.length ? [{
        title: t('cx.rumors'), items: [{ id: 'rumors', label: `${t('cx.rumorsLabel')} (${g.rumors.heard.length})` }],
      }] : []),
    ];

    this.nav.innerHTML = groups.map((gr) =>
      `<div class="cx-grp">${gr.title}</div>` + gr.items.map((it) =>
        `<button class="cx-item${it.id === this.sel ? ' on' : ''}${it.locked ? ' locked' : ''}"
           data-id="${it.id}">${it.locked ? '— sealed —' : it.label}</button>`).join('')
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
        <div class="cx-sub">DEEP SURVEY VESSEL LONG MARGIN · COMMISSION 1101</div>
        <div class="cx-stats">
          ${stat('SYSTEMS CHARTED', `${visited} / ${total}`)}
          ${stat('LANES SURVEYED', `${g.lanes.charted.size} / ${g.lanes.edges.size}`)}
          ${stat('LEDGER', `${g.economy.credits.toLocaleString('en-US')} cr`)}
          ${stat('BODIES CATALOGUED', g.discoveries.size)}
          ${stat('RESONANCE', `${g.state.resonance} / 7`)}
          ${stat('CURRENT SYSTEM', g.system.star.name)}
          ${stat('STAR', `${g.system.star.cls} · ${Math.round(g.system.star.temp)} K`)}
          ${stat('HULL', `${Math.round(g.ship.hull * 100)} %`)}
        </div>
        <div class="cx-text">
          <p>Forty thousand years ago, nine hundred inhabited worlds fell silent inside a
          volume of space eighty light-years across. No debris. No radiation signature.
          No sign of violence at any scale we can measure.</p>
          <p>The Hush left their cities lit and their orbits tidy, and they left seven
          instruments — the Tines — standing in seven systems.</p>
          <p class="q">Chart what you can. Scan what you find. Attune what will let you.</p>
        </div>`;
    }

    if (id.startsWith('canto:')) {
      const c = CANTOS.find((x) => 'canto:' + x.id === id);
      if (!c) return '';
      return `<h1 class="cx-title">${c.title.toUpperCase()}</h1>
        <div class="cx-sub">${c.sub}</div>
        <div class="cx-text">${c.body.map((p) => `<p>${p}</p>`).join('')}
        <p class="q">${c.q}</p></div>`;
    }

    if (id === 'question') {
      const M = g.mystery;
      const rev = M.ledger().map((r) => (r.known
        ? `<div class="cx-rev"><h3>${r.title}</h3><p>${r.text}</p></div>`
        : `<div class="cx-rev locked"><h3>— not yet understood —</h3>
             <p>${r.need}.</p></div>`)).join('');

      const said = M.testimony();
      const claims = said.length
        ? said.map((c) => `<div class="cx-rumor">
            <p>${c.text}</p>
            <div class="cx-rmeta">${c.sources.join(' · ').toUpperCase()}
              ${said.length > 1 ? ' · <b class="cx-contest">CONTESTED</b>' : ' · unchallenged so far'}</div>
          </div>`).join('')
        : '<div class="cx-note">Nobody has told you anything about the Hush yet. '
          + 'Hail somebody and ask for news.</div>';

      return `<h1 class="cx-title">THE QUESTION</h1>
        <div class="cx-sub">WHY IS THERE A NEBULA HERE?</div>
        <div class="cx-stats">
          ${stat('UNDERSTOOD', `${M.found.size} / 5`)}
          ${stat('TINES', `${g.cantos.length} / 7`)}
          ${stat('LUCENT BURNED', `${Math.round(M.lucentBurned)} t`)}
          ${stat('ACCOUNTS HEARD', said.length)}
        </div>
        <h3 class="cx-h3">WHAT THEY SAY HAPPENED</h3>
        <div class="cx-text"><p>Four cultures, four answers, every one delivered
        with complete confidence and no two alike. Nobody here corroborates
        anybody: the disagreement <em>is</em> the evidence. What they cannot
        explain between them is what the ship's own instruments keep finding.</p></div>
        ${claims}
        <h3 class="cx-h3">WHAT YOU HAVE WORKED OUT</h3>
        ${rev}`;
    }

    if (id === 'rumors') {
      const rs = [...g.rumors.heard].reverse();
      const rows = rs.map((r) => {
        const cor = g.rumors.isCorroborated(r);
        return `<div class="cx-rumor${cor ? ' cor' : ''}">
          <p>${r.text}</p>
          <div class="cx-rmeta">${r.source.toUpperCase()}
            ${cor ? ' · <b>CORROBORATED</b>' : ' · uncorroborated'}</div>
        </div>`;
      }).join('');
      return `<h1 class="cx-title">RUMOR LEDGER</h1>
        <div class="cx-sub">HEARSAY, FILED · BELIEVE IT AT YOUR OWN MARGIN</div>
        <div class="cx-text">
          <p>Everything anyone has told you, exactly as they told it. Two mouths
          agreeing is worth something; one mouth is worth what you paid it.</p>
        </div>${rows}`;
    }

    if (id.startsWith('log:')) {
      const l = LOGS.find((x) => 'log:' + x.id === id);
      if (!l) return '';
      return `<h1 class="cx-title">${l.title.toUpperCase()}</h1>
        <div class="cx-sub">${l.sub}</div>
        <div class="cx-text">${l.body.map((p) => `<p>${p}</p>`).join('')}</div>`;
    }

    if (id.startsWith('body:')) {
      const b = g.bodies.find((x) => 'body:' + x.id === id);
      if (!b) return '<div class="cx-empty">no record</div>';
      const d = b.absPos.distanceTo(g.ship.absPos);

      if (b.kind === 'star') {
        const s = b.spec;
        return `<h1 class="cx-title">${b.name.toUpperCase()}</h1>
          <div class="cx-sub">${s.desc.toUpperCase()} · CLASS ${s.cls}</div>
          <div class="cx-stats">
            ${stat('EFFECTIVE TEMP', `${Math.round(s.temp)} K`)}
            ${stat('RADIUS', `${(s.radius / 1000).toFixed(0)} Mm`)}
            ${stat('LUMINOSITY', `${s.luminosity.toFixed(2)} L☉`)}
            ${stat('RANGE', fmtDist(d))}
          </div>
          <div class="cx-text"><p>${STAR_INFO[s.cls] || ''}</p></div>`;
      }

      if (b.kind === 'anomaly') {
        const info = ANOMALY_INFO[b.anomalyType];
        return `<h1 class="cx-title">${b.name.toUpperCase()}</h1>
          <div class="cx-sub">${info.label} · NON-NATURAL ORIGIN</div>
          <div class="cx-stats">
            ${stat('CLASSIFICATION', info.label)}
            ${stat('RANGE', fmtDist(d))}
            ${stat('SYSTEM', g.system.star.name)}
          </div>
          <div class="cx-text"><p>${info.text}</p></div>`;
      }

      const s = b.spec;
      const info = TYPE_INFO[s.type];
      const g0 = (s.radius / 6371) * 1.0;
      /* What the scan found underneath. This is the whole return on the
         scanner: before it, a world is a colour; after it, a manifest. */
      const deps = g.prospect ? g.prospect.deposits(b) : [];
      const depBlock = deps.length ? `<h3 class="cx-h3">${t('cx.deposits')}</h3>
        <div class="cx-deps">${deps.map((dep) => {
    const left = g.prospect.remaining(b, dep);
    return `<div class="cx-dep${left ? '' : ' spent'}">
            <b>${dep.id.toUpperCase()}</b>
            <span>${left ? `${left} t ${dep.grade}` : t('cx.workedOut')}</span>
            <em>${t('cx.bearing')} ${dep.bearing}°</em></div>`;
  }).join('')}</div>
        <div class="cx-note">Set down and hold <kbd>F</kbd> to work a seam.</div>`
        : `<h3 class="cx-h3">${t('cx.deposits')}</h3><div class="cx-note">${t('cx.nothingWorth')}</div>`;
      return `<h1 class="cx-title">${b.name.toUpperCase()}</h1>
        <div class="cx-sub">${info.label.toUpperCase()}${b.kind === 'moon' ? ' · SATELLITE' : ''}</div>
        <div class="cx-stats">
          ${stat('RADIUS', `${Math.round(s.radius)} km`)}
          ${stat('SURFACE GRAVITY', `${g0.toFixed(2)} g`)}
          ${stat('ORBITAL RADIUS', fmtDist(s.orbitR))}
          ${stat('AXIAL TILT', `${(s.tilt * 57.3).toFixed(1)}°`)}
          ${stat('ROTATION', `${(6.283 / Math.abs(s.spinRate) / 3600).toFixed(1)} h`)}
          ${stat('ATMOSPHERE', s.atmo ? 'PRESENT' : 'NEGLIGIBLE')}
          ${stat('HYDROSPHERE', (s.type === 'terran' || s.type === 'ocean') ? `${Math.round(s.sea * 100)} %` : 'NONE')}
          ${stat('RING SYSTEM', s.rings ? 'YES' : 'NO')}
        </div>
        <div class="cx-text">
          <p>${info.text}</p>
          ${s.night ? '<p class="q">Photometry of the night hemisphere shows structured emission along the coastlines. Someone lived here. The lights are still on.</p>' : ''}
        </div>
        ${depBlock}`;
    }

    return '<div class="cx-empty">no record</div>';
  }
}

function stat(label, value) {
  return `<div class="cx-stat"><label>${label}</label><b>${value}</b></div>`;
}
