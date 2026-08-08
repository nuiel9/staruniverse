// M4 acceptance: the ground. Worlds hold seeded deposits, the drone turns
// them into cargo and fuel, folds burn lucent and refuse when the tank is
// dry, and outfits change the ship's numbers and persist.
//
//   node tools/ground.mjs [url]        default http://localhost:4173/
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
    + '  Either:  npm run verify            (builds, serves, runs all four)\n'
    + '  or:      npm run build && npm run preview   in another terminal first.');
  await browser.close();
  process.exit(1);
}
await page.waitForFunction(() => {
  const b = document.getElementById('bootStart'); return b && !b.hidden;
}, undefined, { timeout: SLOW });
await page.evaluate(() => {
  for (const k of ['v1', 'lanes.v1', 'contacts.v1', 'ground.v1', 'outfit.v1']) {
    localStorage.removeItem(`star-universe.${k}`);
  }
});
await page.evaluate(() => document.getElementById('bootStart').click());
await page.waitForFunction(() => window.__game && window.__game.time > 0.5,
  undefined, { timeout: SLOW });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push([name, !!ok, detail]);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
};

// ------------------------------------------------------------- deposits
const deps = await page.evaluate(() => {
  const g = window.__game;
  const solid = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas);
  const listed = solid.map((b) => ({
    name: b.name,
    n: g.prospect.deposits(b).length,
    ids: g.prospect.deposits(b).map((d) => d.id),
    tonnes: g.prospect.deposits(b).reduce((s, d) => s + d.tonnes, 0),
  }));
  // Determinism: asking twice must give the same answer, and two different
  // worlds must not be handed the same seams.
  const first = solid[0];
  const again = JSON.stringify(g.prospect.deposits(first));
  delete first._deposits;
  const recomputed = JSON.stringify(g.prospect.deposits(first));
  const sigs = new Set(listed.map((l) => l.ids.join(',') + ':' + l.tonnes));
  return {
    worlds: listed.length,
    withSeams: listed.filter((l) => l.n > 0).length,
    deterministic: again === recomputed,
    distinct: sigs.size,
    sample: listed.slice(0, 3).map((l) => `${l.name}: ${l.ids.join('+')} ${l.tonnes}t`),
  };
});
check('solid worlds carry deposits', deps.withSeams > 0,
  `${deps.withSeams}/${deps.worlds} worlds · ${deps.sample.join(' | ')}`);
check('deposits are deterministic', deps.deterministic);
check('worlds do not share one seam table', deps.distinct > 1,
  `${deps.distinct} distinct manifests across ${deps.worlds} worlds`);

// ------------------------------------------------------------ extraction
const mined = await page.evaluate(() => {
  const g = window.__game;
  const body = g.bodies.find((b) => b.spec && b.planet && !b.planet.isGas
    && g.prospect.workable(b));
  if (!body) return { none: true };
  const dep = g.prospect.workable(body);
  const before = { left: g.prospect.remaining(body, dep), cargo: g.economy.cargoUsed(), fuel: g.ship.fuel };
  const got = [];
  for (let i = 0; i < 3; i++) got.push(g.prospect.extract(body, dep));
  const after = { left: g.prospect.remaining(body, dep), cargo: g.economy.cargoUsed(), fuel: g.ship.fuel };
  // Work the seam to nothing and confirm it refuses to give more.
  let guard = 0;
  while (g.prospect.remaining(body, dep) > 0 && guard++ < 200) {
    if (g.economy.cargoUsed() >= g.economy.cargoCap && dep.id !== 'lucent') break;
    g.prospect.extract(body, dep);
  }
  const spent = g.prospect.remaining(body, dep) === 0
    ? g.prospect.extract(body, dep) : 'not-emptied';
  const saved = JSON.parse(localStorage.getItem('star-universe.ground.v1'));
  return {
    id: dep.id, got, before, after, spent,
    persisted: !!(saved && Object.keys(saved.worked || {}).length),
  };
});
const intoHold = mined.id !== 'lucent';
check('the drone yields material', !mined.none && mined.got.every((x) => x === mined.id),
  `${mined.id} ×${mined.got.length}`);
