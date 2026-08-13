import { t, goodName } from './i18n.js';
import { PACK_RANGE } from '../ship/Rover.js';

/* ============================================================================
   The surface chart.

   `Sites` put things kilometres from where the ship parks, and the rover made
   them reachable — but between those two changes the ground became a place
   you could get lost in. A bearing and a range printed in the Archive is a
   navigation problem you solve by holding a heading and hoping; someone
   playing it said as much. This is the instrument that closes it.

   It began as a full-screen panel and that was the wrong shape. A star chart
   is consulted *between* journeys; a surface chart is consulted *during* one.
   A map that stops the world to be read cannot answer the question you have
   while driving — am I still pointed at it, and how much closer am I — so it
   sits in the corner, does not take the frame, does not block a control, and
   redraws every frame the wheels are turning.

   Three things it draws that the Archive's list cannot:

     **The pack as a circle.** Two rings: everything you can reach, and
     everything you can reach *and get back from*. The second is the one that
     matters, and a number in a corner never communicated it.

     **Where you actually are, facing up.** It is heading-up and centred on
     you, the way a car's navigation is, because the question while driving is
     "is that thing ahead of me or behind me" and a north-up chart makes you
     do the rotation in your head at speed. North is marked on the rim and
     swings as you turn, which is the cue that tells you you *are* turning.

     **Relative distance.** Four ranges in a column are four numbers; four
     ranges on a disc are a route.

   The canvas is redrawn only while open, on the game's own frame — there is
   nothing here worth a second timer.
   ========================================================================== */

/* Kind → colour and glyph. The palette is the HUD's: cyan is charted and
   safe, amber is a thing to look at, red is spent. */
const STYLE = {
  seam: { fill: '#7fd7a8', glyph: 'diamond' },
  wreck: { fill: '#e8a44c', glyph: 'cross' },
  marker: { fill: '#c98bff', glyph: 'ring' },
  survivor: { fill: '#ff6b6b', glyph: 'star' },
};
const SPENT = '#4a5560';

/* Seam rows are labelled by what is in them, and a commodity already has a
   translated name — printing the raw id left VOLATILES and FOOD in English on
   an otherwise Thai chart. */
function labelFor(s) {
  return s.kind === 'seam' ? goodName(s.dep.id, s.name) : t(`cx.site.${s.kind}`);
}

export class GroundMap {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('groundmap');
    this.canvas = document.getElementById('gmCanvas');
    this.side = document.getElementById('gmSide');
    this.packEl = document.getElementById('gmPack');
    this.steepEl = document.getElementById('gmSteep');
    this.open = false;
    this._dpr = 1;

