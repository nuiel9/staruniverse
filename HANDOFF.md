# Handoff

Written at the end of the cloud session that built M0–M7, so the next session
— or you, locally — can pick it up without re-reading the whole history.

Branch: **`claude/starflight-2-brainstorm-zdzc2l`**. Everything is pushed. No
pull request has been opened.

---

## Get it running

```
npm install
npm run dev            # localhost:5173
```

Verification, in the order it costs you time:

```
npm run lang           # ~1 s, no browser: every written string has a translation
npm run verify         # builds, serves on 4173, runs all eight suites
npm run expedition     # just the ground: sites, rover, salvage, the chart
npm run treecheck      # needs `npm run dev`, not the preview: it imports source
```

On a GPU the suites take seconds. On software GL they take tens of minutes,
which is why nothing in them waits on wall-clock time — they wait on game
state. Run them locally and they will be much faster than they were in the
cloud container.

**One environment note that cost real time here.** `tools/probe.mjs` and the
suites resolve a browser via `$CHROMIUM`, then `/opt/pw-browsers/chromium`,
then Playwright's own download. Locally the third will apply and is fine.

---

## Where things stand

M0 through M7 are done, verified and pushed. The game is a trade-and-survey
loop with a nebula that costs fuel, four cultures who barter, contracts, crew,
a six-part mystery, a landable surface with things on it, and a drivable
rover. Two languages throughout. See `README.md` for what any of that means
and `BRAINSTORM.md` for why.

### Closed since

**Trees are solid.** The rover used to drive straight through them; it now
stops. The vegetation band is tiled, so a tree's world position was always
CPU-derivable — what was not on the CPU was the vertex shader's per-instance
acceptance test, and that is what got written: a JS twin of it in
`src/world/Surface.js`, a near-field index over it in `Surface.treesNear`
memoised per copy, and a capsule-against-circle push-out in `Rover._collide`.

Two checkers, because this is a dual CPU/GPU implementation and this codebase
does not take those on trust. `npm run treecheck` (dev server, like
`fieldcheck`) puts the acceptance test to a real shader compiler instance by
instance and measures the index's copy stability and threshold margin — 35
checks. `npm run expedition` drives the thing: a tree the index is confident
about has to stop the rover, and no push-out anywhere in a run may lack a
trunk overlapping the capsule.

