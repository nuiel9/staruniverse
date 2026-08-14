import './ui/style.css';
import { initLang, mountToggle, t, tx, onLangChange } from './ui/i18n.js';
import { Game } from './game/Game.js';
import { INTRO_LINES } from './game/lore.js';
import { tickClock, after, pendingBeats } from './core/clock.js';
import { mountDetailToggle, setStoredDetail, storedDetail } from './core/detail.js';
import { detectQuality } from './core/Engine.js';

const bootEl = document.getElementById('boot');
const fill = document.getElementById('bootFill');
const status = document.getElementById('bootStatus');
const startBtn = document.getElementById('bootStart');

function progress(p, text) {
  fill.style.right = `${Math.max(0, (1 - p) * 100)}%`;
  if (text) status.textContent = text;
}

function fatal(msg, err) {
  status.innerHTML = `<span style="color:#ff6b5e">${msg}</span>`;
  if (err) console.error(err);
}

/**
 * Phones are turned away at the door rather than served a reduced build.
 *
 * This game spends its entire budget on one thing: how it looks at full
 * resolution on a discrete GPU. Everything that makes it worth looking at —
 * the raymarched atmospheres, the volumetric cloud decks, the terrain
 * self-shadowing, the twenty-pass post chain — is exactly what a phone cannot
 * afford. The honest options were to cut those features for everyone or to
 * ship a phone build that misrepresents the game. Neither is worth it, so a
 * handset gets a short, clear message instead of a bad first impression.
 */
function isHandset() {
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const small = Math.min(window.screen.width, window.screen.height) < 820;
  return coarse && small;
}

function desktopOnly() {
  bootEl.innerHTML = `
    <div class="boot-inner">
      <h1 class="boot-title">STAR UNIVERSE</h1>
      <div class="boot-sub">DEEP SURVEY VESSEL &middot; <span class="accent">LONG MARGIN</span></div>
      <p class="boot-gate">
        This one wants a real screen and a real GPU.<br>
        Open it on a desktop or laptop.
      </p>
      <div class="boot-legal">requires WebGL2 &middot; headphones recommended</div>
    </div>`;
  bootEl.classList.add('gate');
}

