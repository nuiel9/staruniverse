# Route-aware site placement

Design spec. Written 2026-08-11, against `claude/starflight-2-brainstorm-zdzc2l`
at `eaa465e`.

Answers the open item `HANDOFF.md` inherited from M7:

> **Sites are placed without checking the route.** `Sites.at()` picks a bearing
> and a range and puts a marker there. Nothing guarantees a drivable path exists
> — a marker can sit behind a face too steep to climb. The rover can now always
> crawl, so nothing is strictly unreachable, but a site that takes ten minutes
> of switchbacks is a bad site.

It was reported from play: a Hush marker at 266° and 2.2 km, and the rover
"stopped". It had not stopped. It was crawling at `MAX_FWD * CRAWL_FLOOR` —
2.2 m/s — up faces measured at grade 1.13, about 48°, while the range kept
falling. The crawl floor was doing exactly its job and the site was simply in a
bad place.

Two things came out of that report. The first — telling the driver why the
vehicle slowed, without needing the chart open — is done and shipped. This spec
is the second: stop putting sites there.

---

## What this is not

**Not a difficulty cap, and not a guarantee.** Sites are not rejected and the
search does not widen until something passes a bar. A world of mountains should
still be a world of mountains; the rover can always crawl, so nothing here is
unreachable either way. What changes is that of several equally-seeded
positions, the one that is least punishing to drive to is the one that gets
used.

**Not a route finder.** Nothing computes a path, draws waypoints, or steers.
The score is over the straight line, because that is the line a player
instinctively takes and the one that produced the complaint.

**Not a terrain-reading UI.** Shading the chart by slope is a reasonable
separate idea and is out of scope.

---

## 1. The field, extracted once and consumed by both

Scoring a route before landing needs the height field before landing, and today
the field only exists inside a constructed `Surface`. It does not have to:
everything it needs is derivable from the world's `spec`.

Measured, not assumed — the JS field reads exactly five uniforms:

| value | source |
|---|---|
| `uSeed` | `spec.seed` |
| `uRelief` | `spec.relief` |
| `uPlanetR` | `spec.radius * 1000` |
| `uType` | `spec.typeId \| 0` |
| `uLodK` | `LOD_K1 / GQ` (`Surface.js:6320`) |

plus three derived values the constructor computes today: `_site` (from
`pickSite`), `_datum` (from `jTerrainRaw` at the site), and `_seaY`.

So `Surface.js` gains one export:

```js
export function groundField(spec, quality)   // -> { site, datum, seaY, heightAt(x, z, lod) }
```

**And the `Surface` constructor calls it.** This is the load-bearing half of the
decision and it is not an implementation detail. If the constructor keeps its
own copy of the derivation, then sites are placed against one landing site and
driven against another, and the two drift the first time either is touched —
which is the "same law, twice" failure this codebase already carries two
checkers for. Extraction is worth doing *because* it removes the second copy,
not merely because it makes the field reachable.

`heightAt(x, z, lod)` on the returned object must be the same function
`Surface.heightAt` exposes, in the same frame: metres, +Y up, relative to the
landing site, horizon bend included.

### Caching

`pickSite` is a two-stage search — a coarse sweep over a jittered grid at five
samples each, then the best handful re-scored with thirteen. Today it runs once
per landing. Under this design it runs once per *body whose sites are asked
for*, which is a different and possibly much larger number.

So `groundField` memoises per `spec`, and `Sites.at()` already memoises its
whole result on `body._sites`. That bounds it at one `pickSite` per body per
session.

**This is the design's main cost risk and the plan must measure it rather than
assume it.** See §5.

---

## 2. The route score

```js
routeTime(field, x0, z0, x1, z1)   // -> seconds
```

Walk the straight line in fixed steps. At each step take the grade from the
field, run it through **the rover's own curve**, and accumulate `step / speed`:

```
climb = max(0, (h1 - h0) / step)
bite  = 1 - smoothstep(climb, GRADE_FREE, GRADE_STALL)
speed = MAX_FWD * max(CRAWL_FLOOR, bite)
```

Two things about this are deliberate.

**It is sampled at a coarse LOD.** `heightAt` carries a fine band whatever the
LOD, and over a short baseline that band is rubble rather than landform — the
same trap that made the rover crawl on flat ground until `GRADE_LOD` was raised
to 14 (`Rover.js:193-205`). The route is scored at the scale of the hill, with
a step long enough that grit is not in the answer.

