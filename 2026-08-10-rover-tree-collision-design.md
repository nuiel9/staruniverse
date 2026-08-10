# The rover collides with trees

Design spec. Written 2026-08-10, against
`claude/starflight-2-brainstorm-zdzc2l` at `165892b`.

Answers `HANDOFF.md` open item 1: *"Rover collides with nothing."* The handoff
already names the shape of the work — replicate the vertex shader's per-instance
acceptance test in JS, index the near field, collide — and it names the
condition: **whatever you write, write a checker beside it**, because this is
the second dual CPU/GPU implementation in this codebase and the first one
(`tools/fieldcheck.mjs`) exists because a careful transliteration of the height
field was wrong by metres, twice.

It also names the failure mode that would make this worse than not doing it:

> A rover that stops at invisible obstacles, or drives through visible ones, is
> more confusing than one that drives through everything.

Everything below that looks like over-caution — the threshold margin, the
`Math.fround` discipline, the copy-stability assertion — is aimed at that
sentence.

---

## Scope

**The trees band only.** `WOODY[0]` in `src/world/Surface.js:6322` —
`tile: 420`, `n: 1050` (`520` on `lo`), `h0..h1 = 6..18 m`, and it only exists
at all when `veg > 0.55`. Scrub is not collidable: at `h0 = 0.55 m` it is
something you drive over.

**Trunks only, not canopy.** The tree shader's own comment at
`Surface.js:4301` says the fan of tapered triangles "holds up when you walk
under it". That stays true. A crown is not an obstacle.

Out of scope: rocks (`BANDS`), the ship, sites, terrain walls. The rover still
climbs anything; `CRAWL_FLOOR` is untouched.

---

## 1. Retain the band data

`scatterBand`'s output for the woody bands is currently a local inside the
`WOODY.forEach` at `Surface.js:6335` and is dropped once the geometry has the
attributes. Keep the trees entry on the `Surface` instance:

```js
this._trees = { iA, iB, n, tile, fade, pick, form };   // null when veg <= 0.55
```

`iA`/`iB` are the same `Float32Array`s handed to the `InstancedBufferAttribute`
— not copies. `pick` and `form` are the band's own vectors, not the material's
uniforms, so a later edit to `WOODY` reaches both paths in one place.

Nothing is recomputed at collision time. The instance table is built once at
world build and the acceptance test reads it.

---

## 2. The acceptance test, transliterated

This is the "same law, twice" section's third resident. It goes **in that
section**, in the same file, in the same order, with the same names, under the
same standing instruction that already governs it (`Surface.js:1231`):

> **If you change a band, a gate, a frequency or an amplitude above, change it
> below in the same edit.**

The GPU path is `TREE_VERT`'s prologue, `Surface.js:4195-4290`. With the
view-dependent parts removed — `behindCamera`, the `dh > uFade` cut, the crown
LOD branches — what remains is:

```
gp     = tileTo(iA.xy, uTileP, uCamPos, viewMatrix, sShift)
s      = iA.z + sShift
lod    = meshLod(length(gp))
standOn(gp, iB.x*2.0, lod, dat) -> gy
terrainAround(gp, gy, lod, dat) -> ao, slope
above  = clamp((gy - seaLevel(dat.x))/900, 0, 1)
m      = floraMask(gp, slope, shelterOf(ao), drainage(gp + dat.zw), above)
       * pow(uVeg, 0.55)
grow   = clamp((m - uPick.x - hash11(s*9.13 + 0.77)*uPick.y)*2.1, 0, 1)
grow  *= 1 - smoothstep(uPick.z, uPick.w, slope)
grow  *= smoothstep(uForm.z, uForm.w, length(gp))
[dropped: grow *= 1 - smoothstep(uFade*0.55, uFade, dh)]
if((uType == 0 || uType == 5) && gy < seaLevel(dat.x) + 1.5) grow = 0
accept = grow > 0.004
H      = iB.y*(0.62 + 0.55*hash11(s*1.37))*(0.55 + 0.45*grow)
trR    = H*0.021*(0.80 + 0.4*hash11(s*4.73))
```

Exported as `__woodyJS` beside `__fieldJS` (`Surface.js:1546`), for the same
stated reason: *"so the two implementations can actually be diffed rather than
assumed equal."*

