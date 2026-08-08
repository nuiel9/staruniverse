# Star Universe — Brainstorm

*A Starflight 2-style trading & exploration game, built on the engine of
[The Long Silence](https://github.com/achimala/TheLongSilence) (MIT).*

---

## 1. The pitch

**You are a surveyor-trader in a vast nebula where information travels no
faster than a ship.** Chart fold-lanes through the clouds, mine dead worlds,
haggle with alien species who each want different things, and outrun the news
to buy low where the price hasn't caught up yet — while piecing together, one
rumor at a time, why the nebula is there at all.

One sentence: *Starflight 2's living economy and alien diplomacy, inside The
Long Silence's photorealistic, seamless, walkable universe.*

---

## 2. What each source brings

### The Long Silence (the engine we inherit)

Audit of the actual codebase (~33k lines, Three.js + hand-written GLSL, no
external assets):

| Already built, production quality | Where it lives |
|---|---|
| Seamless flight: cockpit ↔ walk the ship ↔ fly ↔ land on planets | `src/ship/*`, `src/world/Surface.js` |
| Fold drive with mass-scaled speed (auto-decelerating approaches) | `src/game/Game.js`, `src/gfx/FoldTunnel.js` |
| Deterministic procedural universe from one seed | `src/world/generate.js` |
| Baked-cubemap planets, raymarched atmospheres, rings, moons | `src/world/Planet.js`, `planetBakeShader.js` |
| Walkable ship interior with holo-screens and holo-map | `src/ship/Interior.js`, `HoloScreen.js`, `HoloMap.js` |
| Orbital stations (visual only — no docking gameplay) | `src/world/Station.js` (3,036 lines!) |
| Ambient ship traffic on analytic schedules (freighters, couriers, tugs) | `src/world/Fleet.js` |
| One-shot hail system with per-trade dialogue lines | `src/game/encounters.js` |
| Cutscene director (live camera, world keeps simulating) | `src/game/Director.js` |
| Full custom post pipeline: bloom, god rays, AgX, auto-exposure, FXAA | `src/gfx/PostFX.js` |
| Scan mechanic, codex/archive UI, HUD, directive system | `src/ui/*`, `src/game/directives.js` |
| Dev tooling: screenshot capture, judge sets, perf probes, smoke tests | `tools/*` (40+ scripts) |
| Blender hard-surface modeling skill for Claude | `.claude/skills/blender-hardsurface` |

**What it does NOT have** (verified by grep — zero hits for credits, buy, sell,
price, market, inventory): no economy, no docking gameplay, no persistent
player state beyond story flags, no dialogue trees, no factions, no crew, no
ship outfitting, no combat, no resource collection.

The Long Silence is a *mood* — quiet, melancholy, one ship in an empty
graveyard. It's the body. Starflight 2 is the *brain* we transplant in.

### Starflight 2: Trade Routes of the Cloud Nebula (the design we chase)

The 1989 classic, decomposed into its load-bearing systems:

1. **Commodity trading** — each alien race values goods differently; buy
   cheap from one culture, sell dear to another; prices drift with supply.
2. **Bartering** — prices aren't fixed; you haggle, counteroffer, and your
   reputation and skill change the outcome.
3. **The nebula as geography** — dense clouds gate travel; finding routes
   *through* them is the "Trade Routes" of the title.
4. **Alien races with personality** — each species has a communication
   posture (friendly/hostile/obsequious), territory, grudges, and rumors.
5. **Rumors as quest engine** — the story isn't told in cutscenes; aliens
   drop coordinates, hints, and lies. You triangulate the mystery yourself.
6. **Planet exploration** — orbit-scan for minerals/lifeforms, land, drive
   a terrain vehicle, fill your cargo hold from the ground itself.
7. **Crew of six with skills** — science, navigation, engineering, comms,
   medical; training them is a spend-money-get-capability loop.
8. **Ship outfitting** — engines, shields, cargo pods; every upgrade visibly
   changes what routes are viable.
9. **Fuel as tether** — every jump costs fuel (shyneum); range is a resource
   you mine, buy, and budget.
10. **An evolving galaxy** — events fire on a timeline whether you're there
    or not; the world doesn't wait.

---

## 3. Design pillars

1. **Show, don't tell** (kept from TLS). No tutorial popups. The first trade
   route is taught by a freighter you can literally follow.
2. **Knowledge is the real cargo.** Charts, prices, and rumors are all
   tradable. Exploration and trading aren't two loops — they're one.
3. **Information moves at ship speed.** No FTL comms (this *is* "the long
   silence" — keep the name's soul). News, prices, and reputations propagate
   through the lane graph at NPC-freighter speed. You can outrun the news.
4. **Seamless everything** (kept from TLS). Docking, trading, landing, and
   talking happen in-world — director-driven cameras, no loading screens, no
   modal full-screen menus where a holo-screen in the cockpit would do.
5. **AAA visual bar** (kept from the workflow). The adversarial critic agent
   stays; nothing ships that the judge wouldn't mistake for Starfield.

---

## 4. The core loop

```
        ┌────────────────────────────────────────────────┐
        │                                                ▼
   DOCK at station ──► read local prices, hear rumors, take contracts
        ▲                                                │
        │                                                ▼
   SELL cargo, charts   ◄──  FLY a lane (or chart a new one through the nebula)
   & survey data             │
        ▲                    ├─► ENCOUNTER traffic, pirates, aliens → barter/talk/flee
        │                    │
        │                    └─► DIVERT to a rumor: mine a hotspot, salvage a
        │                        derelict, scan an anomaly
        └────────────── with a fuller hold and an emptier fuel tank
```

Minute-to-minute: fly, scan, dock, haggle.
Hour-to-hour: open a new region of the nebula, meet a new species, upgrade.
Campaign: follow the rumor chains to the nebula's origin — the endgame
mystery re-uses TLS's "seven artifacts" skeleton with SF2's rumor delivery.

---

## 5. Systems brainstorm

### 5.1 The nebula as the map

- The play space is one large nebula region (~40–80 systems), procedurally
  placed but *clustered*, with dense dust banks between clusters.
- **Fold speed already scales with proximity to mass** in TLS. Extend the
  same law to nebula density: folding into a dense bank chokes your drive to
  a crawl and drinks fuel. Thin corridors — *lanes* — thread the banks.
- Lanes are discovered by flying them slowly the first time (survey), by
  buying charts, or by shadowing NPC freighters who already know them.
- **A chart is an item.** Sell your newly-surveyed lane at a station and NPC
  traffic starts using it — you watch the universe adopt your discovery
  (Fleet.js schedules make this cheap: add the lane to the analytic paths).
  This is the single best "exploration = economy" fusion available to us.

### 5.2 Economy

- Every system's supply/demand falls out of the seed: ice giants export
  volatiles, tectonic worlds export metals, inhabited stations demand food,
  medicine, luxuries; refineries turn ore into alloys, etc. (~12–16
  commodities — SF2 had about that many; more is bookkeeping, not depth.)
- Price at a station = base value × local scarcity × *staleness of news*.
  Prices propagate along the lane graph at freighter speed. A glut at A
  lowers prices at B only when a ship has had time to carry the news.
- Player-visible price table shows the *date of the information* — prices
  you learned two jumps ago are marked stale. Arbitrage on information
  latency is the expert-level game.
- Events (mine collapse, plague, festival, pirate blockade) fire on a
  timeline and inject shocks that ripple outward — the SF2 "evolving
  galaxy," implemented as scheduled events on the lane graph.

### 5.3 Alien species & diplomacy

- 4–6 species, each with: a territory in the nebula, a visual language for
  their ships/stations (distinct silhouettes — Fleet.js is built for this),
  a trade profile (what they overvalue/undervalue), and a **posture system**
  straight from SF2: you choose a stance (friendly / businesslike / hostile /
  obsequious) and each species responds to stances differently.
- Dialogue is data-driven trees seeded with rumor tokens. TLS's encounter
  system ("say something only they could say") becomes the writing bar.
- **Rumors are structured data**: `{subject, location, truthiness, source}`.
  Aliens trade them like goods. Some are lies. Cross-referencing two rumors
  about the same subject is how the player finds story beats — no quest
  markers, just the codex assembling what you've heard.

### 5.4 Bartering

- No fixed prices with aliens — an offer/counteroffer minigame (3–5 rounds
  max, readable tells per species). Reputation and your comms crew skill
  widen the band. With human stations, fixed prices for speed; with aliens,
  haggling is the culture.

### 5.5 Crew

- SF2's six roles, but **embodied**: crew are NPCs who live at stations of
  your walkable interior (nav table, engineering bay, med alcove — Interior.js
  already has the rooms). Hire them in station bars; each gives a passive
  (scan yield, fold efficiency, barter band, repair rate) and — cheaply —
  ambient dialogue lines that double as the rumor/tutorial channel.
- Walking through your ship finally has a mechanical reason: you talk to
  your crew.

### 5.6 Planetside resource loop

- Orbit scan (existing mechanic) reveals mineral hotspots on the baked
  height cubemap. Land (existing mechanic) near one, deploy a **survey
  drone** — a short directed activity, not a chore: guide the drone, pick
  which deposits to take, cargo mass is finite.
- Terrain vehicle à la SF2 is a stretch goal; the drone gets 80% of the
  loop for 20% of the work, and Surface.js terrain is already there.
- Lifeform sampling on rare biotic worlds sells to one species at absurd
  margins — and one species finds it deeply offensive. Choices.

### 5.7 Ship outfitting

- `hull.js` builds the ship parametrically — so upgrades are **visible**:
  cargo pods clamp onto the spine, bigger fuel tanks fatten the hull,
  scanner masts extend. Mass changes handling and fold cost for real.
- Upgrade tree kept flat: engines, fuel, cargo, scanner, shield, drone —
  each 3 tiers. No skill trees; SF2's charm is that money → capability.

### 5.8 Fuel

- One special substance (call it **lucent** — mined only in dangerous dense
  nebula pockets, tradable, and — late game — revealed to matter to the
  story, echoing SF1's endurium twist). Fuel budgeting makes lane charts
  and route planning matter; running dry mid-bank is the game's survival
  edge case (limp on emergency ion, or burn cargo mass).

### 5.9 Docking & stations

- Stations are already gorgeous; give them gameplay: request docking on
  approach → Director flies the autodock cutscene (the docking arms and
  berths already exist in the model!) → station interface as an in-world
  holo-screen: MARKET / OUTFIT / BAR (rumors, crew, contracts) / DEPART.
- Bar scene can be audio + text over an interior-lit window shot — full
  walkable station interiors are a v2 luxury, not MVP.

### 5.10 Combat (deliberately minimal)

- Pirates as *route risk*, priced into the economy: dangerous lanes have
  the margins. An encounter is: hail → demand → pay / flee (boost + fold) /
  fight (simple broadside exchange with shield/hull bars). SF2's combat was
  shallow too — that's fine, it's a trading game. Defer past MVP.

### 5.11 Story

- Keep TLS's structural spine — seven ancient instruments, a vanished
  precursor civilization, a final aperture — but deliver it SF2-style:
  no directive breadcrumbs; every beat is found by cross-referencing alien
  rumors, and each species holds a different, contradictory piece of the
  truth. The nebula itself is the crime scene: *why is there a nebula here,
  and what did it used to be?* (Answer connects to lucent/fuel — you've
  been burning the evidence.)

---

## 6. Tone: reconciling the two games

TLS is elegiac and empty; SF2 is busy and mercantile. The merge: **the
nebula's edge is alive** (stations, traffic, chatter, markets) **and its
heart is the long silence** (the deeper you chart, the quieter and stranger
it gets, until you're back in TLS's mood for the finale). Density of
civilization becomes a literal gradient across the map — and a difficulty
curve, a price curve, and an emotional arc all at once.

---

## 7. Technical plan

**Fork, don't rewrite.** TLS is MIT; we fork it into this repo, keep the
LICENSE and credit prominently, and build on top. The engine layers
(Engine, PostFX, Planet, Surface, Station, Fleet, Interior, Director) stay
nearly untouched; the game layer grows.

New modules, mapped onto the existing architecture:

```
src/econ/Market.js        commodities, station inventories, price model
src/econ/LaneGraph.js     nebula density field, lanes, news/price propagation
src/econ/Cargo.js         player hold, mass → handling/fold coupling
src/game/Species.js       race definitions, territories, trade profiles
src/game/Dialogue.js      posture system, trees, barter minigame
src/game/Rumors.js        rumor tokens, codex cross-referencing
src/game/Contracts.js     delivery/survey missions
src/game/Events.js        timeline shocks on the lane graph
src/ship/Outfitting.js    parametric upgrade attachments on hull.js
src/ship/Crew.js          hiring, passives, interior NPC placement
src/world/Docking.js      berth approach, Director autodock sequences
src/world/Mining.js       hotspots on baked cubemaps, survey drone
src/ui/StationScreen.js   market/outfit/bar holo-interface
```

Reuse notes:
- `generate.js`'s mulberry32 seeding extends naturally to economy seeds.
- `Fleet.js`'s analytic schedules are *ideal* for economy traffic — a
  freighter's schedule IS the news-propagation event.
- `encounters.js`'s hail plumbing is the entry point for dialogue.
- `directives.js` + `Codex.js` become the rumor journal.
- `tools/` (capture, judge, perf, smoke) is our CI for the visual bar.

Performance guardrail: the economy is graph math on ~80 nodes — trivial.
The risk is draw calls from busier systems; Fleet.js's template/instance
discipline must extend to every new ship class.

---

## 8. Milestones

- **M0 — Transplant.** Fork TLS in, rename, boot at 60fps, smoke tests
  green. (Days)
- **M1 — First trade run.** Docking + credits + cargo + static prices at
  two stations in one system. The moment "buy low here, sell high there"
  works, the game exists. (First real milestone)
- **M2 — The nebula.** Density field, fold-choking, lanes, chart-selling,
  price propagation at freighter speed. The signature systems.
- **M3 — The aliens.** Species, postures, dialogue, bartering, rumors.
- **M4 — The ground.** Orbit-scan hotspots, drone mining, outfitting, fuel.
- **M5 — The living galaxy.** Events, contracts, crew, pirates.
- **M6 — The mystery.** Story beats wired to rumors, endgame, full
  critic-agent visual pass, trailer.

Each milestone ends with the judge-subagent screenshot review (the repo's
`tools/judgeset.mjs` pipeline) — same adversarial-critic workflow that
built TLS, now pointed at Starfield *and* at legibility of the trade UI.

---

## 9. Build workflow (from the original process, kept)

1. **Adversarial critic subagent** — compares our screenshots to AAA space
   games; visual work isn't done until the judge signs off. Extend the
   rubric: economy screens must also pass a *readability* judge.
2. **Blender MCP + `blender-hardsurface` skill** (already in `.claude/`) —
   for hero assets: alien ship classes, station berth interiors, the drone.
3. **`tools/` suite** — smoke tests, frame-sheet dumps for artifact hunting,
   perf probes. Wire into every milestone.

---

## 10. Open decisions (recommendations attached)

1. **Scope of combat** — recommend: defer to M5, keep minimal forever.
2. **Terrain vehicle vs. drone** — recommend drone for MVP; vehicle only if
   the ground loop proves fun.
3. **Multiplayer/leaderboards** — recommend: no. Single-player, seeded runs
   are shareable by seed string instead.
4. **Name** — repo says *Star Universe*; consider a title in the TLS
   naming register: *The Loud Nebula*? *Trade Winds*? *Lucent*? *The
   Chartered Deep*? (My pick: **Lucent** — it's the fuel, the mystery, and
   the light in the clouds.)
5. **How much TLS story to keep** — recommend: keep the skeleton (seven
   instruments, precursors), rewrite all surface lore so this is its own
   fiction, not a sequel.
