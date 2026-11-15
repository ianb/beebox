---
title: "canvas-loop: a painted medium on the GPU"
status: superseded
workstream: canvas-brushes
issues: []
superseded-by: ../plans/canvas-loop-scene.md
---
# canvas-loop: a painted medium on the GPU

canvas-loop paints watercolour and pencil texture one brush mark at a time,
which is too slow for live scenes in a browser. This plan proposes that a
sketch describe shapes with a *medium* (how much they granulate, darken at the
edges, and take hatching), and that one painting pass over the whole frame adds
the texture: a WebGL2 shader in the browser, and a TypeScript version of the
same pass headless. It starts with a feasibility gate, because the boxholder
asked to think hard before a WebGL redesign.

**Issues addressed:** none filed. Searched `issues/` and `private-issues/` for
canvas-loop performance, WebGL, shader and brush speed: nothing open. Related:
`issues/closed/exploration/2026-07-13-canvas-tight-loop-agent-programming.md:90`
records the premise this design works around: *"No good headless WebGL2 exists
— 2D only for the prototype."*

## Design

No design section: canvas-loop is a developer library, and nothing here changes
what a person meets in the box unless a figure's sketch opts in to the medium.
Figures that do not opt in render exactly as before. Failure modes and
Agent-flow cover the drawing agent, the audience here.

## Smallest fix and budget

**Problem, measured (2026-11-14).** A hand-inked person costs about 30 ms per
frame headless. Switching parts off on the 16-walker sheet
(`canvas-loop/src/gallery/intra-walk-styles/`, 1280 × 1000) gave, per figure:
pencil hatching 16 ms, washes 10 ms, brush outlines 5 ms, everything else
2 ms. After commit `2e0720f1a` (one soft-dab image; hatch lines batched into
one mark) the browser ran that sheet at 8.75 fps with full ink and one inked
walker at 60 fps (Chromium via `bin/browse`, Apple M2 Pro, measured with a
4-second `requestAnimationFrame` count).

**Smallest fix:** stay in Canvas2D. Paint each material's wash and hatching
once into a texture tile; clip each shape and paste its tile; draw outlines as
a dark underlay. One implementation, no new runtime.

**Why not stop there:** two claims, both unproven, would justify a GPU pass:
the cost of a full-frame pass does not grow with the number of figures, and
image-space effects (edges darkening where colours meet, pigment settling into
paper) look better than tiles. The gate below measures both against the tile
baseline before anything general is built.

**Budget.**
- Gate (both prototypes, timing harness, exhibit): about 600 lines, mostly
  kept: the CPU pass and the GL pass become Tracks A and B's starting points.
  The tile prototype is kept as the fallback path either way.
- Track A, medium in the painter: about 500 source and 300 test lines.
- Track B, GL presentation and lifecycle: about 450 source and 250 test lines.
- Track C, conversions: about 150 lines.
- Docs (TEA.md, BRUSHES.md): about 150 lines, separate.

Total about 2,250 lines of source and tests: a **BIG CHANGE**. What drives the
size is compatibility: the control pass must behave correctly under groups,
masks, caches, sprites and brush marks, and the GL path needs a resource
lifecycle for many figures on one page. Approval is asked only after the gate;
the gate itself is about 600 lines.

## Stated preferences this plan trades against

- **canvas-loop's premise.** `canvas-loop/README.md:8`: *"A deterministic,
  browser-less, frame-stepped Canvas2D sandbox for agent programming."* The
  headless pass keeps it browser-less and byte-identical.
- **One way to do each thing** (`beebox/docs/engineering-principles.md` §8).
  The pass exists twice (TypeScript and GLSL), and brushes and media are two
  ways to make texture. The parity test is the price of the first; BRUSHES.md
  guidance (brush for still pictures, medium for animation) answers the second.
- **Browser and headless may differ a little, already.**
  `canvas-loop/BRUSHES.md:360-361`: *"A render is byte-identical every time in
  the same runtime. The headless renderer (Skia) and a browser can differ."*
  The boxholder, on GPU work in this workstream: "We would not have to be so
  literal as to be perfectly GPU-similar. Deterministic is more like it." So:
  each runtime is deterministic; across runtimes the passes agree on identical
  inputs within a tolerance.
- **§12, the maintainer is an agent.** The agent judges headless frames, so the
  headless pass must produce the look, not an approximation of it.
- **§4, never silent.** No WebGL2, a lost context or an unsupported
  combination must say so and show something sensible, not a blank figure.
