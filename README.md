# STAR UNIVERSE

A procedural space trading & exploration game in the spirit of *Starflight 2:
Trade Routes of the Cloud Nebula*, running in a browser tab. WebGL2, no
assets — every star, world, ring system, nebula and derelict is generated from
a seed and shaded by hand-written GLSL.

Built on the engine of [**The Long Silence**](https://github.com/achimala/TheLongSilence)
by Anshu Chimala (MIT). The rendering, flight, planet, interior and cutscene
systems described under *How it renders* are his work, and they were built
against Starfield as an explicit visual benchmark. Everything under *The game*
— the economy, the nebula as navigable geography, the alien cultures,
prospecting, contracts, crew, and the mystery — is what this fork adds. See
[BRAINSTORM.md](BRAINSTORM.md) for the design and [TODO.md](TODO.md) for what
is still open.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # static bundle in dist/
```

---

## The game

Forty thousand years ago nine hundred inhabited worlds inside an eighty
light-year volume fell silent in four days. No debris, no radiation signature,
no sign of violence. The Hush left their cities lit, their orbits tidy, their
archives open — and seven instruments standing in seven systems.

You fly the survey vessel *Long Margin*, and you have to pay for the fuel.

**Trade.** Every station produces two commodities cheap and wants two dearly,
dealt around a shuffled deck so that what one station makes its neighbour
needs — there is a profitable run in every inhabited system, by construction.
Prices drift on seeded curves, so a price is a function of *when you ask*.

**Charts are cargo.** The nebula is not scenery: a density field thickens
between the stars, and fold cost scales with the dust on the path. Lanes thread
the banks. Flying an unsurveyed lane charts it, which makes it cheap for you
and sellable at every dock — exploration and the economy are one loop, not two.

**Information travels at ship speed.** Nothing here moves faster than a hull.
A dock's board quotes other stations at the price as of *when a freighter last
left there*, and the report says how old the news is. Outrun it and the margin
is yours.

**Four cultures, four postures.** The Registry holds the home cluster; the
Vess Combine, Korrim Lodges and Szethi Drift hold the deep. Hail one and the
first thing you send is a stance — friendly, businesslike, obsequious or
hostile — and it prices the whole conversation. Flatter a Vess trader and you
lose standing; grovel at a Korrim lodge and they cut the channel. Barter is a
walk toward a reservation price you never see.

**The ground pays.** Scan a world from orbit and its Archive entry becomes a
manifest with tonnages on it. Land, hold `F`, and the drone works a seam a
tonne at a time until it is spent — seams do not refill. Lucent goes to the
tank rather than the hold, because it is not cargo, it is range.

**The galaxy carries on without you.** Gluts, shortages, festivals, strikes
and blockades fire on their own schedule and move prices where they land.
Station boards offer hauls with deadlines, priced by distance and by whatever
danger is in the way. Bars have people in them who will change what your ship
can do.

**And there is a question.** Why is there a nebula here? Every culture has an
answer, no two agree, and exactly one is right. Nobody hands you the story: the
Archive collects what you are told and what your instruments find, and the
reading assembles itself. The ending is not a door opening.

### Controls

| | Desktop | Touch |
|---|---|---|
| Steer | mouse (click to capture) or arrow keys | left stick |
| Roll | `Q` / `E` | right stick, horizontal |
| Throttle | `W` / `S`, or scroll | right stick vertical, or `+` / `−` |
| Boost | `Shift` | `BST` |
| Scan | hold `F` | hold `SCAN` |
| Land / dock / lift off | `L` | — |
| Hail a contact | `C` | — |
| Work a seam (landed) | hold `F` | — |
| Fold drive | `J` | `FOLD` |
| Star map | `M` | `MAP` |
| Archive | `Tab` | `ARC` |
| Full stop | `X` | — |
| Camera | `V` | — |
| Frame stats | `P` | — |

Fold speed scales with distance from the nearest mass, so an approach
decelerates itself and drops you out just clear of the surface. Interstellar
transit is initiated from the star map — hover a system to select it — and
costs both drive charge and lucent, scaled by distance and by the dust in the
way. A dry tank strands you, so mine or buy before you go deep.

---

## How it renders

**Scale and precision.** One world unit is one kilometre. Systems span millions
of units while the ship is 0.1 units long, so the world uses a *floating
origin* — the ship sits at (0,0,0) and everything else is positioned relative
to it each frame — plus a logarithmic depth buffer. Custom `ShaderMaterial`s
opt into log depth by hand (`LOGD_*` chunks in `src/gfx/glsl/noise.js`); miss
that and two concentric spheres z-fight into triangular confetti.

**Planets are baked, not evaluated.** Twenty-odd octaves of simplex per pixel
per frame is not survivable on a phone, so each solid world is rendered once
into a cubemap holding linear albedo in RGB and terrain height in A. The
runtime shader is three texture taps for normals plus lighting. Cubemaps rather
than equirectangular maps: no pole pinch, no seam. The nearest world gets
re-baked at 1024²/face; everything else sits at 256².

**Atmospheres are single-scattering raymarches** through a spherical shell in
planet-radius object space, with Rayleigh coefficients set from real optical
depths (~0.05/0.10/0.23 at zenith) and a soft planetary penumbra on the light
ray so twilight fades instead of ending at a line.

**Auto exposure** runs entirely on the GPU: a 64² luminance reduction to 8² to
1², then a ping-pong adaptation target. The metric is a *sqrt* mean — a log
mean is the textbook choice but space frames are 90% black sky and the log of
near-zero drags the average to nothing, blowing out every shot.

**Post** is hand-rolled: bright prefilter → six-level dual-filter bloom with
attenuated wide mips → anamorphic streak → god rays and lens ghosts → composite
(radial blur, chromatic aberration inside the sampler, AgX tonemap, grain,
dither) → FXAA.

**Performance** holds 60fps by trading resolution, never features: the engine
watches frame time and moves the render scale between 0.62× and 2×.

---

## Layout

```
src/
  core/       Engine (renderer, quality tiers, frame loop), Input
  gfx/        PostFX, Sky (nebula cubemap + HDR star field), cube baking,
              greeble (the shared construction + surfacing kit), GLSL
  world/      generate (seeded universe), Planet, Star, Surface (the ground),
              Fleet (traffic), Station, Structures, Asteroids, Dust, shaders
              Prospecting — what a world holds, and what the drone can take
  econ/       Economy (commodities, markets, drifting prices, dated news),
              LaneGraph (nebula density, lanes, charts), Events (the shocks)
  ship/       Ship — procedural hull with injected panel-line PBR, flight model
              Outfitting — five systems, three tiers, visible on the hull
  game/       Game (world state, scanning, fold, floating origin), Director
              (cutscenes), Species, Comms (postures and barter), Rumors,
              Contracts, Crew, Mystery (the question), encounters, lore
  ui/         HUD, Codex, DockScreen, chart readout, stylesheet
  audio/      procedural WebAudio drone and engine
tools/        acceptance suites and capture tooling — see Verification
```

**Everything is a function of a seed, and most things of a seed and a time.**
Worlds, markets, lane density, deposits, station boards, who is drinking in a
bar, and which shock is running where all fall out of `mulberry32` rather than
out of stored state. That is not a style preference: the traffic reports quote
remote stations at *(now − travel time)*, so the past has to stay computable
forever or every dated quote in the game silently becomes a lie.

**One kit builds everything.** `gfx/greeble.js` owns the plate-seam law, the
weathering, the sun-bleaching, the grazing rim term and the five base materials,
and the player's hull, every freighter, every station and every derelict are
surfaced by it. Parts bake their transforms into their geometry and are welded
per material, so panel lines run continuously across part boundaries and a
hundred pieces cost six draws.

**Traffic is on a schedule, not a simulation.** Craft follow analytic paths
keyed to the clock, so they are exactly where they belong after a fold jump or a
two-minute pause. Each carries a *beacon* — a quad sized from view depth to hold
a constant few pixels — because sixty metres of hull four million kilometres
away is far below one, and a moving spark is what makes a system read as busy.

**The ground is a separate scene.** Orbit needs a whole planet with no visible
geometry; standing on one needs ten kilometres of terrain with no visible
sphere. `world/Surface.js` is a radial grid whose rings grow exponentially,
displaced by the same terrain law the orbital bake uses, bent down by the
planet's real radius, and hazed by the same scattering coefficients as the
atmosphere shell above it.

## Verification

Four acceptance suites, one per system, each written against the built bundle
and waiting on *game state* rather than on wall-clock time, so they pass on a
GPU in seconds and on a software renderer in minutes:

```
npm run verify      # builds, serves, runs all four, tears the server down
```

They test the *built* bundle, not the dev server — minification and asset-path
rewriting break things `vite dev` never shows — so each needs `vite preview` up
on 4173. `verify` handles that; run one on its own only if a preview server is
already listening:

```
npm run smoke       # boots, takes the helm, gets the ship under way
npm run trade       # docks, buys, crosses, sells, checks the ledger arithmetic
npm run nebula      # lane graph, charting, chart sales, price drift, dated news
npm run aliens      # territories, postures, barter convergence, rumor truth
npm run ground      # deposits, the drone, fuel burn, outfitting
npm run living      # events, contracts, crew
npm run mystery     # the question: gates, contradictions, the ending
```

They are written to be strict about the things that are easy to get quietly
wrong — that a seam depletes by exactly what was taken, that eleven tonnes of
lucent is not twelve, that a past price is still the same price when asked
again — and they have earned their keep: one caught an upgrade that charged the
player and fitted nothing, because an optional call swallowed a method that had
never been added.

### The judge gate

The original game was built by refusing to call the visuals done until an
independent critic said the frames stood beside Starfield's. That loop is
still here, and now covers this fork's interfaces too:

```
npm run judge       # ~25 frames into shots/judge/, plus tone statistics
```

Then hand `shots/judge/` and [`tools/JUDGE.md`](tools/JUDGE.md) to a reviewer
who has not been staring at the game — an independent agent will do. The brief
is deliberately adversarial and is not to be softened to pass: editing the
wording instead of the game is the tell. Interface frames get a second pass on
legibility alone, because a panel can be beautiful and unreadable — this
project has shipped that mistake and had to undo it twice.

The capture tools drive `npm run dev` and address `localhost:5173` literally.
If Vite says *"Port 5173 is in use, trying another one"* and serves 5174, then
something older is still on 5173 and every shot will be of **that** — stale
code, judged as current, with no clue in the output. Stop it first
(`lsof -ti:5173 | xargs kill`) rather than pointing the tools somewhere else.

```
node tools/play.mjs        # 17 interaction assertions (flight, scan, fold, jump)
node tools/survey.mjs      # screenshots every set-piece, reports fps/draws
node tools/probe.mjs "<js>" --shot out.png     # one expression, one frame
node tools/sheet.mjs a.png b.png --out s.png   # contact sheet — judge a set at once
node tools/levels.mjs shots/*.png              # tone statistics per frame
node tools/judgeset.mjs                        # rebuild the review set in shots/judge/
```

`levels.mjs` is the one that stops arguments. "It looks flat" is not
actionable; "0.00% of pixels clip and the 99th percentile is 165" is, and that
is exactly what the game measured before the highlight range was fixed.

Every tool boots through `tools/boot.mjs`, which exists because the dev server
hot-reloads on any source edit: a capture that started before the reload
finishes happily and screenshots the title card, with a plausible frame rate
printed next to it. It verifies the overlay is actually gone and starts over if
it is not, and the multi-shot tools re-check between shots.

Phones are turned away at the door with a short message rather than served a
reduced build — every feature worth looking at here is one a handset cannot
afford, and a bad first impression is worse than none.

Both drive a real headed Chromium with GPU rasterisation against `npm run dev`.
