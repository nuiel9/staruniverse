import * as THREE from 'three';
import { t, mountToggle, onLangChange } from './i18n.js';
import { after } from '../core/clock.js';

/* ============================================================================
   The screen-space layer.

   Almost everything that used to live here now lives on the dashboard, in the
   world, where a pilot would actually read it. What is left is the handful of
   things that are not physical objects: what you are looking at, what you were
   just told, and what you can reach.

   The directive was the last holdout. It was a centred card drawn over the
   canopy spar — an overlay occluding the structure it was supposedly mounted
   behind — and it is now an annunciator strip on the glareshield, which the
   structure can occlude in turn. Nothing here should ever be an instrument.
   ========================================================================== */

const _v = new THREE.Vector3();

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('hud');
    this.el = {
      reticle: document.getElementById('reticle'),
      rArc: document.getElementById('rArc'),
      markers: document.getElementById('markers'),
      log: document.getElementById('log'),
      narr: document.getElementById('narrText'),
      prompt: document.getElementById('prompt'),
      promptKey: document.getElementById('promptKey'),
      promptLabel: document.getElementById('promptLabel'),
      promptHint: document.getElementById('promptHint'),
      hints: document.getElementById('hints'),
      driveWarn: document.getElementById('driveWarn'),
      fold: document.getElementById('foldOverlay'),
      foldSub: document.getElementById('foldSub'),
      perf: document.getElementById('perf'),
      touchUI: document.getElementById('touchUI'),
    };

    this.markerPool = new Map();
    this.logs = [];
    this._narrTimer = 0;
    this._lastMode = null;

    document.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.close;
        if (id === 'codex') game.codex.close();
        if (id === 'starmap') game.starmap.close();
      });
    });

    if (game.input.hasTouch) this.el.touchUI.classList.remove('hidden');

    /* The language control is reachable in flight, not only at the title card:
       a player who guesses wrong at boot should not have to reload. The hint
       row is memoised on a signature key, so switching language has to
       invalidate it or the old strings would sit there until the context
       happened to change. */
    mountToggle(document.getElementById('hudLang'));
    /* Both caches, not just the hints. Anything on this HUD that remembers what
       it last wrote has to forget it when the language changes, or it keeps
       showing the old one until its underlying state happens to move — and a
       steep warning stays on screen for as long as the hill does. */
    onLangChange(() => { this._hintKey = null; this._steep = null; });
  }

  show() { this.root.classList.remove('hidden'); requestAnimationFrame(() => this.root.classList.add('on')); }

  onSystemChange() {
    for (const [, m] of this.markerPool) m.el.remove();
    this.markerPool.clear();
  }

  refreshTargets() { }

  log(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'lg ' + cls;
    d.textContent = text;
    this.el.log.appendChild(d);
    this.logs.push({ el: d, t: 0 });
    while (this.logs.length > 4) { const o = this.logs.shift(); o.el.remove(); }
    // scene clock, so a stepped capture fades it at the same frame every run
    after(6, () => d.classList.add('out'));
  }

  narrate(text, who) {
    this.el.narr.innerHTML = (who ? `<span class="who">${who}</span>` : '') + text;
    this.el.narr.classList.add('on');
    this._narrTimer = 7.5;
  }

  /**
   * Cinematic mode. Bars and a title card, and every diegetic overlay hidden —
   * during a sequence the frame belongs to the camera, not to the instruments.
   */
  cinematic(on, title, sub) {
    if (!this._cine) {
      const d = document.createElement('div');
      d.id = 'cine';
      d.innerHTML = '<div class="bar top"></div><div class="bar bot"></div>'
        + '<div class="card"><div class="ttl"></div><div class="sub"></div></div>';
      document.body.appendChild(d);
      this._cine = d;
    }
    this._cine.classList.toggle('on', !!on);
    this.root.classList.toggle('cine', !!on);
    if (on) {
      this._cine.querySelector('.ttl').textContent = title || '';
      this._cine.querySelector('.sub').textContent = sub || '';
      this._cine.querySelector('.card').classList.remove('on');
      requestAnimationFrame(() => this._cine.querySelector('.card').classList.add('on'));
    }
  }

  setFold(on) { this.el.fold.classList.toggle('on', on); }
  setFlash(v) { this.game.setFlash(v); }

  /* ------------------------------------------------------------- frame */

  update(dt) {
    const g = this.game;
    const piloting = g.mode === 'pilot' || g.mode === 'exterior';
    const uiOpen = g.starmap.open || g.codex.open || g.dock.open || g.comms.open;

    // ---- reticle only when you are actually flying
    this.el.reticle.classList.toggle('hidden', !piloting || uiOpen);
    const p = g.scanProgress || 0;
    this.el.rArc.setAttribute('d', p > 0.001 ? arcPath(60, 60, 21, -90, -90 + p * 360) : '');

    // ---- interaction prompt
    const st = g.mode === 'walk' ? g.player.station : null;
    const showPrompt = !uiOpen && (st || g.mode === 'pilot');
    this.el.prompt.classList.toggle('hidden', !showPrompt);
    if (showPrompt) {
      const key = g.input.hasTouch ? 'USE' : 'E';
      this.el.promptKey.textContent = key;
      if (g.mode === 'pilot') {
        this.el.promptLabel.textContent = 'LEAVE THE HELM';
        this.el.promptHint.textContent = '';
      } else {
        this.el.promptLabel.textContent = st.label;
        this.el.promptHint.textContent = st.hint || '';
      }
    }

    /* ---- why the drive is fighting you
       The chart has said this since the crawl floor went in, and it says it
       well — but only while the chart is open. A player driving with it closed
       met a vehicle that dropped to MAX_FWD*CRAWL_FLOOR, about 2.2 m/s, and
       nothing anywhere told them why; over a few seconds on a hillside that
       reads as a rover that has stopped, and it was reported as one.

       Same threshold as the chart's line (gradeLoad > 0.75) and the same
       string, so the two can never say different things about the same slope.
       Written only when the state changes: this runs every frame and a DOM
       write per frame for a value that changes every few seconds is waste. */
    const steep = !!(g.landed && g.landed.driving && !uiOpen
      && g.rover.gradeLoad > 0.75);
    if (steep !== this._steep) {
      this._steep = steep;
      this.el.driveWarn.textContent = steep ? t('gm.steep') : '';
    }

    // ---- contextual control hints
    /* Contextual keys.

       This used to key on `mode` alone, and opening a panel does not change
       mode — so the star map could take the frame, block every movement key,
       and leave this row still reading "WASD move". The map *is* escapable:
       Escape closes it and always did. But nothing on screen said so, and a
       control nobody can find is the same as a control that does not exist.
       Someone testing the build reported being trapped in it.

       Landing had the mirror problem. L lands, and L has never appeared here —
       it is also conditional, since `canLand` wants a solid world inside 2.6
       radii, so a player pressing every key in turn from the wrong place would
       conclude it is not possible. It shows up when it is actually available,
       and says which of land or lift off it will do. */
    const driving = !!(g.landed && g.landed.driving);
    const canLand = !!(!g.landed && g.canLand && g.canLand());
    const canDock = !!(g.canDock && g.canDock());
    const canHail = !!(g.canHail && g.canHail());
    const seamNow = g.landed && !g.landed.onFoot && g.prospect
      ? (g.prospect.workable(g.landed.body)?.id || '') : '';
    const hintKey = `${g.mode}|${uiOpen ? 1 : 0}|${g.starmap.open ? 'm' : ''}|${canLand ? 1 : 0}|${canDock ? 1 : 0}`
      + `|${canHail ? 1 : 0}|${g.landed ? (driving ? 3 : g.landed.onFoot ? 2 : 1) : 0}|${seamNow}`
      + `|${driving ? g.rover.atSiteKind || '' : ''}`;
    if (this._hintKey !== hintKey) {
      const wasLand = this._canLand;
      const wasDock = this._canDock;
      const wasHail = this._canHail;
      this._hintKey = hintKey;
      this._lastMode = g.mode;
      this._canLand = canLand;
      this._canDock = canDock;
      this._canHail = canHail;
      let keys;
      if (uiOpen) {
        keys = g.starmap.open
          ? [['MOUSE', t('k.selectSystem')], ['J', t('k.foldTo')], ['ESC', t('k.close')]]
          : [['ESC', t('k.close')]];
      } else if (g.landed) {
        /* The ground has its own controls and used to borrow the flight row,
           which advertised a throttle, a scanner and an autopilot to somebody
           standing on a planet. */
        const seam = g.prospect && g.prospect.workable(g.landed.body);
        if (driving) {
          /* Driving is its own control set. Nothing about the parked ship is
             reachable from out here, and advertising L or E-to-step-out to
             somebody four kilometres away would be a lie. */
          keys = [['WASD', t('k.drive')], ['E', t('k.workSite')],
            ['F', t('k.mine')], ['M', t('k.chart')], ['R', t('k.stow')]];
          /* H only once it is the answer to something. Offered before the pack
             is spent it reads as a taxi and invites the trip that strands you;
             offered after, it is the way out of a state that used to have
             none. See Game.recall. */
          if (!g.rover.canReturn()) keys.push(['H', t('k.recall')]);
          this.el.hints.innerHTML = keys.map(([k, v]) => `<span><kbd>${k}</kbd>${v}</span>`).join('');
          this._syncTouchLabels();
          return;
        }
        keys = g.landed.onFoot
          ? [['WASD', t('k.move')], ['MOUSE', t('k.look')], ['SHIFT', t('k.run')],
            ['M', t('k.chart')], ['E', t('k.board')], ['L', t('k.liftOff')]]
          : [['E', t('k.stepOut')], ['R', t('k.rover')], ['M', t('k.chart')],
            ['L', t('k.liftOff')], ['TAB', t('k.archive')]];
        if (!g.landed.onFoot && seam) keys.splice(1, 0, ['F', `${t('k.mine')} ${seam.id}`]);
      } else if (g.mode === 'walk') {
        keys = [['WASD', t('k.move')], ['MOUSE', t('k.look')], ['E', t('k.use')], ['SHIFT', t('k.run')],
          ['V', t('k.outside')]];
      } else {
        /* V has always existed and has never been on this row, which is most of
           why the view "changed by itself" — the only other things that move it
           are sitting down and standing up. And free-look is quoted with the
           mouse button first: Alt is a modifier the window manager may eat, the
           right button is not, and both have always been wired to it. */
        keys = [['MOUSE', t('k.fly')], ['W/S', t('k.throttle')], ['F', t('k.scan')],
          ['G', t('k.autopilot')], ['J', t('k.fold')], ['RMB', t('k.look')],
          ['V', g.mode === 'exterior' ? t('k.cockpit') : t('k.chase')], ['E', t('k.stand')]];
        if (canDock) keys.push(['L', t('k.dock')]);
        else if (canLand) keys.push(['L', t('k.land')]);
        if (canHail) keys.push(['C', t('k.hail')]);
      }
      this.el.hints.innerHTML = keys.map(([k, v]) => `<span><kbd>${k}</kbd>${v}</span>`).join('');
      this._syncTouchLabels();
      // The row is small and at the bottom edge. Coming into range of a world
      // you can actually set down on is worth saying out loud, once.
      if (canDock && !wasDock) {
        this.log(`BERTH AVAILABLE · ${g.canDock().name.toUpperCase()} · L`, 'ok');
      } else if (canLand && !wasLand && g.target) {
        this.log(`LANDING AVAILABLE · ${g.target.name.toUpperCase()} · L`, 'ok');
      }
      if (canHail && !wasHail) {
        this.log(`CONTACT IN RANGE · ${g.canHail().name.toUpperCase()} · C`, 'ok');
      }
    }

    // ---- fold banner
    if (g.ship.foldMode) {
      const t = g.target;
      this.el.foldSub.textContent = t
        ? `${t.name.toUpperCase()}  ·  ${fmtDist(t.absPos.distanceTo(g.ship.absPos))}` : '';
    }

    // ---- timers
    if (this._narrTimer > 0) {
      this._narrTimer -= dt;
      if (this._narrTimer <= 0) this.el.narr.classList.remove('on');
    }
    this._updateMarkers(piloting && !uiOpen);

    if (this.el.perf.classList.contains('on')) {
      this.el.perf.textContent =
        `${g.engine.fps.toFixed(0)} fps  ${g.engine.pixelRatio.toFixed(2)}x  q=${g.quality}  ${g.mode}\n` +
        `draws ${g.engine.drawCalls}  tris ${(g.engine.triangles / 1000).toFixed(0)}k`;
    }
  }

  _syncTouchLabels() {
    const walk = this.game.mode === 'walk';
    const map = walk
      ? { use: 'USE', boost: 'RUN', scan: 'MAP', auto: 'ARC', fold: 'VIEW' }
      : { use: 'STAND', boost: 'BOOST', scan: 'SCAN', auto: 'AUTO', fold: 'FOLD' };
    document.querySelectorAll('#touchBtns .tb').forEach((b) => {
      const t = map[b.dataset.act];
      if (t) b.textContent = t;
    });
    const thr = document.getElementById('touchThr');
    if (thr) thr.style.display = walk ? 'none' : '';
  }

  _updateMarkers(active) {
    const g = this.game;
    if (!active) {
      for (const [, m] of this.markerPool) m.el.style.display = 'none';
      return;
    }
    const cam = g.camera;
    const seen = new Set();
    const bodies = g.bodies.slice()
      .sort((a, b) => a.absPos.distanceToSquared(g.ship.absPos) - b.absPos.distanceToSquared(g.ship.absPos))
      .slice(0, 10);

    // Screen-space declutter. Bodies arrive sorted near-to-far, so the first
    // one to claim a patch of canopy keeps it and anything landing on top of it
    // is dropped — two labels overlapping is worse than one label missing.
    const placed = [];
    const MIN_SEP = 46;
    /* The cabin is drawn over the world in its own pass, so a marker composited
       on top of the frame sits on top of the *room* as well — the review caught
       one label lying across the centre MFD, interleaved with the MFD's own
       type, and another over the left MFD and the throttle. Ask the cabin
       whether the ray actually leaves through the glazing. Only in the cockpit:
       in exterior view there is no room in the way. */
    const cabin = (g.mode !== 'exterior' && g.interior && g.interior.seesSky)
      ? g.interior : null;

    for (const b of bodies) {
      _v.copy(b.absPos).sub(g.origin);
      const dist = _v.distanceTo(cam.position);
      _v.project(cam);
      const onScreen = _v.z < 1 && Math.abs(_v.x) < 0.98 && Math.abs(_v.y) < 0.92;
      const angular = 2 * Math.atan((b.radius || 1) / Math.max(dist, 1));
      if (!onScreen || angular > 0.5) continue;
      if (cabin && !cabin.seesSky(_v.x, _v.y, g.interiorCam)) continue;

      const sx = (_v.x * 0.5 + 0.5) * innerWidth;
      const sy = (-_v.y * 0.5 + 0.5) * innerHeight;
      let crowded = false;
      for (const q of placed) {
        if (Math.abs(q.x - sx) < MIN_SEP && Math.abs(q.y - sy) < MIN_SEP) { crowded = true; break; }
      }
      if (crowded && b !== g.target) continue;
      placed.push({ x: sx, y: sy });

      seen.add(b.id);
      let m = this.markerPool.get(b.id);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'mk';
        el.innerHTML = `<svg viewBox="0 0 28 28">
            <path class="mk-br" d="M4 10V4h6M18 4h6v6M24 18v6h-6M10 24H4v-6"/>
            <circle cx="14" cy="14" r="1.5" class="mk-dot"/>
          </svg>
          <div class="mk-lbl"><span></span><em></em></div>`;
        this.el.markers.appendChild(el);
        m = { el, name: el.querySelector('span'), sub: el.querySelector('em') };
        this.markerPool.set(b.id, m);
      }
      m.el.style.display = '';
      m.el.style.transform = `translate(${sx}px, ${sy}px)`;
      m.el.className = 'mk'
        + (b.kind === 'anomaly' ? ' anom' : '')
        + (b.scanned ? ' scanned' : '')
        + (b === g.target ? ' sel' : '');
      if (m._n !== b.name) { m.name.textContent = b.name; m._n = b.name; }
      m.sub.textContent = fmtDist(dist);
    }
    for (const [id, m] of this.markerPool) if (!seen.has(id)) m.el.style.display = 'none';
  }
}

export function fmtDist(d) {
  if (d < 1) return `${Math.round(d * 1000)} m`;
  if (d < 1000) return `${d.toFixed(1)} km`;
  if (d < 1e6) return `${(d / 1000).toFixed(1)} Mm`;
  return `${(d / 149597870).toFixed(4)} AU`;
}

function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}
