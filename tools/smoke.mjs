// Boot-and-fly smoke test against any URL — the production bundle, or the
// deployed site. Minification and asset-path rewriting break things the dev
// server never shows, so this runs against the built artifact, not the source.
//
// Every wait here is on a *game state*, never on wall-clock time: on a Mac
// with a GPU the whole test takes seconds, while a software-GL CI container
// renders a frame every few seconds and needs minutes for the same
// transitions. Conditions pass on both; sleeps only pass on one.
//
//   node tools/smoke.mjs [url]        default http://localhost:4173/
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:4173/';

// Playwright insists on its own pinned browser build; a preinstalled system
// chromium (CI containers, sandboxes) is fine for a smoke test. CHROMIUM env
// wins, then a well-known preinstalled path, then Playwright's download.
const exe = process.env.CHROMIUM
  || ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));

// On a Mac with a GPU the test runs headed on metal; anywhere else (CI,
// containers) it falls back to headless SwiftShader, which still exercises the
// full WebGL2 path — just slowly, so nothing here may gate on fps.
const mac = process.platform === 'darwin';
const browser = await chromium.launch({
  headless: !mac,
  executablePath: mac ? undefined : exe,
  args: mac
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
});
const ctx = await browser.newContext({ viewport: { width: mac ? 1280 : 800, height: mac ? 720 : 450 } });
const page = await ctx.newPage();

const errs = [];
const failed = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) failed.push(`HTTP ${r.status()} ${r.url()}`); });

// Generous ceilings sized for software GL; a real GPU never gets near them.
const SLOW = 300000;

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const b = document.getElementById('bootStart'); return b && !b.hidden;
}, undefined, { timeout: SLOW });

// A DOM-level click rather than a trusted input event: under software GL the
// boot overlay's fade keeps the button "unstable" long enough to time out
// Playwright's actionability checks, and the handler does not care.
await page.evaluate(() => document.getElementById('bootStart').click());

// The sim is alive once frames advance the clock.
await page.waitForFunction(() => window.__game && window.__game.time > 0.5,
  undefined, { timeout: SLOW });

const boot = await page.evaluate(() => ({
  fps: +window.__game.engine.fps.toFixed(0),
  mode: window.__game.mode,
  bodies: window.__game.bodies.length,
  draws: window.__game.engine.drawCalls,
}));

// Take the helm and put some throttle in, so the flight path is exercised too.
// You wake up in the habitat, a cabin away from the seat, so E does nothing
// until the player is actually stood at the station.
await page.evaluate(() => {
  const g = window.__game;
  const st = g.interior.stations.find((x) => x.id === 'seat');
  g.player.pos.set(st.pos.x, 0, st.pos.z);
  g.player.yaw = 0;
});
// One frame must pass for the proximity scan to notice the station.
await page.waitForFunction(() => window.__game.player.station?.id === 'seat',
  undefined, { timeout: SLOW });
await page.keyboard.press('e');
await page.waitForFunction(() => window.__game.mode === 'pilot',
  undefined, { timeout: SLOW });

await page.keyboard.down('KeyW');
await page.waitForFunction(() => window.__game.ship.speed > 0,
  undefined, { timeout: SLOW });
await page.keyboard.up('KeyW');

const fly = await page.evaluate(() => ({
  mode: window.__game.mode,
  speed: +window.__game.ship.speed.toFixed(1),
  fps: +window.__game.engine.fps.toFixed(0),
}));

console.log(`url    : ${URL}`);
console.log(`boot   : fps=${boot.fps} mode=${boot.mode} bodies=${boot.bodies} draws=${boot.draws}`);
console.log(`fly    : mode=${fly.mode} speed=${fly.speed} km/s fps=${fly.fps}`);
console.log(`console: ${errs.length ? [...new Set(errs)].slice(0, 6).join(' | ') : 'clean'}`);
console.log(`network: ${failed.length ? [...new Set(failed)].slice(0, 8).join(' | ') : 'clean'}`);

const ok = boot.bodies > 0 && fly.mode === 'pilot' && fly.speed > 0 && !failed.length;
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
