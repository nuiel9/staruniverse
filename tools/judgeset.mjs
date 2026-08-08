// Rebuild the review set an independent judge looks at.
//
// The survey exists to catch regressions; this exists to be *judged*. It runs
// the same set-pieces, then adds the two the survey cannot stage from a single
// boot — standing on a planet, and the same planet at a different hour — and
// copies everything into shots/judge/ so a reviewer has one directory to read.
//
//   node tools/judgeset.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUT = 'shots/judge';

// Clear the survey directory, and do it *before* creating the output directory
// inside it. A shot the current system cannot stage does not overwrite its PNG,
// so anything left from an earlier run gets copied into the review set as if it
// were current — a frame of a different system, at a different revision,
// presented for judging beside the real ones.
console.log('— survey —');
fs.rmSync('shots', { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
execFileSync('node', ['tools/survey.mjs', '--w', '1600', '--h', '900'], { stdio: 'inherit' });

const FROM_SURVEY = [
  'a-spawn', 'b-terran', 'c-terran-crescent', 'x-orbit', 'd-gas', 'i-rings',
  'e-barren', 'f-ice', 'g-hot', 'h-dry', 'j-star', 'k-ship', 'u-shipclose',
  'v-station', 'm-derelict', 'l-resonator', 'w-traffic', 't-belt', 'q-jump', 'p-fold',
];
for (const n of FROM_SURVEY) {
  const src = `shots/${n}.png`;
  if (fs.existsSync(src)) fs.copyFileSync(src, `${OUT}/${n}.png`);
}

// Landing has to be shot separately: it swaps the whole scene, so the survey
// cannot follow it with anything else from the same boot.
const LANDINGS = [
  ['y-landed', `g.pose({kind:'terran', dist:1.6, phase:70, elev:8}); g.land(g.target, {now:true}); g.director.stop();`],
  // Dusk, not midnight. The sun climbs at 0.012 rad/s, so t=260 is 180 degrees
  // of rotation — a full night. Search for the moment it sits just above the
  // horizon instead of guessing a number.
  ['z-landed-dusk', `g.pose({kind:'terran', dist:1.6, phase:70, elev:8}); g.land(g.target, {now:true}); g.director.stop();
     for(let t=0;t<520;t+=2){ g.landed.t=t; g.updateSurface(0.001);
       const y = g.surface.skyMat.uniforms.uSunDir.value.y; if(y < 0.10 && y > 0.03) break; }`],
];
console.log('— landings —');
for (const [name, js] of LANDINGS) {
  execFileSync('node', ['tools/probe.mjs',
    `(()=>{g.mode='exterior'; ${js} g.setLayer('hud',false); return null;})()`,
    '--shot', `${OUT}/${name}.png`, '--settle', '3200', '--w', '1600', '--h', '900'],
  { stdio: 'inherit' });
}

/* The interfaces, which the original set had no reason to carry: this fork's
   own work is a market, a negotiation and a chart, and all three are judged on
   whether they can be *read* rather than on whether they are pretty. Shot with
   the HUD left on, at dpr 2, because a sharpness verdict taken at one device
   pixel per CSS pixel is worthless — see probe.mjs. */
const INTERFACES = [
  ['ui-a-market', `g.mode='pilot';
     const st = g.bodies.filter(b=>b.kind==='station')[0];
     g.ship.absPos.copy(st.absPos); g.ship.absPos.x += st.radius*1.6; g.ship.vel.set(0,0,0);
     g.dockAt(st);
     const m = g.dockedAt.station.market;
     g.economy.buy(m, m.goods.find(x=>x.role==='produces').id, 3);
     g.dock.render();`],
  ['ui-b-chart', `g.mode='pilot'; g.starmap.show();
     /* a frontier lane charted, so both registers are in frame */
     const e = [...g.lanes.edges.values()].find(x=>!g.lanes.isCharted(x.key));
     if (e) { g.lanes.chart(e.a, e.b); g.starmap.refreshLanes(); }
     g.starmap.sel = (g.currentSystemId + 3) % g.galaxy.length;`],
  ['ui-c-comms', `g.mode='pilot';
     g.comms.openFor({kind:'craft', craftKind:'freighter', name:'BULK HAULER KESH', faction:'free'}, 'vess');
     g.comms._act('posture','businesslike'); g.comms._act('trade');`],
];
console.log('\n— interfaces —');
for (const [name, js] of INTERFACES) {
  execFileSync('node', ['tools/probe.mjs',
    `(()=>{ ${js} return null; })()`,
    '--shot', `${OUT}/${name}.png`, '--settle', '2600', '--w', '1600', '--h', '900', '--dpr', '2'],
  { stdio: 'inherit' });
}

console.log('\n— tone —');
execFileSync('node', ['tools/levels.mjs', ...fs.readdirSync(OUT).map((f) => `${OUT}/${f}`)],
  { stdio: 'inherit' });
console.log(`\n${fs.readdirSync(OUT).length} frames in ${OUT}`);
console.log(`brief for the reviewer: tools/JUDGE.md`);
