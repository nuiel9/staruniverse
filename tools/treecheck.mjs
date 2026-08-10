/* Does the JS transliteration of the tree acceptance test agree with the GLSL?
 *
 * The same job tools/fieldcheck.mjs does for the height field, and for the same
 * reason: a careful transliteration of that field was wrong by metres, twice,
 * from single-precision effects that no amount of reading would have found. The
 * tree test is worse, because it ends in a hard binary — grow > 0.004 — and a
 * disagreement there is not a small error in a height, it is a tree that one
 * copy has and the other does not.
 *
 * Four stages, cheapest first, in the order that localises a failure:
 *   0  hash11 and meshLod alone, JS against GPU. The precision story lives here.
 *   1  the whole acceptance test, per instance, at three camera poses.
 *   3  the guard the game ships, which asks stage 1's question on the player's
 *      machine. It runs here, out of numerical order, because everything below
 *      it goes through treesNear and the guard is what turns treesNear off.
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

// ------------------------------------------- stage 1: the acceptance test
/* Three camera poses, synthetic rather than taken from the live camera, so
   both copies are handed exactly the same pair and the comparison is about the
   transliteration rather than about where the chase camera happened to be. The
   probe builds the view matrix from the pose, because tileTo reads the forward
   out of it: viewM[0][2] and viewM[2][2] are the camera's own +Z in world, and
   tileTo negates them. */
const POSES = [
  { p: [0, 0], f: [0, -1] },
  { p: [300, -120], f: [-0.6, 0.8] },
  { p: [-1500, 900], f: [0.316, 0.949] },
];