    this.root?.querySelectorAll('[data-close-gm]').forEach((b) => {
      b.addEventListener('click', () => this.close());
    });
  }

  toggle() { this.open ? this.close() : this.show(); }

  show() {
    if (!this.root || !this.game.landed) return;
    this.open = true;
    this.root.classList.remove('hidden', 'closing');
    this.draw();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('closing');
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      this.root.classList.remove('closing');
      this.root.classList.add('hidden');
    }, 200);
  }

  hide() {
    this.open = false;
    clearTimeout(this._t);
    this.root?.classList.remove('closing');
    this.root?.classList.add('hidden');
  }

  /* -------------------------------------------------------------- drawing */

  draw() {
    const g = this.game;
    if (!this.open || !g.landed || !this.canvas) return;
    const body = g.landed.body;
    /* From where you *are*, not from where the ship is parked. Measuring from
       the origin made every range on the panel a constant — the map looked
       broken while driving because the numbers never moved, and the numbers
       never moved because they were answering a different question. */
    const me = g.groundPos();
    const rover0 = g.rover;
    const sites = g.sites.manifest(body, me.x, me.z);

    const cv = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr; cv.height = h * dpr;
    }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);

    /* Scale to hold every site with a margin, but never zoom in past the
       pack's own reach — a chart that reframed itself as you drove would
       make two glances at it incomparable. */
    const far = Math.max(PACK_RANGE * 0.5, ...sites.map((s) => s.range)) * 1.15;
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) / 2 - 18;
    const k = R / far;

    /* Heading-up, centred on you. The world rotates under a fixed reticle
       rather than a marker rotating inside a fixed world — so "ahead" is
       always the top of the disc, and a site drawn to the right is a site you
       turn right for, with no mental rotation at speed.

       Everything below therefore plots *world* metres and lets this transform
       place them; nothing needs to know about the rotation. */
    const rot = g.landed.driving && rover0.deployed
      ? -Math.atan2(...rover0.forward()) : 0;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const px = (x, z) => cx + ((x - me.x) * cos - (z - me.z) * sin) * k;
    const py = (x, z) => cy - ((x - me.x) * sin + (z - me.z) * cos) * k;

    // ---- ground tone and the graticule
    c.fillStyle = 'rgba(8,16,22,0.55)';
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();

    c.strokeStyle = 'rgba(120,170,190,0.14)';
    c.lineWidth = 1;
    for (let r = 1000; r <= far; r += 1000) {
      c.beginPath(); c.arc(cx, cy, r * k, 0, Math.PI * 2); c.stroke();
    }
    c.beginPath();
    c.moveTo(cx - R, cy); c.lineTo(cx + R, cy);
    c.moveTo(cx, cy - R); c.lineTo(cx, cy + R);
    c.stroke();

    // ---- the pack, as the two circles that actually decide the trip
    const rover = rover0;
    const reach = rover.metresLeft();
    /* Centred on the *ship*, not on you: the range that matters is the range
       from the thing you have to get back to. */
    const shipX = px(0, 0), shipY = py(0, 0);
    const ring = (m, colour, dash) => {
      if (m <= 0) return;
      c.save();
      c.setLineDash(dash);
      c.strokeStyle = colour;
      c.lineWidth = 1.4;
      c.beginPath(); c.arc(shipX, shipY, m * k, 0, Math.PI * 2); c.stroke();
      c.restore();
    };
    ring(reach, 'rgba(232,164,76,0.40)', [4, 5]);          // one-way
    ring(reach / 2, 'rgba(63,216,232,0.55)', [2, 4]);      // there and back

    // ---- north
    const nAng = rot - Math.PI / 2;
    const nx = cx + Math.cos(nAng) * (R - 7);
    const ny = cy + Math.sin(nAng) * (R - 7);
    c.fillStyle = 'rgba(160,200,215,0.75)';
    c.font = '9px ui-monospace, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', nx, ny);
    c.textBaseline = 'alphabetic';

    // ---- the sites
    for (const s of sites) {
      const x = px(s.x, s.z), y = py(s.x, s.z);
      const st = STYLE[s.kind] || STYLE.seam;
      const spent = s.kind === 'seam'
        ? g.prospect.remaining(body, s.dep) <= 0 : s.done;
      const col = spent ? SPENT : st.fill;

      c.strokeStyle = 'rgba(120,170,190,0.20)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke();

      c.fillStyle = col;
      c.strokeStyle = col;
      c.lineWidth = 1.6;
      glyph(c, st.glyph, x, y, 5);

      c.fillStyle = spent ? 'rgba(150,168,180,0.55)' : 'rgba(226,242,248,0.92)';
      c.font = '8.5px ui-monospace, monospace';
      c.textAlign = 'left';
      c.fillText(labelFor(s), x + 8, y + 3);
    }

    // ---- the ship, wherever it now sits relative to you
    c.fillStyle = '#e2f2f8';
    c.beginPath(); c.arc(shipX, shipY, 3.5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(226,242,248,0.55)';
    c.lineWidth = 1;
    c.beginPath(); c.arc(shipX, shipY, 7, 0, Math.PI * 2); c.stroke();

    // ---- and you, at the centre, always pointing up
    c.fillStyle = '#3fd8e8';
    c.beginPath();
    c.moveTo(cx, cy - 8);
    c.lineTo(cx - 5, cy + 5);
    c.lineTo(cx + 5, cy + 5);
    c.closePath();
    c.fill();

    this._side(sites, body, reach);
  }

  _side(sites, body, reach) {
    if (!this.side) return;
    const g = this.game;
    const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
    const me = g.groundPos();
    /* Compass bearing, still absolute: the number is what you would set on a
       heading indicator, and the *picture* is what tells you which way to
       turn. Two relative readouts saying the same thing would be redundant. */
    const bearingTo = (s) => {
      const a = Math.atan2(s.x - me.x, s.z - me.z) * 180 / Math.PI;
      return Math.round((a + 360) % 360);
    };
    const rows = sites.map((s) => {
      const spent = s.kind === 'seam'
        ? g.prospect.remaining(body, s.dep) <= 0 : s.done;
      const label = labelFor(s);
      const note = s.kind === 'seam' && !spent
        ? `${g.prospect.remaining(body, s.dep)} t` : spent ? t('cx.site.done') : '';
      /* Reachable means there and then *home*, and those are three different
         numbers once you have driven anywhere.
       *
         This read `s.dist * 2`, which is the cost of going to the site and
         coming back to the patch of ground you are standing on — a journey
         nobody makes. What the pack has to cover is here to the site, then the
         site to the ship, and `range` is exactly that second leg because sites
         are placed in the ship's own frame.
       *
         Doubling the distance from the rover is wrong in both directions, and
         the pessimistic one is what gets reported: drive four kilometres out
         and a wreck two kilometres further on reads as a twelve-kilometre round
         trip when it is a six-kilometre one, so the chart calls it unreachable
         while you are most of the way there. The rings drawn above this list
         already had it right — they are centred on the ship, for the reason
         written beside them — and the numbers underneath disagreed with the
         picture.
       *
         Still an underestimate of the charge, because climbing costs more per
         metre than flat ground does. That is deliberate: the pack is a decision
         you can get wrong, and a readout that promised otherwise would be
         making the decision for you. */
      const ok = s.dist + s.range <= reach;
      return `<div class="gm-row${spent ? ' spent' : ''}">
        <b class="k-${s.kind}">${label}</b>
        <span>${bearingTo(s)}° · ${km(s.dist)}</span>
        <em class="${ok ? '' : 'far'}">${ok ? note : t('gm.beyond')}</em></div>`;
    }).join('');

    if (this.packEl) {
      /* When the drive is fighting the slope, that is the thing to say — a
         player on a steep face is asking "is this broken", and the pack
         percentage does not answer them. */
      const steep = g.landed.driving && g.rover.gradeLoad > 0.75;
      this.packEl.textContent = g.landed.driving
        ? `${Math.round(g.rover.charge * 100)}% · ${km(reach)}`
        : t('gm.stowed');
      this.packEl.classList.toggle('warn', !!steep);
      if (this.steepEl) this.steepEl.textContent = steep ? t('gm.steep') : '';
    }
    this.side.innerHTML = `<div class="gm-rows">${
      rows || `<div class="gm-note">${t('gm.empty')}</div>`}</div>
      <div class="gm-note">${t('gm.note')}</div>`;
  }
}

/* One tiny vector glyph per kind, so the chart reads without colour alone —
   the palette is doing double duty as spent/unspent already. */
function glyph(c, kind, x, y, r) {
  c.beginPath();
  if (kind === 'diamond') {
    c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y);
    c.closePath(); c.fill();
  } else if (kind === 'cross') {
    c.moveTo(x - r, y - r); c.lineTo(x + r, y + r);
    c.moveTo(x + r, y - r); c.lineTo(x - r, y + r);
    c.stroke();
  } else if (kind === 'ring') {
    c.arc(x, y, r * 0.85, 0, Math.PI * 2); c.stroke();
  } else {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * Math.PI * 0.8;
      const fn = i ? 'lineTo' : 'moveTo';
      c[fn](x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    c.closePath(); c.fill();
  }
}
