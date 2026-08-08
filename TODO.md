# Outstanding

Things found and deliberately deferred, so they are not rediscovered from
scratch later.

## From the first judge run (24 frames, MacBook Air, M3 build)

**The full-screen panels use almost none of the display range.** `levels.mjs`
on the review set:

| frame | mean | p99 | clip% | black% |
|---|---|---|---|---|
| `ui-a-market` | 11.3 | 49 | 0.000 | 37.7 |
| `ui-c-comms` | 9.3 | 38 | 0.000 | 49.1 |
| `ui-b-chart` | 23.8 | 161 | 0.043 | 0.8 |

`.panel` lays `rgba(2,6,11,.88)` over an already-dark scene, so a third to a
half of those frames is pure black and the brightest pixel in them is under
50/255. Legible in a dark room, mud in daylight. The chart frame is healthy
because the hologram sits behind it. Worth lifting the panel ground, or
giving the table rows their own lighter surface.

**Two performance dips.** `z-landed-dusk` at 15fps, and all three interface
frames at 21fps. The interface cost is probably `backdrop-filter: blur(22px)`
compositing a full-screen blur; `ui-b-chart` also carries the set's highest
draw count at 394. Dusk landing is a separate question — likely the
atmosphere raymarch at a grazing sun angle.

**Not yet reviewed by eye.** The frames live on the developer's machine; no
adversarial pass has been run against them yet. See `tools/JUDGE.md`.

## Smaller

- `m-derelict` framed `Ithirka STATION B` rather than a derelict — check the
  shot's subject selection when a system has no derelict.
- `g-hot` skips in systems with no molten world, which is correct but means
  the review set silently varies in size between seeds.