**Only climbing costs.** Descent is free, exactly as the drive model has it.
That is what makes a site on the near side of a ridge score better than one on
the far side, which is the whole point.

### The shared drive model

`GRADE_FREE`, `GRADE_STALL`, `CRAWL_FLOOR` and `MAX_FWD` are private to
`Rover.js` today. The score above is not an approximation of the drive model —
it *is* the drive model — so the constants move to a small module that both
`Rover` and `Sites` import, and neither owns.

`Sites` reaching into `src/ship/` for constants would be the wrong direction of
dependency: placement is a property of the world, not of the vehicle. A vehicle
whose curve changed and silently left placement scoring the old one is the
failure this avoids.

---

## 3. The placement

Inside `place()` (`Sites.js:91`), after the existing bearing and range rolls,
derive a small fixed lattice of candidates, score each with `routeTime` from the
origin, and keep the cheapest.

**Candidates are derived, never rolled.** This is a hard constraint, not a
preference: `_isSurvivorHost` (`Sites.js:187-194`) reproduces `at()`'s roll
sequence draw for draw — its own comment says *"Burn exactly the rolls `at()`
burns"* — so a single extra `rnd()` inside `place()` desynchronises it and moves
the survivor. Offsets are therefore a constant lattice applied to the rolled
position: bearing nudges and range nudges, no randomness.

**Seams get range candidates only.** The deposit owns its bearing and the survey
text quotes it; `Sites.js:109-113` already says so — *"Honour it rather than
rolling a second one, or the survey text and the ground disagree."* Moving a
seam's bearing would reintroduce exactly that. Wrecks, markers and the survivor
have both free.

**Range stays inside `RANGE_MIN`..`RANGE_MAX`.** Those bounds are load-bearing
in both directions: under 700 m walking becomes the answer, over 6200 m a full
pack no longer covers the round trip. A candidate that leaves the band is
dropped rather than clamped, so the lattice thins near the edges instead of
piling candidates onto the boundary.

Site `id`s are unchanged (`marker:0` and so on), so saved surveyed/worked state
keyed by id survives sites moving.

---

## 4. What proves it

Three things, in the order that localises a failure.

**1. The field agrees with the surface it was extracted from.** Land for real,
and compare `groundField(spec).heightAt` against the landed `Surface.heightAt`
over a few hundred scattered points, on several worlds. They should agree to the
bit, because after §1 they are the same code — which is what makes this cheap
insurance rather than a second `fieldcheck`. If they ever disagree, sites are
being placed on a world nobody drives on, and everything below is meaningless.

**2. Sites actually got gentler.** Over many worlds, report predicted drive time
to every site with the lattice disabled and with it enabled. The claim to prove
is distributional, not per-site: the median should fall and the tail should fall
harder, since the lattice can only help where the rolled position was bad. A run
where nothing improved means the lattice is too small or the score is not
measuring what the rover feels.

**3. It is still reachable in the game, not just in a spreadsheet.** One
end-to-end assertion in `tools/expedition.mjs`: drive to a marker and arrive
inside a time budget, with the rover actually under its own power.

And one property worth asserting because it is cheap and its violation is
silent: **`at()` is unchanged in its roll sequence.** The survivor lands on the
same world, and the same seed still produces the same set of sites with the same
ids and bearings — only positions move.

---

## 5. The cost, and the number that decides it

`pickSite` per body is the one thing here that could be worse than the problem
it solves.

The plan must **measure before it builds**: how long `pickSite` takes for one
body, and how many bodies a normal session asks sites for. Multiply. If the
product is a visible hitch on the frame that opens the survey, the answer is not
to ship it and hope — it is either to memoise `groundField` across the session
more aggressively, to score against a cheaper LOD, or to reconsider whether
placement happens at first-query rather than at survey time.

Stated as a gate: **if querying every solid body in a system costs more than
about 100 ms, stop and bring the number back before continuing.**

---

## What "done" means

- `groundField(spec)` exists, `Surface` uses it, and the two agree to the bit.
- The drive constants have one home, imported by both `Rover` and `Sites`.
- Predicted drive times to sites fall across a spread of worlds, measurably.
- `npm run expedition` still passes, plus a marker-reachability assertion.
- The survivor is still on the same world, and site ids are unchanged.
- The measured cost of §5 is written down, not assumed.
