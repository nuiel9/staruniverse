# Rover collision with the tree band

Design, 2026-08-10. Item 1 in `HANDOFF.md`: *the rover collides with nothing —
you drive straight through trees.*

## The problem, precisely

The woody scatter is GPU-instanced. `scatterBand()` builds the instance data on
the CPU, so a candidate tree's position is already known there — but a candidate
is not a tree. The vertex shader decides, per instance, whether the thing is
drawn at all, from ground slope, sky occlusion, drainage, altitude and a
per-instance hash. That test lives only in GLSL, so the CPU knows where trees
*might* be and nothing about where they *are*.

Collision therefore needs the acceptance test on the CPU. This is the third
resident of the "same law, twice" problem the file already documents at
`Surface.js:1220` — and it is the same liability, so it gets the same treatment:
the transliteration lives beside the GLSL it mirrors, and a checker proves the
two agree.

## Scope

**Trees only.** The `trees` band: `tile: 420`, `n: 1050`, stature 6–18 m, trunk
radius 0.055–0.44 m. The `scrub` band (0.55–2.4 m, `tile: 120`) stays
drive-over: it is brush, a six-wheeled vehicle goes through it, and scrub is
deliberately much less choosy about ground than trees are — it grows on the
banks and the thin soil and the exposed shoulders, which is exactly where the
driving is. Making it solid would turn open hillsides into a maze.

**Trunks only.** Not the canopy. `Surface.js:6287` says a tree is something *you
can walk under*, and that stays true.

**The rover only.** The index lives on `Surface`, so a walking player could use
it later, but nothing else is wired to it in this work.

## 1. Retain the band data

`scatterBand`'s output for the woody bands is currently a local inside
`WOODY.forEach` (`Surface.js:6335`). The `trees` entry is kept on the Surface
instance instead — `iA`, `iB`, `n`, `tile`, `fade`, and the band's `pick` and
`form` vectors — so nothing is regenerated at collision time.

## 2. The acceptance test, transliterated

The GPU path is `Surface.js:4195–4290`. With the view-dependent culls removed
(they decide what is *drawn this frame*, not what exists), the law is:

```
gp, sShift = tileTo(iA.xy, 420, camPos, camFwd)
s          = iA.z + sShift
lod        = meshLod(|gp|)
standOn(gp, iB.x*2, lod)          → gy, gn
terrainAround(gp, gy, lod)        → ao, slope
above      = clamp((gy - seaLevel) / 900, 0, 1)
m          = floraMask(gp, slope, shelterOf(ao), drainage(gp + site), above)
             * uVeg^0.55
grow       = clamp((m - uPick.x - hash11(s*9.13 + 0.77)*uPick.y) * 2.1, 0, 1)
grow      *= 1 - smoothstep(uPick.z, uPick.w, slope)
grow      *= smoothstep(uForm.z, uForm.w, |gp|)          // clear of the pad
if (uType is 0 or 5) and gy < seaLevel + 1.5:  grow = 0
q1, q3     = hash11(s*1.37), hash11(s*4.73)
H          = iB.y * (0.62 + 0.55*q1) * (0.55 + 0.45*grow)
trR        = H * 0.021 * (0.80 + 0.4*q3)
```

For the trees band `uPick = (0.34, 0.72, 0.24, 0.40)` and
`uForm = (1.0, 1.0, 22.0, 54.0)`.

What already exists in JS: `jSnoise`, `jFbm`, `jRidged`, `jDrainage`,
`jTerrainRaw`, `jSmoothstep`, `jClamp`, `jMix`. What must be written:
`hash11`, `meshLod`, `shelterOf`, `floraMask`, `standOn`, `terrainAround`,
`tileTo`, `seaLevel`.

`standOn` and `terrainAround` need no second `groundYFlat`. `fieldcheck.mjs:156`
already establishes — and measures — the correspondence

```
groundYFlat(p, lod, dat)  ===  heightAt(p, lod) + |p|² / 2R
```

so both are written against `heightAt`, which is the one CPU copy of the field
and already proven against the GPU. Writing a second one would create exactly
the drift this section exists to prevent.

Exported as `__woodyJS`, beside `__fieldJS`, for the checker.

### One term deliberately dropped

`grow *= 1 - smoothstep(uFade*0.55, uFade, dh)` — the thinning at the fade edge —
is not ported. For trees `uFade` is 760, so the factor is exactly 1 inside
418 m, and collision happens inside 25 m. The checker evaluates at real ranges
rather than taking this on trust.

## 3. The threshold margin

The GPU draws a tree when `grow > 0.004`. That is a hard binary decided on float
arithmetic, and `hash11` — `fract(p*0.1031)`, then two self-multiplies, then
`fract` — is precisely the kind of function where single precision bites. The
transliteration section records being wrong *by metres, twice*, from
single-precision effects that no amount of careful reading found.

So the CPU does not collide at `0.004`. **It collides at `grow ≥ 0.05`.**

The asymmetry is the point. The two failure modes are not equal:

- *An invisible wall* — the CPU has a tree the GPU did not draw — makes the
  vehicle feel broken, and is the one thing the handoff warns is worse than
  doing nothing at all. With the margin, it needs a CPU-vs-GPU disagreement of
  0.046 in `grow`.
- *A ghost tree* — the GPU drew one the CPU does not collide with — is the
  status quo for that one tree, and barely registers.