That second assertion is the one that matters, and it is why the CPU collides
at a higher `grow` than the shader draws at (`J_GROW_MIN` 0.05 against the
shader's 0.004 — see its comment). **Half-doing it is worse than not doing
it:** a rover that stops at invisible obstacles, or drives through visible
ones, is more confusing than one that drives through everything. Given a
disagreement near a hard binary, the margin decides which way it is allowed to
hurt, and drawing a tree nobody collides with is the mistake to prefer. The
same reasoning runs one level up: `Surface.verifyTreeAgreement` asks this
machine's compiler the question once per landing, and `treesNear` returns
nothing at all for the whole world if the answer is no.

That guard is not belt-and-braces. The JS only agrees with the shader because
it is written against what this machine's compiler *does* to an inlined
`fract` hash — folds its leading multiply into the caller's constants and fuses
the result — and written the way the GLSL reads instead, `grow` came out wrong
by the hash's whole range on 785 of 2079 samples. That is a compiler's habit,
not a language guarantee, so it is asked rather than assumed.

Three things it does not cover, none of them known to be wrong and all cheap to
close if you want to:

- **One world.** Everything measured is the first vegetated terran in this
  galaxy. `tools/treecheck.mjs` already takes the world type as its first
  argument, so `node tools/treecheck.mjs desert` is a run, not a build.
- **`tileTo`'s seed shift** is written as two separate roundings and measures
  bit-exact — but only over the tile indices three poses reach, about 4 against
  a world that tops out near 15. Same folding question, unguarded. It would
  fail loudly rather than silently.
- **The stature check reads `q1` and not `q3`,** so a driver that folded one
  constant this machine's way and the other differently would ship trunk radii
  up to a fifth out. The probe's output vector is full; see the comment on
  `GATE_H` for why that was accepted rather than repacked.

**Sites are placed with the route in mind.** A marker used to be dropped at
a bearing and a range with nothing asking whether the ground in between was
climbable — a site could sit behind a face steep enough that reaching it meant
ten minutes of switchbacks. `Sites.at()` now scores a small lattice of nearby
bearings and range factors around the position the seed rolled, using the same
drive model the rover itself runs on, and keeps whichever candidate has the
shortest continuous stretch below a quarter of top speed — the wall in the
way, not the length of the trip. A whole-route total was tried first and
rejected: 500 m of 48° face inside an otherwise flat 5 km route dilutes to an
unremarkable 1.9×, which is exactly the kind of site the original bug report
was about and exactly what a total-time metric cannot see.

Proven two ways. `npm run sitecheck` measures 35 sites over 12 worlds before
and after easing and shows the worst wall shrinking (276 m → 249 m) with no
site made worse; `npm run expedition` goes further and actually drives a
rover, under its own steering, at the marker with the greatest range in the
home system rather than whichever one sorts first. That check's budget is not
a fixed wall-clock cap — an early version used one, and it was wrong: two
markers on this seed sit over four minutes from their ship at full speed on
flat ground, which a fixed cap would fail on distance alone regardless of how
good the route is. The budget is a multiple of a flat-out run instead (2.6x,
against sitecheck's measured worst of 2.37x across the home system — and
2.6x is deliberately a home-system number, because this suite never leaves
home; the galaxy's worst is 4.46x), so the check is honest about what
placement can and cannot fix: it cannot make a marker closer, only make the
ground between the ship and it less of a fight. On this seed the hardest
marker drives at 1.01x flat-out, well inside budget.

The effect is not uniform, and the reason is structural rather than a bug.
Markers and wrecks are free to change bearing as well as range, and their
walls fall hard — markers' worst wall went 251 m → 100 m, mean 110 m → 30 m.
Seams cannot turn at all: a seam's bearing belongs to the deposit it surveys,
so easing can only slide it in or out along the ray the deposit already
picked, and the worst seam wall only comes down 276 m → 249 m. **What this
deliberately does not do:** it is not a guarantee — nothing is rejected for
having a bad route, so a world of mountains is still a world of mountains and
a sufficiently unlucky roll can still land near a wall the lattice's own reach
cannot avoid. The search never widens past the lattice the brief fixed either,
even though a wider one was measured and would not have changed the worst
site's floor — the floor there is the seam-bearing rule, not the lattice's
radius. Treat this as the ground getting friendlier on average and the worst
case getting shorter, not as a promise that every site is fair.

Four loose ends, none known to be wrong and all cheap to close:

- **The thresholds were tuned on one system, and the checker now walks all
  fourteen.** `npm run sitecheck` used to score the home system alone, because
  that is where the game boots and nothing moved it; it walks the galaxy by
  default now — 457 sites over 152 worlds, about 30 s — and `sitecheck <url> N`
  limits it to the first N systems when you want it quick. That immediately
  showed the home system had been a soft sample: the worst drive is **4.46x** a
  flat-out run galaxy-wide against 2.37x at home, and the worst wall 376 m
  against 276 m. Both tuned numbers survive, and both are now documented as
  home-system calibrations where they sit — `WALL_TRIGGER`'s "middle of an
  empty band" argument is true at home and not galaxy-wide, and the acceptance
  budget's 2.6x has headroom only because that suite never leaves home. If
  anything ever teaches `expedition` to jump, re-derive the budget rather than
  re-running it.
- **A deposit bearing of exactly 360° would disagree with itself.**
  `Prospecting` rolls `round(rnd()*360)`, so 360 is reachable, and an eased
  seam normalises it to 0 while the deposit keeps 360. Geometrically the same
  place, textually a survey that contradicts the chart. Under one seam in a
  galaxy; a one-line guard when someone is next in there.
- **The tie-break is not monotonic.** Inside half a route step the ranking may
  take a nominally longer wall for a faster drive, and `bestW` then moves with
  it, so the winner depends on iteration order. Order is fixed, so it is
  reproducible; quantisation bounds the drift to centimetres. Worth knowing
  before anyone changes the loop.
- **`_rolled` rides into the UI.** Each site keeps the position the seed rolled
  so the checker can prove sites got better, and `manifest()` spreads it into
  the rows the Codex and the chart consume. Nothing reads it there. Drop it
  once the distribution is trusted.

**The cost, re-measured after the wiring, not before it.** The design's §5 set
a gate — if querying every solid body in a system for its sites costs more
than about 100 ms, stop and bring the number back — and its own done-criterion
was that the measured cost get written down rather than assumed. The number
that was first written down was a baseline taken before `Sites.at()` actually
consumed the field, so it measured nothing the spec asked about. Re-measured
after: a cold query of every solid body in a system (12 worlds, 35 sites)
costs **172.5 / 175.0 / 186.2 ms** — of which ~93 ms is `pickSite`'s lattice
search and ~80 ms is the route walks it scores. `groundField` alone is
7.4–8.1 ms per body. Per body, cold, end to end: 8.2–25.6 ms; warm, cached,
it's 0 ms. Read literally, the whole-system figure breaches the 100 ms gate by
nearly 2x.

That is the wrong number to gate on, because nothing in the game asks it. The
gate assumes a survey queries every body in a system at once; nothing does.
`Sites.at()`'s only non-`nearest` caller in `src/` is `Game.js`, and it asks
for one body — the one just landed on — and the Codex reads one selected body
at a time the same way. So the shape the spec guessed at (whole-system, every
call) never happens; the shape production actually pays is one cold query per
body, the first time that body's sites are asked for, cached after. That is
an **8–26 ms hitch, once per world per session** — one dropped frame the first
time you land somewhere or open its Codex page, not a stall that scales with
how many bodies a system has. Restated in the shape that matters: the gate is
clear, by a wide margin, for the query pattern that exists; it is not clear
for a query pattern the game never issues.

### Open, in the order I would take them

**1. `mystery.mjs` has a stale assertion.** It checks "all five readings
reachable" and passes, but there are six now and it counts *found* rather than
total. It is a weaker claim than its name suggests. `REVELATION_COUNT` is
exported from `src/game/Mystery.js` for exactly this.

**2. Cloud Run has never actually run.** `Dockerfile`, `nginx/` and
`cloudbuild.yaml` are written and the YAML parses, but this container had no
Docker, so no image was ever built. The first `gcloud builds submit` is the
real test. README has the full walkthrough including the IAM step that bites
people. Locally you can at least do `docker build -t staruniverse . && docker
run --rm -p 8080:8080 staruniverse`.

**3. Thai has never been seen rendered.** No Thai font in the container, so
every screenshot here would have been tofu. The strings are all in
`src/ui/i18n.js` (interface) and `src/ui/story.th.js` (fiction), 155 of the
latter, and `npm run lang` proves coverage — but coverage is not quality.
Read it on a machine with a Thai face and fix what reads stiff.

---

## Things that were true and cost time to learn

Written down because each of these looked like something else first.

**The suite can measure the wrong thing and pass.** The rover floated by three
metres while a check called "it sits on the terrain" was green, because that
check compared the body's *centre* to the ground under the centre — which a
tilted body satisfies while hanging clear at every wheel. When a player
reports something the suite says is fine, suspect the check before the report.

**Frames.** The ground scene is in **metres** (1 unit = 1 m); everywhere else
is **kilometres**. The ship gets around this with a rig scaled by 1000. The
rover is authored in metres and added to `surfaceScene` directly. Mixing the
two silently produces objects 1000× the wrong size.

**Forward is `(-sin yaw, -cos yaw)`** — `Player` and `Rover` agree. The rover
*mesh* is authored nose-toward +Z, so it carries a half turn the controller
does not. Getting this wrong inverts steering in a way that looks like drift.

**Do not build an orientation from Euler angles you computed in another
frame.** Pitch and roll derived from ground samples are about the body's axes;
writing them into world components produced an attitude that did not match the
ground, and that was the *actual* cause of the floating rover — not noise, not
LOD, not the seating. Two tangents across the wheelbase and the track,
crossed, cannot get it wrong. See `Rover._settle`.

**`heightAt(x, z, lod)` does not smooth the way you would expect.** It returns
a coarse band plus a `fine` one, and the fine band is added whatever the LOD.
Raising LOD from 1 to 8 changed the measured roughness under the wheels by
almost nothing. If you need the field smoothed at the scale of an object,
average a footprint — `Rover._footprint` does.

**`land(body, {now: true})` refuses silently from orbit.** It wants the ship
inside 2.6 radii and returns a resolved promise otherwise, so a test that
picks a world and lands on it looks like it worked and leaves `landed` null.
`g.pose({bodyRef: body, dist: 1.6, ...})` first.

**`$SHORT_SHA` is empty for manual Cloud Build runs.** Only trigger builds
have a commit behind them. `cloudbuild.yaml` uses a `_TAG` substitution
instead; triggers should pass `_TAG=$SHORT_SHA`.

**Two `npm run verify` runs at once will fail each other.** They both want
port 4173 and the machine's CPU, and the failures look like timeouts in
`smoke`. Check for stray `vite preview` processes before believing a red run.

---

## Design commitments worth not undoing

- **Everything is seeded.** Same seed, same galaxy, same worlds, same seams,
  same faces in the bar. Prices are pure functions of `(seed, time)` so a past
  price can still be recomputed — the dated-news model depends on it.
- **Information travels at ship speed.** A dock quotes other stations as of
  when a freighter last left there. Nothing in the game is faster than a hull.
- **The ground is a place.** Seams have coordinates you must drive to. The
  drone only reaches what is under it. Do not re-add a global "mine here".
- **One reading needs the surface.** The `marker` revelation is gated on Hush
  markers surveyed on foot, and it is the only evidence unobtainable from the
  cockpit. That is what makes landing load-bearing rather than optional.
- **The rover can always crawl.** Slope resistance floors at `CRAWL_FLOOR`
  rather than reaching zero, because "go around is faster" and "you are stuck
  with no explanation" must not be the same experience. The chart says
  `STEEP — GOING AROUND IS FASTER` when the drive is fighting the grade.
- **English lives in its content module, Thai in the translation table**,
  keyed by the same id, with the English slot left empty where the content
  module already holds it. One copy of each sentence, so they cannot drift.