### What already exists and what does not

`jSnoise`, `jFbm`, `jRidged`, `jDrainage`, `jTerrainRaw`, `jSmoothstep`,
`jClamp`, `jMix`, `jFract` all exist (`Surface.js:1271-1440`). Two twins are
missing and this spec names them because they are the actual new work:

- **`jMeshLod(d)`** — twin of `Surface.js:1048`. `RING_P`, `RING_MIN`,
  `RING_MAX`, `LOD_K1` are already module scope at `Surface.js:414-416`; it
  reads `U.uLodK.value`.
- **`jHash11(p)`** — twin of `hash11` in `src/gfx/glsl/noise.js:13`. See §2.2;
  this one is the risk.

`standOn` and `terrainAround` need no second `groundYFlat`.
`tools/fieldcheck.mjs:156` already establishes that
`groundYFlat(p) === heightAt(p) + (p.x² + p.z²)/(2·uPlanetR)`, and
`groundYFlat` (`Surface.js:1029`) and `heightAt` (`Surface.js:6910`) agree line
for line including the `max(y, seaLevel)` clamp on types 0 and 5. So both are
written against `heightAt`.

**The bend is added per sample, not once at `gp`.** `standOn` samples at
`+(ee,0)` and `+(0,ee)`; `terrainAround` samples 90 m out. Adding the bend once
at the instance would put the wrong number into every difference. It is one
multiply per sample and it is exact, so there is no reason to approximate it.

### 2.1 Two transcription traps

Both are the kind of thing a faithful-*looking* transliteration flattens.

**The coordinate asymmetry in `floraMask`.** `m0` and `m1`
(`Surface.js:1206-1207`) sample raw `gp`. `drainage` is called on
`gp + dat.zw` — the site offset. They are not the same point and must not
become the same point.

**`jDrainage` takes the pre-scaled `q`.** The GLSL `drainage`
(`Surface.js:591`) computes `q = vec3(p.x, uSeed*31.7, p.y)*0.00013` and the
JS twin (`Surface.js:1395`) starts *after* that. The caller computes
`(p.x*0.00013, uSeed*31.7*0.00013, p.y*0.00013)`.

### 2.2 `jHash11`, and why it is the whole precision story

`hash11` is `fract`-based and chaotic:

```glsl
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
```

The GPU runs it at float32. Run it at JS double precision and the answer is not
*close* — it is uncorrelated, and since `hash11(s*9.13 + 0.77)*uPick.y`
subtracts up to `0.72` from `m` before the `*2.1`, an uncorrelated hash makes
`grow` uncorrelated. No margin anywhere in this design survives that. This is
the single failure that would produce the invisible walls the handoff warns
about, and it would produce them everywhere, not marginally.

So `jHash11` is written with `Math.fround` per operation, and **the discipline
starts upstream of the hash, not inside it**:

- `sShift` — GLSL `mod(dot(t, vec2(7.31, 3.77)), 23.0)`. Neither `7.31` nor
  `3.77` is exactly representable at float32; emulate per operation.
- `s = fround(iA.z + sShift)`. `iA.z` is already exact — the `Float32Array`
  store rounded it.
- The arguments — and **this is not what the GLSL looks like it says.** See
  below; writing them as they read is wrong by the hash's entire range on a
  quarter of the band.

The precedent is in the file: `jSnoise`'s gradient constants at
`Surface.js:1260-1262` and its `Math.fround` chain at `Surface.js:1334-1338`,
whose comment says exactly this — *"Math.fround reproduces the shader's
arithmetic exactly."*

### 2.2.1 The hash arguments are folded and fused — measured, not predicted

This section originally predicted a residual of ~1e-3 in `grow` from FMA
contraction. That prediction was wrong in kind, not in size, and the checker is
what said so. What follows replaces it, and it is the single most important
paragraph in this document for anyone maintaining the pair.

Written as the GLSL reads — `fround(fround(s*9.13) + 0.77)` and
`fround(s*1.37)` — `grow` came out wrong by a **full 1.0** on roughly a quarter
of the band, while every input to it agreed to `4e-4` or better. Fitted against
the live compiled material over 2079 samples (693 instances × 3 poses):

