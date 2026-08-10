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
  const mod = await import('/src/gfx/glsl/noise.js');
  const surfMod = await import('/src/world/Surface.js');
  const WJ = surfMod.__woodyJS;
  if (!WJ.accept) return { err: '__woodyJS.accept is not exported' };
  const T = S._trees;
  if (!T) return { err: 'this world has no trees band (veg <= 0.55)' };

  const mesh = S.floraMeshes.find((m) => m.name === 'trees');
  if (!mesh) return { err: 'no trees mesh' };
  const vsrc = mesh.material.vertexShader;

  /* The slice, and where it starts is the whole trick.
     Slicing from `void main(){` picks up three early-outs that write
     gl_Position and a crown-LOD block that reads the `position` attribute —
     neither is legal in a fragment shader, and by the time the source is a
     compiled string the ${tree ? ...} markers that would let you cut the block
     out are gone. Starting at `vec4 dat = uDatum;` steps over all of it in one
     move and still keeps every line that could be wrong as live shader text. */
  const a = vsrc.indexOf('vec4 dat = uDatum;');
  const b = vsrc.indexOf('if(grow <= 0.004)');
  if (a < 0 || b < 0 || b < a) return { err: 'could not find the acceptance slice' };
  const body = vsrc.slice(a, b);

  /* The functions AND the uniforms, from the same compiled source.
     The marker is the first line of FIELD_UNIFORMS, not `const float VSCALE`.
     fieldcheck slices from VSCALE and hand-declares the uniforms it needs,
     which is why it broke the day uSeaDrop was added — VSCALE is at
     Surface.js:420 and the field uniforms are at 306-346, so that slice starts
     *after* them. Starting at `uniform float uSeed;` picks up every uniform the
     chunks below declare and still excludes everything three prepends (its own
     matrices, precision qualifiers and the position/normal/uv attributes).
     The in/out/attribute declarations at the bottom of the region are stripped:
     iA and iB become plain globals filled by texelFetch, and the vertex stage's
     varyings would collide with our own output. */
  const fs0 = vsrc.indexOf('uniform float uSeed;');
  const fs1 = vsrc.indexOf('void main(');
  if (fs0 < 0 || fs1 < 0) return { err: 'could not find the chunk region' };
  const chunk = vsrc.slice(fs0, fs1)
    .split('\n').filter((L) => !/^\s*(in|out|attribute|varying)\s/.test(L)).join('\n');

  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const gl = cv.getContext('webgl2', { antialias: false });
  if (!gl) return { err: 'no webgl2' };
  if (!gl.getExtension('EXT_color_buffer_float')) return { err: 'no float rt' };

  const VS = `#version 300 es
  in vec2 aPos;
  void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FS = `#version 300 es
  precision highp float;
  ${mod.NOISE.replace(/^#ifndef LS_NOISE|#define LS_NOISE|#endif$/gm, '')}
  uniform mat4 viewMatrix, projectionMatrix;
  ${chunk}
  uniform sampler2D uIA, uIB;
  uniform int uN;
  vec4 iA, iB;
  out vec4 oCol;
  void main(){
    int idx = int(gl_FragCoord.y)*64 + int(gl_FragCoord.x);
    if(idx >= uN){ oCol = vec4(-1.0); return; }
    ivec2 tc = ivec2(idx % 64, idx / 64);
    iA = texelFetch(uIA, tc, 0);
    iB = texelFetch(uIB, tc, 0);
    float sShift;
    vec2 gp = tileTo(iA.xy, uTileP, uCamPos, viewMatrix, sShift);
    float s = iA.z + sShift;
    float dh = length(vec2(gp.x - uCamPos.x, gp.y - uCamPos.z));
    ${body}
    float accept = grow > 0.004 ? 1.0 : 0.0;
    /* H is not in the slice — it is computed below the grow test and below
       \`float bi = position.z;\`, so reaching it would drag the attribute back
       in. Three lines, duplicated, and check 1 below fails loudly if this copy
       and the JS one ever disagree. */
    float q1 = hash11(s*1.37), q3 = hash11(s*4.73);
    float H = iB.y*(0.62 + 0.55*q1)*(0.55 + 0.45*grow);
    oCol = vec4(accept, grow, gy, H);
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
  } catch (e) { return { err: String(e).slice(0, 2000) }; }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

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

const bad = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - bad}/${checks.length} ok`);
await browser.close();
process.exit(bad ? 1 : 0);
