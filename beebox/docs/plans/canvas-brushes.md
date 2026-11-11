---
title: "canvas-loop brushes: an iterative drawing space for agents"
status: draft
workstream: canvas-brushes
issues: []
---
# canvas-loop brushes: an iterative drawing space for agents

This plan adds expressive brushes, pressure-like stroke variation, compositing
groups, and paper grain to canvas-loop, so that an agent can draw an
illustration by writing a sketch, rendering it, looking at the frame, and
revising. A drawing experiment with real agent drawers runs alongside the
build. Its results choose the path form, find the bugs, and steer the brush
tuning.

**Issues addressed:** none filed. Related, not closed by this plan:
`issues/exploration/2026-11-11-look-at-klad-shared-human-agent-painting.md`
(klad prompted the work; that issue asks wider questions about the box).
Searched `issues/` for brush, visual diff, pixelmatch, contact-sheet: only the
klad issue matches outside `closed/`.

## Design

No design section: canvas-loop is a developer library, and nothing here changes
what a person meets in the box. The audience is an agent that draws. The
"Agent-flow" section below covers that audience.

## Smallest fix and budget

**Smallest version:** a single `s.mark(points, { width, taper })` that hands the
points to perfect-freehand and fills the outline. It gives variable-width ink
and nothing else: no grain, no texture, no group opacity. The boxholder named
brushes as the main difference from plain Canvas2D, so this is too small.

**Chosen design:**

| Track | Source | Tests |
| --- | --- | --- |
| A. Painter base: layers, transform-aware sampling, `curve`, blend/erase, groups | ~400 | ~150 |
| B. Gesture, mark seeding, brush engine (ink, stamp, bristle), paper grain | ~800 | ~250 |
| C. View/Sketch/BrowserView surface and docs | ~200 | ~50 |
| D. Experiment harness: guide, brief, cycle recording | ~150 | 0 |
| E. Visual-diff exploration tool | ~250 | ~50 |
| F. Gallery entries and examples from the experiment | ~600 (sketches) | gallery check |

Estimate: about 2,400 source lines and 500 test lines. **BIG CHANGE**, approved
by the boxholder on 2026-11-11 ("Big change is fine anywhere here"). The size
comes from the brush engine and from the gallery sketches the drawers write.
The authored docs (README, TEA.md, CHANGELOG, a brushes reference) add about
400 lines, counted separately.

## Stated preferences this plan trades against

- **Rhyme with p5** (boxholder, 2026-11-11: "I like the idea that this rhymes
  with p5"). Brush state is set the way p5 sets stroke state (`brush()`,
  `erase()`, `blendMode()`), and existing shapes take the brush. This trades
  against a pure data-call API (`mark(path, options)`), which would be easier
  to serialize.