| form of `hash11(s*9.13 + 0.77)` | mismatches / 2079 | worst |
|---|---|---|
| two roundings then the hash, *as written in the GLSL* | 785 | 0.998 |
| fused, then the hash | 612 | 0.996 |
| folded and distributed, separate roundings | 630 | 0.992 |
| exact, then rounded | 415 | 0.982 |
| **folded and distributed, then fused** | **0** | **0** |

One rule with three consequences: **`hash11` inlines, the compiler folds its own
leading `p*0.1031` back into whatever constants the caller built the argument
from — distributing across an add where there is one — and contracts the
surviving multiply-and-add into a single rounding.** So the JS must be written
as the *folded* form:

```
hash11(s*1.37)        →  fract32(s * fround(1.37*0.1031))
hash11(s*4.73)        →  fract32(s * fround(4.73*0.1031))
hash11(s*9.13 + 0.77) →  fract32(fma32(s, fround(9.13*0.1031), fround(0.77*0.1031)))
```

with the rest of `hash11` unchanged. None of this is visible in the shader
source, GLSL ES imposes no evaluation order that forbids any of it, and
`precise` — which would forbid it — is GLSL ES 3.20 while WebGL2 is 3.00, so it
cannot be legislated from the shader side either.

Note the discrimination the table buys: "fused" and "folded then fused" are
different answers, and only the second one is right. A transliteration that got
*most* of this story would still be wrong on 612 instances.

**Measured after the fix:** zero accept/reject disagreements at all three
poses, and a `grow` error of **2 % of the 0.046 margin**.

The height-field tail this document worried about did not materialise *in
`grow`* — which is the thing the margin protects and the reason the worry
existed. It did show up where the field is measured directly rather than
through two smoothsteps: the ground-height and stature checks, which is what
moved those gates to 10 mm. Those are the same field error seen at two removes
from each other, not two findings.

**And this is one compiler's behaviour, not the language's.** A driver that
folds differently puts the error straight back at full scale, because the hash
wraps. That is what §6.1 exists for.

`tileTo`'s own `dot(t, vec2(7.31, 3.77))` measured bit-exact as two separate
roundings over the tile indices these poses exercise, and was left that way —
but it is the same question, and a pose with larger indices could answer it
differently.

### 2.3 The dropped term

Dropped: `grow *= 1 - smoothstep(uFade*0.55, uFade, dh)`.

For trees `uFade = 760`, so the factor is exactly `1` for `dh < 418 m` and
collision happens inside 25 m of the rover — where `dh`, the distance from the
*camera*, is under 40 m. The term cannot fire. It is dropped rather than
carried because carrying it would mean the CPU path needs `dh`, which means it
needs the camera position for a reason other than tile assignment, which is a
coupling worth not having.

The checker evaluates at real ranges rather than taking this on trust: if the
term ever fires within collision range, `treecheck` sees a `grow` disagreement
and fails.

---

## 3. The threshold margin — the decision that matters

The GPU draws a tree when `grow > 0.004` (`Surface.js:4290`). That is a hard
binary over float arithmetic, and the section this transliteration joins
records being wrong by metres twice from single-precision effects alone. The
two copies **will** disagree near the threshold. The only question is which way
the disagreement hurts.

**The CPU collides at `grow >= 0.05`.**

An invisible wall — the rover stops where the player sees nothing — then
requires a CPU-vs-GPU error of `0.046` in `grow`. `treecheck`'s job is to
measure the real error bound and show that the margin clears it by a wide
factor.

The residual failure is the opposite one: driving through a marginal tree the
GPU did draw. That is the right way round. It is also the one a player barely
notices, where the other one generates a bug report.

**Marginal trees are not saplings.** At `grow ≈ 0`,
`H = iB.y*(0.62 + 0.55*q1)*0.55` — still 55 % of full stature, so a marginal
tree in a `6..18 m` band is 2 to 7 m tall and perfectly visible. The checker
therefore reports the **tallest** tree among any accept/reject mismatches
rather than assuming mismatches are small ones.

---

## 4. Camera coupling, bounded by construction

`tileTo` (`Surface.js:1788`) wraps each instance into the cell nearest

