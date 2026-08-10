# Rover Tree Collision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rover stops when it drives into a tree it can see, and never stops where there is nothing.

**Architecture:** The tree band's per-instance acceptance test currently exists only in the vertex shader. Transliterate it into JS beside the existing height-field twin, retain the instance table on the `Surface`, index the trees near the rover, and collide a capsule against trunk circles. Because this is the codebase's *second* dual CPU/GPU implementation and the first one was wrong by metres twice, a checker (`tools/treecheck.mjs`, modelled on `tools/fieldcheck.mjs`) is written **first at each stage** and is the authority on whether the transliteration is right.

**Tech Stack:** Vanilla ES modules, three.js 0.185, WebGL2 / GLSL ES 3.00, Playwright for the browser-side checkers. There is no unit-test runner in this repo and this plan does not add one — the tests are `tools/*.mjs` scripts run through `npm run`, which is the established pattern.

**Spec:** `2026-08-10-rover-tree-collision-design.md` at the repo root. Read it before starting. Every number in this plan comes from it.

## Global Constraints

- **Scope is the trees band only** — `WOODY[0]`, `Surface.js:6322`: `tile: 420`, `n: 1050` (`520` when `lo`), `h0..h1 = 6..18`, `fade: 760`, `form: [1.0, 1.0, 22.0, 54.0]`, `pick: [0.34, 0.72, 0.24, 0.40]`. Scrub is never collidable.
- **Trunks only, never canopy.** You can still walk and drive under a tree.
- **The band only exists when `surface.veg > 0.55`.** Every new entry point returns empty rather than throwing when it does not.
- **The CPU collides at `grow >= 0.05`.** The GPU draws at `grow > 0.004`. The 0.046 gap is the whole safety argument; do not "tidy" the two numbers into one.
- **The capsule radius is `TRACK * 0.56 = 1.12`** — `CONTACTS`' half-track, `Rover.js:84-89`. `_settle` uses `TRACK * 0.5 = 1.0` for a different purpose. Neither is a typo.
- **`Math.fround` per operation on every path feeding `hash11`**, including the float32 literals, which are hoisted as `Math.fround(...)` constants. Precedent: `Surface.js:1260-1262`, `1334-1338`.
- **The horizon bend is added per sample**, not once per instance: `groundYFlat(p) === heightAt(p) + (p.x² + p.z²) / (2 * uPlanetR)`.
- **New JS twins go in the "same law, twice" section** (`Surface.js:1220` onward), in the shader's order, with the shader's names, under the standing instruction at `Surface.js:1231`.
- **Prose style:** this codebase comments *why*, at length, in full sentences. Match it. A new function with no explanation of the decision behind it is not finished.
- `tools/fieldcheck.mjs` and `tools/treecheck.mjs` target the **dev server** (`http://localhost:5173`, `npm run dev`). `tools/expedition.mjs` targets the **built bundle** (`http://localhost:4173`, `npm run verify` or `npm run build && npm run preview`).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `tools/fieldcheck.mjs` | Existing height-field checker. One-line import fix. | 1 |
| `package.json` | `fieldcheck` and `treecheck` scripts. | 1 |
| `tools/treecheck.mjs` | **New.** The GPU-vs-JS checker, in three stages, grown one stage per task. | 2, 4, 5 |
| `src/world/Surface.js` | The JS twins (`jHash11`, `jMeshLod`, the acceptance test), `__woodyJS`, the retained band, the camera stash, `treesNear`. | 2, 3, 4, 5 |
| `src/game/Game.js` | Pass `camFwd` into `surface.update`'s ctx. One hunk. | 3 |
| `src/ship/Rover.js` | The capsule-vs-circle collision. | 6 |
| `tools/expedition.mjs` | Two end-to-end assertions. | 6 |

`Surface.js` is already 6952 lines and organised by *law* rather than by layer — the GLSL chunk, then its JS twin, then the class. New code follows that organisation; do not split the file.

---

### Task 1: `fieldcheck` runs on this machine

The precedent tool cannot run anywhere but its author's laptop, and you are about to copy it. Fix it and look at its output before writing anything, so you know what "the two agree" reads like.

**Files:**
- Modify: `tools/fieldcheck.mjs:8`
- Modify: `package.json` (scripts block)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run fieldcheck`, `npm run treecheck` (the latter's target file arrives in Task 2).

- [ ] **Step 1: Fix the absolute import**

`tools/fieldcheck.mjs:8` currently reads:

```js
import { bootGame } from '/Users/anshu/Code/SpaceGame2/tools/boot.mjs';
```

Replace with:

```js
import { bootGame } from './boot.mjs';
```

- [ ] **Step 2: Add both npm scripts**

In `package.json`, after the `"verify"` line, add:

```json
    "fieldcheck": "node tools/fieldcheck.mjs",
    "treecheck": "node tools/treecheck.mjs",
```

- [ ] **Step 3: Start the dev server and run it**

```bash
npm run dev
```

In a second terminal:

```bash
npm run fieldcheck
```

Expected: a JSON array of three entries (`lod` 1, 6, 40), each with `mean`, `median`, `p90`, `worst`, `range`. Per the comment at `Surface.js:1248`, `lod: 1` should show a median of 0 and a worst around 3e-4. If `worst` at `lod: 1` is above a millimetre, stop — the height field itself has drifted and that is a different bug from the one this plan is about.

- [ ] **Step 4: Commit**

```bash
git add tools/fieldcheck.mjs package.json
git commit -m "Make fieldcheck runnable, and give both checkers a script

It imported boot.mjs by an absolute path on the original author's
machine, so the one tool that exists to keep a CPU/GPU pair honest
could not be run by anyone else — and it is the file the tree checker
is about to be copied from."
```

---

### Task 2: `jHash11` and `jMeshLod`, proven against the GPU

`hash11` is the single place where getting the precision wrong does not degrade the answer, it *destroys* it: a `fract`-based hash run at double precision is uncorrelated with the same hash run at float32, and it feeds `grow` with a weight of `0.72`. So it is checked against the GPU before anything is built on it.

**Files:**
- Modify: `src/world/Surface.js` (the "same law, twice" section, after `jDrainage` at line 1399)
- Create: `tools/treecheck.mjs`

**Interfaces:**
- Consumes: `jClamp`, `jFract`, `jSmoothstep` (existing, `Surface.js:1267-1275`); `RING_P`, `RING_MIN`, `RING_MAX`, `LOD_K1` (existing, `Surface.js:414-416`).
- Produces:
  - `jHash11(p: number) -> number` in `[0, 1)`
  - `jMeshLod(d: number, U: object) -> number` where `U` is `Surface.U`
  - `export const __woodyJS = { hash11: jHash11, meshLod: jMeshLod }` — extended in Task 4.

- [ ] **Step 1: Write the failing checker — `tools/treecheck.mjs`, stage 0**

Create the file. This is stage 0 only; Tasks 4 and 5 append stages 1 and 2.

```js
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
await bootGame(page, {
  setup: `(()=>{
    g.mode='exterior';
    const solid = g.bodies.filter((b)=>b.spec && b.planet && !b.planet.isGas
      && b.spec.kind === '${KIND}' && (b.spec.veg||0) > 0.62);
    const body = solid[0];
    if(!body) return {failed:'no vegetated ${KIND} world in this galaxy'};
    g.pose({bodyRef: body, dist:1.6, phase:70, elev:8});
    g.land(body, {now:true});
    g.director.stop(); g.setLayer('hud', false);
    return {body: body.name};
  })()`,
  settle: 1500,
});

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
    body: S.spec ? S.spec.kind : '?',
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
check('meshLod agrees with the GPU', s0.lod.worst <= 1e-5,
  `worst ${s0.lod.worst.toExponential(2)}`);