check('the seam depletes by what was taken', mined.before.left - mined.after.left === 3,
  `${mined.before.left} → ${mined.after.left} t`);
check(intoHold ? 'ore lands in the hold' : 'lucent lands in the tank',
  intoHold ? mined.after.cargo === mined.before.cargo + 3
    : mined.after.fuel === mined.before.fuel + 3,
  intoHold ? `hold ${mined.before.cargo} → ${mined.after.cargo}`
    : `tank ${mined.before.fuel} → ${mined.after.fuel}`);
check('a worked-out seam gives nothing more',
  mined.spent === null || mined.spent === 'not-emptied', String(mined.spent));
check('extraction persists', mined.persisted);

// ----------------------------------------------------------------- fuel
const fuel = await page.evaluate(() => {
  const g = window.__game;
  const to = g.galaxy.find((s) => s.id !== g.currentSystemId
    && Number.isFinite(g.lanes.graphDist(g.currentSystemId, s.id)));
  const jc = g.jumpCost(g.currentSystemId, to.id);
  const need = g.fuelFor(jc);
  g.ship.fuel = g.ship.fuelCap;
  g.ship.foldCharge = 1;
  g.starmap.show();
  g.starmap.sel = to.id;
  const before = g.ship.fuel;
  const jumped = g.starmap.confirm();
  const after = g.ship.fuel;
  // Now dry the tank and confirm the drive refuses.
  g.ship.fuel = 0;
  g.ship.foldCharge = 1;
  g.starmap.show();
  g.starmap.sel = to.id;
  const dryJump = g.starmap.confirm();
  g.starmap.close();
  return { need, before, after, jumped, dryJump, cost: jc.cost, dist: jc.dist };
});
check('a fold costs lucent by distance', fuel.need >= 1 && fuel.jumped
  && fuel.after === fuel.before - fuel.need,
`${fuel.dist.toFixed(1)} ly → ${fuel.need} t · ${fuel.before} → ${fuel.after}`);
check('a dry tank refuses the jump', fuel.dryJump === false);

// ------------------------------------------------------------ outfitting
const fit = await page.evaluate(() => {
  const g = window.__game;
  const eco = g.economy;
  const before = { cargoCap: eco.cargoCap, tier: g.outfit.tier.hold, credits: eco.credits };
  const nx = g.outfit.next('hold');
  eco.credits = nx.cost - 1;
  const poor = g.outfit.buy('hold');
  eco.credits = nx.cost + 500;
  const bought = g.outfit.buy('hold');
  const after = { cargoCap: eco.cargoCap, tier: g.outfit.tier.hold, credits: eco.credits };
  const podsShown = g.ship.pods.filter((p) => p.visible).length;
  const saved = JSON.parse(localStorage.getItem('star-universe.outfit.v1'));
  return { before, after, poor, bought, cost: nx.cost, podsShown, savedTier: saved?.tier?.hold };
});
check('an upgrade you cannot afford is refused', fit.poor === false);
check('fitting the hold raises capacity and charges for it',
  fit.bought && fit.after.cargoCap > fit.before.cargoCap
  && fit.after.credits === fit.cost + 500 - fit.cost,
  `${fit.before.cargoCap} → ${fit.after.cargoCap} t for ${fit.cost} cr`);
check('the hardware shows on the hull', fit.podsShown === fit.after.tier,
  `${fit.podsShown} pod group(s) visible at tier ${fit.after.tier}`);
check('the fit persists', fit.savedTier === fit.after.tier);

if (errs.length) console.log('pageerrors:', [...new Set(errs)].slice(0, 4).join(' | '));
const ok = checks.every((c) => c[1]) && !errs.length;
console.log(ok ? 'GROUND PASS' : 'GROUND FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
