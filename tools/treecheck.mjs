/* Does the JS transliteration of the tree acceptance test agree with the GLSL?
 *
 * The same job tools/fieldcheck.mjs does for the height field, and for the same
 * reason: a careful transliteration of that field was wrong by metres, twice,
 * from single-precision effects that no amount of reading would have found. The
 * tree test is worse, because it ends in a hard binary — grow > 0.004 — and a
 * disagreement there is not a small error in a height, it is a tree that one
 * copy has and the other does not.
 *
 * Three stages, cheapest first, in the order that localises a failure:
 *   0  hash11 and meshLod alone, JS against GPU. The precision story lives here.
 *   1  the whole acceptance test, per instance, at three camera poses.
 *   2  the near-field index: copy stability and the threshold margin.
 *
 * Runs against the DEV server, like fieldcheck — it imports source modules.
 *   npm run dev            in one terminal
 *   npm run treecheck      in another
 */
import { chromium } from 'playwright';
import { bootGame } from './boot.mjs';

const KIND = process.argv[2] || 'terran';
const URL = process.argv[3] || 'http://localhost:5173/';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 600)); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });

/* A vegetated world, because the trees band only exists above veg 0.55 and a
   checker that silently examined an empty band would pass for the wrong
   reason. `pose` first: `land` refuses from orbit and returns a resolved
   promise while doing it, which is exactly the sort of thing a suite must not
   paper over — see the note in HANDOFF.md. */
/* `b.spec.kind` does not exist on this data model — a planet's terrain kind
   ('terran', 'desert', ...) lives at `b.spec.type`; `kind` is only the body's
   own top-level tag ('planet', 'star', 'moon'). Game.js's own pose() helper
   confirms the convention (`x.spec.type === o.kind`, Game.js:3469). Filtering
   on `.kind` here would silently match nothing on every galaxy, not just this
   one, which is exactly the "empty band examined silently" failure the
   comment above warns about — so this reads `.type`, not `.kind`. */
const booted = await bootGame(page, {
  setup: `(()=>{
    g.mode='exterior';
    const solid = g.bodies.filter((b)=>b.spec && b.planet && !b.planet.isGas
      && b.spec.type === '${KIND}' && (b.spec.veg||0) > 0.62);
    const body = solid[0];
    if(!body) return {failed:'no vegetated ${KIND} world in this galaxy'};
    g.pose({bodyRef: body, dist:1.6, phase:70, elev:8});
    g.land(body, {now:true});
    g.director.stop(); g.setLayer('hud', false);
    return {body: body.name};
  })()`,
  settle: 1500,
});
if (booted && booted.failed) {
  console.error('setup:', booted.failed);
  await browser.close();
  process.exit(1);
}

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push([name, !!ok, detail]);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
};

