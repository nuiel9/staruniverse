/* Does the detail control actually change anything?
 *
 * The three tiers reach a long way — Engine's supersample and pixel-ratio
 * ceiling, PostFX's streak pass, the terrain's step counts, planet LOD
 * thresholds, asteroid and mote counts, the fleet budget, sky cube resolution,
 * star count, cabin dust — but they were only ever chosen for the player by a
 * guess from navigator.deviceMemory. A control that offers the choice is easy
 * to add and easy to get subtly wrong: stored but not read, read but not
 * applied, applied to the renderer but not to the world, or applied so
 * enthusiastically that it overrides the ?q= the capture tooling depends on.
 *
 * So this asserts the whole round trip rather than the storage: pick a tier on
 * the title card, let the page reload, and check that the world that comes back
 * is genuinely cheaper — fewer stars, fewer motes, a lower ceiling on
 * resolution — because "the setting is saved" is not the claim anyone cares
 * about. The claim is that choosing LOW buys you frames.
 *
 * Runs against the DEV server.
 *   npm run dev            in one terminal
 *   npm run detailcheck    in another
 */
import { chromium } from 'playwright';
import { bootGame } from './boot.mjs';

const URL = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { pass++; console.log(`ok    ${what}${detail ? '  · ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${what}${detail ? '  · ' + detail : ''}`); }
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 400)); });

/* What a tier costs, read off the built world rather than off the setting.
   These are the numbers the tier is supposed to move; if the control worked
   only as far as localStorage they would all stay put. */
const COST = `(() => {
  const g = window.__game;
  return {
    q: g.quality,
    stored: localStorage.getItem('su.detail'),
    prCeil: +g.engine.prCeil.toFixed(3),
    pixelRatio: +g.engine.pixelRatio.toFixed(3),
    streak: !!g.engine.post.enabled.streak,
    skyRes: g.skyRes,
    stars: g.starField?.geometry?.getAttribute('position')?.count ?? -1,
    dust: g.dust?.mat ? (g.dust.points?.geometry?.getAttribute('position')?.count ?? -1) : -1,
  };
})()`;

/** Load fresh, optionally picking a tier on the title card first. */
async function run(pick, { q = null, keepStorage = false } = {}) {
  await page.goto(URL + (q ? `?q=${q}` : ''), { waitUntil: 'domcontentloaded' });
  if (!keepStorage && !pick) {
    await page.evaluate(() => { try { localStorage.removeItem('su.detail'); } catch { /* off */ } });
    await page.goto(URL + (q ? `?q=${q}` : ''), { waitUntil: 'domcontentloaded' });
  }
  if (pick) {
    await page.waitForSelector(`#bootDetail button[data-detail="${pick}"]`, { timeout: 60000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
      page.click(`#bootDetail button[data-detail="${pick}"]`),
    ]);
  }
  await bootGame(page);
  await page.waitForTimeout(1500);
  return page.evaluate(COST);
}

console.log('— the control is on the title card —');
const base = await run(null);
ok(base.stored === null, 'a player who has never chosen has nothing stored',
  `detected ${base.q}`);
const shown = await page.evaluate(() =>
  [...document.querySelectorAll('#bootDetail button')].map((b) => b.dataset.detail));
ok(shown.join(',') === 'low,medium,high', 'all three tiers are offered', shown.join(' '));

console.log('\n— picking a tier survives the reload —');
const low = await run('low');
ok(low.stored === 'low', 'the choice is stored', `su.detail=${low.stored}`);
ok(low.q === 'low', 'and the world is built at it', `quality=${low.q}`);

const high = await run('high');
ok(high.stored === 'high', 'and so is the other end', `su.detail=${high.stored}`);
ok(high.q === 'high', 'and that world too', `quality=${high.q}`);

console.log('\n— and it is genuinely cheaper, not just labelled so —');
/* The point of the control. Each of these is a different subsystem reading the
   tier, so a control that reached the renderer but not the world — or the world
   but not the renderer — fails here rather than passing on a stored string. */
ok(low.prCeil < high.prCeil, 'low puts a lower ceiling on resolution',
  `${low.prCeil} vs ${high.prCeil}`);
ok(low.pixelRatio < high.pixelRatio, 'and renders fewer pixels for real',
  `${low.pixelRatio}x vs ${high.pixelRatio}x`);
ok(low.streak === false && high.streak === true, 'low drops the streak pass',
  `low ${low.streak}, high ${high.streak}`);
ok(low.skyRes < high.skyRes, 'and bakes a smaller sky',
  `${low.skyRes} vs ${high.skyRes}`);
ok(low.stars > 0 && low.stars < high.stars, 'and draws fewer stars',
  `${low.stars} vs ${high.stars}`);

console.log('\n— the capture tooling still wins —');
/* This one protects the review set. ?q= is what survey and judgeset pass, and a
   preference left in a profile that silently re-tiered a capture would have a
   judge comparing two different renderers while being told they were the same
   one. The stored tier here is 'high', from the run above. */
const forced = await run(null, { q: 'low', keepStorage: true });
ok(forced.stored === 'high', 'the stored preference is left alone', `su.detail=${forced.stored}`);
ok(forced.q === 'low', 'but ?q= decides what gets built', `quality=${forced.q}`);

await page.evaluate(() => { try { localStorage.removeItem('su.detail'); } catch { /* off */ } });
console.log(`\n${pass}/${pass + fail} ok`);
await browser.close();
process.exit(fail ? 1 : 0);
