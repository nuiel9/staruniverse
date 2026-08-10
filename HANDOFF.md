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

### Open, in the order I would take them

**1. Sites are placed without checking the route.** `Sites.at()` picks a
bearing and a range and puts a marker there. Nothing guarantees a drivable
path exists — a marker can sit behind a face too steep to climb. The rover can
now always crawl (see below), so nothing is strictly unreachable, but a site
that takes ten minutes of switchbacks is a bad site. Worth sampling a few
candidate offsets at placement time and preferring the one with the gentler
approach.

**2. `mystery.mjs` has a stale assertion.** It checks "all five readings
reachable" and passes, but there are six now and it counts *found* rather than
total. It is a weaker claim than its name suggests. `REVELATION_COUNT` is
exported from `src/game/Mystery.js` for exactly this.

**3. Cloud Run has never actually run.** `Dockerfile`, `nginx/` and
`cloudbuild.yaml` are written and the YAML parses, but this container had no
Docker, so no image was ever built. The first `gcloud builds submit` is the
real test. README has the full walkthrough including the IAM step that bites
people. Locally you can at least do `docker build -t staruniverse . && docker
run --rm -p 8080:8080 staruniverse`.

**4. Thai has never been seen rendered.** No Thai font in the container, so
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