const s1 = await page.evaluate(async (POSES) => {
  const g = window.__game;
  const S = g.surface;
  const surfMod = await import('/src/world/Surface.js');
  const WJ = surfMod.__woodyJS;
  if (!WJ.accept) return { err: '__woodyJS.accept is not exported' };
  const T = S._trees;
  if (!T) return { err: 'this world has no trees band (veg <= 0.55)' };

  const mesh = S.floraMeshes.find((m) => m.name === 'trees');
  if (!mesh) return { err: 'no trees mesh' };

  /* The slice is not built here any more, and that is the point: the shipped
     guard (stage 3, Surface.verifyTreeAgreement) has to compile the *same*
     text this stage does, or a pass here says nothing about what the player's
     machine will conclude. Task 4 measured that a cut-down probe is optimised
     differently and answers differently, so the assembly lives in one place —
     Surface.treeProbeGLSL — and both callers use it. All that differs between
     the two is how the uniforms are fed: raw WebGL2 here, a RawShaderMaterial
     on the game's own renderer there.

     The `#version` line is prepended by each caller rather than carried in the
     sources, because three prepends exactly that string and nothing else to a
     RawShaderMaterial declared GLSL3 — so both compiles see identical text. */
  let SRC;
  try {
    SRC = surfMod.treeProbeGLSL(mesh.material.vertexShader);
  } catch (e) {
    return { err: `treeProbeGLSL: ${e && e.message}` };
  }

  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const gl = cv.getContext('webgl2', { antialias: false });
  if (!gl) return { err: 'no webgl2' };
  if (!gl.getExtension('EXT_color_buffer_float')) return { err: 'no float rt' };

  const VS = `#version 300 es${SRC.vert}`;
  const FS = `#version 300 es${SRC.frag}`;

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
  } catch (e) { return { err: String(e).slice(0, 2000) }; }

  /* Three components and the name `position`, because the shared vertex source
     is also what three draws the probe quad with, and three takes a
     non-indexed draw's vertex count off geometry.attributes.position. */
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'position');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);

  const mkTex = (unit, data) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 64, 64);
    const pad = new Float32Array(64 * 64 * 4);
    pad.set(data.subarray(0, Math.min(data.length, pad.length)));
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RGBA, gl.FLOAT, pad);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  };
  mkTex(0, T.iA); mkTex(1, T.iB);

  const out = gl.createTexture();
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, out);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 64, 64);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);

  gl.useProgram(prog);
  const u = (n) => gl.getUniformLocation(prog, n);
  /* Every uniform the sliced chunk declares, from the live material. Reading
     them off mesh.material.uniforms rather than retyping them is the point:
     a uniform that changes name upstream then fails here loudly. */
  const MU = mesh.material.uniforms;
  const setU = (name) => {
    const l = u(name); if (!l) return;
    const v = MU[name] && MU[name].value;
    if (v === undefined || v === null) return;
    if (typeof v === 'number') {
      if (name === 'uType') gl.uniform1i(l, v | 0); else gl.uniform1f(l, v);
    } else if (v.isVector2) gl.uniform2f(l, v.x, v.y);
    else if (v.isVector3) gl.uniform3f(l, v.x, v.y, v.z);
    else if (v.isVector4) gl.uniform4f(l, v.x, v.y, v.z, v.w);
  };
  for (const name of Object.keys(MU)) setU(name);
  gl.uniform1i(u('uIA'), 0); gl.uniform1i(u('uIB'), 1);
  gl.uniform1i(u('uN'), T.n);
  gl.uniformMatrix4fv(u('projectionMatrix'), false, new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -2, 0,
  ]));

  const results = [];
  for (const pose of POSES) {
    const [px, pz] = pose.p;
    let [fx, fz] = pose.f;
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    /* The view matrix for a camera at (px, 0, pz) looking along (fx, 0, fz)
       with +Y up. Column-major, elements[col*4 + row]. Its rotation block is
       the transpose of (xAxis, yAxis, zAxis) with zAxis = -forward, which is
       what makes viewM[0][2] = zAxis.x and viewM[2][2] = zAxis.z. */
    const zx = -fx, zz = -fz;          // zAxis
    const xx = -fz, xz = fx;           // xAxis = up x zAxis
    const V = new Float32Array([
      xx, 0, zx, 0,
      0, 1, 0, 0,
      xz, 0, zz, 0,
      -(xx * px + xz * pz), 0, -(zx * px + zz * pz), 1,
    ]);
    gl.uniformMatrix4fv(u('viewMatrix'), false, V);
    gl.uniform3f(u('uCamPos'), px, 0, pz);
    gl.viewport(0, 0, 64, 64);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px4 = new Float32Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.FLOAT, px4);

    let posWorst = 0, hWorst = 0, growWorst = 0, nAcc = 0;
    const mism = [];
    for (let i = 0; i < T.n; i++) {
      const acc = px4[i * 4] > 0.5, grow = px4[i * 4 + 1];
      const gy = px4[i * 4 + 2], H = px4[i * 4 + 3];
      const js = WJ.accept(S, i, px, pz, fx, fz);
      growWorst = Math.max(growWorst, Math.abs(js.grow - grow));
      if (acc && js.accept) {
        nAcc++;
        posWorst = Math.max(posWorst, Math.abs(js.gy - gy));
        hWorst = Math.max(hWorst, Math.abs(js.H - H));
      }
      if (acc !== js.accept) {
        mism.push({ i, gpu: grow, js: js.grow, H: Math.max(H, js.H) });
      }
    }
    mism.sort((a2, b2) => b2.H - a2.H);
    results.push({
      pose: [px, pz, +fx.toFixed(3), +fz.toFixed(3)],
      accepted: nAcc, posWorst, hWorst, growWorst,
      mismatches: mism.length,
      /* Marginal trees are not saplings: at grow ~ 0 the stature is still
         0.55 of full, so a mismatch in a 6..18 m band is a 2 to 7 m tree.
         Report the tallest rather than assuming they are small. */
      tallestMismatch: mism.length ? +mism[0].H.toFixed(2) : 0,
      /* A disagreement is only forgivable near the threshold. One at grow 0.5
         is a transliteration bug, not a rounding effect. */
      worstMismatchDistance: mism.length
        ? Math.max(...mism.map((m2) => Math.max(Math.abs(m2.gpu - 0.004), Math.abs(m2.js - 0.004))))
        : 0,
    });
  }
  return { n: T.n, results };
}, POSES);

if (s1.err) { console.error('stage 1:', s1.err); await browser.close(); process.exit(1); }