const bad = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - bad}/${checks.length} ok`);
await browser.close();
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

With `npm run dev` running:

```bash
npm run treecheck
```

Expected: `stage 0: __woodyJS.hash11 is not exported`, exit 1.

- [ ] **Step 3: Add a deliberately naive `jHash11`, to see the size of the problem**

In `src/world/Surface.js`, immediately after `jDrainage` (which ends at line 1399), add:

```js
/** hash11, at plain JS precision. Temporary — see the next step. */
function jHash11(p) {
  let q = jFract(p * 0.1031);
  q = q * (q + 33.33);
  q = q * (q + q);
  return jFract(q);
}
```

and after `jMeshLod` is added below, extend the export. For now, add the export block after `__fieldJS` (`Surface.js:1548`):

```js
/* Exported for tools/treecheck.mjs, for the same reason __fieldJS is: the tree
   acceptance test exists twice and the two copies have to be diffable rather
   than assumed equal. Nothing in the game imports this. */
export const __woodyJS = {
  hash11: jHash11, meshLod: jMeshLod,
};
```

- [ ] **Step 4: Add `jMeshLod`**

Beside `jHash11`:

```js
/** meshLod, line for line. See the GLSL at the top of the file for why the
 *  law is a power of range clamped by the grid builder's own two numbers. */
function jMeshLod(d, U) {
  const k = U.uLodK.value;
  const p = k * Math.pow(Math.max(d, 1), 1 - RING_P);
  return 0.26 + jClamp(p, d * k * (RING_MIN / LOD_K1), d * k * (RING_MAX / LOD_K1));
}
```

- [ ] **Step 5: Run it and read the failure**

```bash
npm run treecheck
```

Expected: `meshLod` passes. All three `hash11` sweeps **FAIL**, with `worst` of order `1e-1` to `5e-1` and `nonZero` near 4096. This is the point of the exercise: the error is not small, it is the full range of the function. Write the number down; it goes in the commit message.

- [ ] **Step 6: Replace `jHash11` with the float32 emulation**

Replace the naive version with:

```js
/* hash11, and this one has to be exact rather than close.
 *
 * Every other twin in this section is a smooth function of position, so a
 * single-precision disagreement moves an answer by a fraction of a millimetre.
 * This one is `fract`-based and chaotic: run at JS double precision it is not a
 * near miss, it is a different function, and it feeds the tree acceptance test
 * with a weight of 0.72 out of a threshold of 0.34. An uncorrelated hash means
 * an uncorrelated forest — trees the player can see that the rover drives
 * through, and walls in the open ground where nothing is drawn.
 *
 * So every operation is rounded to float32 the way the shader's ALU does, and
 * both literals are hoisted at the shader's own precision — 33.33 and 0.1031
 * are not exactly representable and using the JS double for either puts the
 * error straight back. tools/treecheck.mjs stage 0 measures this against a real
 * GPU; naive JS scores an error of about a third of the function's range.
 *
 * `fract` needs no rounding of its own: for any float32 x, x - floor(x) is a
 * multiple of x's own ulp and is therefore exactly representable. */
const J_H1031 = Math.fround(0.1031);
const J_H3333 = Math.fround(33.33);
function jHash11(p) {
  let q = Math.fround(Math.fround(p) * J_H1031);
  q = Math.fround(q - Math.floor(q));
  q = Math.fround(q * Math.fround(q + J_H3333));
  q = Math.fround(q * Math.fround(q + q));
  return Math.fround(q - Math.floor(q));
}
```

- [ ] **Step 7: Run it and verify it passes**

```bash
npm run treecheck
```

Expected: all four checks `ok`. `hash11`'s `worst` should be exactly `0` and `nonZero` exactly `0` — the emulation is bit-exact, because nothing in `hash11` has the shape a driver would contract into an FMA. A non-zero-but-tiny result is acceptable and should be recorded; a `worst` above `1e-6` means the emulation is wrong somewhere, not that the GPU is unusual.

- [ ] **Step 8: Commit**

```bash
git add src/world/Surface.js tools/treecheck.mjs
git commit -m "Transliterate hash11 and meshLod, and prove the hash bit-exact

hash11 is the one twin in this file where getting the precision wrong
does not degrade the answer, it replaces it: fract-based and chaotic, so
JS double precision gives a function uncorrelated with the shader's, and
it carries 0.72 of weight against a 0.34 threshold. Measured before the
frounds went in, the naive version was wrong by about a third of the
function's whole range on every one of 4096 samples. With the literals
hoisted at float32 and every operation rounded, it is exact.

treecheck stage 0 is what says so, and it is written first on purpose.
Stages 1 and 2 follow with the acceptance test and the index."
```

---

### Task 3: Retain the band, and stash the camera pair

The instance table is currently thrown away, and the CPU needs the camera *forward* as well as its position because `tileTo` centres each cell 134.4 m down the view axis. Both are plumbing; neither is interesting; getting either wrong makes every later task measure the wrong thing.

**Files:**
- Modify: `src/world/Surface.js` — the `WOODY.forEach` at `6335`, the constructor near `5984`, and `update` at `6631`
- Modify: `src/game/Game.js:2048-2057`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `surface._trees` — `{ iA: Float32Array, iB: Float32Array, n: number, tile: number, fade: number, pick: number[], form: number[] }`, or `null` when `veg <= 0.55`.
  - `surface._camXZ` — `THREE.Vector2`, the drawn frame's camera XZ.
  - `surface._camFwdXZ` — `THREE.Vector2`, the drawn frame's camera forward XZ, **not** normalised (`tileTo` normalises).
  - `ctx.camFwd` — `THREE.Vector3`, added to the object `Game.js` passes to `surface.update`.

- [ ] **Step 1: Add the fields to the constructor**

In `src/world/Surface.js`, beside `this._datum = [0, 0];` (line 5984):

```js
    /* What the CPU needs to answer "is there a tree here" without a frame.
       Filled by the woody band below when the world has one; null otherwise,
       and every consumer checks. See treesNear. */
    this._trees = null;
    /* The camera the *drawn* frame used, stashed at the moment its uniforms
       are written. tileTo wraps every tiled instance into the cell nearest a
       point 0.32 periods down the view axis, so which trees exist at all
       depends on where the camera is looking — and a consumer that read
       game.camera directly would be asking about a frame that has not been
       drawn yet. */
    this._camXZ = new THREE.Vector2();
    this._camFwdXZ = new THREE.Vector2(0, 1);