- **`draw` runs once per frame.** `canvas-loop/TEA.md:98-102`: *"then calls
  `draw` **once** with the resulting model … `draw` runs exactly once per frame
  headless."* Track A changes this contract for medium frames; the second call
  is a painter-internal pass with side effects suppressed, and TEA.md says so.

## What already exists

- **Immediate-mode painter.** `canvas-loop/src/core/view.ts:2` *"every call
  goes straight to the Painter with its style"*; `PainterCore`
  (`src/core/painter/core.ts:38`) owns layers, groups, clips, caches,
  sprites. No recorded command list exists; `src/core/paint.ts:2-4` only
  intends one (*"serializable-in-principle"*). The control pass replays `draw`
  instead of recording; Track A lists every painter feature it must handle.
- **Compositing features the control pass must handle.** Groups composite with
  opacity, blend and CSS-filter effects (`core.ts:185-194`, `effects.ts`);
  masks use `destination-in` (`core.ts:202`); a union of clip shapes reads
  pixels back with `getImageData` in the browser too (`core.ts:169-172`);
  caches and sprites stop running their bodies after the first frame
  (`core.ts:246-273`).
- **Brush marks.** `renderMark` (`src/core/brush/render/mark.ts`) builds a
  coverage layer and then colours it (`colorize`); smears move existing pixels
  instead (`render/smear.ts`). The control pass reuses the coverage step with a
  control colour.
- **Runtime seam.** `MakeLayer`, `Layer` (`src/core/paint.ts:132-138`);
  headless `makeSkiaLayer` (`src/headless/surface.ts:14`); browser
  `makeDomLayer` (`src/browser/runtime/layer.ts:6`).
- **Mounting.** `attachSketch` takes the caller's canvas, gets its 2D context
  and wires input and visibility on it (`src/browser/mount.ts:76`). The
  browser pixel ratio is capped at 2 (`mount.ts:410-413`). Each runtime draws
  once during construction (`src/browser/runtime/engine.ts:105`).
- **Paper.** A canvas-sized texture generated in JS from hash noise
  (`src/core/brush/paper.ts:29-49`), scaled by pixel ratio. It is finite and
  fixed to the canvas, so it is not reused as a world-anchored height field.
- **Deterministic hash noise.** `src/core/brush/random.ts`. Reused by the
  headless pass and ported to GLSL.
- **Determinism check.** `gallery:check` compares two runs byte for byte
  (`src/headless/gallery.ts:142`). The headless pass runs inside it.
- **WebGL in beebox figures.** Three.js is a figure runtime
  (`beebox/src/frontend/src/components/FigureView/FigureMount.tsx:18`). This
  shows a GL figure is allowed; it does not show capacity for many.
- **Raw context.** `src/core/tea.ts:280-281` gives sketches `v.ctx`; 37
  gallery and example files use it, some only to set a transform for later
  `v.*` calls (`src/gallery/intra-lounge-drawn/light-tea.ts:29,47`).

## Prior art (external)