for (const r of s1.results) {
  const at = `at (${r.pose[0]}, ${r.pose[1]}) facing (${r.pose[2]}, ${r.pose[3]})`;
  /* Ten millimetres, and 1e-3 was the wrong number for a reason worth writing
     down: neither of these two checks is measuring the tree code at all.

     jStandOnY is min() of three jFlatY calls, and jFlatY is Surface.heightAt
     with the horizon bend added back — so `posWorst` is the *height field's*
     twin, the one tools/fieldcheck.mjs already owns, sampled at the lods a tree
     happens to stand at. Nothing between `vec4 dat = uDatum;` and the grow test
     contributes to it. A gate here is therefore a second, badly-placed opinion
     about fieldcheck's own tolerance, and at 1 mm it was an opinion the field
     has never satisfied.

     The numbers that set it, measured on this world in one session: fieldcheck
     reports worst 3.66 mm at lod 1, and the tree path's worst is 3.73 mm at lod
     3.5 — the same quantity, the same magnitude, arrived at through a different
     door. Fifteen to seventeen per cent of accepted instances exceed 1 mm at the
     two near poses, while the far pose at lod ~40 has none at all. That is the
     opposite of a lod-driven tail: more of the field's bands are switched on at
     low lod, so the near ground is where the twin has the most to disagree
     about. Gating at 1 mm was gating below the field's own p90.

     Cite lod 1 and only lod 1, and here is why that is not cherry-picking.
     fieldcheck prints three sweeps and the other two look alarming next to a
     10 mm gate — 61.5 mm at lod 6 and 150 mm at lod 40. They are large because
     of what they cover, not because of lod: those sweeps step 3 m, 72 m and
     480 m across relief ranges of 24.9 m, 561 m and 687 m respectively, so the
     high-lod pair are walking over whole mountains and their worst case is a
     millimetre-scale disagreement on a six-hundred-metre feature. A tree stands
     in a 420 m tile within a few hundred metres of the site; the 3 m sweep over
     24.9 m of relief is the one whose scale actually matches that, and it is
     the one this gate has to live with. The far pose measuring cleanest of the
     three, at lod ~40, is the same fact from the other end.

     Ten millimetres still discriminates, which is the only thing that matters.
     What this check exists to catch is a wrong offset, a swapped sample or a
     missing min() in the three-sample footprint, and every one of those misses
     by *metres* — the ee footprint alone is lod + 0.8 across relief that runs to
     hundreds of metres. The gate keeps roughly three orders of magnitude of
     headroom over the failures it is for, which is the same trade stage 0's
     meshLod bound already makes.

     `hWorst` gets the same ten millimetres, and it is not because stature is
     grow's error wearing metres — it is, but that argument would justify almost
     anything, since the grow gate at 0.023 times dH/dgrow would put this bound
     at 218 mm. Ten is deliberately far tighter than that, and it is set by the
     one failure this branch nearly shipped.

     H = iB.y*(0.62 + 0.55*q1)*(0.55 + 0.45*grow), and q1 is `hash11(s*1.37)`.
     The naive transliteration of that argument — the one that reads straight
     off the GLSL — differs from the folded form the compiler actually computes
     by up to 2.9e-3 in q1, which through 0.55*iB.y at this band's 18 m ceiling
     is up to 29 mm of stature. So a 10 mm gate is precisely the instrument that
     catches a wrong q1 fold, which is a live failure mode rather than a
     hypothetical one: the first version of this check's twin got that fold
     wrong, and stature is where it shows. A bound argued from grow alone would
     have sailed past it.

     It is a tight gate, not a slack one, and the next person should know that
     before "fixing" it. iB.y is the same float32 on both sides and q1 is now
     bit-exact, so H can only differ through grow; at the measured grow worst of
     1.0e-3 and dH/dgrow of about 9.5 m per unit, the implied stature bound is
     about 9.5 mm — ninety-five per cent of the gate. There is no slack here to
     spend, and if grow ever gets worse this fails before the grow check does,
     which is the right order. */
  check(`ground height agrees on accepted trees ${at}`, r.posWorst < 1e-2,
    `${r.accepted} accepted · worst ${r.posWorst.toExponential(2)} m`);
  check(`stature agrees on accepted trees ${at}`, r.hWorst < 1e-2,
    `worst ${r.hWorst.toExponential(2)} m`);
  /* The margin the whole design rests on. The CPU collides at 0.05 and the GPU
     draws at 0.004, so an invisible wall needs an error of 0.046 in grow. This
     is the number that says how much room there actually is. */
  check(`grow error is well inside the 0.046 margin ${at}`, r.growWorst < 0.046 * 0.5,
    `worst ${r.growWorst.toExponential(2)} · ${Math.round(r.growWorst / 0.046 * 100)}% of margin`);
  check(`every accept/reject disagreement sits at the threshold ${at}`,
    r.worstMismatchDistance < 0.046,
    `${r.mismatches} disagreements · furthest ${r.worstMismatchDistance.toExponential(2)} from 0.004`
    + ` · tallest ${r.tallestMismatch} m`);
}

