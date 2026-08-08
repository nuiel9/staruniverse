# The judge's brief

Hand this, and the contents of `shots/judge/`, to a reviewer who has not
worked on the game. An independent agent is fine; the author is not, and
neither is anyone who has been staring at the frames all day.

Generate the set with `npm run judge` (see `tools/judgeset.mjs`). It writes
~25 frames: the world set-pieces, two landings including one at dusk, and the
three interfaces this fork added.

---

## The standing instruction

> You are an impartial reviewer. Open reference screenshots of AAA space games
> — Starfield above all, and Elite Dangerous or No Man's Sky where they are
> stronger — and compare them against the frames in `shots/judge/`.
>
> Your job is to find what is worse and say so precisely. Name the frame, name
> the element, say what is wrong with it, and say what you would expect
> instead. "Looks good" is not a review; if a frame is genuinely equal to the
> reference, say which reference and why.
>
> Assess, in detail: **meshes** (silhouette, proportion, panel-line density,
> anything that reads as procedural or blocky), **textures** (resolution,
> tiling, wear, the plasticky-shiny failure mode), **lighting** (key/fill
> ratio, terminator softness, shadow presence, bounce), **shader effects**
> (atmosphere, bloom, streaks, god rays, grain — and whether any of them are
> doing too much), **composition** (scale cues, horizon, negative space),
> **interfaces** (legibility first, then style), and **artifacts** (z-fighting,
> banding, aliasing, moire, crawling patterns, clipped highlights, black
> crush).
>
> Verdict per frame, then one overall: does this look like a shipped AAA space
> game at 60fps in a browser tab? If not, what are the three highest-leverage
> fixes?

**The rule that makes it work:** the goal is not done until the judge says the
frames stand beside the references. Do not soften this brief to pass it. If
you find yourself editing the wording rather than the game, that is the tell.

---

## The second dimension: legibility

The original benchmark was purely visual, because the original game had almost
no interface. This fork has a market, a barter negotiation and a chart, and
they fail differently: a panel can be beautiful and unreadable. Every frame
named `ui-*` gets a second pass, ideally from a reviewer looking at it cold:

- Read the frame at 100% and at 50%. What can you not make out?
- Is any text clipped by a screen edge, or overlapping something bright?
- Is the smallest text at least ~16 device pixels tall?
- Can you tell, without being told, what the screen wants you to do next?
- Is the most important number on the screen also the most prominent?

Two failures this project has already shipped and had to undo, worth checking
for by name:

- **Text on a world-space panel.** The display shader blooms bright strokes
  outward and its scan patterns chew small type, so raising contrast made
  things *worse*, not better. The readout is DOM now. Anything that has to be
  read should be.
- **Framing that depends on the window.** A quad placed to look right at 16:9
  hangs off the top of a 2:1 window. Judge every interface frame at more than
  one aspect ratio.

---

## Running it

```
npm run dev            # the tools drive the dev server on :5173
npm run judge          # ~25 frames into shots/judge/, plus tone stats
```

Run it on a machine with a real GPU. Under software rendering the frames take
minutes each, come out noisier than the game actually is, and will earn you a
verdict about the renderer rather than about the game.
