/* Does the height field you can build from a spec match the one you land on?
 *
 * Site placement is about to score routes before the player lands, using a
 * field built from the world's spec alone. If that field and the one the
 * Surface actually constructs ever differ, sites are placed on a world nobody
 * drives on — and every later check in this file would be measuring the wrong
 * planet while passing.
 *
 * After Task 1 they are the same code, so this is cheap insurance rather than
 * a second fieldcheck. It is still worth running: "the same code" is a claim
 * about a refactor, and refactors are exactly where it stops being true.
 *
 *   npm run dev            in one terminal
 *   npm run sitecheck      in another
 */
import { chromium } from 'playwright';
import { bootGame } from './boot.mjs';

const URL = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const b = document.getElementById('bootStart'); return b && !b.hidden;
}, undefined, { timeout: 120000 });
await page.evaluate(() => document.getElementById('bootStart').click());
await page.waitForFunction(() => window.__game && window.__game.time > 0.5,
  undefined, { timeout: 180000 });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push([name, !!ok, detail]);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
};

/* Three worlds rather than one. The extraction has to hold across world types,
   because seaY branches on spec.garden and heightAt branches on uType. */
const agree = await page.evaluate(async () => {
  const g = window.__game;
  const surfMod = await import('/src/world/Surface.js');
  if (typeof surfMod.groundField !== 'function') return { err: 'groundField is not exported' };
  const solid = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas);
  const out = [];
  for (const body of solid.slice(0, 3)) {
    g.pose({ bodyRef: body, dist: 1.6, phase: 70, elev: 8 });
    g.land(body, { now: true });
    g.director.stop();
    if (!g.landed) { out.push({ body: body.name, err: 'land refused' }); continue; }
    const S = g.surface;
    const f = surfMod.groundField(body.spec);
    let worstY = 0, worstAt = null;
    /* Scattered rather than gridded, and out to the range a site can sit at,
       because that is the ground the score will be walked over. */
    for (let i = 0; i < 400; i++) {
      const a = i * 2.399963229, r = 40 + (i / 400) * 6200;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      for (const lod of [1, 14, 40]) {
        const d = Math.abs(f.heightAt(x, z, lod) - S.heightAt(x, z, lod));
        if (d > worstY) { worstY = d; worstAt = [Math.round(x), Math.round(z), lod]; }
      }
    }
    out.push({
      body: body.name, type: body.spec.type,
      siteDx: Math.abs(f.site[0] - S._site[0]) + Math.abs(f.site[1] - S._site[1]),
      datumDx: Math.abs(f.datum[0] - S._datum[0]) + Math.abs(f.datum[1] - S._datum[1]),
      seaDx: Math.abs(f.seaY - S._seaY),
      worstY, worstAt,
    });
    await g.liftOff({ now: true });
  }
  return { out };
});

if (agree.err) { console.error(agree.err); await browser.close(); process.exit(1); }
for (const r of agree.out) {
  if (r.err) { check(`field agrees on ${r.body}`, false, r.err); continue; }
  /* Exact, not close. The two are the same function after Task 1, so any
     difference at all means the constructor kept a second derivation. */
  check(`the landing site agrees on ${r.body} (${r.type})`, r.siteDx === 0 && r.datumDx === 0 && r.seaDx === 0,
    `site ${r.siteDx} · datum ${r.datumDx} · sea ${r.seaDx}`);
  check(`heights agree on ${r.body} (${r.type})`, r.worstY === 0,
    `worst ${r.worstY} m${r.worstAt ? ` at ${r.worstAt[0]},${r.worstAt[1]} lod ${r.worstAt[2]}` : ''}`);
}

const bad = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - bad}/${checks.length} ok`);
await browser.close();
process.exit(bad ? 1 : 0);