// ---------------------------------------- stage 3: the guard that ships
/* The runtime self-check has to reach the same verdict this whole tool does,
   on the machine the tool is running on — otherwise it is either dead weight
   or it is about to disable a working feature for every player.

   Numbered 3 and placed second, which needs saying. Every stage below this one
   goes through `treesNear`, and `treesNear` is exactly what the guard switches
   off — so on a machine where the guard fires, stage 2 finds an empty index
   and stage 2b exits the process before a stage 3 at the bottom of the file
   would ever run. That is the one run where this check has something to say,
   so it runs before them. It depends on nothing they produce: the verdict was
   reached at landing, by Game.js, and cached. */
const s3 = await page.evaluate(async () => {
  const g = window.__game;
  const S = g.surface;
  if (typeof S.verifyTreeAgreement !== 'function') {
    return { err: 'Surface.verifyTreeAgreement does not exist' };
  }
  const v = S.verifyTreeAgreement(g.renderer);
  const near = S.treesNear(0, 0, 25);
  return {
    ok: v && v.ok, worst: v && v.worst, reason: v && v.reason,
    cached: S._treeAgreement === v,
    /* And it must not have disabled anything on a machine that agrees. Not an
       assertion that trees exist at the origin — that is a property of the
       world — only that the guard is not the reason if they do not. */
    disabled: (v && v.ok) === false && near.length === 0,
  };
});

if (s3.err) { console.error('stage 3:', s3.err); await browser.close(); process.exit(1); }
check('the shipped guard agrees with the checker', s3.ok,
  `worst ${Number(s3.worst).toExponential(2)} · ${s3.reason}`
  + (s3.disabled ? ' · treesNear is returning nothing' : ''));
check('the guard caches its verdict rather than re-probing', s3.cached);

// -------------------------------------------- stage 2: the near-field index
const s2 = await page.evaluate(async (POSES) => {
  const g = window.__game;
  const S = g.surface;
  const surfMod = await import('/src/world/Surface.js');
  const WJ = surfMod.__woodyJS;
  if (typeof S.treesNear !== 'function') return { err: 'Surface.treesNear does not exist' };
  const T = S._trees;
  if (!T) return { err: 'this world has no trees band' };

  const R = 25;
  const out = [];
  for (const pose of POSES) {
    const [px, pz] = pose.p;
    let [fx, fz] = pose.f;
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    /* Drive the stash directly. treesNear reads the pair the frame was drawn
       with and nothing else, which is the property being tested — so the test
       sets that pair rather than trying to pose a real camera. */
    S._camXZ.set(px, pz);
    S._camFwdXZ.set(fx, fz);

    /* The rover sits ahead of the chase camera, which is 9.5 m behind it. Query
       from there, which is where Rover.update will. */
    const rx = px + fx * 9.5, rz = pz + fz * 9.5;

    S._treeMemo = null;                     // cold, so the count below is real
    const near = S.treesNear(rx, rz, R);
    const cold = S._treeMemoSize ? S._treeMemoSize() : -1;
    const again = S.treesNear(rx, rz, R);

    // ground truth: run the acceptance over every instance for this pose
    const truth = [];
    for (let i = 0; i < T.n; i++) {
      const a = WJ.accept(S, i, px, pz, fx, fz);
      /* WJ.accept (jTreeAccept) answers about an instance without being told
         its own index, so its return value has no `i` — tag it on here. The
         complete/sound checks below key off `.i`, and without this every
         truth entry compares as `undefined`, which fails both checks even
         when the index is correct: the counts already agreeing while every
         membership test fails is exactly that signature. */
      if (a.grow >= WJ.GROW_MIN && Math.hypot(a.x - rx, a.z - rz) <= R) truth.push({ ...a, i });
    }

    /* c is where tileTo centres the cell. Every tree the index returns has to
       be inside half a period of it per axis, or it is about to swap copies
       under the rover — which is the one way a tree can move while you are
       looking at it. */
    const cx = px + fx * T.tile * 0.32, cz = pz + fz * T.tile * 0.32;
    let worstAxis = 0;
    for (const t of near) {
      worstAxis = Math.max(worstAxis, Math.abs(t.x - cx), Math.abs(t.z - cz));
    }

    out.push({
      pose: [px, pz],
      count: near.length,
      truth: truth.length,
      /* Same query twice must give the same answer — the memo is a cache, not
         a state machine. */
      stable: JSON.stringify(near) === JSON.stringify(again),
      complete: truth.every((t) => near.some((q) => q.i === t.i)),
      sound: near.every((q) => truth.some((t) => t.i === q.i)),
      radiiPositive: near.every((q) => q.r > 0 && q.r < 2),
      worstAxis: +worstAxis.toFixed(1),
      halfPeriod: T.tile / 2,
      cold,
    });
  }
  return { out, n: T.n };
}, POSES);

