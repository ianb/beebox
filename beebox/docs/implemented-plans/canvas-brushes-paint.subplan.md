---
title: "canvas-loop: colour variation within a stroke, smudge and wet paint"
status: implemented
workstream: canvas-brushes
issues: []
---
# canvas-loop: colour variation within a stroke, smudge and wet paint

Subplan of [canvas-brushes.md](../plans/canvas-brushes.md). The effects subplan
(`beebox/docs/implemented-plans/canvas-brushes-effects.subplan.md`) left
klad's per-dab colour variation and smudge/wet paint out of scope. Asked which
of the remaining klad features would improve agent drawings, I named these two;
the boxholder answered "ok, sure, add just those" (2026-11-12). The boxholder
also said they are "not concerned with user editing or anything, like undo
history".

## Design

No design section: canvas-loop is a drawing library whose user is a sketch
author (an agent); nothing here changes what a box user meets.

## Smallest fix and budget

- Smallest version of colour variation: one brush field, `lightJitter`, on
  stamp brushes only. Chosen: `hueJitter` and `lightJitter` on stamp and
  bristle brushes. A bristle brush whose bristles carry slightly different
  shades is the main painterly gain; the hue field costs one more line in the
  HSL step.
- Smallest version of smudge: a `smudge` preset that drags the drawing under
  it. Chosen: one new brush kind, `smear`, with a `color` field: at 0 it only
  smudges, above 0 it also lays down its own colour, mixed with what it picks
  up (wet paint). Two presets, `smudge` and `wet`.
- Estimate: ~220 source lines, ~150 test lines, ~60 doc lines, one example.

## Stated preferences this plan trades against

- **Data over modal state** (canvas-brushes.md, styles decision 2026-11-11):
  both features are plain brush fields and presets, validated like the rest
  (`canvas-loop/src/core/brush/presets.ts`, `KIND_FIELDS`).
- **Determinism** (`canvas-loop/BRUSHES.md`, "## Determinism"): jitter comes
  from the mark seed (`rand(seed, { channel, index })`,
  `canvas-loop/src/core/brush/random.ts`), so a mark keeps its colours when it
  is re-rendered. Smear reads pixels already drawn, which are deterministic in
  one runtime; across runtimes the same caveat as stroke strength applies.
- **Bias toward strict**: a gradient paint with jitter or with `color > 0` is
  an error, rather than a silent fallback to one colour.
