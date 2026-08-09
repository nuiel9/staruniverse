// M6 acceptance: the question. Four cultures give four incompatible accounts,
// the revelations unlock on evidence the player gathers by playing, and the
// lucent twist only fires once enough of it has actually been burned.
//
//   node tools/mystery.mjs [url]        default http://localhost:4173/
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:4173/';
const exe = process.env.CHROMIUM
  || ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));
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
page.on('pageerror', (e) => errs.push(e.message));

const SLOW = 300000;
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
} catch {
  console.error(`cannot reach ${URL}\n`
    + '  The acceptance suites run against the BUILT bundle, not the dev server.\n'
    + '  Either:  npm run verify            (builds, serves, runs them all)\n'
    + '  or:      npm run build && npm run preview   in another terminal first.');
  await browser.close();
  process.exit(1);
}
await page.waitForFunction(() => {
  const b = document.getElementById('bootStart'); return b && !b.hidden;
}, undefined, { timeout: SLOW });
await page.evaluate(() => {
  for (const k of ['v1', 'lanes.v1', 'contacts.v1', 'ground.v1', 'outfit.v1',
    'contracts.v1', 'crew.v1', 'mystery.v1']) localStorage.removeItem(`star-universe.${k}`);
});
await page.evaluate(() => document.getElementById('bootStart').click());
await page.waitForFunction(() => window.__game && window.__game.time > 0.5,
  undefined, { timeout: SLOW });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push([name, !!ok, detail]);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
};

// ------------------------------------------------------- nothing for free
const start = await page.evaluate(() => {
  const g = window.__game;
  g.mystery.update();
  return { found: [...g.mystery.found], burned: g.mystery.lucentBurned };
});
check('a new player understands nothing', start.found.length === 0 && start.burned === 0);

// ------------------------------------------------------ four flat contradictions
const claims = await page.evaluate(() => {
  const g = window.__game;
  const said = [];
  for (const sp of ['institute', 'vess', 'korrim', 'szethi']) {
    // Ask each culture until it volunteers its account of the Stillness.
    for (let i = 0; i < 60; i++) {
      const r = g.rumors.generate(sp, 900 + i * 37);
      if (r && r.kind === 'origin') { g.rumors.hear(r); said.push({ sp, claim: r.claim, truth: r.truth }); break; }
    }
  }
  return {
    said,
    distinct: g.mystery.distinctClaims(),
    truths: said.filter((x) => x.truth).length,
    testimony: g.mystery.testimony().length,
    corroborated: g.mystery.corroboratedClaims().length,
  };
});
check('every culture has its own account', claims.said.length === 4
  && claims.distinct.length === 4,
`${claims.said.map((x) => `${x.sp}:${x.claim}`).join(' ')}`);
check('exactly one of them is right', claims.truths === 1,
  claims.said.filter((x) => x.truth).map((x) => x.sp).join('') || 'none');
check('nobody corroborates anybody', claims.corroborated === 0,
  'the disagreement is the evidence');

// ---------------------------------------------- revelations gate on evidence
const gates = await page.evaluate(() => {
  const g = window.__game;
  const M = g.mystery;
  const out = {};
  // Contradiction alone should already have unlocked the second revelation.
  M.update();
  out.afterClaims = [...M.found];

  // Tines.
  g.cantos = ['canto1'];
  M.update();
  out.oneCanto = M.found.has('instrument');
  g.cantos = ['canto1', 'canto2'];
  M.update();
  out.twoCantos = M.found.has('instrument');

  // Lucent: eleven tonnes is not twelve.
  M.burn(11);
  M.update();
  out.elevenBurned = M.found.has('lucent');
  M.burn(1);
  M.update();
  out.twelveBurned = M.found.has('lucent');

  /* The survey reading wants six charted lanes and four catalogued worlds,
     and nothing above gathers either — so leaving it out and then asserting
     "all five reachable" was testing that the game gives away a revelation
     nobody earned. Earn it. */
  for (const e of [...g.lanes.edges.values()].slice(0, 6)) g.lanes.charted.add(e.key);
  for (let i = 0; i < 4; i++) g.discoveries.add(`probe:${i}`);
  M.update();
  out.census = M.found.has('census');

  // The ending fires with the seventh canto, and states the answer.
  let narrated = null;
  const realNarrate = g.hud.narrate.bind(g.hud);
  g.hud.narrate = (text, who) => { narrated = { text, who }; realNarrate(text, who); };
  g.cantos = ['1', '2', '3', '4', '5', '6', '7'];
  M.update();
  g.hud.narrate = realNarrate;

  const saved = JSON.parse(localStorage.getItem('star-universe.mystery.v1'));
  return {
    ...out,
    ending: M.found.has('aperture'),
    narrated,
    all: M.found.size,
    savedFound: saved?.found?.length, savedBurned: saved?.burned,
  };
});
check('contradiction alone unlocks the second reading',
  gates.afterClaims.includes('notdead'), gates.afterClaims.join(', ') || 'none');
check('one Tine is not two', gates.oneCanto === false && gates.twoCantos === true);
check('eleven tonnes of lucent is not twelve',
  gates.elevenBurned === false && gates.twelveBurned === true);
check('the seventh Canto ends it', gates.ending && !!gates.narrated,
  gates.narrated ? `"${gates.narrated.text.slice(0, 52)}…"` : 'no narration');
check('survey evidence unlocks the census reading', gates.census === true);
check('all five readings reachable', gates.all === 5, `${gates.all}/5`);
check('the question persists', gates.savedFound === 5 && gates.savedBurned === 12,
  `${gates.savedFound} found, ${gates.savedBurned} t burned`);

// --------------------------------------------------- a fold burns somebody
const burn = await page.evaluate(() => {
  const g = window.__game;
  const here = g.currentSystemId;
  const edge = g.lanes.adj[here].find((e) => g.lanes.isCharted(e.key));
  const to = g.galaxy[edge.a === here ? edge.b : edge.a];
  const need = g.fuelFor(g.jumpCost(here, to.id));
  g.ship.fuel = g.ship.fuelCap;
  g.ship.foldCharge = 1;
  const before = g.mystery.lucentBurned;
  g.starmap.show();
  g.starmap.sel = to.id;
  g.starmap.confirm();
  g.starmap.close();
  return { before, after: g.mystery.lucentBurned, need };
});
check('the ledger counts what the drive burns',
  burn.after === burn.before + burn.need, `+${burn.need} t recorded`);

if (errs.length) console.log('pageerrors:', [...new Set(errs)].slice(0, 4).join(' | '));
const ok = checks.every((c) => c[1]) && !errs.length;
console.log(ok ? 'MYSTERY PASS' : 'MYSTERY FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