if (s2.err) { console.error('stage 2:', s2.err); await browser.close(); process.exit(1); }

for (const r of s2.out) {
  const at = `at (${r.pose[0]}, ${r.pose[1]})`;
  check(`the index finds every collidable tree ${at}`, r.complete,
    `${r.count} returned · ${r.truth} expected`);
  check(`the index invents none ${at}`, r.sound && r.radiiPositive);
  check(`the index is stable across calls ${at}`, r.stable);
  /* The bound the whole camera-coupling argument rests on: a tree the rover can
     touch must be well inside half a period of the cell centre, because past
     that it belongs to a different copy and is a different tree. */
  check(`no tree in range is near a copy boundary ${at}`,
    r.worstAxis < r.halfPeriod - 30,
    `furthest ${r.worstAxis} m of a ${r.halfPeriod} m half-period`
    + ` · ${(r.halfPeriod - r.worstAxis).toFixed(0)} m of margin`);
}

// ------------------------------- stage 2b: the two-generation eviction
/* The loop above resets S._treeMemo before every pose, so `_treeMemoPrev` is
   null at query time in all three of it and the fallback path — the entire
   reason a second generation exists rather than one — never actually runs.
   This exercises it: three queries along POSES[0]'s own heading, each a
   whole tile period (420 m) further than the last, with the memo left alone
   the entire time. (0, -1) is an axis-aligned heading on purpose, so the
   epoch's floor() index changes by exactly one each step with nothing left
   to floating-point luck. */
const s2b = await page.evaluate(async (pose0) => {
  const g = window.__game;
  const S = g.surface;
  const surfMod = await import('/src/world/Surface.js');
  const WJ = surfMod.__woodyJS;
  const T = S._trees;
  if (!S._treeMemo) return { err: 'memo is cold entering stage 2b — stage 2 should have warmed it' };

  const R = 25;
  let [fx, fz] = pose0.f;
  const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
  const [px0, pz0] = pose0.p;

  const step = (cx, cz) => {
    S._camXZ.set(cx, cz);
    S._camFwdXZ.set(fx, fz);
    const rx = cx + fx * 9.5, rz = cz + fz * 9.5;
    const near = S.treesNear(rx, rz, R);

    const truth = [];
    for (let i = 0; i < T.n; i++) {
      const a = WJ.accept(S, i, cx, cz, fx, fz);
      if (a.grow >= WJ.GROW_MIN && Math.hypot(a.x - rx, a.z - rz) <= R) truth.push({ ...a, i });
    }

    return {
      complete: truth.every((t) => near.some((q) => q.i === t.i)),
      sound: near.every((q) => truth.some((t) => t.i === q.i)),
      curSize: S._treeMemo.size,
      prevSize: S._treeMemoPrev ? S._treeMemoPrev.size : 0,
    };
  };

  // Do NOT reset the memo anywhere in here — that is the one thing the loop
  // above already covers, and it is exactly what leaves `prev` untested.
  const a1 = step(px0, pz0);
  const a2 = step(px0 + fx * T.tile, pz0 + fz * T.tile);
  const a3 = step(px0 + fx * T.tile * 2, pz0 + fz * T.tile * 2);
  return { a1, a2, a3 };
}, POSES[0]);

if (s2b.err) { console.error('stage 2b:', s2b.err); await browser.close(); process.exit(1); }