- **No pixel read-back in the browser per frame** (`core.ts` comment: *"Read
  the mark's strongest pixel back … costly in a browser, where it stalls the
  GPU"*): smear moves pixels with `drawImage` between canvases only, never
  `getImageData`.

## What already exists

- Every brushed mark runs through `renderMark`
  (`canvas-loop/src/core/brush/render/mark.ts`). The kinds paint **coverage**
  in black (`kinds.ts:1`: *"Each paints COVERAGE (black, varying alpha) onto
  the mark's layer"*); grain is cut out with `destination-out`; `colorize`
  fills the coverage with the paint using `source-in`; the mark is composited
  once at the brush opacity.
- Stamp dabs: `paintStamp` loops over samples with per-dab `rand` for size and
  scatter (`kinds.ts`, channels 11 and 12). Bristles: `makeBristles` gives each
  bristle seeded traits (channels 21–24).
- The painter keeps a stack of **contexts** (`core.ts:44`: *"The bottom entry
  is the canvas; `group` pushes its layer's context"*). The root canvas has no
  `LayerImage`, so no code can `drawImage` from it today. Both runtimes build
  the painter in one place each: `browser/runtime/browser-view.ts:26` and
  `headless/surface.ts:40`.
- No colour parser exists in `canvas-loop/src` (searched for `hsl` and
  `parseColor`; only the generated sound data matched).

## Prior art (external)

- **klad** (`docs/format.md`, read 2026-11-12, MIT; via the effects subplan):
  brushes with per-dab colour variation, and smudge/wet tools that mix paint
  already on the canvas.
- **Smudge in raster painters** (Krita's smudge engine, MyPaint's
  `smudge`/`smudge_length` settings, from memory, not re-verified): the brush
  carries a small colour buffer; at each dab it deposits the buffer and then
  mixes in what is under the dab. `smudge_length` is how long the carried
  colour lasts. This plan uses the same model with a patch of pixels instead
  of a single colour, so detail is dragged, not only colour.

## Ontology

- **Jitter** (`hueJitter`, `lightJitter`): per dab (stamp) or per bristle,
  the paint colour moves by up to ±`hueJitter` degrees of hue and ±`lightJitter`
  of HSL lightness (0..1). Seeded by the mark seed.
- **Smear** (brush kind `"smear"`): dabs along the path that move the drawing
  under the brush forward.
  - `tip`, `spacing`, `sizeByPressure`, `opacityByPressure`, `grain`, `opacity`
    as for stamp brushes.
  - `strength` 0..1: how much of the carried patch is laid down at each dab,
    and how long it lasts (high = long drag).
  - `color` 0..1: how much of the brush's own paint is mixed into its load at
    each dab. 0 = pure smudge (the stroke colour is ignored), above 0 = wet paint.
- **Presets:** `smudge` (smear, `color: 0`), `wet` (smear, `color: 0.35`,
  hard-edged enough to read as paint).

## Tracks / scope

1. **Colour jitter.**
   - `colour.ts`: normalise a CSS colour through a context (`ctx.fillStyle =
     c; ctx.fillStyle` gives `#rrggbb` or `rgba(…)` in both runtimes), to RGB
     and HSL and back.
   - `hueJitter` (0..180) and `lightJitter` (0..1) fields on stamp and bristle
     brushes, default 0, validated in `KIND_FIELDS`.
   - When a brush has jitter: the kind paints each dab or bristle in its own
     colour instead of black, and `renderMark` skips `colorize`. Grain and the
     single composite are unchanged. A gradient paint with jitter is a
     `SketchUsageError`.
2. **Painter surfaces.** `#ctxStack` becomes a stack of `Layer`s; the
   constructor takes the root canvas as a `Layer` (`{ ctx, image }`). Both
   facades already hold the canvas. `PainterCore.ctx` is unchanged for callers.
3. **Smear kind.** In `renderMark`, a `smear` brush skips the coverage layer
   and paints dab by dab onto the target:
   - pickup patch (pooled, dab-sized) ← target pixels at the first dab, or the
     paint colour when `color` is 1;
   - each dab: dab layer ← pickup; `destination-in` the tip (hard disc or
     radial gradient); grain `destination-out`; draw onto the target at
     `flow × opacity`; then pickup ← mix of itself and the target under the
     new dab (`1 − strength`), plus the paint colour (`color`).
   - Clip, transform and group follow the target as for other marks. A smear
     brush with `erase` or a non-normal blend is a `SketchUsageError`. Faint
     checks skip smear marks (they move existing paint).
4. **Docs and example.** BRUSHES.md presets table, field table, a short
   "Smudge and wet paint" section; TEA.md style keys if they list fields;
   CHANGELOG; a `brush-mixing` example (bristle with jitter, smudge across a
   boundary, wet paint over a colour); box docs regenerate from BRUSHES.md.

## Could this be simpler?

The simplest version is `lightJitter` on stamp brushes and a pure `smudge`
preset. The fuller version adds hue jitter and per-bristle colour (the bristle
brush is the preset agents use for painted looks, so variation there is where
it shows) and the `color` field, which turns the same smear engine into wet
paint for one extra fill per dab. Both additions reuse the same machinery; no
second engine.

## Subplans

none

## Failure modes

- **Smear on an empty area** drags transparent pixels: it erases nothing (dab
  draws transparent with source-over), so the mark is invisible. Docs say a
  smudge needs paint under it; the transcript gets no warning (faint checks
  skip smear).
- **Smear across a group boundary:** inside `group`, the target is the group
  layer, so smudge only moves the group's own paint. Documented.
- **Pickup at the canvas edge:** `drawImage` source rects outside the canvas
  are clipped by the runtime; the pickup layer is cleared first, so outside
  reads are transparent.
- **Cost:** about four small `drawImage` calls per dab. A 400-pixel stroke at
  width 20 and spacing 0.15 is ~130 dabs, ~520 calls, each on a ~20×20 patch.
  The browser runtime draws on change only (earlier perf work), so this cost
  is per drawn frame, not per tick.
- **Colour normalisation** of an invalid CSS colour leaves `fillStyle`
  unchanged; check by setting a sentinel first and treat "unchanged sentinel"
  as an error naming the colour.

## Agent-flow / user-flow edge cases

- An agent sets `color: 0` but expects its stroke colour to show: the docs
  table says smudge ignores the stroke colour; `wet` is the preset for paint.
- An agent animates a smudge every frame over a redrawn background: each frame
  redraws then smudges, so the result is stable (the smear reads this frame's
  pixels). Determinism check covers it.

## NOT in scope

- Colour that changes along the stroke (start → end colour) and jitter on ink
  brushes (no dabs to vary).
- Pressure-sensitive pickup, canvas wetness that persists between marks,
  watercolour bleeding.
- Undo, editing, or any person-facing painting (boxholder: "not concerned with
  user editing").

## Open design questions

None blocking. Preset values are tuned by rendering the example.

## Knowledge audits

Skip: canvas-loop guidance is dev-repo documentation that drawing agents read
directly; earlier drawing rounds tested it that way.

## What will hold this after it ships

- Unit tests (`canvas-loop/test/`):
  - jitter 0 renders the same pixels as before (the colour path does not
    change unjittered marks);
  - jitter gives a stamp mark more than one colour, and the same colours on a
    second render;
  - gradient + jitter, gradient + wet, smear + erase are errors;
  - a smudge dragged from a red square into white leaves red pixels past the
    square's edge, and does not change pixels outside its reach;
  - `color: 1` with `strength: 0` paints the stroke colour (wet degenerates to
    a stamp).
- `gallery check` determinism over the new example.

## Implementation notes (2026-11-12)

- **@napi-rs/canvas 1.0.2 → 1.1.0.** In 1.0.2, after a canvas was read as a
  `drawImage` source while its context had an open `save()`, a later
  `drawImage` of that canvas was deferred, so clearing it afterwards (the
  layer pool's release) blanked the copy. A smear inside a `group` lost the
  whole group. Reproduced with @napi-rs/canvas alone; 1.1.0 and 1.1.1 draw it
  correctly. 1.1.1 is younger than the workspace's `minimumReleaseAge`, so
  1.1.0. Side effect: `ctx.font` reads back without `normal`; one text test's
  expected string changed.
- **Pickup source.** Wet paint that picked up the live drawing picked up its
  own fresh paint and turned into flat stroke colour. Wet paint now picks up
  from a copy of the reachable area taken before the stroke (a third scratch
  layer, `before`). A smudge still picks up the live drawing, so it keeps
  dragging what it smeared; with a copy, adjacent smudge strokes left
  separate teeth instead of blending.
- `LayerPool.scratch()`/`paintScratch()` became `scratch(name)` with names
  `"mark" | "paint" | "before"`.
- Preset values after looking at renders: `smudge` strength 0.93; `wet`
  strength 0.7, color 0.3, spacing 0.1.

## Review decisions (cross-model plan review, codex gpt-6-sol, 2026-11-12)

The review read the plan and the in-progress code.

- **Named colours fail with jitter in the headless runtime:** rejected for
  @napi-rs/canvas 1.1.0. A probe shows `red` → `#ff0000`, `#abc` →
  `#aabbcc`, `hsl(10 60% 45%)` → `#b8452e`. A test now pins a name, a short
  hex and `hsl()`.
- **Smear applies `opacity` per dab, not per mark:** accepted as a documented
  exception (BRUSHES.md field table). A smear is sequential read-modify-write
  on the target, so it has no single composite.
- **Pickup after laying a dab picked up its own deposit:** fixed. Each dab
  now mixes the load with what is under it first, then lays it, so
  `strength: 0` changes nothing.
- **Jitter with a translucent colour darkened per dab:** fixed. Jittered dabs
  are opaque; the colour's alpha is applied once when the mark is composited.
  Test: a translucent jittered airbrush lands within 8/255 of the plain one.
- **Invalid wet colour painted black:** fixed; the wet colour is parsed first
  and an unreadable colour is an error.
- **A one-dab wet mark painted nothing:** fixed; the first sample now lays a
  dab. Tested.
- **Full-canvas scratch layers crop a dab wider than the canvas; no tests
  under clip, transform or pixel ratio 2:** accepted risk. A brush wider than
  the canvas is not a real use. Group behaviour is tested (it found the
  @napi-rs/canvas bug above).

## Review decisions (cross-model code review, codex gpt-6-sol, 2026-11-12)

- **A smudge made translucent paint more opaque** (laying the load with
  source-over): fixed. A dab is now an exact premultiplied lerp: erase the
  target by the tip mask, then add the masked load with `lighter`. Test: a
  `strength: 0` smudge over 20%-alpha red leaves it at 20%. A browser's
  `destination-in` clears outside the drawn rect, so the mask is used on the
  target before the load is masked.
- **The faint-mark check ignored a jittered colour's own alpha:** fixed.
- Found while checking the lerp fix: a smudge starting off the canvas picked
  up transparency and erased what it crossed. Pickup now reads the nearest
  patch inside the canvas.
- No second review round: the fixes were checked with tests and by rendering
  the example headless and in a browser.

## Implementation order

1. Track 2 (painter surfaces) with existing tests green. Commit.
2. Track 1 with tests. Commit.
3. Track 3 with tests. Commit.
4. Track 4, rendered and looked at. Commit. Cross-model review; report.

## Rollout shape

Done means `pnpm --dir canvas-loop test`, `typecheck`, `lint` and
`gallery:check` pass, the example frames have been looked at, and beebox
`doc-check`/`layout-check` pass. No migration: new fields default off.