```
c = camPos.xz + normalize(viewForward.xz) * period * 0.32
```

which for `period = 420` is **134.4 m** down the view axis. The seed shifts per
copy (`seedShift = mod(dot(t, vec2(7.31, 3.77)), 23.0)`), so the same candidate
is a different tree in every cell. Two consequences.

**The CPU must ask about the frame that was actually drawn.**
`Surface.update` stashes the camera forward alongside `uCamPos`, at the same
point (`Surface.js:6631`):

```js
U.uCamPos.value.copy(ctx.camPos);
this._camXZ.set(ctx.camPos.x, ctx.camPos.z);
this._camFwdXZ.copy(ctx.camFwd);        // new field on ctx, from Game.js:2048
```

`treesNear` uses that stashed pair and nothing else — never
`game.camera` directly, which by then may have moved.

**One frame of staleness, and it is bounded.** The ground update order is
`rover.update` (`Game.js:878`) → `updateCamera` (`Game.js:889`) →
`updateSurface` (`Game.js:890`). So `treesNear`, called from `Rover.update`,
reads the stash written on the *previous* frame. At a hard yaw of 90 °/s and
60 fps that is 1.5° of rotation, moving `c` by `2 * 134.4 * sin(0.75°) ≈ 3.5 m`.
This is stated because it is the kind of one-frame skew that is invisible until
it is a bug, and because it eats into the margin below.

**Copy assignment is stable inside collision range.** The chase camera sits
9.5 m behind the rover (`Rover.cameraPose`), so `c` is at most
`134.4 + 9.5 ≈ 144 m` from the rover. A tree within 25 m of the rover is
therefore at most `169 m` from `c` per axis, against a half-period of `210 m`.
**41 m of margin** before any tree could swap copies — before the one-frame
skew, and ~37 m after it.

The checker asserts this rather than trusting the arithmetic.

---

## 5. The index and the collision

### `Surface.treesNear(x, z, r)`

Returns `[]` when `this._trees` is null (`veg <= 0.55`). Otherwise:

1. Wrap all `n` instances into the current copy — one `floor` and one multiply
   each, per `tileTo`, using the stashed camera pair.
2. Distance-filter against `r` in XZ. This is the cheap pass and it removes
   essentially everything: 1050 instances over a 420 m cell is one tree per
   ~168 m², so a 25 m disc holds on the order of a dozen candidates before
   acceptance.
3. Run the full acceptance from §2 only on survivors.

**Memoised per `(instance, tileIndex)`.** The answer is deterministic per copy
and the tile index changes once every 420 m of driving, so steady driving pays
for a handful of new trees a second rather than 67 evaluations a frame.

- Key: `i * 4096 + ((tx & 63) << 6) + (tz & 63)` — or a `Map` keyed on a
  composed string; the numeric key is preferred because it does not allocate.
- Value: `{ accept, gpx, gpz, gy, H, trR }`.
- **Eviction:** keep the current tile and the previous one, drop anything
  older. On a tile change, the previous-tile map becomes the drop set and a
  fresh map takes over. This bounds the cache at ~2 × 1050 entries and makes
  "a handful of new trees a second" a property of the design rather than a
  hope.

### The collision, in `Rover.update`

Placed **after** the position step (`Rover.js:251-261`) and **before**
`_settle()` (`Rover.js:263`), so the chassis settles onto the corrected
position.

The rover is a **capsule**: the segment between the axle midpoints,

```
a = pos + fwd * (WHEELBASE/2)      // WHEELBASE = 2.9
b = pos - fwd * (WHEELBASE/2)
radius = 1.12
```

`1.12` is `TRACK * 0.56` — **`CONTACTS`' own half-track** (`Rover.js:84-89`),
the outer edge of the wheels. Note that `_settle` builds its corners at
`TRACK * 0.5 = 1.0`; that is a different thing (where the ground is sampled)
and neither number should be "corrected" to the other.

Each trunk is a circle of radius `trR` at `(gpx, gpz)`.

For each overlap, nearest first, at most two iterations:

```
q    = closest point on segment(a, b) to the trunk centre
d    = q - centre,  L = |d|
pen  = (radius + trR) - L
if pen > 0:
   n = d / L                                  // contact normal, XZ
   pos += n * pen                             // push out
   speed *= 1 - dot(fwd, n)²                  // remove only the inward part
```

`speed` is scalar in this controller, so the velocity projection is expressed
against the heading: a square hit (`fwd` anti-parallel to `n`) zeroes the
speed, a glancing one keeps almost all of it and the push-out slides the rover
along the trunk. That is the behaviour the spec wants — deflect on a glance,
stop on a square hit — without introducing a velocity vector the rest of the
controller does not have.

`L` degenerate (dead-centre hit) falls back to `n = -fwd`.

---

## 6. Keeping the two honest

### `tools/treecheck.mjs` — `npm run treecheck`

Built on `fieldcheck.mjs`'s trick: the acceptance prologue is not exported, so
lift it out of the material three has already compiled —
`surface.floraMeshes.find(m => m.name === 'trees').material.vertexShader` — and
run it in a **fragment** shader that writes one texel per instance to an
`RGBA32F` target.

**Where the slice starts, and why not at `void main(){`.** The obvious slice —
`void main(){` through the `grow <= 0.004` line — will not compile in a
fragment stage, for three reasons that are all in the first forty lines of it:
the three early-outs write `gl_Position`; the crown-LOD block reads the
`position` **attribute** (`Surface.js:4229`, `4236`); and by the time the
source is a compiled string the `${tree ? ...}` markers are gone, so that block
cannot be excised by marker either.

So the slice runs from **`vec4 dat = uDatum;`** (`Surface.js:4240`) through the
`grow <= 0.004` test, rewritten as an accept flag. That one move skips all
three early-outs and the LOD block, and it keeps every line of the risky
arithmetic — `standOn`, `terrainAround`, `floraMask`, `drainage`, both
`hash11`s in `grow` — as live text lifted from the shader rather than as a
third copy.

Two things then have to be hand-written in the probe:

- **The preamble**, three lines: `gp = tileTo(iA.xy, uTileP, uCamPos,
  viewMatrix, sShift)`, `s = iA.z + sShift`, and `dh`. `tileTo` itself is still
  live chunk text, so only the call sites are duplicated.
- **`H`**, which is not in the slice at all: it is computed *after* the grow
  test (`Surface.js:4319`) and its `q1`/`q3` hashes sit below
  `float bi = position.z;`, so extending the slice to reach it would pull the
  attribute back in. Its three lines are duplicated in the probe. That is one
  formula existing in three places, which is a real cost and is accepted
  because check 1 below fails loudly on any mismatch in it.

Harness mechanics, named here because they are the fiddly part:

- `iA` and `iB` upload as two `RGBA32F` textures, `n` texels wide;
  `texelFetch` by instance index derived from `gl_FragCoord`. They are declared
  in the probe as plain `vec4`s filled from those fetches — the slice
  references `iA` and `iB` by name and must not see an `attribute`.
- Declare `uniform mat4 viewMatrix, projectionMatrix;` in the fragment shader.
  This is legal — three.js only injects those declarations into the vertex
  stage — and they are filled from the live camera at each pose.
- Output `(accept, grow, gy, H)` per instance.
- Compare only instances the pose did not `behindCamera`-cull, or use a pose
  that cannot cull them. A culled instance has no `grow` to compare.

Run at **three camera poses** (differing in position and heading), diffing
against `__woodyJS`. It passes when:

1. **Position and `H` agree** on every instance both sides accept — to **10 mm**.

   That gate looks slack and is not. These two checks do not measure anything
   the tree code computes: `jStandOnY` is `min()` of three `jFlatY` calls and
   `jFlatY` is `Surface.heightAt` with the horizon bend added back, so this is
   the height-field twin that `fieldcheck` already owns, sampled at the lods a
   tree stands at. `fieldcheck` measures worst 3.66 mm at lod 1 on this world
   and the tree path's worst is 3.73 mm — the same quantity through a second
   door, and a 1 mm gate sits below the twin's own p90 at low lod. What these
   checks exist to catch is a wrong offset, a swapped sample or a missing
   `min`, and every one of those misses by metres, so 10 mm keeps about three
   orders of magnitude of discrimination.

   `H` is not an independent measurement: `iB.y` is shared and `q1` is
   bit-exact, so `H` can differ *only* through `grow`, and `dH/dgrow` of about
   9.5 m per unit against the measured `grow` worst bounds it at ~7 mm.