check('crossing a tile boundary is complete and sound both sides',
  s2b.a1.complete && s2b.a1.sound && s2b.a2.complete && s2b.a2.sound
  && s2b.a3.complete && s2b.a3.sound);
check('the previous generation is populated after the epoch moves',
  s2b.a1.curSize > 0 && s2b.a2.prevSize === s2b.a1.curSize,
  `gen1 cur ${s2b.a1.curSize} → gen2 prev ${s2b.a2.prevSize}`);
/* This is the eviction check, not just a size check: if a third generation
   were being kept instead of two, a3's prev would include gen1's leftovers
   and this equality would fail — prevSize would be too big, not merely
   "large". Exact equality is the point: promotion replaces the previous
   generation wholesale rather than merging into it, so nothing accumulates
   across an epoch the rover has already left. */
check('the memo holds exactly two generations, not three, after a second boundary',
  s2b.a3.prevSize === s2b.a2.curSize,
  `gen2 cur ${s2b.a2.curSize} → gen3 prev ${s2b.a3.prevSize}`
  + ` (gen1's ${s2b.a1.curSize} is gone)`);

// -------------------------------------- stage 2c: a genuine prev cache hit
/* Stage 2b proves the eviction *shape* — populate, then drop the oldest
   generation wholesale — but never proves a prev *hit*, because a
   whole-period, axis-aligned step shifts every instance's own tile index by
   exactly one: floor((cx - baseX)/period + 0.5) moves by the same integer
   for every instance when the shared numerator (cx, which does not depend on
   baseX) shifts by a whole period. Every key at the new epoch is therefore
   new, and prev.get(key) is consulted but always misses.

   Half the tile period, the first instinct, is ruled out on grounds that
   have nothing to do with the period at all. For a stay-behind instance
   (same key, unchanged wrapped position) to be a genuine prev hit, it has
   to appear in *both* the before and the after query's result — and every
   result is filtered to within R = 25 m of the query point. By the
   triangle inequality, a single fixed point can only be within R of two
   query points that are themselves at most 2R apart. So no step bigger
   than 50 m can ever produce a hit, on any world, at any period.

   Separately, `prev` only gets populated once the camera's own cell index
   changes, and that requires the step to cross whichever boundary happens
   to be nearest to wherever the camera currently sits within its cell —
   which is a property of *where the camera starts*, not of the step size.
   An earlier version of this check searched a fixed set of hand-picked
   poses and offsets for a combination where that boundary happened to be
   close enough; it worked, but its passing depended on one of those poses
   happening to sit within 50 m of its own boundary, which is exactly the
   kind of accident that turns into a confusing failure the day someone
   edits the pose list. This version constructs the boundary distance
   instead of hoping for it.

   `tileTo` computes `c = camPos + normalize(fwd) * period * 0.32` and wraps
   an instance into the copy nearest `c`; the wrap changes when
   `c / period + 0.5` crosses an integer, i.e. at `c = period * (m - 0.5)`
   for any integer `m`. So: pick an axis-aligned heading (0, -1), so `c`'s
   only moving component is along z and the arithmetic has one variable
   instead of two; pick a boundary `period * (m - 0.5)`; place the camera
   `d` metres on the near side of it. The only real constraint on `d` is
   `0 < d < off` — anything in that range crosses the boundary when stepped
   by `off` — so `d` = 20 is simply a value comfortably clear of float noise
   at either end, not a bound the geometry demands; `off` = 30 is chosen to
   be both bigger than `d` (guaranteeing the boundary is crossed) and under
   the 50 m overlap ceiling from above (guaranteeing a stay-behind instance
   can still be found on both sides). Both guarantees are now structural,
   not observed.

   What is *not* guaranteed by this arithmetic is that any tree exists near
   the derived position at all — that depends on the world's terrain and
   vegetation, which the boundary formula knows nothing about. So the
   search still tries several positions: a spread of `m` (nearby boundaries
   along z) crossed with a spread of x offsets (different slices of
   terrain), each one individually exact about the boundary distance and
   the step size. Every attempt is graded and reported; if none of them
   turns up a tree to reuse, the check fails loudly rather than passing on
   a query that never exercised what it claims to.

   The old hand-picked-pose search is not kept as a fallback. Keeping it
   would just reintroduce the dependency this rewrite exists to remove —
   whatever redundancy it offered, the derived search's own spread over
   m and x already provides in a principled way, and two mechanisms for
   the same check is one more thing to explain to whoever reads this next.

   The epoch-change guard below is not just bookkeeping: it is what makes
   the reference match attributable to `prev` specifically. Once the epoch
   has changed, `cur` starts the query empty, so a match found by reference
   could only have come from `prev.get(key)` — a hit against the same,
   still-warm `cur` (the "stable across calls" case stage 2 already covers)
   is ruled out by construction, not by inspection. */