The checker's job is to measure the real error bound and show the margin clears
it by a wide factor.

Marginal trees are not saplings: at `grow ≈ 0`, `H` is still 0.55 of full
stature, so a ghost is potentially a ten-metre tree. The checker therefore
reports the tallest tree among any mismatches rather than assuming they are
small.

## 4. Camera coupling, bounded by construction

`tileTo` wraps each instance into the cell around

```
c = camPos.xz + normalize(viewForward.xz) * period * 0.32
```

and folds the tile index back into the instance seed, so **which** trees exist,
and how tall they are, depends on where the camera is looking. Two consequences.

**`Surface.update` stashes the camera forward** alongside the `uCamPos` it
already copies (`Surface.js:6631`), and `treesNear` uses that stashed pair. The
CPU must ask about the frame that was actually drawn; deriving a forward vector
independently at collision time can diverge from it.

**Copy assignment is stable inside collision range**, and the numbers say so.
`period * 0.32 = 134.4 m`. The chase camera sits 9.5 m behind the rover looking
at it (`Rover.cameraPose`), so `c` is at most ~135 m from the rover. A tree
within 25 m of the rover is therefore within 160 m of `c` on each axis, against
a half-period of 210 m — fifty metres of margin before an instance could swap
copies as the camera yaws. The checker asserts this rather than trusting the
arithmetic.

## 5. The index

`Surface.treesNear(x, z, r)` returns `[{ x, z, trunkR, height }]`.

Every instance is wrapped through `tileTo` — one floor and one multiply each,
1050 of them — and distance-filtered. The full acceptance test runs only on
survivors, memoised per `(instance, tileIndex)`: the answer is deterministic
per copy, and the tile index changes once every 420 m of driving. Steady
driving therefore pays for the handful of trees newly entering the radius each
second, not for the whole neighbourhood every frame.

Each acceptance costs about five `heightAt` calls (three in `standOn`, two in
`terrainAround`), which is the same order as one wheel contact. The rover
already spends twenty-two per frame.

## 6. The collision

In `Rover.update`, after the position step and before `_settle()`.

The rover is a **capsule** in the XZ plane: the segment between the front and
rear axle midpoints (length `WHEELBASE` = 2.9 m) with radius `TRACK * 0.56`
= 1.12 m, which is exactly where the existing contact points sit. A circle would
be badly wrong for a body 3.4 m long and 1.8 m wide.

Each trunk is a circle of radius `trR`. On overlap:

1. Push the rover out along the contact normal to exactly touching.
2. Remove only the inward component of velocity: `v -= n * dot(v, n)`.

So a glancing hit deflects and keeps most of its speed; a square hit stops and
must be reversed out of. This follows the existing commitment that "go around is
faster" and "you are stuck with no explanation" must never be the same
experience — a hard stop on a 0.3 m trunk at 22 m/s reads as a bug.

Speed is scalar in the current model (`this.speed` along `forward()`), so the
projection is applied to the velocity vector and the result written back as
speed along the heading. Yaw is not changed by contact: the driver steers.

## 7. Keeping the two honest — `tools/treecheck.mjs`

Built on `fieldcheck.mjs`'s trick, which is the reason that file exists.

Lift the acceptance prologue out of the **live compiled** tree material's
`vertexShader` — not a copy of the source, the string three actually compiled —
and run it in a fragment shader that writes `(accept, grow, gy, H)` per instance
into an `RGBA32F` target. Evaluate at three camera poses, over the instances
within a few hundred metres. Diff against `__woodyJS`.

It passes when:

- **Agreement on the accepted set.** For every instance both sides accept,
  position matches to millimetres and `H` to a few centimetres.
- **Every disagreement is marginal.** For each accept/reject mismatch,
  `|grow − 0.004|` is well inside the 0.05 margin. The report includes the
  worst-case `grow` error, the count of mismatches, and the tallest tree among
  them.
- **Copy stability holds.** No instance within 25 m of the rover changes tile
  index across the three poses.

`npm run treecheck`.

## 8. The end-to-end check

Two assertions added to `tools/expedition.mjs`, which is where the rover's
behaviour is already tested:

- **It stops.** Take a confidently-accepted tree from the index (highest `grow`
  within a few hundred metres), aim the rover at it, drive. Assert the rover
  ends up outside `trunkR + 1.12` and did not pass the trunk.
- **It is not blocked by nothing.** Drive a bearing the index reports clear for
  200 m. Assert distance travelled is unimpeded — this is the invisible-wall
  regression, and it is the one that matters most.

## 9. Two small things folded in

- `tools/fieldcheck.mjs:8` imports `boot.mjs` from an absolute path on another
  machine (`/Users/anshu/Code/SpaceGame2/tools/boot.mjs`). It cannot run here,
  and it is the file this work is modelled on. It becomes `'./boot.mjs'`, as
  every other tool in the directory has it.
- `fieldcheck` gets an npm script; it currently has none.

## What this does not do

- No collision for scrub, rocks, boulders, outcrops or arches. The same
  machinery extends to them — the rock bands run `clutterMask` rather than
  `floraMask` and are otherwise identical — but each band added is another copy
  of a law that can drift, and that cost should be paid where it buys
  something.
- No collision for the walking player.
- No canopy, no branch, no leaf.
- No damage model. A tree costs you speed and time, not charge or condition.
