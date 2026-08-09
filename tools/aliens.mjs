// M3 acceptance: the aliens. Territories dealt deterministically, posture
// pricing the whole conversation, barter walking monotonically toward a
// hidden reservation with exact ledger math, and rumors that check out
// against the real world state.
//
//   node tools/aliens.mjs [url]        default http://localhost:4173/
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
  localStorage.removeItem('star-universe.v1');
  localStorage.removeItem('star-universe.lanes.v1');
  localStorage.removeItem('star-universe.contacts.v1');
});
await page.evaluate(() => document.getElementById('bootStart').click());
await page.waitForFunction(() => window.__game && window.__game.time > 0.5,
  undefined, { timeout: SLOW });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push([name, !!ok, detail]);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
};

// ---------------------------------------------------------------- territory
const terr = await page.evaluate(() => {
  const g = window.__game;
  const owner = g.territory.owner;
  const counts = {};
  for (const sp of owner) counts[sp] = (counts[sp] || 0) + 1;
  return { home: owner[0], counts, total: owner.length, all: owner.every(Boolean) };
});
check('every system has an owner, home is Registry',
  terr.all && terr.home === 'institute', JSON.stringify(terr.counts));
check('at least three cultures hold territory', Object.keys(terr.counts).length >= 3);

// ------------------------------------------------------- posture is pricing
const posture = await page.evaluate(() => {
  // Reach the posture matrix through live contacts: fabricate one per species.
  const g = window.__game;
  const runs = {};
  for (const spId of ['vess', 'korrim', 'szethi']) {
    const fits = {};
    for (const p of ['friendly', 'businesslike', 'obsequious', 'hostile']) {
      g.comms.openFor({ kind: 'craft', craftKind: 'freighter', name: 'TEST HULL', faction: 'free' }, spId);
      g.comms._act('posture', p);
      fits[p] = g.comms.state ? g.comms.state.fit : null;
      g.comms.close();
    }
    runs[spId] = fits;
  }
  return runs;
});
check('Vess price flattery below business',
  posture.vess.obsequious < posture.vess.businesslike,
  `obsequious=${posture.vess.obsequious} businesslike=${posture.vess.businesslike}`);
check('Korrim respect iron, despise grovelling',
  posture.korrim.hostile > posture.korrim.obsequious,
  `hostile=${posture.korrim.hostile} obsequious=${posture.korrim.obsequious}`);
check('Szethi cut a hostile channel dead',
  posture.szethi.hostile <= -3, `hostile=${posture.szethi.hostile}`);

// -------------------------------------------------------------- the barter
const barter = await page.evaluate(() => {
  const g = window.__game;
  const eco = g.economy;
  const credits0 = eco.credits;
  // A warm Vess contact with a lot they SELL (ore/volatiles biased under 1).
  g.comms.openFor({ kind: 'craft', craftKind: 'freighter', name: 'MARGIN HULL', faction: 'free' }, 'vess');
  g.comms._act('posture', 'businesslike');
  const s = g.comms.state;
  if (!s.offer) return { noOffer: true };
  const mode = s.offer.mode;
  // If they are buying, hold enough to fill the lot — the test is the math,
  // not the shopping trip.
  if (mode === 'buy') eco.cargo[s.offer.id] = (eco.cargo[s.offer.id] || 0) + s.offer.qty;
  g.comms._act('trade');
  const p0 = s.price;
  const walk = [p0];
  for (let i = 0; i < 3 && !s.done; i++) {
    g.comms._act('counter');
    walk.push(s.price);
  }
  const pN = s.price;
  // Accept clears the offer on success — remember the lot before it goes.
  const lotId = s.offer.id;
  const qty = s.offer.qty;
  const before = eco.credits;
  const held0 = eco.cargo[lotId] || 0;
  g.comms._act('accept');
  const after = eco.credits;
  const held1 = eco.cargo[lotId] || 0;
  const n = mode === 'sell' ? held1 - held0 : held0 - held1;
  g.comms._act('end');
  const spent = s.contact.craft === undefined;  // fabricated contact has no craft
  return {
    mode, walk, monotone: mode === 'sell'
      ? walk.every((v, i) => i === 0 || v <= walk[i - 1])
      : walk.every((v, i) => i === 0 || v >= walk[i - 1]),
    improved: mode === 'sell' ? pN < p0 : pN > p0,
    qty, n, before, after, pN, credits0,
    ledgerExact: mode === 'sell'
      ? after === before - n * pN
      : after === before + n * pN,
    spent,
  };
});
check('counteroffers walk one way toward the reservation',
  !barter.noOffer && barter.monotone && barter.improved, `${barter.mode}: ${barter.walk.join(' → ')}`);
check('accept executes exact ledger math', barter.ledgerExact,
  `${barter.n}u @ ${barter.pN} · ${barter.before} → ${barter.after} cr`);

// ---------------------------------------------------------------- rumors
const rumor = await page.evaluate(() => {
  const g = window.__game;
  // Warm Szethi contact: friendly gets fit 2 → free rumor, filed.
  g.comms.openFor({ kind: 'craft', craftKind: 'freighter', name: 'DRIFT HULL', faction: 'free' }, 'szethi');
  g.comms._act('posture', 'friendly');
  const heard0 = g.rumors.heard.length;
  g.comms._act('ask');
  const heard1 = g.rumors.heard.length;
  const r = g.rumors.heard[g.rumors.heard.length - 1];
  g.comms._act('end');
  g.comms.close();

  const saved = JSON.parse(localStorage.getItem('star-universe.contacts.v1'));
  return {
    gained: heard1 - heard0, text: r ? r.text.slice(0, 60) : null,
    savedHeard: saved ? saved.heard.length : 0,
    savedRep: saved ? saved.rep : null,
  };
});
check('a warm contact hands over a rumor, filed to the ledger',
  rumor.gained === 1 && rumor.savedHeard >= 1, rumor.text);
check('reputation persists across contacts', rumor.savedRep && Object.keys(rumor.savedRep).length > 0,
  JSON.stringify(rumor.savedRep));

// Truth check needs the market builder exposed; verify in this context instead.
const truth = await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 60; i++) {
    const cand = g.rumors.generate('korrim', 5000 + i * 13);
    if (cand && cand.kind === 'lane' && cand.truth) {
      const e = g.lanes.edges.get(cand.edgeKey);
      return { kind: 'lane', claimed: 'clear', density: e.density, honest: e.density < 0.35 };
    }
  }
  return null;
});
check('a truthful lane rumor names a genuinely clear lane',
  truth && truth.honest, truth ? `density ${truth.density.toFixed(2)}` : 'none generated');

if (errs.length) console.log('pageerrors:', [...new Set(errs)].slice(0, 4).join(' | '));
const ok = checks.every((c) => c[1]) && !errs.length;
console.log(ok ? 'ALIENS PASS' : 'ALIENS FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