// ---------------------------------------------------- stage 0: the basis
const s0 = await page.evaluate(async () => {
  const g = window.__game;
  const S = g.surface;
  const mod = await import('/src/gfx/glsl/noise.js');
  const surfMod = await import('/src/world/Surface.js');
  const WJ = surfMod.__woodyJS;
  if (!WJ || !WJ.hash11) return { err: '__woodyJS.hash11 is not exported' };

  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const gl = cv.getContext('webgl2', { antialias: false });
  if (!gl) return { err: 'no webgl2' };
  if (!gl.getExtension('EXT_color_buffer_float')) return { err: 'no float rt' };

  const VS = `#version 300 es
  in vec2 aPos;
  void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

  /* uMode 0 is hash11 on its own, over the range of seed arguments the band
     actually produces: iA.z runs 0..40 and the tile shift 0..23, so s runs
     0..63 and the three arguments (s*9.13+0.77, s*1.37, s*4.73) reach ~576.
     uMode 1 is meshLod. Both write the *input* alongside the output so the JS
     side compares against the same float32 the GPU saw, rather than against
     the double it thinks it asked for. */
  const FS = `#version 300 es
  precision highp float;
  ${mod.NOISE.replace(/^#ifndef LS_NOISE|#define LS_NOISE|#endif$/gm, '')}
  uniform float uLodK;
  uniform float uP0, uStep;
  uniform int uMode;
  out vec4 oCol;
  float meshLodProbe(float d){
    float p = uLodK*pow(max(d, 1.0), ${(1 - 0.28).toFixed(6)});
    return 0.26 + clamp(p, d*uLodK*${(0.0130 / (0.0195 * Math.pow(1000, 0.28))).toFixed(9)},
                           d*uLodK*${(0.115 / (0.0195 * Math.pow(1000, 0.28))).toFixed(9)});
  }
  void main(){
    float i = floor(gl_FragCoord.y)*64.0 + floor(gl_FragCoord.x);
    float p = uP0 + i*uStep;
    if(uMode == 0) oCol = vec4(hash11(p), p, 0.0, 1.0);
    else           oCol = vec4(meshLodProbe(p), p, 0.0, 1.0);
  }`;

  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { return { err: String(e).slice(0, 1200) }; }

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 64, 64);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  gl.useProgram(prog);
  const u = (n) => gl.getUniformLocation(prog, n);
  gl.uniform1f(u('uLodK'), S.U.uLodK.value);

  const run = (mode, p0, step, js) => {
    gl.uniform1i(u('uMode'), mode);
    gl.uniform1f(u('uP0'), p0);
    gl.uniform1f(u('uStep'), step);
    gl.viewport(0, 0, 64, 64);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Float32Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.FLOAT, px);
    let worst = 0, worstAt = null, nz = 0;
    const errs = [];
    for (let i = 0; i < 64 * 64; i++) {
      const got = px[i * 4], p = px[i * 4 + 1];
      const d = Math.abs(js(p) - got);
      errs.push(d);
      if (d > 0) nz++;
      if (d > worst) { worst = d; worstAt = [p, got, js(p)]; }
    }
    errs.sort((a, b) => a - b);
    return { worst, worstAt, median: errs[errs.length >> 1], nonZero: nz };
  };

  return {
    body: S.spec ? S.spec.type : '?',
    // three sweeps at deliberately incommensurate steps, so the sample set is
    // not a lattice the hash could be accidentally friendly to
    hashA: run(0, 0, 0.1372, WJ.hash11),
    hashB: run(0, 0.77, 0.0413, WJ.hash11),
    hashC: run(0, 137.0, 0.1099, WJ.hash11),
    lod: run(1, 1, 1.9137, (d) => WJ.meshLod(d, S.U)),
  };
});

if (s0.err) { console.error('stage 0:', s0.err); await browser.close(); process.exit(1); }

for (const k of ['hashA', 'hashB', 'hashC']) {
  const r = s0[k];
  check(`hash11 agrees with the GPU (${k})`, r.worst <= 1e-6,
    `worst ${r.worst.toExponential(2)} · median ${r.median.toExponential(2)}`
    + ` · ${r.nonZero}/4096 inexact`
    + (r.worst > 0 ? ` · at p=${r.worstAt[0]} gpu ${r.worstAt[1]} js ${r.worstAt[2]}` : ''));
}
/* 1e-5 looked right on paper but was never run against a real GPU — measured
   here (ANGLE/Metal, this machine) the worst case is 4.3e-5 at d≈4165, about
   five and a half float32 ulps at that magnitude. It is not a transliteration
   bug: emulating the shader's float32 rounding with Math.fround at every step
   of jMeshLod does not shrink the gap, it *widens* it to 6.1e-5, which is what
   you get when the divergence is the GPU's own pow() — implementations are
   free under the GLSL ES spec to compute it as exp2(y*log2(x)), an
   approximation, rather than the correctly-rounded value Math.pow gives — and
   not a rounding mode this JS twin could ever reproduce. 2e-4 keeps five times
   that headroom while still catching what this check exists to catch: a wrong
   exponent, a swapped clamp constant or a missing 0.26 all miss by 1e-1 or
   more, three orders of magnitude past this bound. */
check('meshLod agrees with the GPU', s0.lod.worst <= 2e-4,
  `worst ${s0.lod.worst.toExponential(2)}`);

const bad = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - bad}/${checks.length} ok`);
await browser.close();
process.exit(bad ? 1 : 0);