- Bousseau, Kaplan, Thollot, Sillion, "Interactive Watercolor Rendering with
  Temporal Coherence and Abstraction", NPAR 2006
  (https://hal.inria.fr/inria-00510223): pigment density variation, paper
  granulation, edge darkening as image-space passes over a flat render.
  **Adopted** as the model for the pass; ACKNOWLEDGEMENTS.md entry lands with
  Track A.
- Praun, Hoppe, Webb, Finkelstein, "Real-Time Hatching", SIGGRAPH 2001: tonal
  art maps, hatching revealed by darkness. **Adopted**, in screen space;
  ACKNOWLEDGEMENTS.md entry lands with Track A.
- HTML standard, `getContext`: a canvas that has a 2D context returns `null`
  for any other context type
  (https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-getcontext-dev).
  **Constrains** Track B: the GL canvas is detached and copied into the
  figure's 2D canvas.
- headless-gl (https://github.com/stackgl/headless-gl): WebGL 1 only, native
  build. **Evaluated only**: a native GL headless gives up byte-identical
  output across machines.
- Headless Chromium with SwiftShader: unreliable in some headless builds
  (https://bugs.launchpad.net/bugs/1959416). **Evaluated only**: it would make
  the loop browser-based.
- Browsers limit live WebGL contexts per page; the exact number is not
  verified here. Track B tests the behaviour instead of relying on a number.

## Ontology

- **Medium** (new): per-shape parameters, in style field `style.medium`:
  `shade` (how dark the light leaves the shape, 0..1; drives hatching),
  `granulate` (pigment settling into paper, 0..1), `edge` (darkening where the
  colour changes, 0..1). It makes no marks. Bleed is cut from v1: it needs a
  fourth independent channel.
- **Frame medium** (new): per-frame settings, `v.medium({ hatch, origin })`:
  `hatch` (strength, 0..1) and `origin` (logical-pixel offset of the world, so
  procedural pigment noise pans with the camera).
- **Control layer** (new): RGBA8 at the frame's pixel size. R = shade, G =
  granulate, B = edge, A = coverage. Each parameter has its own channel, so
  antialiasing, opacity and scaling interpolate each one correctly. Not seen
  by the sketch.
- **Control pass** (new): `draw` run a second time with the painter in
  control mode. Defined by the compositing rules in Track A, not by "the same
  as colour".
- **Painting pass** (new): (colour layer, control layer, frame medium) to the
  final pixels. `paintPassCpu` (TypeScript, headless, the reference) and a
  GLSL fragment shader (browser).
- **Medium entry** (new): a cache or sprite entry that holds a colour layer, a
  control layer, and whether its body used a medium.
- **Painter**, **Layer**, **cache**, **sprite**, **mark**: existing, names
  kept.

## Tracks / scope

### Gate: browser feasibility against a Canvas2D baseline

- **What:** two prototypes on the same moving artwork (the walker sheet at
  1280 × 1000 and one panning Intra room at 1280 × 760), measured in the
  browser at pixel ratio 1 and 2:
  1. **Tile baseline:** texture tiles clipped into shapes, underlay outlines.
  2. **Minimal GPU pass:** `paintPassCpu` and a GLSL twin doing granulation,
     edge darkening and hatching by shade only. The control layer is painted
     by hand in the sketch (no painter changes). A detached WebGL2 canvas is
     drawn back into the figure's 2D canvas.
- **Why:** the boxholder asked for nice artwork *and* speed in the browser and
  asked to think hard about WebGL. Looks and speed are the claims; both need
  evidence before the compatibility work.
- **Measured:** whole-frame time (scene drawing, both rasters, uploads, pass,
  copy-back) in the browser, warm and cold caches, with one and with six
  figures on a page; headless time; input responsiveness while running. The
  harness and machine are written down with the numbers.
- **Gate outcome:** an exhibit with ink, tiles and the pass side by side, and
  the timings. **Human decision required:** continue to Tracks A–C, ship tiles
  only, or stop.
- **First implementation chunk:** the timing harness: a browser page that runs
  a sketch for N frames and reports mean and 95th-percentile frame time, with
  the ink walker sheet as its first measurement.

### Track A: medium in the painter (headless complete)

- **What:** `style.medium`, `v.medium()`, the control pass, medium entries for
  caches and sprites, and the headless runtime applying `paintPassCpu`.
- **Why:** the gate paints control by hand; sketches need one style field, and
  control must follow the frame's real geometry.
- **Direction, control-mode rules:**
  - **Alpha is kept, colour is replaced.** Every fill, stroke and brush mark
    paints with its real final alpha (paint alpha, gradient alpha, brush
    opacity, coverage) and with RGB replaced by the medium's parameters (zeros
    with no medium). A translucent shape changes control only as much as it
    shows. Brush colour jitter is off in control mode.
  - A shape with no medium over a medium shape zeroes the parameters beneath it
    in proportion to its alpha.
  - **Blends** at every entry point (shape, brush, group, cache and sprite
    paste) composite as `normal` in control; **erase** erases control too.
    Smears are skipped in control mode and documented: they move colour, not
    material.
  - **Groups:** opacity applies as in colour. Effects (blur, glow, shadow,
    colour adjustments) are not replayed on control.
  - **Masks:** the mask body is drawn in colour mode, effects included, so its
    alpha is exactly the colour pass's; that alpha then cuts the control body.
  - Clip unions run as in colour, including their read-back (an existing cost,
    `core.ts:169-172`, measured in the gate).
  - `v.ctx` in a frame that uses a medium throws a `SketchUsageError` naming
    the call. Raw drawing and raw transforms cannot be replayed safely. Caches
    and sprites record raw-context use, so pasting one built with `v.ctx` into
    a medium frame raises the same error, whatever the call order.
  - The second `draw` call suppresses logs, snapshots and other non-paint
    effects.
- **Direction, caches and sprites:** an entry records whether its body used a
  medium and whether it used `v.ctx`, and a paste replays both flags into the
  frame, so a warm cache keeps the frame in medium mode. Control storage is
  lazy: an entry gets a control layer only when its body used a medium. An
  entry without one contributes control (0, 0, 0, its colour alpha), which is
  exactly right for a body with no medium; so entries built before a sketch's
  first medium frame need no re-run. Sketches that never use a medium allocate
  nothing new. Retained memory is measured in the gate (one control layer at
  1280 × 1000 and ratio 2 is about 20 MB).
- **Direction, surfaces:** in a medium frame the painter draws into an
  offscreen colour surface that persists between frames exactly as the visible
  canvas does today (it is not cleared for the sketch). The painting pass
  writes the visible canvas with replacement, never source-over, so processed
  pixels never feed the next frame. When a frame has no medium, the colour
  surface is presented as is.
- **Direction, shapes:** `Style.medium?: { shade?: number; granulate?: number;
  edge?: number }`, each validated in 0..1 (§3); `v.medium(frame: { hatch?:
  number; origin?: Vec2 })`, `origin` in logical pixels.
- **A frame with no medium** is drawn once and is untouched.
- **Vocabulary lock-ins:** `medium`, `shade`, `granulate`, `edge`, `hatch`,
  `origin`; control channel layout.
- **First implementation chunk:** `Style.medium` validation and control mode
  for fills, with tests: a plain shape over a medium shape zeroes control;
  half-opacity group halves coverage.

### Track B: GL presentation and lifecycle in the browser

- **What:** a detached WebGL2 canvas per medium figure runs the GLSL pass, and
  the result is drawn into the figure's existing 2D canvas.
- **Why:** the visible canvas already has a 2D context and cannot also hold
  WebGL2 (HTML standard, above).
- **Direction:**
  - The GL canvas and its textures are created on the first medium frame and
    released on unmount and when the figure is suspended offscreen.
  - Control is uploaded at pixel ratio 1 if the gate shows full resolution
    costs too much at ratio 2.
  - No WebGL2, a failed shader compile, or `webglcontextlost`: one
    `console.warn` naming the cause; the figure keeps drawing its colour layer
    unpainted, including the frame shown while paused.
- **Parity:** `paintPassCpu` and the GLSL pass get identical colour and
  control inputs (fixtures). Done when 99.5% of pixels are within 3/255 per
  channel, and every 32 × 32 tile's mean difference is under 2/255, so a small
  wrong region cannot hide in a whole-frame average. The browser tier is
  required; if no browser is available the test fails, it does not skip.
- **Lifecycle tests:** offscreen mounts, repeated mount and unmount, a page with
  canvas-loop, three and p5 figures together, and forced context loss on a
  paused figure.
- **First implementation chunk:** the detached GL canvas with an identity
  shader drawn back into the 2D canvas, with the copy timed, and the fallback
  on forced context loss.

### Track C: conversions

- **What:** the walk-styles figure uses `medium` in place of washes and
  hatching; one Intra room pans with `origin`.
- **Why:** real drawings test the API and give the timing that justified the
  plan.
- **First implementation chunk:** the walker's trunk and limbs with
  `medium.shade` set from the side the light falls on.

## Could this be simpler?

Yes, possibly, and the gate exists to find out. The simplest version is the
tile baseline: pre-painted tiles per material, clipped into shapes, plus
underlay outlines. One implementation, no GL, probably a few milliseconds per
figure (unmeasured). The GPU pass earns its size only if the gate shows one of:
- the tile cost per figure exceeds the budget with the number of figures a
  scene really has, while the pass stays within it at pixel ratio 2; or
- the image-space look (edges where colours meet, granulation) is clearly
  better to the boxholder.

If neither holds, tiles ship and this plan stops at the gate.

Options rejected:
- **Replace Canvas2D with a WebGL renderer.** It rebuilds paths, text, clips,
  CSS-filter effects and `v.ctx` (37 files), and headless would need a GL that
  is not byte-identical.
- **Brush marks on the GPU.** Marks would cross between a 2D and a GL context
  once per mark, and groups and clips stay in Canvas2D.
- **Headless through Chromium.** It makes the loop browser-based, and output
  differs across machines.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| CPU and GLSL passes drift after an edit | Track B parity test on fixtures, required | no | clear: test fails |
| A cached body used a medium, and on warm frames the frame forgets it | Track A warm-cache test | medium entry flag | clear: test |
| Control parameters corrupted by compositing (opacity, AA, scaling) | Track A tests | one parameter per channel | clear: test |
| A blend mode or effect changes control values | Track A test | effects and blends not replayed in control | clear: test |
| A brush outline over a medium fill leaves control wrong around the ink | Track A test | real coverage, control colour | clear: test |
| `v.ctx` used in a medium frame, directly or inside a cache built earlier | Track A tests (direct; warm cache built before the first medium frame) | `SketchUsageError`; flag carried by entries | clear |
| A translucent or gradient shape, or a jittered brush, writes wrong control | Track A fixtures | final alpha kept, jitter off | clear: test |
| A mask with effects inside cuts control differently from colour | Track A test | mask body drawn in colour mode | clear: test |
| Processed pixels feed back into the next frame | Track B test (repeated draws, medium on and off) | separate colour surface; replace on present | clear: test |
| Control layers exhaust memory with many caches | gate memory measurement | lazy control storage | clear: gate numbers |
| Second `draw` call duplicates logs or snapshots | Track A test | suppressed in control pass | clear: test |
| No WebGL2, shader compile failure, context loss | Track B tests | colour unpainted, `console.warn` | clear |
| Many GL contexts on one page; oldest lost | Track B lifecycle tests | release offscreen, fallback | clear: `console.warn` |
| Frame time over budget at pixel ratio 2 | gate measurements | control at ratio 1 | clear: gate numbers |
| Moving characters: pigment noise slides over them | gate exhibit | none in v1 | visible; NOT in scope |

## Agent-flow / user-flow edge cases

- **Wrong tool:** washes painted with the `wash` brush in an animated scene.
  ADDRESSED: BRUSHES.md "Brush or medium?" section (Track A docs).
- **Value out of range:** `medium.edge: 2`. ADDRESSED: style validation names
  the field and range (Track A).
- **Raw context in a medium frame:** ADDRESSED: `SketchUsageError` with a
  message that says to set the transform with `v.at` instead (Track A).
- **Forgotten `origin` while panning:** ADDRESSED in docs by the Track C
  example; the texture visibly stays on the screen, so the mistake shows.
- **Stale ref, two agents, migration:** not applicable: no stored data, and
  existing sketches are unchanged unless they opt in.

## NOT in scope

- **Bleed** (edges wandering into neighbours): needs a fourth parameter
  channel; after v1 if wanted.
- **Per-object texture anchoring** (pigment fixed to a moving limb): needs a
  per-shape coordinate layer, a subsystem of its own. **Human decision
  required** after the gate: accept sliding on moving characters, or plan it.
- **A shared GL renderer for all figures on a page:** only if the lifecycle
  tests show per-figure contexts fail. **Human decision required** then.
- **`cache(…, { every })` and pannable caches:** lower frame rate for
  background items, a separate canvas-loop change.
- **GPU brush marks, GPU text, a GL replacement for Canvas2D:** rejected
  above.
- **WebGPU:** WebGL2 is what figures can count on today.

## Open design questions

- **Control resolution at pixel ratio 2.** Lean: ratio 1 control under a
  ratio 2 colour layer, if the gate shows the cost; edges come from the colour
  layer anyway. Settled by gate numbers before Track A.
- **Ink outlines.** Lean: brush-ink outlines stay as marks in v1; an
  edge-detected line in the pass is revisited after Track C.

## Knowledge audits

Skip: canvas-loop guidance is TEA.md and BRUSHES.md, which drawing agents read
directly; no box-agent concept changes. A later beebox figure guide that names
the medium carries its own audit.

## What will hold this after it ships

- `paintPassCpu` unit tests on small hand-built layers, in `canvas-loop/test/`.
- Control-mode tests: occlusion, translucent and gradient paint, jittered
  brushes, masks with effects, blends and erase at each entry point, warm
  caches (medium and raw-context flags), `v.ctx` error, suppressed side
  effects.
- `gallery:check` byte-identical runs, including the converted exercises.
- The parity test on fixtures, a new test tier (a real browser through
  `bin/browse`). It is needed because nothing else catches the two passes
  drifting apart; it fails, never skips, without a browser.
- Lifecycle tests in the browser tier.

## Implementation order

1. Gate: timing harness; tile baseline; minimal CPU and GL passes with a
   hand-painted control layer; exhibit and numbers. **Stop for the boxholder's
   decision and, if continuing, approval of the BIG CHANGE size.**
2. Track A: medium validation and fills; strokes and brush coverage; groups,
   masks, effects rules; caches and sprites as medium entries; `v.ctx` error
   and side-effect suppression; `v.medium()`; headless integration; docs;
   ACKNOWLEDGEMENTS.md entries for the two papers.
3. Track B: detached GL canvas and copy-back; the GLSL pass; fallbacks;
   parity test; lifecycle tests.
4. Track C: convert the walker; pan a room with `origin`; browser timings
   before and after.

## Rollout shape

Done when:
- the unit, control-mode, parity and lifecycle tests and `gallery:check` pass;
- the walker sheet and one panning room meet the frame budget the gate set, in
  the browser at pixel ratio 2;
- an exhibit shows ink, tiles and the medium side by side.

No data migration. Sketches opt in; existing figures render as before. No
knowledge audits.