const s2c = await page.evaluate(async () => {
  const g = window.__game;
  const S = g.surface;
  const surfMod = await import('/src/world/Surface.js');
  const WJ = surfMod.__woodyJS;
  const T = S._trees;
  const R = 25;
  const period = T.tile;
  const fx = 0, fz = -1;                    // axis-aligned: only cz moves

  const query = (cx, cz) => {
    S._camXZ.set(cx, cz);
    S._camFwdXZ.set(fx, fz);
    const rx = cx + fx * 9.5, rz = cz + fz * 9.5;
    return { near: S.treesNear(rx, rz, R), cx, cz, rx, rz };
  };
  const truthAt = (cx, cz, rx, rz) => {
    const t = [];
    for (let i = 0; i < T.n; i++) {
      const a = WJ.accept(S, i, cx, cz, fx, fz);
      if (a.grow >= WJ.GROW_MIN && Math.hypot(a.x - rx, a.z - rz) <= R) t.push({ ...a, i });
    }
    return t;
  };

  const d = 20;                              // 0 < d < off; comfortably clear of float noise
  const off = 30;                            // > d (crosses it), < 2R = 50 (stays in overlap)
  const xs = [0, 300, -1500, 1200, -600];   // a spread of terrain to sample
  const ms = [-2, -1, 0, 1, 2];             // a spread of nearby boundaries along z
  const tried = [];
  for (const x0 of xs) {
    for (const m of ms) {
      const boundary = period * (m - 0.5);
      const czBefore = boundary + d;                  // d metres before the boundary
      const camZBefore = czBefore + period * 0.32;     // invert cz = camZ + fz*period*0.32 (fz=-1)
      const camZAfter = camZBefore - off;

      S._treeMemo = null;                             // a clean epoch for this attempt
      const before = query(x0, camZBefore);
      const epoch0 = S._treeMemoAt;
      const after = query(x0, camZAfter);
      const epoch1 = S._treeMemoAt;
      if (epoch1 === epoch0) {
        tried.push({ x0, m, reason: 'the camera cell did not change (arithmetic error, should not happen)' });
        continue;
      }

      const hit = after.near.find((q) => before.near.includes(q));
      if (!hit) {
        tried.push({ x0, m, reason: `no tree to reuse here — ${before.near.length} before, ${after.near.length} after` });
        continue;
      }

      const truth = truthAt(after.cx, after.cz, after.rx, after.rz);
      return {
        ok: true, x0, m, d, off,
        beforeCount: before.near.length, afterCount: after.near.length, hitIndex: hit.i,
        complete: truth.every((t) => after.near.some((q) => q.i === t.i)),
        sound: after.near.every((q) => truth.some((t) => t.i === q.i)),
      };
    }
  }
  return { ok: false, tried };
});

if (s2c.ok) {
  check('a boundary-derived step produces a genuine prev cache hit', true,
    `x=${s2c.x0} m=${s2c.m} · ${s2c.d} m before the boundary · stepped ${s2c.off} m · tree #${s2c.hitIndex}`
    + ` reused by reference from the previous generation`
    + ` · ${s2c.beforeCount} before · ${s2c.afterCount} after`);
  check('the index stays complete and sound after a boundary-derived epoch flip',
    s2c.complete && s2c.sound);
} else {
  const detail = s2c.tried.map((t) => `x=${t.x0},m=${t.m}: ${t.reason}`).join(' · ');
  check('a boundary-derived step produces a genuine prev cache hit', false,
    `no derived position produced a reference hit — ${detail}`);
  check('the index stays complete and sound after a boundary-derived epoch flip', false,
    'not reached — no derived position produced a hit to verify against');
}

const bad = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - bad}/${checks.length} ok`);
await browser.close();
process.exit(bad ? 1 : 0);
