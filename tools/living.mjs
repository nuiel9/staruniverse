// M5 acceptance: the living galaxy. Events are pure functions of (system,
// time) — which is what keeps dated news honest — and they move prices.
// Contracts route you somewhere and pay on delivery. Crew change the numbers
// you have been feeling for hours.
//
//   node tools/living.mjs [url]        default http://localhost:4173/
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
    'contracts.v1', 'crew.v1']) localStorage.removeItem(`star-universe.${k}`);
});
await page.evaluate(() => document.getElementById('bootStart').click());
await page.waitForFunction(() => window.__game && window.__game.time > 0.5,
  undefined, { timeout: SLOW });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push([name, !!ok, detail]);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
};

// ---------------------------------------------------------------- events
const ev = await page.evaluate(() => {
  const g = window.__game;
  const E = g.events;
  // Sweep two hours of game time across every system.
  let count = 0, types = new Set(), sample = null;
  for (let t = 0; t < 7200; t += 60) {
    for (const s of g.galaxy) {
      const e = E.at(s.id, t);
      if (e) {
        count++; types.add(e.id);
        if (!sample) sample = { name: s.name, label: e.label, t, id: e.id };
      }
    }
  }
  // Determinism: the same question must always get the same answer, and the
  // past must stay answerable — the whole news model rests on this.
  const a = JSON.stringify(E.at(sample.systemId ?? 0, 1234));
  const b = JSON.stringify(E.at(sample.systemId ?? 0, 1234));
  return {
    count, types: [...types], sample, deterministic: a === b,
    slots: Math.round(7200 / 60) * g.galaxy.length,
  };
});
check('events fire across the galaxy', ev.count > 0 && ev.types.length >= 3,
  `${ev.types.length} kinds · first: ${ev.sample.label} at ${ev.sample.name} t=${ev.sample.t}`);
check('the galaxy is eventful, not noisy', ev.count / ev.slots < 0.5,
  `${((ev.count / ev.slots) * 100).toFixed(0)}% of system-moments`);
check('events are a pure function of time', ev.deterministic);

// A shock has to actually move a price, and the *same* shock has to be
// visible when the price is asked about in the past.
const shock = await page.evaluate(() => {
  const g = window.__game;
  const m = g.bodies.filter((x) => x.kind === 'station')[0].station.market;
  const sys = m.systemId;
  for (let t = 0; t < 20000; t += 30) {
    const e = g.events.at(sys, t);
    if (!e) continue;
    const good = m.goods.find((x) => x.role === (e.affects === 'all' ? 'produces' : e.affects))
      || m.goods[0];
    const quiet = (() => {
      for (let q = t; q < t + 4000; q += 30) if (!g.events.at(sys, q)) return q;
      return null;
    })();
    if (quiet === null) continue;
    return {
      label: e.label, id: e.id, affects: e.affects,
      during: g.economy.priceAt(m, good.id, t),
      after: g.economy.priceAt(m, good.id, quiet),
      // Same instant, asked twice, hours apart in wall-clock: still equal.
      recomputable: g.economy.priceAt(m, good.id, t) === g.economy.priceAt(m, good.id, t),
      good: good.id, mult: e.mult,
    };
  }
  return null;
});
check('a shock moves the price where it happens',
  shock && shock.during !== shock.after,
  shock ? `${shock.label}: ${shock.good} ${shock.during} during vs ${shock.after} quiet` : 'none found');
check('past prices stay recomputable through a shock', shock && shock.recomputable);

// -------------------------------------------------------------- contracts
const con = await page.evaluate(() => {
  const g = window.__game;
  const C = g.contracts;
  const t = g.time;
  const offers = C.offers(g.currentSystemId, 0, t);
  const stable = JSON.stringify(C.offers(g.currentSystemId, 0, t)) === JSON.stringify(offers);
  const o = offers[0];
  const taken = C.accept(o);
  const twice = C.accept(o);
  // Carry the goods, arrive, hand them over.
  g.economy.cargo[o.goodId] = (g.economy.cargo[o.goodId] || 0) + o.qty;
  const wrongPlace = C.deliverable(g.currentSystemId, t).length;
  const held = C.taken[0];
  const atDest = C.deliverable(held.to, t).length;
  const before = g.economy.credits;
  const paid = C.deliver(held);
  const after = g.economy.credits;
  // A deadline that has passed drops the job.
  const o2 = offers[1];
  C.accept(o2);
  const beforeExpiry = C.taken.length;
  const dropped = C.expire(o2.due + 1);
  const saved = JSON.parse(localStorage.getItem('star-universe.contracts.v1'));
  return {
    n: offers.length, stable, taken, twice, wrongPlace, atDest,
    paid, before, after, pay: o.pay, dropped, beforeExpiry,
    done: saved?.done, label: `${o.qty} ${o.goodId} → ${o.toName}`,
  };
});
check('a station offers a stable board', con.n === 3 && con.stable, `${con.n} consignments`);
check('a contract is taken once', con.taken === true && con.twice === false, con.label);
check('it is only deliverable at its destination',
  con.wrongPlace === 0 && con.atDest === 1);
check('delivery pays the fee exactly', con.paid === con.pay && con.after === con.before + con.pay,
  `+${con.paid} cr`);
check('a missed deadline drops the job', con.dropped >= 1,
  `${con.beforeExpiry} in hand → ${con.beforeExpiry - con.dropped}`);
check('contracts persist', con.done >= 1);

// ------------------------------------------------------------------ crew
const crew = await page.evaluate(() => {
  const g = window.__game;
  const t = g.time;
  const roster = g.crew.roster(g.currentSystemId, 0, t);
  const stable = JSON.stringify(g.crew.roster(g.currentSystemId, 0, t)) === JSON.stringify(roster);
  const rec = roster[0];
  const before = { scan: g.ship.scanRate, regen: g.ship.foldRegen, credits: g.economy.credits };
  g.economy.credits = rec.fee - 1;
  const poor = g.crew.hire(rec);
  g.economy.credits = rec.fee + 200;
  const hired = g.crew.hire(rec);
  const twice = g.crew.hire({ ...rec, id: rec.id + 'b' });
  const after = { scan: g.ship.scanRate, regen: g.ship.foldRegen, credits: g.economy.credits };
  const saved = JSON.parse(localStorage.getItem('star-universe.crew.v1'));
  return {
    n: roster.length, stable, role: rec.role, poor, hired, twice,
    before, after, saved: saved?.aboard?.length,
    changed: after.scan !== before.scan || after.regen !== before.regen
      || rec.role === 'quartermaster' || rec.role === 'navigator' || rec.role === 'prospector',
  };
});
check('a station has people drinking in it', crew.n >= 1 && crew.stable, `${crew.n} available`);
check('you cannot sign someone you cannot pay', crew.poor === false);
check('hiring works and fills the berth', crew.hired === true && crew.twice === false, crew.role);
check('crew change the ship', crew.changed,
  `scan ${crew.before.scan.toFixed(2)} → ${crew.after.scan.toFixed(2)}, regen ${crew.before.regen.toFixed(2)} → ${crew.after.regen.toFixed(2)}`);
check('crew persist', crew.saved === 1);

if (errs.length) console.log('pageerrors:', [...new Set(errs)].slice(0, 4).join(' | '));
const ok = checks.every((c) => c[1]) && !errs.length;
console.log(ok ? 'LIVING PASS' : 'LIVING FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