- **No backward compatibility** (boxholder, 2026-11-11: "there's no
  outstanding uses of this"). Renames and reshapes are allowed. Each one is
  recorded in `canvas-loop/CHANGELOG.md` (`canvas-loop/README.md:3-6`, the
  EXPERIMENTAL banner).
- **Serializable-in-principle** (`canvas-loop/README.md:95-99`: *"prefer them so
  a sketch stays serializable-in-principle (the primitives are declarative data,
  `ctx` calls are not)"*). Brushes, gestures and group options are plain data.
  The group callback is the same shape as the existing `clip(shape, body)`
  (`canvas-loop/src/core/painter.ts:194`).
- **Byte determinism per runtime** (`canvas-loop/README.md:17-19`). Brush jitter
  comes from per-mark seeded streams. No `Math.random`.
- **Minimal invented concepts** (boxholder memory). Named points are ordinary
  program constants, not an API. Paper is one canvas-level setting.
- **Both tiers stay first-class** (boxholder, 2026-11-11: "I like TEA, so
  yeah, keep it"). Every brush, gesture, group and paper call exists on the
  TEA `View` as well as on `Sketch`. Round-1 drawers write mutable sketches,
  because a still drawing has no model for TEA to fold.
- **Brushes apply to strokes only** (proposed 2026-11-11, boxholder did not
  object). Fills stay flat; textured shading is marks inside `clip` or
  `group`.
- **TEA discipline** (`canvas-loop/TEA.md`: *"`draw` gets `View` (drawing, log,
  snapshot, `ctx`) and no randomness"*). Mark seeding is a pure function of the
  mark's data, so brushes work in `draw` without giving it randomness.

## What already exists

- `Painter` (`canvas-loop/src/core/painter.ts:30`) is the one drawing engine for
  both runtimes, typed against the structural `Ctx2D`
  (`canvas-loop/src/core/paint.ts:32`). Reuse: brushes extend it. `Ctx2D` grows
  by the members listed in Track A.
- `PathCommand` and `tracePath` (`canvas-loop/src/core/paint.ts:76`, `:150`):
  reuse as the bezier path form. Add a flattener beside them for brush sampling.
- `SeededRandom` (mulberry32, `canvas-loop/src/core/prng.ts:5`): reuse for
  per-mark streams.
- `clip(shape, body)` (`canvas-loop/src/core/painter.ts:194`): the scoped
  callback pattern that `group` copies.
- The three facades, each delegating to `Painter`: `Sketch`
  (`canvas-loop/src/headless/sketch.ts:27`), `TeaView`
  (`canvas-loop/src/headless/tea-view.ts:13`), `BrowserView`
  (`canvas-loop/src/browser/runtime/browser-view.ts:12`). Each gains the new
  methods by delegation.
- The gallery (`canvas-loop/src/gallery/README.md`) and `gallery check`: reuse
  for the final drawings, plus an optional `history/` directory (Track D).
- PNG decode and encode: `@napi-rs/canvas` `loadImage` / `canvas.encode`,
  already a dependency. The diff tool needs nothing new.
- The guide image: `canvas-loop/src/examples/alien-reference.ts`, flat-shape
  alien, approved by the boxholder on 2026-11-11.

## Prior art (external)

- **perfect-freehand 1.2.3** (MIT, no dependencies, about 110 KB unpacked;
  `pnpm view perfect-freehand`): `getStroke(points, options)` takes
  `[x, y, pressure]` points and returns an outline polygon. Options include
  `size`, `thinning`, `smoothing`, `streamline`, `start`/`end` taper, and
  `simulatePressure`. **Adopted** as the ink brush's outline generator, so it
  gets an ACKNOWLEDGEMENTS.md entry in chunk B1.
  https://github.com/steveruizok/perfect-freehand
- **Stamp brushes** (Krita, Procreate, MyPaint): a dab image placed at fixed
  spacing along the path. Size, opacity, angle and scatter come from pressure
  and speed. Paper texture is fixed to the canvas and subtracts from the dabs.
  **Evaluated only:** the general technique; no code is copied.
- **Catmull-Rom to cubic bezier:** for a segment through P1→P2, the control
  points are `P1 + (P2 − P0)/6` and `P2 − (P3 − P1)/6`. This is standard math;
  p5's `curveVertex` draws the same curve. **Evaluated only.**
- **klad** (`issues/exploration/2026-11-11-look-at-klad-shared-human-agent-painting.md`):
  agents paint with real brushes through a CLI. Motivation only; no design
  decision depends on its internals.

## Ontology

- **Mark** (new): one brushed stroke along one path. Every stroked shape draws
  one mark while a brush is set: `line`, `curve`, `path`, `polygon`, `rect`,
  `circle`, `ellipse`, `arc`, `triangle`. Identified by its seed (below). Not a
  stored object: a mark is painted and forgotten, like any Canvas2D draw call.
- **Path forms** (existing plus one new): polyline (`polygon` / `line`), bezier
  commands (`path`, existing `PathCommand`), and **`curve(points, closed?)`**
  (new: a Catmull-Rom curve through the points, p5's `curveVertex` shape). All
  three flatten to one sampled polyline for brushes.
- **Gesture** (new): how the hand moves along a mark, as functions of `t`
  (distance along the mark, 0..1). Fields: `pressure: Envelope` and `wobble`
  (lateral jitter amplitude, in px), plus `speed: Envelope`. Set with
  `gesture({...})`. Not a brush property: one gesture works with any brush.
- **Envelope** (new): a value over `t` in 0..1. One of: a number (constant);
  a preset name (`"even"`, `"taper"`, `"taper-in"`, `"taper-out"`, `"swell"`,
  `"press"`); or keyframes `[[t, v], …]` interpolated smoothly.
- **Brush** (new): how a gesture becomes pixels. Plain data:
  `{ kind: "ink" | "stamp" | "bristle", size, opacity, grain, … }` plus
  kind-specific fields. Colour comes from the existing `stroke(paint)` and
  `strokeWeight` scales `size`. Presets are selected by name: `brush("pencil")`,
  `brush("ink", { thinning: 0.7 })`. `noBrush()` returns to plain Canvas2D
  strokes.
- **Paper** (new): one grain texture per canvas, fixed in canvas space,
  generated from seeded noise. Set with `paper({ grain, scale })`. A brush's
  `grain` (0..1) says how much the paper subtracts from that brush's marks.
- **Group** (new): `group({ opacity, blend }, body)` draws `body` on an
  offscreen layer and composites it back once. It gives group opacity with no
  overlap darkening, a blend mode for the whole group, and erasing limited to
  the group. Groups nest. Not a document layer: program order is the only
  ordering.
- **Layer** (new, internal): an offscreen surface from an injected factory
  (`createCanvas` headless, a DOM canvas in the browser). Sketches never see it.
- **Mark seed** (new): a 32-bit hash of the mark's flattened points under the
  current transform, its brush, and its gesture, plus an optional
  `gesture({ seed })`. Each mark seeds its own `SeededRandom` from it. The run
  `--seed` is not an input, so a drawing does not change when the run seed
  changes.
- **Cycle** (experiment): one write→render→look iteration by a drawer. It is
  saved as `history/cycle-N.ts` in the drawer's gallery entry.
- **Drawer** (experiment): an agent run given the brief, the guide image, and a
  cycle budget. It ends with an account of the process.

Existing names kept: `stroke(paint)` (colour), `strokeWeight`, `fill`,
`PathCommand`, `Vec2`, `Paint`, `clip`.

## Tracks / scope

### A. Painter base

- **What:** the Canvas2D plumbing brushes and groups need. Grow `Ctx2D` by
  `globalAlpha`, `globalCompositeOperation`, `drawImage`, `createPattern`,
  `getTransform`, `setTransform`, `createImageData`, `putImageData`, and
  `fillRect`/`clearRect` on layers. Inject `makeLayer(w, h)` into `Painter`. Add
  `curve`, `blendMode`, `erase`/`noErase`, `group`, and a flattener from every
  primitive to a polyline.
- **Why:** a group needs an offscreen surface and compositing. Brushes need a
  per-mark layer, so grain subtracts only from that mark. Today `Painter` can
  only fill or stroke a path (`canvas-loop/src/core/painter.ts:216-229`).
- **Direction:**
  - `type Layer = { readonly ctx: Ctx2D; readonly image: LayerImage }`, where
    `LayerImage` is a branded opaque type that `drawImage` accepts.
  - `new Painter({ ctx, width, height, makeLayer })`.
  - `group(options: { opacity?: number; blend?: BlendMode }, body: () => void)`.
  - `BlendMode` is a union of the Canvas2D composite names both runtimes share:
    `"normal"` (meaning `source-over`), `multiply`, `screen`, `overlay`,
    `darken`, `lighten`, `soft-light`, `hard-light`, `color-dodge`,
    `color-burn`.
  - `erase()` sets `destination-out` for later fills, strokes and marks.
    `noErase()` restores the blend mode.
- **Vocabulary lock-ins:** `curve`, `group`, `blendMode`, `erase`/`noErase`,
  `BlendMode`.
- **First chunk:** the `Ctx2D` additions and the `makeLayer` injection in all
  three facades, plus `group` with opacity and blend. Test: two overlapping
  50%-opaque circles inside `group({ opacity: 0.5 })` give the same pixel in
  the overlap as outside it.

### B. Gesture, mark seed, brush engine, paper

- **What:** sample a mark, evaluate the gesture, and render through one of
  three brush kinds, with paper grain.
- **Why:** the brushes are the feature.
- **Direction:**
  1. **Sampling.** Flatten the path in device space, using `getTransform()`, so
     brush spacing is in real pixels under `scale()`. Resample at even
     arc-length steps. Each sample carries `t`, position, tangent, `pressure`
     and `speed`. Wobble moves each sample along the normal by
     smoothed seeded noise.
  2. **Ink** (`kind: "ink"`): perfect-freehand `getStroke` on
     `[x, y, pressure]` with `simulatePressure: false`. Fill the outline.
     Presets: `ink` (thinning 0.6) and `marker` (low thinning, square-ish,
     opacity 0.8, multiply blend inside the mark).
  3. **Stamp** (`kind: "stamp"`): draw dabs along the samples at spacing
     `size × spacing`. Dab size, alpha, angle and scatter follow pressure and
     speed through brush fields (`sizeByPressure`, `opacityByPressure`,
     `scatter`, `angle`, `tip: "round" | "soft" | "chisel"`). Dabs draw on the
     mark's layer. Presets: `pencil` (small hard tip, low flow, grain 0.8),
     `chalk` (larger, grain 0.9, scatter), `airbrush` (soft tip, very low flow,
     no grain).
  4. **Bristle** (`kind: "bristle"`): N bristles at fixed offsets across the
     width. Each bristle follows the path offset along the normal. Its width
     and alpha follow pressure. Its paint load runs out at a seeded `t`, sooner
     for outer bristles and at low pressure, so the end of a stroke breaks into
     dry streaks. Preset: `bristle` (12 bristles, grain 0.4). Second preset if
     useful: `drybrush`.
  5. **Grain.** Generate the paper texture once per canvas from seeded value
     noise (fixed seed per `paper()` call) into an ImageData. Keep it as a
     layer. After a mark is drawn on its layer, draw the paper on it with
     `destination-out` at `globalAlpha = brush.grain`. Composite the mark's
     layer onto the target with the brush opacity and the current blend mode.
     The mark's layer is cropped to its bounding box.
- **Vocabulary lock-ins:** `brush(name | Brush, overrides?)`, `noBrush()`,
  `gesture({ pressure, speed, wobble, seed })`, `paper({ grain, scale })`,
  `Envelope`, `Brush`, `BrushKind`, preset names `ink`, `marker`, `pencil`,
  `chalk`, `airbrush`, `bristle`.
- **First chunk:** sampling, envelopes, the mark seed, and the ink brush
  through `curve` and `path`. Test: inserting a non-overlapping mark before
  mark B leaves B's pixels byte-identical.

### C. Surface on all three facades, and docs

- **What:** delegate every new method from `Sketch`, `TeaView` and
  `BrowserView`; add them to the `View` type in `canvas-loop/src/core/tea.ts`;
  wire `makeLayer` in each runtime. Document in README.md, TEA.md, a new
  `canvas-loop/BRUSHES.md` (brush and gesture reference with a rendered
  sample of each preset), and CHANGELOG.md.
- **Why:** both tiers and both runtimes must draw the same marks.
- **Direction:** the browser `makeLayer` uses `document.createElement("canvas")`.
  The headless one uses `createCanvas`. The docs state that output is
  byte-identical per runtime, and that cross-runtime output can differ in
  antialiasing.
- **First chunk:** delegation and types. Test: `pnpm typecheck` passes for all
  five tsconfig projects, and a TEA sketch that uses `brush` runs headless.

### D. Experiment harness and rounds

- **What:** the brief, the guide image, the cycle recording, and the rounds.
- **Why:** the boxholder asked that the path form, the gesture/brush split, and
  the brush quality be chosen from real drawings. Opus is the target drawer;
  Sol (`codex gpt-6-sol`) is a second drawer.
- **Direction:**
  - **Brief:** "Draw this friendly green alien as a picture-book illustration:
    ink outlines, pencil or bristle shading, the guide for pose and
    proportion. You have N render cycles." The drawer gets the guide PNG only,
    not its source. It also gets README.md, TEA.md and BRUSHES.md.
  - **Conditions (round 1):** three Opus drawers, each told to draw outlines
    with one path form: `curve` through points, polylines, or `path` beziers.
    Six cycles each. The drawer saves every cycle as `history/cycle-N.ts`.
  - **Account:** each drawer ends with a short account: what fought it, what it
    wanted and did not have, and how it felt about the process and the result.
    No blind judging in early rounds (boxholder, 2026-11-11: "Only when we have
    the basics working in a bug-free way do we need to think about the finer
    points").
  - **Checkpoint:** after round 1 I show the boxholder the final frames and
    the accounts, fix the bugs they expose, and agree the next round with the
    boxholder.
  - **Later rounds:** the chosen path form with the tuned brushes; one Sol
    drawer; zoomed crops as a condition only if round 1 drawers ask for detail
    they cannot see.
- **Vocabulary lock-ins:** gallery `history/` directory (optional, holds
  `cycle-N.ts`; `gallery check` renders only the final sketch).
- **First chunk:** the brief text, the gallery `history/` rule in
  `canvas-loop/src/gallery/README.md`, and `gallery check` accepting the
  directory.

### E. Visual-diff exploration

- **What:** a `cli diff <before.png> <after.png> --out dir` command that writes
  several diff forms. A test of which form helps an agent answer "did my change
  help?".
- **Why:** the boxholder rated visual diff "definitely an exploration case".
  The output is a recommendation, not a finished feature.
- **Direction:** forms:
  1. before/after side by side
  2. changed pixels highlighted over a faded "after"
  3. a crop of the changed bounding box, before and after, scaled up
  4. one line of numbers: changed pixel count and bounding box

  Test material: consecutive cycle pairs from the round-1 histories. Opus
  subagents each see one form per pair and say whether the change helped and
  why. I compare their answers with the drawer's own stated intent for that
  cycle and with the boxholder's view of the pair.
- **Vocabulary lock-ins:** none until the recommendation is accepted. The
  command is marked experimental in the CLI help.
- **First chunk:** the command producing forms 1 and 4.

### F. Gallery and examples

- **What:** one gallery entry per drawer run kept, plus one brush-sampler
  example sketch (`src/examples/brushes.ts`) that shows each preset with each
  gesture preset.
- **Direction:** gallery entries follow `canvas-loop/src/gallery/README.md`
  (meta.yaml, task.md, runs.jsonl, no PNGs). The sampler renders the
  BRUSHES.md images.

## Could this be simpler?

The simplest version is ink only: a `mark` call over perfect-freehand, no
grain, no groups, no experiment. It fails the stated goal: the boxholder named
brushes as the main difference, and ink alone draws clean vector lines
without texture.

A middle version drops the state-based p5 API and adds only
`mark(path, options)`. It would be a little smaller: no flattener for the
existing shapes. It loses the p5 rhyme the boxholder asked for, and the guide
alien could no longer take a brush with one line (`s.brush("ink")`).

What the full plan buys, piece by piece:

- **Groups:** needed for marker overlaps, shading that does not darken where
  marks cross, and erasing.
- **Per-mark seeds:** needed for TEA purity and for edits that stay local.
- **The diff tool:** an exploration with a size limit (~250 lines), kept only
  if it earns a place.

Not built: smudge, watercolor, pixel API, layers (see NOT in scope).

## Subplans

none

## Failure modes

> **Critical gap (accepted):** cross-runtime pixel equality. Skia
> (`@napi-rs/canvas`) and a browser canvas antialias differently. A drawing
> tuned headless can look slightly different in a figure. No test, no
> handling, and the difference is silent. Accepted: README and BRUSHES.md say
> output is byte-identical per runtime only.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Mark seed depends on something run-order-dependent (a shared stream), so inserting a mark shifts later jitter | Planned: insertion test (B) | Seed is a pure hash of mark data | Clear (test fails) |
| Repeated marks under `translate` in a loop all get identical jitter | Planned: seed hashes device-space points | Transform folded into hash | Clear in frames |
| `group` body throws; the layer stack and `globalCompositeOperation` stay changed | Planned | `try/finally` restores, as `clip` does (`painter.ts:194-205`) | Clear (error in transcript) |
| `erase()` left on after a `pop()` | Planned | Erase is part of style state saved by `push`/`pop` | Clear in frames |
| A composite mode name differs between Skia and browsers | No | `BlendMode` limited to names both support | Silent → listed in BRUSHES.md |
| Per-mark layer cost makes a 500-mark drawing slow | Planned: timing log in the sampler run | Layer cropped to mark bounds; ink without grain skips the layer | Clear (CLI time) |
| Zero-length or single-point mark (a dot) | Planned | Sampler emits one dab or a round dot | Clear |
| Huge `size` makes a bounds-cropped layer larger than the canvas | Planned | Bounds clamped to canvas | Clear |
| Unknown preset name | Planned | `SketchUsageError` listing preset names | Clear |
| Drawer gets the guide source and copies coordinates, so the path-form test measures nothing | n/a | Brief gives the PNG only | Clear in the drawer's sketch |
| Browser `BrowserView` misses a new method | Typecheck (`View` interface) | `implements View` | Clear (compile error) |

## Agent-flow / user-flow edge cases

- **Wrong one of two similar things:** `stroke("#333")` (colour) vs
  `brush("ink")` (how strokes render). ADDRESSED: both are kept, with p5's
  meaning for `stroke`. A shape drawn with a brush and `noStroke()` gets no
  mark. BRUSHES.md says so in its first paragraph, and the transcript logs a
  one-time warning when `brush()` is set and `noStroke()` suppresses a mark.
- **Fill with a brush:** ADDRESSED: brushes apply to the stroke only. A fill
  stays flat. Textured fills are done by marks inside a `clip` or a `group`.
  BRUSHES.md has an example (pencil hatching inside a clip).
- **Stale ref / two agents / partial migration:** not applicable. There are no
  stored references, no concurrent writers, and no persisted data.
- **Hand-edit drift / fabricated value:** an unknown brush field or preset name
  raises `SketchUsageError` with the valid names. Envelope keyframes outside
  0..1 are clamped and logged once.
- **Validation error UX:** errors go through the existing frame-tagged
  transcript error entry (`canvas-loop/src/headless/transcript.ts:8`).
- **Drawer cannot see texture at frame scale:** DEFERRED to the round-1
  accounts (zoomed crops as a later condition).

## NOT in scope

- **Watercolor:** interesting (boxholder, 2026-11-11), and costly to tune. It
  is the first stretch brush after the basics are bug-free.
- **Smudge:** needs pixel reads under the brush. Not now.
- **General pixel API:** no effect in this plan needs one; grain uses
  `putImageData` once per paper.
- **Document layers:** program order covers ordering (handoff decision).
- **Live human/agent collaboration:** out of scope by the handoff.
- **Render density / supersampling:** dropped by the boxholder (2026-11-11).
- **Blind judging:** the boxholder judges; drawers write accounts.
- **Turtle path form:** considered as a fourth condition. Not in round 1,
  because outlines of a character are a poor fit for relative moves. It can be
  tried for hair or grass after round 1, if a drawer asks.
- **Cross-runtime pixel equality:** see Failure modes.
- **Textured fills as a brush property:** see the edge cases above.

## Open design questions

- **Speed in the gesture.** The agent has no real speed. Lean: keep `speed` as
  an envelope that only affects stamp spacing and bristle dry-out, and drop it
  if no drawer uses it.
- **Default gesture.** Lean: `pressure: "taper"` for open paths and `"even"`
  with light seeded variation for closed shapes.
- **Brush presets vs raw kinds.** Lean: drawers use presets with overrides;
  raw `Brush` objects stay documented for tuning.
- **Diff form to keep.** Settled by Track E.

## Knowledge audits

Skip: canvas-loop guidance is dev-repo documentation read by a drawing agent,
not box-loaded guidance. The drawers' accounts in Track D test what agents
learn from README.md, TEA.md and BRUSHES.md directly.

## What will hold this after it ships

- **Unit tests** (`canvas-loop/test/`, `node --test`, the package's tier):
  - envelope evaluation
  - Catmull-Rom passes through every input point
  - path flattening length within tolerance
  - mark-seed stability under insertion
  - group opacity without overlap darkening
  - erase limited to a group
  - an unknown preset raises an error
- **Determinism:** `gallery check` renders each gallery drawing twice and
  compares bytes (`canvas-loop/src/headless/gallery.ts`). The drawer entries
  become determinism tests for the whole brush engine.
- **Typecheck:** the `View` interface makes a missing `BrowserView` method a
  compile error.
- **No new test tier.** The browser runtime is checked by hand once, with the
  playground and the browse skill. There is no automated browser canvas test
  today, and this plan does not add one.

## Implementation order

1. **A1:** `Ctx2D` additions, `makeLayer` injection, `group`, `blendMode`,
   `erase`, with tests. Commit.
2. **A2:** the flattener for all primitives, and `curve`. Commit.
3. **B1:** sampling, envelopes, mark seed, ink brush. Add perfect-freehand,
   with an ACKNOWLEDGEMENTS.md entry. Commit.
4. **B2:** stamp brush with pencil, chalk and airbrush, plus paper grain.
   Commit.
5. **B3:** bristle brush. Commit.
6. **C:** facades, `View` type, BRUSHES.md, README/TEA/CHANGELOG, and the
   brush-sampler example. Commit.
7. **D1:** brief, gallery `history/`, the guide image in the brief. Commit.
8. **D2:** round 1, three Opus drawers. **Checkpoint with the boxholder.**
9. Fix the bugs round 1 exposes; tune the brushes. Commit per fix.
10. **E:** diff command and the diff exploration over the round-1 histories.
    Commit.
11. **D3:** later rounds as agreed at the checkpoint, including Sol. Gallery
    entries. Commit.
12. Cross-model review of the branch, the report, and an exhibit with
    `bin/exhibits add`. No merge.

## Rollout shape

Tests first per chunk: the test named in each track's first chunk is written
with that chunk. Done means:

- `pnpm --dir canvas-loop test`, `typecheck`, `lint` and `gallery:check` all
  pass.
- The brush sampler renders every preset.
- Round 1 and the agreed later rounds are recorded in the gallery.
- The report covers the path-form result, the diff recommendation, and the
  weak points of the brushes.

No knowledge audits and no data migration: the package has no persisted data,
and the boxholder waived backward compatibility.