(async () => {
  /* Language first: the boot overlay is the first thing a player reads, and
     switching after the fact would leave the title card in the wrong one. */
  initLang();
  mountToggle(document.getElementById('bootLang'));

  /* The detail tier, beside the language. Both are choices the title card is
     the right place to ask for: they are settled once, before anything has
     been staked on them, and the answer changes how the whole thing is built.
     The tier is read back out of storage by Game's constructor rather than
     passed in, so the URL override the capture tooling uses keeps winning. */
  let detailPaint = null;
  const detailNote = document.getElementById('bootDetailNote');
  /* What the buttons show before anything is built: the player's choice if
     they have made one, otherwise the same guess Game will make. Deliberately
     not read off `game`, which does not exist yet — and would throw rather
     than read undefined if it were touched here. */
  const shownDetail = () => storedDetail() || detectQuality();
  const mountDetail = () => {
    detailPaint = mountDetailToggle(
      document.getElementById('bootDetail'), shownDetail(),
      (tier) => {
        if (!setStoredDetail(tier)) return;   // storage refused: leave it alone
        /* Reload rather than pretend. Nearly everything a tier touches is
           decided at construction — the terrain's step counts are compiled
           into the shader, the asteroid field's buffers are sized once, planet
           LOD meshes are built up front — so there is no honest way to move
           between tiers in place, and a control that silently applied to half
           the scene would be worse than one that takes a moment. */
        if (detailNote) detailNote.textContent = t('boot.detail.reload');
        setTimeout(() => location.reload(), 60);
      },
      (id) => t(`boot.detail.${id}`));
    if (detailNote && !detailNote.textContent) detailNote.textContent = t('boot.detail.hint');
  };
  mountDetail();
  const paintBoot = () => {
    const sub = document.getElementById('bootSub');
    const legal = document.getElementById('bootLegal');
    const start = document.getElementById('bootStart');
    if (sub) sub.textContent = t('boot.sub');
    if (legal) legal.textContent = t('boot.legal');
    if (start) start.textContent = t('boot.wake');
    // the tier buttons carry translated labels, so they repaint with the rest
    if (detailPaint) detailPaint(shownDetail());
    if (detailNote) detailNote.textContent = t('boot.detail.hint');
    /* The two panel headings that live in the markup rather than in a
       render(): the archive and the star map both paint their own bodies but
       inherit their title bar from index.html. */
    const cxT = document.getElementById('codexTitle');
    const mpT = document.getElementById('mapTitle');
    if (cxT) cxT.textContent = t('cx.archive');
    if (mpT) mpT.textContent = t('map.title');
    const gmT = document.getElementById('gmTitle');
    if (gmT) gmT.textContent = t('gm.title');
  };
  onLangChange(paintBoot);
  paintBoot();
  const canvas = document.getElementById('scene');

  if (isHandset()) { desktopOnly(); return; }

  // WebGL2 gate
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) { fatal('WebGL2 unavailable on this device'); return; }

  let game;
  try {
    game = new Game(canvas, progress);
    window.__game = game;
    await game.boot();
  } catch (e) {
    fatal('initialisation failed — see console', e);
    return;
  }

  status.textContent = 'systems nominal';
  startBtn.hidden = false;

  const begin = async () => {
    startBtn.hidden = true;
    bootEl.classList.add('out');
    setTimeout(() => bootEl.style.display = 'none', 1000);
    game.hud.show();
    game.started = true;
    try { await game.audio.resume(); } catch { /* autoplay policy */ }

    // opening beats
    /* Resolved at fire time, not at schedule time: the language control is on
       the title card, so a player who switches and then hits WAKE would
       otherwise get English for the first fifteen seconds of their game. */
    /* On the scene clock, not on setTimeout. These are beats in the game, so
       they should advance with the game: a hidden tab should not burn through
       the opening narration, and a stepped capture should see the same line on
       screen every time it is run. It did not — two captures of the spawn view
       came back with different lines of intro in them. */
    INTRO_LINES.forEach((l, i) => {
      after(1.2 + i * 5.2, () => game.hud.narrate(
        tx(`lore.intro.${i}.text`, l.text), tx(`lore.intro.${i}.who`, l.who)));
    });
    after(0.9, () => {
      game.hud.log('SCANNER ONLINE', 'ok');
      game.hud.log(`SYSTEM · ${game.system.star.name.toUpperCase()}`);
    });
  };

  startBtn.addEventListener('click', begin);
  window.addEventListener('keydown', (e) => {
    if (!game.started && (e.code === 'Enter' || e.code === 'Space')) begin();
  });

  /* ---------------------------------------------------------------- loop
     ?record=N drives the loop by hand at a fixed 1/N second step instead of
     from the wall clock. Capture is far slower than real time, so a recorder
     that samples a free-running loop gets uneven, stuttering motion; stepping
     one frame per captured image means the footage plays back at exactly the
     intended speed however long the grab took. */
  const RECORD = +(new URLSearchParams(location.search).get('record') || 0);
  let last = performance.now();
  const MAX_DT = 1 / 15;

  function step(dt) {
    try {
      /* One clock for everything that moves. Panels, rings, lamps and the
         cabin's own shader time used to read performance.now() directly, which
         meant they ignored this dt entirely — they ran at wall-clock speed
         through a stepped capture and kept running while the tab was hidden.
         See src/core/clock.js. */
      tickClock(dt);
      if (game.started) game.update(dt);
      else game.updateIdle?.(dt);
      game.engine.time = game.time;
      game.engine.dt = dt;
      // the cabin is a second pass with its own camera; see Engine.render
      game.engine.render(
        game.interiorRig && game.interiorRig.visible ? game.interiorScene : null,
        game.interiorCam);
      /* Dynamic resolution is measured off the real framerate, so it is the
         single most machine-dependent input in the pipeline: the same scene
         comes out at a different pixel ratio — different sharpness, different
         aliasing — on a slow machine than a fast one. A stepped capture wants
         the resolution it was asked for and nothing else. */
      if (!RECORD) game.engine.adapt(dt);
    } catch (e) {
      console.error(e);
      fatal('runtime error — see console', e);
      throw e;
    }
  }

  function tick(now) {
    requestAnimationFrame(tick);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > MAX_DT) dt = MAX_DT;
    if (document.hidden) return;
    step(dt);
  }

  if (RECORD) {
    // one frame per call, so the capture tool controls time exactly
    window.__step = (n = 1) => { for (let i = 0; i < n; i++) step(1 / RECORD); };
    /* Lets a capture tool see whether anything is actually waiting on the
       clock. Without it there is no way to distinguish a sequence that needs
       frames from one that is blocked on a load, and driving frames through
       the second makes the capture depend on how long the load took. */
    window.__beats = pendingBeats;
    step(1 / RECORD);
  } else {
    requestAnimationFrame(tick);
  }
})();
