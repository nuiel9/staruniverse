// Ad-hoc probe: boot the game, run JS, optionally screenshot.
//   node tools/probe.mjs "expr" [--shot path] [--settle ms] [--w 1600] [--h 900]
//
// --frozen  capture deterministically: drive the loop by hand at a fixed step
//           instead of letting it free-run against the wall clock. Use it for
//           anything a human or a judge will compare against another capture.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { bootGame } from './boot.mjs';
import { frozenBoot, frozenRun, frozenSettle, installHelpers, recordQuery } from './frozen.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const EXPR = args[0] && !args[0].startsWith('--') ? args[0] : '1';
const SHOT = opt('shot', null);
const SETTLE = +opt('settle', 1200);
/* --frozen: capture deterministically. Frames instead of milliseconds, and no
   dynamic-resolution controller chasing the wall clock. See tools/frozen.mjs
   for why the set was not reproducible without it. */
const FROZEN = args.includes('--frozen');
/* Same browser resolution the acceptance suites use. This used to launch
   Playwright's own pinned build with metal flags unconditionally, which works
   on the Mac it was written on and fails outright in a container that has a
   preinstalled chromium and no downloaded one. CHROMIUM env wins, then the
   well-known preinstalled path, then Playwright's download. */
const exe = process.env.CHROMIUM
  || ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));
const mac = process.platform === 'darwin';
const browser = await chromium.launch({
  headless: true,
  executablePath: mac ? undefined : exe,
  args: mac
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
});
/* deviceScaleFactor matters more than the viewport. A capture at 1 is about a
   megapixel; the laptop this is judged on is a 2x Retina panel at nearly six.
   Sharpness and aliasing verdicts taken at 1 are worthless — pass --dpr 2. */
const page = await browser.newPage({
  viewport: { width: +opt('w', 1600), height: +opt('h', 900) },
  deviceScaleFactor: +opt('dpr', 1),
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text()); });
const Q = opt('q', null);
const qs = FROZEN ? recordQuery(Q) : (Q ? 'q=' + Q : '');
await page.goto('http://localhost:5173/' + (qs ? '?' + qs : ''),
  { waitUntil: 'domcontentloaded' });
const AFTER = opt('after', null);
let out;
if (FROZEN) {
  await frozenBoot(page);
  await installHelpers(page);
  out = await frozenRun(page, EXPR);
  if (SHOT || AFTER) await frozenSettle(page, SETTLE);
  if (AFTER) out = await frozenRun(page, AFTER);
} else {
  out = await bootGame(page, { setup: EXPR, settle: (SHOT || AFTER) ? SETTLE : 0, after: AFTER });
}
if (out !== undefined && out !== null) console.log(JSON.stringify(out, null, 2));
if (SHOT) {
  /* Generous, because the thing being photographed is a scene that has just
     had a hundred frames driven through it and the compositor may still be
     catching up. The default thirty seconds killed a dusk capture mid-set. */
  await page.screenshot({ path: SHOT, timeout: 120000 });
  const st = await page.evaluate(() => ({
    fps: +window.__game.engine.fps.toFixed(0), calls: window.__game.engine.drawCalls,
  }));
  console.log(`shot ${SHOT}  fps=${st.fps} calls=${st.calls}`);
}
await browser.close();
