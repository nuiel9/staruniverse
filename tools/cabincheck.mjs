/* Can you still walk to everything in the cabin?
 *
 * The interior's own comments record what happens when the answer is no, and
 * both failures were silent. A blocker box that ran 0.14 m too far aft put the
 * player's stand point *inside* it, where every candidate move lands in it too
 * — measured, holding W, S, A or D for three seconds each moved the player
 * exactly zero millimetres, and leaving the helm soft-locked the game. And a
 * lane between the nav table and the lockers that looked open was closed once
 * the 0.30 m collision radius was applied to both sides, so everything aft of
 * z 2.7 — the resonance chamber, the port, half the lockers — was unreachable
 * on foot. Neither shows up as an error. The room renders perfectly; you just
 * cannot get there.
 *
 * Both were found by hand, by flood fill, after someone noticed. This does it
 * every time, which is what makes moving the furniture a safe thing to do:
 * the point of the check is not that the current layout passes, it is that the
 * next one has to.
 *
 * Runs against the DEV server, because it reads the live interior.
 *   npm run dev            in one terminal
 *   npm run cabincheck     in another
 */
import { chromium } from 'playwright';
import { bootGame } from './boot.mjs';

const URL = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const ok = (c, what, detail = '') => {
  if (c) { pass++; console.log(`ok    ${what}${detail ? '  · ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${what}${detail ? '  · ' + detail : ''}`); }
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await bootGame(page);

const R = await page.evaluate(() => {
  const g = window.__game;
  const I = g.interior;
  const RADIUS = 0.30;                      // Player.js
  const STEP = 0.05;                        // 5 cm, well under the radius
  const V = I.volumes, B = I.blockers;
  const zMin = V[0][2] + RADIUS, zMax = V[V.length - 1][3] - RADIUS;
  const halfAt = (z) => { for (const v of V) if (z >= v[2] && z <= v[3]) return v[1]; return 0.6; };
  const blocked = (x, z) => B.some((b) => x > b[0] - RADIUS && x < b[1] + RADIUS
    && z > b[2] - RADIUS && z < b[3] + RADIUS);
  /* The same test Player._tryMove applies, so a cell this calls walkable is a
     cell the player can actually stand in — not an approximation of one. */
  const walkable = (x, z) => z >= zMin && z <= zMax
    && Math.abs(x) <= halfAt(z) - RADIUS && !blocked(x, z);

  const nx = Math.ceil(4 / STEP), nz = Math.ceil((zMax - zMin) / STEP) + 1;
  const key = (i, j) => j * nx + i;
  const X = (i) => -2 + i * STEP, Z = (j) => zMin + j * STEP;

  // flood fill from where standing up puts you
  const start = { x: 0, z: -4.35 };
  const seen = new Uint8Array(nx * nz);
  const si = Math.round((start.x + 2) / STEP), sj = Math.round((start.z - zMin) / STEP);
  const startWalkable = walkable(start.x, start.z);
  const q = [[si, sj]];
  if (startWalkable) seen[key(si, sj)] = 1;
  let reached = 0;
  while (q.length) {
    const [i, j] = q.pop(); reached++;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz || seen[key(a, b)]) continue;
      if (!walkable(X(a), Z(b))) continue;
      seen[key(a, b)] = 1; q.push([a, b]);
    }
  }

  /* A station counts as reachable if any walkable cell inside its own radius
     was reached — which is the rule the game uses to offer the prompt, rather
     than requiring the player to stand on the exact anchor point. */
  const stations = (I.stations || []).map((s) => {
    const p = s.pos; let best = false;
    const r = s.radius || 1.0;
    for (let j = 0; j < nz && !best; j++) {
      for (let i = 0; i < nx; i++) {
        if (!seen[key(i, j)]) continue;
        if (Math.hypot(X(i) - p.x, Z(j) - p.z) <= r) { best = true; break; }
      }
    }
    return { id: s.id, reachable: best, x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
  });

  return { startWalkable, reached, cells: nx * nz, stations,
    volumes: V.length, blockers: B.length };
});

console.log('— the cabin is walkable —');
ok(R.startWalkable, 'standing up does not put you inside a blocker',
  'the seat box once did, and every direction was blocked');
ok(R.reached > 200, 'the walkable floor is a connected space', `${R.reached} cells reached`);

console.log('\n— and everything in it can be reached on foot —');
for (const s of R.stations) {
  ok(s.reachable, `${s.id} is reachable`, `at x ${s.x}, z ${s.z}`);
}
ok(R.stations.length >= 5, 'every station was tested', `${R.stations.length} stations`);

/* ---- and the star chart comes out of the table it is projected from.
 *
 * This is the invariant that was actually broken once: the table's position was
 * written down in two files, the table moved to starboard, and the chart stayed
 * at x 0 — a projection hanging over open deck with no projector under it,
 * its rings sweeping through the airlock hatch. Nothing errored. It took an
 * outside eye to notice, and then a second look to establish it had been fixed,
 * because the table's own cyan rim reads as orbit rings from close range and
 * is easy to mistake for the chart.
 *
 * So the guard is arithmetic rather than judgement: the deployed volume has to
 * be centred on the table and fit inside the room. */
const holo = await page.evaluate(async () => {
  const g = window.__game;
  g.mode = 'pilot';
  g.starmap.show();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const root = g.starmap.root || g.starmap.group;
  root.updateWorldMatrix(true, true);
  const V = g.origin.constructor;
  let mn = [9, 9, 9], mx = [-9, -9, -9];
  root.traverse((o) => {
    if (!o.visible || !o.geometry) return;
    o.geometry.computeBoundingBox?.();
    const bb = o.geometry.boundingBox; if (!bb) return;
    for (let i = 0; i < 8; i++) {
      const v = new V(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y,
        i & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld);
      const c = [v.x, v.y, v.z];
      for (let k = 0; k < 3; k++) { if (c[k] < mn[k]) mn[k] = c[k]; if (c[k] > mx[k]) mx[k] = c[k]; }
    }
  });
  const t = g.interior.navTable.position;
  return { mn, mx, table: [t.x, t.z],
    centre: [(mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2] };
});

console.log('\n— the chart sits on the table it comes out of —');
const offX = Math.abs(holo.centre[0] - holo.table[0]);
const offZ = Math.abs(holo.centre[1] - holo.table[1]);
ok(offX < 0.25 && offZ < 0.25, 'the projection is centred over the projector',
  `off by ${offX.toFixed(2)} m across, ${offZ.toFixed(2)} m along`);
ok(holo.mn[0] > -1.68 && holo.mx[0] < 1.68, 'and does not reach through the hull',
  `x ${holo.mn[0].toFixed(2)} .. ${holo.mx[0].toFixed(2)} inside +/-1.68`);
ok(holo.mx[1] < 2.30, 'nor through the ceiling', `top at y ${holo.mx[1].toFixed(2)}`);

console.log(`\n${pass}/${pass + fail} ok`);
await browser.close();
process.exit(fail ? 1 : 0);
