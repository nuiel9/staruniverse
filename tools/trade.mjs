// The first trade run, end to end and headless: dock at station A, buy what
// it produces, cross to station B, sell into its demand, and come out ahead.
// This is the M1 acceptance test — if it fails, the game is not a trading
// game, whatever else works.
//
// Uses the built bundle like smoke.mjs, and the same rule: wait on game
// state, never on wall-clock time, because software GL renders at seconds
// per frame.
//
//   node tools/trade.mjs [url]        default http://localhost:4173/
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
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const b = document.getElementById('bootStart'); return b && !b.hidden;
}, undefined, { timeout: SLOW });
await page.evaluate(() => localStorage.removeItem('star-universe.v1'));
await page.evaluate(() => document.getElementById('bootStart').click());
await page.waitForFunction(() => window.__game && window.__game.time > 0.5,
  undefined, { timeout: SLOW });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push([name, !!ok, detail]);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
};

// -------------------------------------------------- two stations, one system
const setup = await page.evaluate(() => {
  const g = window.__game;
  const st = g.bodies.filter((b) => b.kind === 'station');
  return { count: st.length, names: st.map((s) => s.name) };
});
check('home system has two stations', setup.count === 2, setup.names.join(' / '));

// A profitable run must exist by construction, in at least one direction —
// prices drift with time now, so ask the live price function, both ways.
const spread = await page.evaluate(() => {
  const g = window.__game;
  const eco = g.economy;
  const st = g.bodies.filter((x) => x.kind === 'station');
  let best = null;
  for (const [i, j] of [[0, 1], [1, 0]]) {
    for (const gd of st[i].station.market.goods) {
      const buyAt = eco.priceAt(st[i].station.market, gd.id, g.time);
      const sellAt = eco.priceAt(st[j].station.market, gd.id, g.time);
      const margin = sellAt - buyAt;
      if (gd.stock > 0 && (!best || margin > best.margin)) {
        best = { id: gd.id, from: i, to: j, buyAt, sellAt, margin, stock: gd.stock };
      }
    }
  }
  return best;
});
check('profitable route exists between the stations', spread.margin > 0,
  `${spread.id}: buy ${spread.buyAt} @${spread.from} sell ${spread.sellAt} @${spread.to} (+${spread.margin}/u)`);

// ---------------------------------------------------------- take the helm
// Docking is a pilot's act — canDock refuses anyone standing in the cabin —
// so sit down the same way smoke.mjs does.
await page.evaluate(() => {
  const g = window.__game;
  const st = g.interior.stations.find((x) => x.id === 'seat');
  g.player.pos.set(st.pos.x, 0, st.pos.z);
  g.player.yaw = 0;
});
await page.waitForFunction(() => window.__game.player.station?.id === 'seat',
  undefined, { timeout: SLOW });
await page.keyboard.press('e');
await page.waitForFunction(() => window.__game.mode === 'pilot',
  undefined, { timeout: SLOW });

// ------------------------------------------------------------- dock at A
// Teleport to the first station's doorstep — flying there for real is the
// game, not the test — then dock through the same call the L key makes.
await page.evaluate((idx) => {
  const g = window.__game;
  const a = g.bodies.filter((x) => x.kind === 'station')[idx];
  g.ship.absPos.copy(a.absPos);
  g.ship.absPos.x += a.radius * 1.6;
  g.ship.vel.set(0, 0, 0);
}, spread.from);
await page.waitForFunction(() => window.__game.canDock(),
  undefined, { timeout: SLOW });
const trade1 = await page.evaluate((goodId) => {
  const g = window.__game;
  g.dockAt(g.canDock());
  const before = g.economy.credits;
  const market = g.dockedAt.station.market;
  const { n, price } = g.economy.buy(market, goodId, 5);
  return {
    docked: !!g.dockedAt, screen: g.dock.open, station: g.dockedAt?.name,
    bought: n, before, after: g.economy.credits, price,
    held: g.economy.cargo[goodId] || 0,
  };
}, spread.id);
check('docked at A, screen open', trade1.docked && trade1.screen, trade1.station);
// A buy is allowed to partial-fill: five requested, but the ledger, the
// stock and the hold each cap it. What must hold is the arithmetic.
const affordable = Math.min(5, Math.floor(trade1.before / trade1.price), spread.stock);
check('buy filled to the ledger\'s cap, debited exactly', trade1.bought === affordable
  && trade1.bought > 0
  && trade1.after === trade1.before - trade1.bought * trade1.price
  && trade1.held === trade1.bought,
`${trade1.bought}u @ ${trade1.price} · ${trade1.before} → ${trade1.after} cr`);

// ------------------------------------------------------------- cross to B
await page.evaluate((idx) => {
  const g = window.__game;
  g.undock();
  const b = g.bodies.filter((x) => x.kind === 'station')[idx];
  g.ship.absPos.copy(b.absPos);
  g.ship.absPos.x += b.radius * 1.6;
  g.ship.vel.set(0, 0, 0);
}, spread.to);
await page.waitForFunction(() => window.__game.canDock(),
  undefined, { timeout: SLOW });
const trade2 = await page.evaluate((goodId) => {
  const g = window.__game;
  g.dockAt(g.canDock());
  const before = g.economy.credits;
  const market = g.dockedAt.station.market;
  const { n, price } = g.economy.sell(market, goodId, 5);
  return {
    station: g.dockedAt?.name, sold: n, before, after: g.economy.credits, price,
    held: g.economy.cargo[goodId] || 0,
  };
}, spread.id);
check('sold entire hold at destination, credited exactly', trade2.sold === trade1.bought
  && trade2.after === trade2.before + trade2.sold * trade2.price
  && trade2.held === 0,
`${trade2.sold}u @ ${trade2.price} · ${trade2.before} → ${trade2.after} cr at ${trade2.station}`);
// Prices drifted between the two docks, so assert direction, not arithmetic:
// the strong produce→demand gap dwarfs the ±26% drift.
check('the run turned a profit', trade2.after > trade1.before,
  `net +${trade2.after - trade1.before} cr`);

// ---------------------------------------------------------- persistence
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('star-universe.v1')));
check('ledger persisted', saved && saved.credits === trade2.after, `saved ${saved?.credits} cr`);

// ---------------------------------------------------------- depart cleanly
const departed = await page.evaluate(() => {
  const g = window.__game;
  g.undock();
  return { docked: !!g.dockedAt, screen: g.dock.open, mode: g.mode };
});
check('departed, controls returned', !departed.docked && !departed.screen
  && departed.mode === 'pilot', `mode=${departed.mode}`);

if (errs.length) console.log('pageerrors:', [...new Set(errs)].slice(0, 4).join(' | '));
const ok = checks.every((c) => c[1]) && !errs.length;
console.log(ok ? 'TRADE PASS' : 'TRADE FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