2. **Every accept/reject disagreement sits below the margin** — that is, every
   instance where the two sides differ on acceptance has `grow` within `0.046`
   of `0.004` on both sides. A disagreement at `grow = 0.5` is a
   transliteration bug, not a rounding effect, and must fail loudly.
3. **The tallest mismatched tree is reported** (see §3), pass or fail.
4. **The copy-stability bound holds** — for every accepted tree within 25 m of
   the rover, distance from `c` per axis is under `210 m`; and the measured
   per-pose camera skew is reported against the 41 m margin from §4.
5. **The measured `grow` error bound is printed** against the `0.046` margin,
   so the margin is a number someone can see rather than an assertion.

### One end-to-end check in `tools/expedition.mjs`

Two assertions, in the suite that already owns the ground:

- Take a **confidently-accepted** tree from `treesNear` (`grow` comfortably
  above `0.05`), drive at it, assert the rover **stops short of the trunk** —
  final distance from trunk centre `>= trR + 1.12 - ε`, and speed at rest.
- Drive a bearing `treesNear` reports as **clear**, assert the run is
  **unimpeded** — distance covered matches the free-driving expectation.

The second assertion is the one that catches an invisible wall, and it is why
it is in the suite rather than only in `treecheck`.

### 6.1 The guard that ships

Everything above runs on a developer's machine. §2.2.1 is one shader
compiler's folding behaviour, and a player's driver that folds differently puts
the whole error back — not as drift, but at the hash's full range, which is
precisely the invisible walls the handoff calls worse than no collision at all.
`treecheck` cannot see that machine.

So the same comparison ships. Once per landing, on the real device:

- Take **the live material's own slice** — the identical slice-and-compile
  `treecheck` stage 1 uses — and evaluate it over the instance table at the
  landing pose. It has to be that slice and not a hand-written mini-shader:
  a cut-down probe gets optimised differently and answers differently, which
  is a measured fact from Task 4 and not a precaution.
- Diff `grow` and `accept` against `__woodyJS`.
- On disagreement, `treesNear` returns empty for that world, and one line goes
  to the console saying why.

A mismatched driver then degrades to **exactly today's behaviour** — the rover
drives through trees — which the handoff names as the acceptable failure, and
never to the unacceptable one. It also covers the `tileTo` `dot()` contraction
residual noted at the end of §2.2.1, at the pose that actually matters rather
than at three synthetic ones.

The alternative considered and not taken: have the CPU compute the three
per-instance hashes and upload them as instance attributes on tile change, so
the shader stops computing them and there is nothing left to fold. That is
robust by construction rather than by check, but it touches the renderer and
the custom depth material, and it re-introduces a per-tile upload the tiled
scatter exists to avoid.

---

## 7. Two small things folded in

Both are in the file being copied, and both cost the next person time.

- **`tools/fieldcheck.mjs:8`** imports `boot.mjs` by an absolute path on
  someone else's machine — `/Users/anshu/Code/SpaceGame2/tools/boot.mjs`. It
  cannot run anywhere but there. It becomes `'./boot.mjs'`.
- **`fieldcheck` has no npm script.** It gets one, alongside `treecheck`:

  ```json
  "fieldcheck": "node tools/fieldcheck.mjs",
  "treecheck":  "node tools/treecheck.mjs"
  ```

  Note that `fieldcheck` targets the **dev server** (`localhost:5173`) while
  the acceptance suites target the **built bundle** (`localhost:4173`).
  `treecheck` follows `fieldcheck`, since it is the same kind of tool.

---

## What "done" means

- `npm run fieldcheck` runs on this machine.
- `npm run treecheck` passes at three poses, and prints a measured `grow` error
  bound that is a small fraction of `0.046`.
- The shipped guard (§6.1) disables tree collision rather than trusting it when
  the device disagrees with the CPU.
- `npm run expedition` passes, including the two new assertions.
- Driving into a visible tree stops the rover. Driving across open ground the
  chart calls clear is unimpeded.