```

- [ ] **Step 2: Retain the trees entry**

In the `WOODY.forEach` (`Surface.js:6335`), after the `ti.B` height loop (which ends at line 6348) and before `const tmat = new THREE.ShaderMaterial({`, add:

```js
        /* Keep the trees band. The rover has to collide with these and the
           acceptance test that decides which of them exist runs on the CPU
           now (see the woody section of "the same law, twice"), so the
           instance table cannot be a local that dies with this closure.
           These are the same arrays the attributes point at, not copies, and
           the band's own pick/form vectors rather than the material's
           uniforms — so an edit to WOODY reaches both paths at once.

           Trees only. Scrub tops out at 2.4 m and is something you drive
           over, not into. */
        if (w.key === 'trees') {
          this._trees = {
            iA: ti.A, iB: ti.B, n: nT, tile: w.tile, fade: w.fade,
            pick: w.pick.slice(), form: w.form.slice(),
          };
        }
```

Note the enclosing `WOODY.forEach((w, i) => {...})` is an arrow function, so `this` is the `Surface`. Confirm that before relying on it.

- [ ] **Step 3: Stash the pair in `update`**

In `src/world/Surface.js`, at line 6631, replace:

```js
    U.uCamPos.value.copy(ctx.camPos);
```

with:

```js
    U.uCamPos.value.copy(ctx.camPos);
    /* Stashed here rather than read later, and stashed *together*: this is the
       exact pair the frame's tileTo will use, and treesNear has to ask about
       the frame that was drawn rather than about wherever the camera has got
       to by the time the rover asks. The forward is left unnormalised because
       tileTo normalises it itself. */
    this._camXZ.set(ctx.camPos.x, ctx.camPos.z);
    if (ctx.camFwd) this._camFwdXZ.set(ctx.camFwd.x, ctx.camFwd.z);
```

- [ ] **Step 4: Pass the forward from `Game.js`**

Near the top of `src/game/Game.js`, beside the other module-scope scratch vectors (search for `const _v = new THREE.Vector3()`), add:

```js
const _camFwd = new THREE.Vector3();
```

Then in the `this.surface.update(dt, {...})` call at `Game.js:2048`, add one line to the object:

```js
    this.surface.update(dt, {
      sunDir: sunLocal, sunColor: _sunCol,
      camPos: this.camera.position, time: this.time,
      /* The camera's own -Z in world space, which is exactly the
         vec2(-viewM[0][2], -viewM[2][2]) the tiled scatter's tileTo reads out
         of the view matrix. The ground CPU needs it because a tiled band's
         cells are centred down the view axis, not on the camera. */
      camFwd: _camFwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion),
      shadowNB: this._shadowNB,
      shadowBox: {
        half: 0.11 * 1000 + (this._groundExtra || 0),
        cx: aimPrev ? aimPrev.x : 0, cz: aimPrev ? aimPrev.z : 0,
      },
    });
```

- [ ] **Step 5: Verify by hand in the browser**

With `npm run dev` running, open `http://localhost:5173/`, land on a vegetated world, and in the console:

```js
const S = __game.surface;
[S.veg, S._trees && S._trees.n, S._trees && S._trees.tile,
 S._camXZ.toArray(), S._camFwdXZ.toArray(), S._camFwdXZ.length()]
```

Expected on a world with `veg > 0.55`: `n` is `1050` (or `520` on a `lo` tier), `tile` is `420`, `_camXZ` matches `__game.camera.position` in x/z, and `_camFwdXZ.length()` is at most 1 and moves when you look around. On a world with `veg <= 0.55`, `_trees` is `null` and nothing throws.

- [ ] **Step 6: Commit**

```bash
git add src/world/Surface.js src/game/Game.js
git commit -m "Keep the tree band, and the camera the frame was drawn with

The instance table died with the closure that built it, and the CPU is
about to need it. The camera forward comes with it because tileTo puts
each tiled cell 0.32 periods down the view axis — which trees exist at
all depends on where the camera is looking, so the answer has to be
asked of the pair the frame actually used rather than of whatever the
camera has moved to since."
```

---

### Task 4: The acceptance test, transliterated and diffed

The heart of it. Every line of `Surface.js:4240-4290` and its callees, in JS, beside the height field's twin — and a per-instance GPU diff at three camera poses that has to agree before anything is built on it.

**Files:**
- Modify: `src/world/Surface.js` — the woody section of "the same law, twice", after `jMeshLod`
- Modify: `tools/treecheck.mjs` — append stage 1

**Interfaces:**
- Consumes: `jHash11`, `jMeshLod` (Task 2); `surface._trees` (Task 3); existing `jSnoise`, `jDrainage`, `jSmoothstep`, `jClamp`, `jMix`, `Surface.heightAt`, `Surface._site`, `Surface._seaY`.
- Produces:
  - `jTileTo(baseX, baseZ, period, camX, camZ, fwdX, fwdZ, out5) -> void`, writing `[gpx, gpz, sShift, tx, tz]`
  - `jTreeAccept(S, i, camX, camZ, fwdX, fwdZ, out) -> object` with `{ accept, grow, gy, H, trR, x, z, tx, tz }`
  - `__woodyJS` extended to `{ hash11, meshLod, tileTo: jTileTo, accept: jTreeAccept, GROW_MIN: 0.05 }`

- [ ] **Step 1: Append stage 1 to `tools/treecheck.mjs`**

Insert before the final tally block (`const bad = checks.filter(...)`):

```js
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
     compiled string the ${'$'}{tree ? ...} markers that would let you cut the block
     out are gone. Starting at `vec4 dat = uDatum;` steps over all of it in one
     move and still keeps every line that could be wrong as live shader text. */
  const a = vsrc.indexOf('vec4 dat = uDatum;');
  const b = vsrc.indexOf('if(grow <= 0.004)');
  if (a < 0 || b < 0 || b < a) return { err: 'could not find the acceptance slice' };
  const body = vsrc.slice(a, b);

  /* The functions and uniforms, from the same compiled source. Everything three
     prepends sits above `const float VSCALE`, which is why that is the marker —
     it is the one fieldcheck uses too. The in/out/attribute declarations at the
     bottom of the region are stripped: iA and iB become plain globals filled by
     texelFetch, and the vertex stage's varyings would collide with our own
     output. */
  const fs0 = vsrc.indexOf('const float VSCALE');
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
       `float bi = position.z;`, so reaching it would drag the attribute back
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
  check(`ground height agrees on accepted trees ${at}`, r.posWorst < 1e-3,
    `${r.accepted} accepted · worst ${r.posWorst.toExponential(2)} m`);
  check(`stature agrees on accepted trees ${at}`, r.hWorst < 1e-3,
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run treecheck
```

Expected: `stage 1: __woodyJS.accept is not exported`, exit 1.

- [ ] **Step 3: Write `jTileTo`**

In `src/world/Surface.js`, after `jMeshLod`:

```js
/* ------------------------------------------------------------ the woody band
 *
 * The third resident of this section, and the one with a hard edge in it.
 *
 * The height field's twin can be a fraction of a millimetre out and nobody can
 * tell. This one ends in `grow > 0.004` — a binary — so a disagreement is not a
 * small error in a number, it is a tree that one copy has and the other does
 * not. The CPU therefore collides at a *higher* threshold than the GPU draws
 * at (see J_GROW_MIN below), so the two can only ever disagree in the harmless
 * direction, and tools/treecheck.mjs measures the real error against that
 * margin rather than taking it on trust.
 *
 * The same standing instruction applies as to everything above: change the
 * shader at Surface.js:4240-4290 and change this in the same edit. */

/** Where the CPU collides. The shader draws a tree at grow > 0.004; this is
 *  more than ten times that, so an invisible wall — the failure that makes a
 *  vehicle feel broken — needs a CPU/GPU disagreement of 0.046 in grow, and
 *  treecheck reports the measured error against exactly that number. What is
 *  left is the opposite failure, driving through a marginal tree the shader
 *  drew, which is both the right way round and the one a player barely
 *  notices. */
const J_GROW_MIN = 0.05;

// tileTo's two literals, at the shader's precision: they feed the seed shift,
// which feeds hash11, where a double is not a near miss. See jHash11.
const J_T731 = Math.fround(7.31), J_T377 = Math.fround(3.77);

/** tileTo, line for line — see the CLUTTER chunk for why a tiled band's cell
 *  is centred a third of its own width down the view axis rather than under
 *  the lens. Writes [gpx, gpz, seedShift, tx, tz]; the tile index comes out
 *  because the near-field index memoises on it. */
function jTileTo(baseX, baseZ, period, camX, camZ, fwdX, fwdZ, out) {
  if (period <= 0) {
    out[0] = baseX; out[1] = baseZ; out[2] = 0; out[3] = 0; out[4] = 0;
    return;
  }
  const fl = Math.hypot(fwdX, fwdZ);
  const ux = fl > 1e-4 ? fwdX / fl : 0;
  const uz = fl > 1e-4 ? fwdZ / fl : 1;
  const cx = camX + ux * period * 0.32;
  const cz = camZ + uz * period * 0.32;
  const tx = Math.floor((cx - baseX) / period + 0.5);
  const tz = Math.floor((cz - baseZ) / period + 0.5);
  const d = Math.fround(Math.fround(tx * J_T731) + Math.fround(tz * J_T377));
  const shift = Math.fround(d - Math.fround(23 * Math.floor(Math.fround(d / 23))));
  out[0] = baseX + tx * period;
  out[1] = baseZ + tz * period;
  out[2] = shift;
  out[3] = tx; out[4] = tz;
}
```

- [ ] **Step 4: Write the field helpers and the acceptance test**

Immediately after `jTileTo`:

```js
/* groundYFlat, from heightAt. fieldcheck.mjs already establishes that the two
   differ by exactly the horizon bend, and groundYFlat and heightAt agree line
   for line including the sea clamp on types 0 and 5 — so there is no second
   copy of the field here, only the bend added back.

   Added per *sample*, not once per instance: standOn differences the field
   across its own footprint and terrainAround does it across ninety metres, and
   putting one instance-centre bend into both sides of a difference would
   quietly corrupt every slope in the band. It is one multiply. */
function jFlatY(S, x, z, lod) {
  return S.heightAt(x, z, lod) + (x * x + z * z) / (2 * S.U.uPlanetR.value);
}

/** standOn's height, without the normal — nothing in the acceptance test uses
 *  the normal. Lowest of a footprint's three samples, so a tree can only ever
 *  be slightly buried; see the GLSL for why that is what the grid needs. */
function jStandOnY(S, gpx, gpz, foot, lod) {
  const ee = Math.max(foot, lod + 0.8);
  return Math.min(
    jFlatY(S, gpx, gpz, lod),
    jFlatY(S, gpx + ee, gpz, lod),
    jFlatY(S, gpx, gpz + ee, lod),
  );
}

/** terrainAround, line for line: shelter and *hillside* slope from two
 *  deliberately non-orthogonal samples ninety metres out, with the gradient
 *  they imply solved rather than assumed. Writes [ao, slope]. */
function jTerrainAround(S, gpx, gpz, gy, lod, out) {
  const R = Math.max(90, lod * 4.5);
  const sl = Math.max(lod, R * 0.42);
  const d1x = 0.95 * R, d1z = 0.30 * R;
  const d2x = -0.60 * R, d2z = -0.75 * R;
  const h1 = jFlatY(S, gpx + d1x, gpz + d1z, sl) - gy;
  const h2 = jFlatY(S, gpx + d2x, gpz + d2z, sl) - gy;
  out[0] = jClamp(1 - jClamp(Math.max(h1, h2) / R, 0, 1) * 0.55, 0.2, 1);
  const det = d1x * d2z - d1z * d2x;
  const gx = (h1 * d2z - h2 * d1z) / det;
  const gz = (d1x * h2 - d2x * h1) / det;
  out[1] = jClamp(Math.hypot(gx, gz), 0, 2);
}

/** floraMask, line for line. Two things here are easy to flatten and must not
 *  be: m0 and m1 sample the raw gp while `flow` comes from drainage at
 *  gp + the site offset — they are different points — and the whole vec3 is
 *  scaled, so the constant y channel is scaled too. */
function jFloraMask(gpx, gpz, slope, shelter, flow, above) {
  const m0 = jSnoise(gpx * 0.0021, 401 * 0.0021, gpz * 0.0021) * 0.5 + 0.5;
  const m1 = jSnoise(gpx * 0.017, 53 * 0.017, gpz * 0.017) * 0.5 + 0.5;
  const stand = jSmoothstep(0.22, 0.66, m0 * 0.60 + m1 * 0.40) * 1.45;
  const sl = 1 - jSmoothstep(0.20, 0.55, slope);
  const sh = jMix(0.70, 1.45, shelter);
  const wet = 1 + jSmoothstep(0.36, 0.92, flow) * 1.4;
  const alt = 1 - jSmoothstep(0.34 + (m0 - 0.5) * 0.34, 0.80 + (m0 - 0.5) * 0.34, above);
  return jClamp(stand * sl * sh * wet * alt, 0, 1.4);
}

// Scratch, at module scope: this path allocates nothing per call.
const _Wt = [0, 0, 0, 0, 0];
const _Wta = [0, 0];

/** One instance of the trees band, answered without a frame.
 *
 * The shader's own order, from `vec4 dat = uDatum;` to the grow test, with the
 * view-dependent parts left out: behindCamera and the dh fade decide what is
 * *drawn*, not what exists, and the crown LOD decides how much of a tree to
 * build. One term is genuinely dropped rather than merely skipped —
 * `grow *= 1 - smoothstep(uFade*0.55, uFade, dh)` — because for trees uFade is
 * 760, so the factor is exactly 1 inside 418 m and collision happens inside 25.
 * treecheck keeps the term on the GPU side, so if it ever does fire in range
 * the two disagree and the check fails rather than the rover quietly gaining a
 * wall.
 *
 * @param {Surface} S
 * @param {number} i          instance index into _trees
 * @param {number} camX,camZ  the drawn frame's camera, ground metres
 * @param {number} fwdX,fwdZ  the drawn frame's camera forward, need not be unit
 * @returns {{accept:boolean, grow:number, gy:number, H:number, trR:number,
 *            x:number, z:number, tx:number, tz:number}}
 */
function jTreeAccept(S, i, camX, camZ, fwdX, fwdZ) {
  const T = S._trees;
  const iA = T.iA, iB = T.iB, k = i * 4;
  jTileTo(iA[k], iA[k + 1], T.tile, camX, camZ, fwdX, fwdZ, _Wt);
  const gpx = _Wt[0], gpz = _Wt[1];
  const s = Math.fround(iA[k + 2] + _Wt[2]);

  const lod = jMeshLod(Math.hypot(gpx, gpz), S.U);
  const gy = jStandOnY(S, gpx, gpz, iB[k] * 2, lod);
  jTerrainAround(S, gpx, gpz, gy, lod, _Wta);
  const ao = _Wta[0], slope = _Wta[1];

  const seaY = S._seaY;
  const above = jClamp((gy - seaY) / 900, 0, 1);
  const shelter = jClamp((1 - ao) * 1.7, 0, 1);        // shelterOf
  /* drainage takes the *pre-scaled* q — the GLSL scales the vec3 by 0.00013
     before calling, and jDrainage starts after that. And it is sampled at
     gp + the site offset, unlike floraMask's own two lookups. */
  const dk = 0.00013;
  const flow = jDrainage((gpx + S._site[0]) * dk, S.U.uSeed.value * 31.7 * dk,
    (gpz + S._site[1]) * dk);
  const m = jFloraMask(gpx, gpz, slope, shelter, flow, above)
    * Math.pow(S.U.uVeg.value, 0.55);

  const pick = T.pick, form = T.form;
  const hs = jHash11(Math.fround(Math.fround(s * 9.13) + 0.77));
  let grow = jClamp((m - pick[0] - hs * pick[1]) * 2.1, 0, 1);
  grow *= 1 - jSmoothstep(pick[2], pick[3], slope);
  grow *= jSmoothstep(form[2], form[3], Math.hypot(gpx, gpz));
  const ty = S.U.uType.value | 0;
  if ((ty === 0 || ty === 5) && gy < seaY + 1.5) grow = 0;

  /* Stature is a property of the tree, not of the piece being drawn, so it
     comes off the instance seed alone — the same q1/q3 the shader uses. At
     grow 0 a tree is still 0.55 of full height, which is why a marginal tree
     is not a sapling and why treecheck reports the tallest mismatch. */
  const q1 = jHash11(Math.fround(s * 1.37));
  const q3 = jHash11(Math.fround(s * 4.73));
  const H = iB[k + 1] * (0.62 + 0.55 * q1) * (0.55 + 0.45 * grow);
  const trR = H * 0.021 * (0.80 + 0.4 * q3);

  return {
    accept: grow > 0.004, grow, gy, H, trR,
    x: gpx, z: gpz, tx: _Wt[3], tz: _Wt[4],
  };
}
```

- [ ] **Step 5: Extend the export**

Replace the `__woodyJS` block from Task 2 with:

```js
export const __woodyJS = {
  hash11: jHash11, meshLod: jMeshLod, tileTo: jTileTo, accept: jTreeAccept,
  GROW_MIN: J_GROW_MIN,
};
```

- [ ] **Step 6: Run and verify it passes**

```bash
npm run treecheck
```

Expected: stage 0's four checks plus twelve stage-1 checks, all `ok`.

Read the numbers, do not just read the word `ok`:
- `grow error` should print a percentage of margin. Per the spec, 2 % is the good case and 10–20 % is the expected case if the driver contracts the `dot()` in the seed shift. **Above 50 % the check fails** and the transliteration has a real bug.
- `disagreements` will be small but non-zero (a handful out of 1050) and every one must sit within 0.046 of 0.004. A disagreement further out means a term is wrong, not that floats are floats — find it before continuing.
- `accepted` should be in the low hundreds. Zero means the world has no trees where you are looking and the check is passing vacuously: pick another world with `process.argv[2]` or raise the `veg` filter in the boot setup.

- [ ] **Step 7: Commit**

```bash
git add src/world/Surface.js tools/treecheck.mjs
git commit -m "Put the tree acceptance test on the CPU, and diff it per instance

The shader decides from slope, altitude, shelter, drainage and a hashed
per-instance threshold whether each of 1050 candidates is a tree at all,
and nothing outside the vertex stage knew the answer. This is that test
in JS, in the same section and the same order as the height field's twin,
with the view-dependent parts left out and one term deliberately dropped
— the fade factor is exactly 1 inside 418 m and collision happens inside
25, so it cannot fire.

treecheck stage 1 lifts the acceptance prologue out of the live compiled
material, runs it per instance in a fragment shader at three camera poses,
and diffs. It reports the measured grow error against the 0.046 margin the
CPU threshold buys, and the tallest tree among any accept/reject
disagreements — because at grow 0 a tree is still 0.55 of full stature, so
a marginal tree is not a sapling."
```

---

### Task 5: `treesNear` — the near-field index

**Files:**
- Modify: `src/world/Surface.js` — a public method on the class, near `heightAt` (`6910`), plus two memo fields in the constructor
- Modify: `tools/treecheck.mjs` — append stage 2

**Interfaces:**
- Consumes: `jTreeAccept`, `jTileTo`, `J_GROW_MIN` (Task 4); `_trees`, `_camXZ`, `_camFwdXZ` (Task 3).
- Produces: `surface.treesNear(x, z, r) -> Array<{x, z, r, H, gy, i}>` — trunk centre XZ, trunk radius `r`, stature `H`, ground height `gy`, instance index `i`. Empty array when the band does not exist. Only trees with `grow >= 0.05`.

- [ ] **Step 1: Append stage 2 to `tools/treecheck.mjs`**

Insert before the final tally block:

```js
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
      if (a.grow >= WJ.GROW_MIN && Math.hypot(a.x - rx, a.z - rz) <= R) truth.push(a);
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run treecheck
```

Expected: `stage 2: Surface.treesNear does not exist`, exit 1.

- [ ] **Step 3: Add the memo fields to the constructor**

Beside `this._trees = null;` from Task 3:

```js
    /* The acceptance test is twelve height-field evaluations per candidate, so
       the answer is memoised per (instance, tile index) — it is deterministic
       per copy, and the tile index changes once every 420 m of driving. Two
       generations are kept: the current tile's answers and the previous
       tile's, so crossing a boundary does not throw away everything at once
       and then re-derive it. Anything older is dropped whole. */
    this._treeMemo = null;
    this._treeMemoPrev = null;
    this._treeMemoAt = 0;          // the camera cell these were computed in
```

- [ ] **Step 4: Write `treesNear`**

In `src/world/Surface.js`, immediately after `normalAt` (which ends at line 6940):

```js
  /**
   * The trees a thing at (x, z) could run into, within r metres.
   *
   * Three passes, cheapest first, because the acceptance test is twelve
   * height-field evaluations and there are 1050 candidates: wrap every
   * instance into the copy the camera is standing in (one floor and one
   * multiply), reject on distance, and only then ask whether the survivors are
   * trees at all. At one tree per ~168 m² a 25 m disc holds a dozen candidates
   * before acceptance, so the expensive pass runs a dozen times, not a
   * thousand — and memoised, most of those dozen are already answered.
   *
   * The threshold is J_GROW_MIN, not the shader's 0.004. See its comment: the
   * two copies disagree near a hard binary and this is which way the
   * disagreement is allowed to hurt.
   *
   * Asks about the camera pair the last drawn frame used, which on the ground
   * is one frame old — Rover.update runs before updateCamera and updateSurface.
   * At a hard yaw that is about 3.5 m of movement in the cell centre against
   * some forty metres of margin before a tree could change copies. See the
   * design note; treecheck stage 2 measures the margin that is actually left.
   *
   * @param {number} x
   * @param {number} z
   * @param {number} r  metres
   * @returns {Array<{i:number, x:number, z:number, r:number, H:number, gy:number}>}
   *   trunk centres and trunk radii. Empty when the world has no trees band.
   */
  treesNear(x, z, r) {
    const T = this._trees;
    if (!T) return [];
    const camX = this._camXZ.x, camZ = this._camXZ.y;
    const fwdX = this._camFwdXZ.x, fwdZ = this._camFwdXZ.y;
    const period = T.tile;

    /* Which cell the camera itself is in, which is what ages the memo. Not the
       per-instance tile index — that varies by one across the band, because
       each instance wraps about its own base position. */
    const fl = Math.hypot(fwdX, fwdZ);
    const ux = fl > 1e-4 ? fwdX / fl : 0, uz = fl > 1e-4 ? fwdZ / fl : 1;
    const cx = camX + ux * period * 0.32, cz = camZ + uz * period * 0.32;
    const epoch = Math.floor(cx / period + 0.5) * 8191 + Math.floor(cz / period + 0.5);
    if (!this._treeMemo || epoch !== this._treeMemoAt) {
      this._treeMemoPrev = this._treeMemo;
      this._treeMemo = new Map();
      this._treeMemoAt = epoch;
    }
    const cur = this._treeMemo, prev = this._treeMemoPrev;

    const out = [];
    const r2 = r * r;
    const iA = T.iA;
    for (let i = 0; i < T.n; i++) {
      const k = i * 4;
      jTileTo(iA[k], iA[k + 1], period, camX, camZ, fwdX, fwdZ, _Wt);
      const dx = _Wt[0] - x, dz = _Wt[1] - z;
      if (dx * dx + dz * dz > r2) continue;

      /* Keyed on the instance and its own tile index, because the same
         candidate is a different tree in every copy — the tile index is folded
         back into its seed. Numeric rather than a composed string so the hot
         path allocates nothing. */
      const key = i * 4096 + ((_Wt[3] & 63) << 6) + (_Wt[4] & 63);
      /* A miss is `undefined`; a cached rejection is `null`. Keeping the two
         apart is most of the point — the great majority of candidates are not
         trees, and re-deriving that twelve samples at a time every frame is
         the cost this cache exists to avoid. */
      let e = cur.get(key);
      if (e === undefined) {
        e = prev ? prev.get(key) : undefined;
        if (e === undefined) {
          const a = jTreeAccept(this, i, camX, camZ, fwdX, fwdZ);
          e = a.grow >= J_GROW_MIN
            ? { i, x: a.x, z: a.z, r: a.trR, H: a.H, gy: a.gy }
            : null;
        }
        cur.set(key, e);
      }
      if (e) out.push(e);
    }
    return out;
  }

  /** How many acceptance answers are currently cached. For treecheck, which
   *  asserts that steady driving pays for a handful of new trees rather than
   *  the whole band every frame. */
  _treeMemoSize() {
    return (this._treeMemo ? this._treeMemo.size : 0)
      + (this._treeMemoPrev ? this._treeMemoPrev.size : 0);
  }
```

- [ ] **Step 5: Run and verify**

```bash
npm run treecheck
```

Expected: stage 0's four, stage 1's twelve and stage 2's twelve checks all `ok`.

Read `no tree in range is near a copy boundary` on all three poses: the spec's arithmetic predicts about 41 m of margin, and the check demands at least 30. If the printed margin is materially below 41, the chase-camera geometry has changed and the design note needs revisiting rather than the check relaxing.

- [ ] **Step 6: Commit**

```bash
git add src/world/Surface.js tools/treecheck.mjs
git commit -m "Index the trees near the rover, memoised per copy

Wrap all 1050 instances into the camera's copy, reject on distance, and
run the twelve-sample acceptance only on the dozen survivors — memoised
on (instance, tile index), because the answer is deterministic per copy
and the tile index changes once every 420 m. Two generations are kept so
crossing a cell boundary does not re-derive the whole band at once.

The threshold is 0.05 against the shader's 0.004. treecheck stage 2
checks the index against a full-band ground truth for completeness and
soundness, and asserts the bound the camera coupling rests on: every
tree the rover can reach sits well inside half a tile period of the cell
centre, so nothing can swap copies underneath it."
```

---

### Task 6: The collision, and the end-to-end assertions

**Files:**
- Modify: `src/ship/Rover.js` — constants near line 79, a call in `update` between lines 261 and 263, and a new `_collide` method after `_settle`
- Modify: `tools/expedition.mjs` — a new section after the existing rover checks (after line 188)

**Interfaces:**
- Consumes: `surface.treesNear` (Task 5).
- Produces: nothing further.

- [ ] **Step 1: Write the failing acceptance checks in `tools/expedition.mjs`**

Insert after the `driving costs charge in proportion to distance` check (line 188) and before the `// ---- the drone` section:

```js
// -------------------------------------------------------- trees are solid
/* The rover used to drive through trees, which is the first open item in
   HANDOFF.md. Both directions are asserted here and the second is the one that
   matters more: an invisible wall is worse than no collision at all, so a
   bearing the index calls clear has to actually be clear. */
const treesOn = await page.evaluate(async () => {
  const g = window.__game;
  /* A vegetated world — the trees band only exists above veg 0.55, and there
     is at least one habitable world per galaxy by construction. */
  const body = g.bodies.filter((b) => b.spec && b.planet && !b.planet.isGas
    && b.spec.kind === 'terran' && (b.spec.veg || 0) > 0.62)
    .sort((a, b2) => (b2.spec.veg || 0) - (a.spec.veg || 0))[0];
  if (!body) return { skipped: 'no vegetated world in this galaxy' };
  g.pose({ bodyRef: body, dist: 1.6, phase: 70, elev: 8 });
  g.land(body, { now: true });
  g.director.stop();
  if (!g.landed) return { skipped: 'land refused' };
  if (!g.landed.driving) g.toggleRover();
  return { body: body.name, veg: +(g.surface.veg).toFixed(2), hasBand: !!g.surface._trees };
});

if (treesOn.skipped || !treesOn.hasBand) {
  check('trees are solid', false, treesOn.skipped || 'the landed world has no trees band');
} else {
  /* Two real animation frames between positioning and driving, because
     treesNear reads the pair the last *drawn* frame used — and the tight
     rover.update loop below never runs the frame loop, so without this the
     index would be answering about wherever the camera was left. */
  const settle = () => page.evaluate(() => new Promise((res) => {
    requestAnimationFrame(() => requestAnimationFrame(res));
  }));

  // find a tree the index is confident about, and park short of it
  const aimed = await page.evaluate(() => {
    const g = window.__game, S = g.surface, R = g.rover;
    const near = S.treesNear(R.pos.x, R.pos.z, 300);
    if (!near.length) return { none: true };
    /* The nearest one that is not already under the rover, so there is room to
       get up to speed before reaching it. */
    const t = near.map((q) => ({ q, d: Math.hypot(q.x - R.pos.x, q.z - R.pos.z) }))
      .filter((e) => e.d > 30 && e.d < 220).sort((a, b) => a.d - b.d)[0];
    if (!t) return { none: true };
    // 18 m short of the trunk, nose on it
    const ux = (t.q.x - R.pos.x) / t.d, uz = (t.q.z - R.pos.z) / t.d;
    R.pos.x = t.q.x - ux * 18; R.pos.z = t.q.z - uz * 18;
    R.yaw = Math.atan2(-ux, -uz);
    R.speed = 0;
    return { tx: t.q.x, tz: t.q.z, tr: t.q.r, H: +t.q.H.toFixed(1) };
  });
  await settle();

  const hit = await page.evaluate(() => {
    const g = window.__game, S = g.surface, R = g.rover;
    /* Re-ask after the frames ran: the camera moved with the rover, so the
       cell may have shifted and the tree's own position with it. */
    const near = S.treesNear(R.pos.x, R.pos.z, 40);
    const t = near.map((q) => ({ q, d: Math.hypot(q.x - R.pos.x, q.z - R.pos.z) }))
      .sort((a, b) => a.d - b.d)[0];
    if (!t) return { none: true };
    const input = { held: (a) => a === 'thrUp', touch: false };
    let steps = 0, closest = Infinity;
    while (steps < 900) {
      R.update(1 / 30, input, false);
      closest = Math.min(closest, Math.hypot(R.pos.x - t.q.x, R.pos.z - t.q.z));
      steps++;
    }
    const d = Math.hypot(R.pos.x - t.q.x, R.pos.z - t.q.z);
    return {
      trunkR: +t.q.r.toFixed(2), H: +t.q.H.toFixed(1),
      finalDist: +d.toFixed(2), closest: +closest.toFixed(2),
      clear: +(closest - t.q.r - 1.12).toFixed(2),
      speed: +Math.abs(R.speed).toFixed(2),
    };
  });

  check('driving into a tree stops the rover', !hit.none
    && hit.clear > -0.05 && hit.speed < 1.0,
    hit.none ? 'no tree found in range'
      : `stopped ${hit.clear} m clear of a ${hit.H} m tree`
        + ` (trunk r ${hit.trunkR}) at ${hit.speed} m/s`);

  // and a bearing the index says is clear
  const clear = await page.evaluate(() => {
    const g = window.__game, S = g.surface, R = g.rover;
    const RUN = 120;
    /* Sweep bearings for one the corridor is empty along — sampled every 5 m
       out to the run length, against the capsule's own half-width plus the
       fattest trunk in range, so "clear" means clear for the vehicle rather
       than for a point. */
    let best = null;
    for (let a = 0; a < 72 && !best; a++) {
      const yaw = a * Math.PI / 36;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      let ok = true;
      for (let d = 0; d <= RUN && ok; d += 5) {
        const px = R.pos.x + fx * d, pz = R.pos.z + fz * d;
        if (S.treesNear(px, pz, 4.0).length) ok = false;
      }
      if (ok) best = yaw;
    }
    if (best === null) return { none: true };
    R.yaw = best; R.speed = 0; R.charge = 1;
    const x0 = R.pos.x, z0 = R.pos.z;
    const input = { held: (a) => a === 'thrUp', touch: false };
    for (let i = 0; i < 900; i++) R.update(1 / 30, input, false);
    return {
      covered: +Math.hypot(R.pos.x - x0, R.pos.z - z0).toFixed(1),
      speed: +R.speed.toFixed(1),
    };
  });

  /* The invisible-wall assertion. Thirty seconds on a bearing with nothing in
     it has to move the vehicle a long way and leave it still moving; a rover
     that stops on open ground is the failure this whole design is arranged
     around avoiding. The floor is generous because the ground may be steep and
     CRAWL_FLOOR is a tenth of full drive. */
  check('a bearing the index calls clear is unimpeded', !clear.none
    && clear.covered > 60 && clear.speed > 0.5,
    clear.none ? 'no clear bearing found within 120 m'
      : `${clear.covered} m in 30 s, still making ${clear.speed} m/s`);
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run build && npm run preview
```

In a second terminal:

```bash
npm run expedition
```

Expected: `driving into a tree stops the rover` **FAILS** with a negative `clear` of several metres — the rover drives straight through. `a bearing the index calls clear is unimpeded` should already pass, since nothing collides yet. Both matter: the second one passing now is what makes it meaningful when it still passes later.

- [ ] **Step 3: Add the collision constants**

In `src/ship/Rover.js`, after `const TRACK = 2.0;` (line 79):

```js
/* The rover as an obstacle-sized thing: the segment between the axle midpoints,
   swept by the half-track. 1.12 is TRACK*0.56, the same figure CONTACTS uses
   for where the wheels touch — the outer edge of the tyres, which is what a
   trunk actually meets. (`_settle` builds its sampling corners at TRACK*0.5;
   that is a different measurement and neither is a typo for the other.) */
const HULL_R = TRACK * 0.56;

/* How far ahead trees are asked for. Well inside the range over which a tiled
   instance is guaranteed to stay in the same copy — see Surface.treesNear —
   and comfortably more than a frame of travel at full speed. */
const TREE_RANGE = 25;
```

- [ ] **Step 4: Call it from `update`**

In `src/ship/Rover.js`, between the `if (step) { ... }` block (ends line 261) and `this._settle();` (line 263):

```js
    /* Trees, after the step and before the body is seated: a push-out changes
       where the wheels are, so the attitude has to be worked out from the
       corrected position rather than from the one the drive asked for. */
    this._collide();

    this._settle();
```

- [ ] **Step 5: Write `_collide`**

After `_settle()` (which ends around line 344, before `_height`):

```js
  /** Trunks are solid.
   *
   * The rover is a capsule — the segment between the axle midpoints, swept by
   * the half-track — and each trunk is a circle. Two resolutions rather than
   * one, because pushing out of one trunk can push into its neighbour and a
   * stand is exactly where that happens; two is enough for a pair and the
   * third case is rare enough to leave to the next frame.
   *
   * What is removed is only the *inward* part of the motion. `speed` here is a
   * scalar along the heading, so that is expressed against the contact normal:
   * a square hit has the heading anti-parallel to the normal and stops the
   * vehicle, a glancing one keeps nearly all of it and the push-out slides the
   * rover along the trunk. Zeroing the speed outright would make every brush
   * past a tree feel like hitting a wall, which is the same complaint in a
   * different costume.
   *
   * Canopies are not obstacles. The tree shader draws a real crown you can
   * walk under and that stays true — only the bole is here.
   */
  _collide() {
    const S = this.game && this.game.surface;
    if (!S || typeof S.treesNear !== 'function') return;
    const near = S.treesNear(this.pos.x, this.pos.z, TREE_RANGE);
    if (!near.length) return;

    const [fx, fz] = this.forward();
    const hb = WHEELBASE * 0.5;
    for (let pass = 0; pass < 2; pass++) {
      const ax = this.pos.x + fx * hb, az = this.pos.z + fz * hb;
      const bx = this.pos.x - fx * hb, bz = this.pos.z - fz * hb;
      const abx = bx - ax, abz = bz - az;
      const L2 = abx * abx + abz * abz;

      // the deepest overlap first: resolving the worst one is what makes two
      // passes enough
      let deepest = 0, hx = 0, hz = 0, hL = 0;
      for (let i = 0; i < near.length; i++) {
        const t = near[i];
        let u = L2 > 0 ? ((t.x - ax) * abx + (t.z - az) * abz) / L2 : 0;
        u = u < 0 ? 0 : (u > 1 ? 1 : u);
        const dx = ax + abx * u - t.x, dz = az + abz * u - t.z;
        const L = Math.hypot(dx, dz);
        const pen = (HULL_R + t.r) - L;
        if (pen > deepest) { deepest = pen; hx = dx; hz = dz; hL = L; }
      }
      if (deepest <= 0) return;

      /* Dead centre — the axle line straight through the trunk's own centre —
         has no normal to speak of, so back out the way we came in. */
      let nx, nz;
      if (hL > 1e-4) { nx = hx / hL; nz = hz / hL; } else { nx = -fx; nz = -fz; }

      this.pos.x += nx * deepest;
      this.pos.z += nz * deepest;
      const along = fx * nx + fz * nz;
      this.speed *= 1 - along * along;
      // and stop cleanly rather than creeping into the bark forever
      if (Math.abs(this.speed) < 0.05) this.speed = 0;
    }
  }
```

- [ ] **Step 6: Rebuild and run the acceptance suite**

```bash
npm run build && npm run preview
```

```bash
npm run expedition
```

Expected: both new checks `ok`. `driving into a tree stops the rover` should report a small positive `clear` (a few centimetres — the push-out resolves to exactly touching) and a speed under 1 m/s. `a bearing the index calls clear is unimpeded` must still report over 60 m covered.

- [ ] **Step 7: Run the checker again, and then everything**

```bash
npm run treecheck
```

```bash
npm run verify
```

Expected: `treecheck` unchanged (28 ok); `verify` green across all eight suites. If `verify` fails on something unrelated to trees, check for a stray `vite preview` holding port 4173 before believing it — see `HANDOFF.md`.

- [ ] **Step 8: Commit**

```bash
git add src/ship/Rover.js tools/expedition.mjs
git commit -m "The rover stops at trees, and only at trees

A capsule between the axle midpoints against a circle per trunk, run
after the position step so the body settles onto the corrected place.
Only the inward part of the motion is removed — a square hit stops the
vehicle and a glancing one deflects, because zeroing the speed on every
brush past a bole is the same complaint in a different costume. Canopies
are untouched: you can still drive under a tree.

Two assertions in the expedition suite, and the second is the important
one. Driving at a tree the index is confident about has to stop short of
the trunk; driving a bearing the index calls clear has to be unimpeded.
An invisible wall is worse than no collision at all, so the suite has to
be able to catch one."
```

- [ ] **Step 9: Update `HANDOFF.md`**

Open item 1 is now closed. Replace the whole of the "**1. Rover collides with nothing.**" entry (`HANDOFF.md:47-64`) with a short note recording what was built and where the checker is, and renumber the items below it. Keep the warning sentence — "Half-doing it is worse than not doing it" — as part of the record of *why* the threshold margin exists, or move that reasoning into the design note if it reads better there.

```bash
git add HANDOFF.md
git commit -m "Close the first open item in the handoff: trees are solid"
```

---

## Self-Review

**Spec coverage.** Every numbered section of `2026-08-10-rover-tree-collision-design.md` maps to a task: §1 → Task 3; §2 and §2.1–2.3 → Tasks 2 and 4; §3 (the margin) → the `J_GROW_MIN` constant in Task 4 and the margin check in treecheck stage 1; §4 → Task 3's stash and stage 2's copy-stability check; §5 → Tasks 5 and 6; §6 → the three stages plus Task 6's expedition checks; §7 → Task 1.

**Known gaps, stated rather than hidden:**

- **The memo's cost is asserted weakly.** Stage 2 records `_treeMemoSize()` after a cold call but does not assert a per-frame ceiling on new evaluations. A real "a handful of trees a second" assertion needs a counter on `jTreeAccept` calls and a driving loop. If you want it, add it to stage 2 — it is a genuine claim in the spec that this plan only observes rather than proves.
- **The `hp`/stature loop is not re-derived on the CPU.** `treesNear` reads `iB[k+1]` straight from the retained array, which is correct precisely because it is the same array the GPU reads. Do not "helpfully" recompute it.
- **`_collide` runs after the position step and before `_settle`, but the drone and the arrival check run elsewhere.** Nothing in this plan touches `_roverArrival`; if a site marker ends up inside a stand, reaching it may now be harder. That is open item 2 in the handoff (route-aware site placement) and is deliberately out of scope.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-10-rover-tree-collision.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.
