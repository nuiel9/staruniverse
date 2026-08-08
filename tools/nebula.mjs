// M2 acceptance: the nebula as geography. Lane graph connected, home lanes
// pre-charted, dust priced into every jump, surveys cut the cost and sell at
// docks, prices drift with time, and remote quotes age with lane distance.
//
// Same discipline as smoke.mjs/trade.mjs: state waits only, built bundle only.
//
//   node tools/nebula.mjs [url]        default http://localhost:4173/
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
});
await page.evaluate(() => document.getElementById('bootStart').click());
await page.waitForFunction(() => window.__game && window.__game.time > 0.5,
  undefined, { timeout: SLOW });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push([name, !!ok, detail]);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
};

// -------------------------------------------------------------- the graph
const graph = await page.evaluate(() => {
  const g = window.__game;
  const L = g.lanes;
  const seen = new Set([0]);
  const q = [0];
  while (q.length) {
    const u = q.pop();
    for (const e of L.adj[u]) {
      const v = e.a === u ? e.b : e.a;
      if (!seen.has(v)) { seen.add(v); q.push(v); }
    }
  }
  return {
    systems: g.galaxy.length,
    reachable: seen.size,
    edges: L.edges.size,
    homePrecharted: L.adj[0].every((e) => L.isCharted(e.key)),
    unchartedCount: [...L.edges.keys()].filter((k) => !L.isCharted(k)).length,
  };
});
check('lane graph connects every system', graph.reachable === graph.systems,
  `${graph.reachable}/${graph.systems} via ${graph.edges} lanes`);
check('home lanes pre-charted, frontier exists', graph.homePrecharted && graph.unchartedCount > 0,
  `${graph.unchartedCount} lanes unsurveyed`);

// ------------------------------------------------- dust is priced into jumps
const costs = await page.evaluate(() => {
  const g = window.__game;
  const L = g.lanes;
  const e = [...L.edges.values()].find((x) => !L.isCharted(x.key) && x.density > 0.1);
  if (!e) return null;
  const before = L.costBetween(e.a, e.b);
  L.chart(e.a, e.b);
  const after = L.costBetween(e.a, e.b);
  const offlane = (() => {
    for (let i = 0; i < g.galaxy.length; i++) {
      for (let j = i + 1; j < g.galaxy.length; j++) {
        if (!L.lane(i, j)) return L.costBetween(i, j);
      }
    }
    return null;
  })();
  return {
    key: e.key, density: e.density,
    before: before.cost, after: after.cost,
    charted: after.charted,
    saved: JSON.parse(localStorage.getItem('star-universe.lanes.v1')).charted.includes(e.key),
    offlaneWorse: offlane ? offlane.cost / (offlane.dist / 80) : null,
  };
});
check('charting a lane cuts its fold cost', costs && costs.charted && costs.after < costs.before,
  `${costs.key} d=${costs.density.toFixed(2)}: ${(costs.before * 100).toFixed(0)}% → ${(costs.after * 100).toFixed(0)}%`);
check('survey persists to disk', costs.saved, costs.key);
check('off-lane jumps pay the wilderness surcharge', costs.offlaneWorse === null || costs.offlaneWorse > 1.5,
  costs.offlaneWorse ? `×${costs.offlaneWorse.toFixed(2)} over clear-space base` : 'no off-lane pair');

// ---------------------------------------------------------- prices breathe
const drift = await page.evaluate(() => {
  const g = window.__game;
  const m = g.bodies.filter((x) => x.kind === 'station')[0].station.market;
  const t = g.time;
  let moved = 0;
  for (const gd of m.goods) {
    if (g.economy.priceAt(m, gd.id, t) !== g.economy.priceAt(m, gd.id, t + 900)) moved++;
  }
  const past = g.economy.priceAt(m, m.goods[0].id, t - 600);
  const again = g.economy.priceAt(m, m.goods[0].id, t - 600);
  return { moved, total: m.goods.length, deterministic: past === again };
});
check('prices drift with time', drift.moved > 0, `${drift.moved}/${drift.total} goods moved over 15m`);
check('the past is recomputable (news needs this)', drift.deterministic);

// ------------------------------------------- dock: sell charts, read reports
// The helm, the doorstep, the berth — same route as trade.mjs.
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
await page.evaluate(() => {
  const g = window.__game;
  const a = g.bodies.filter((x) => x.kind === 'station')[0];
  g.ship.absPos.copy(a.absPos);
  g.ship.absPos.x += a.radius * 1.6;
  g.ship.vel.set(0, 0, 0);
});
await page.waitForFunction(() => window.__game.canDock(),
  undefined, { timeout: SLOW });

const dock = await page.evaluate(() => {
  const g = window.__game;
  g.dockAt(g.canDock());
  const key = `${g.currentSystemId}:${g.dockedAt.station.idx}`;
  const sellable = g.lanes.sellableAt(key);
  const quoted = sellable.reduce((s, e) => s + g.lanes.chartValue(e), 0);
  const before = g.economy.credits;
  const paid = g.lanes.sellAt(key);
  if (paid) { g.economy.credits += paid; g.economy.save(); }
  const paidTwice = g.lanes.sellAt(key);
  const reports = g.economy.reports(g.currentSystemId, g.time, key);
  return {
    station: g.dockedAt.name, sellableCount: sellable.length, quoted, paid,
    before, after: g.economy.credits, paidTwice,
    known: g.economy.known.length,
    report: reports[0] ? {
      name: reports[0].name, age: reports[0].age, goods: reports[0].goods.length,
    } : null,
  };
});
check('dock buys the fresh chart at the quoted price',
  dock.sellableCount === 1 && dock.paid === dock.quoted && dock.after === dock.before + dock.paid,
  `${dock.paid} cr at ${dock.station}`);
check('a chart sells to the same station once', dock.paidTwice === 0);
check('docking teaches the local boards', dock.known >= 2, `${dock.known} stations known`);
check('sibling board is quoted live', dock.report && dock.report.age < 1 && dock.report.goods > 0,
  dock.report ? `${dock.report.name} · age ${dock.report.age.toFixed(1)}s · ${dock.report.goods} quotes` : 'no report');

// Remote quotes must age with lane distance, and match the price function
// evaluated back then. Learn a far station artificially to prove it.
const far = await page.evaluate(() => {
  const g = window.__game;
  const eco = g.economy;
  const sys = g.galaxy.find((s) => s.id !== 0 && Number.isFinite(g.lanes.graphDist(0, s.id)));
  eco.learnStation({ key: `${sys.id}:0`, systemId: sys.id, systemSeed: sys.seed, idx: 0, name: `${sys.name} GATE` });
  const key = `${g.currentSystemId}:${g.dockedAt.station.idx}`;
  const reports = eco.reports(g.currentSystemId, g.time, key);
  const r = reports.find((x) => x.systemId === sys.id);
  if (!r) return null;
  return { name: r.name, ly: r.ly, age: r.age, goods: r.goods.length };
});
check('remote quotes age with lane distance', far && far.age > 60 && far.goods > 0,
  far ? `${far.name} · ${far.ly.toFixed(1)} ly · ${Math.round(far.age)}s stale` : 'no remote report');

if (errs.length) console.log('pageerrors:', [...new Set(errs)].slice(0, 4).join(' | '));
const ok = checks.every((c) => c[1]) && !errs.length;
console.log(ok ? 'NEBULA PASS' : 'NEBULA FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
