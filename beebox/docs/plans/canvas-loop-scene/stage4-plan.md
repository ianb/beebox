# Stage 4: the spike-through, plan

Part of `beebox/docs/plans/canvas-loop-scene.md`, Stage 4. Written
2026-11-15, after Checkpoint 3 chose one WebGPU renderer for the browser and
for headless (Dawn), and the Linux probe confirmed Dawn runs without a GPU.

## Goal

Working pictures end to end through the new design, so Checkpoint 4 can judge
all five principles on real examples: the recorder, the WebGPU renderer, Dawn
headless with the dev loop, three ported examples, the browser and beebox
host paths, offscreen sleep, a dev-loop checklist, and a drawing round with
agents.

## Where the code lives

`canvas-loop/src/scene-spike/`, as real, lint-clean TypeScript beside the
existing renderer, which it does not change. Spike code is allowed to be
thrown away, but writing it to the repo's standards means the subplans can
keep what fits. The probe code in `scratch/stage3/` is the starting point for
each part.

Two dependencies are added to canvas-loop, through the repo's dependency
process (`package.json`, `pnpm install --lockfile-only`, check the lockfile
diff, `pnpm install`): `@webgpu/types` (development, types only) and `webgpu`
(Dawn for Node, the headless renderer; native binaries for macOS and Linux x64
and arm64, as `@napi-rs/canvas` has).

## Architecture

- **Scene** (`scene.ts`): the node types of draft 2.2 as plain data. Shapes
  carry flattened contours (helper results frozen when made, per the
  scene-cost probe); brushed strokes carry their brush and gesture; groups,
  clips, masks, placements, text, lights. Pictures live in a version table
  keyed by key, size and deps.
- **Recorder** (`record.ts`): a `View` (draft 2.2) that builds the scene,
  captures arguments by value, keeps picture versions, and hashes subtrees
  while recording.
- **Renderer** (`gpu/`): one `GpuRenderer` over a `GPUDevice`, from the probes:
  - coverage atlas for fills and plain strokes (geometry probe);
  - brush marks from canvas-loop's existing expansion code, as instanced dabs,
    ink outlines and bristle runs, mark opacity once (brushes probe);
  - groups, clips, masks, blends, effects in shared textures (compositing
    probe);
  - wash and hatching passes (light-and-paint probe); lighting only as one
    small example (Checkpoint 3: lower priority);
  - text through a glyph atlas drawn by the runtime's 2D canvas.
- **Device** (`device.ts`): `navigator.gpu` in the browser; Dawn's `create()`
  in Node, keeping a reference to the created object (the light-and-paint
  probe's crash).
- **Headless run** (`run.ts`): runs a TEA sketch whose `draw` takes the draft
  View, renders captured frames under Dawn, and writes a transcript with
  frames, warnings and `--scene` outlines. Only captured frames are rendered.
- **Browser mount** (`mount.ts`): like `mountSketch`, drawing through WebGPU
  into the figure's canvas; inputs and controls as today; sleep releases GPU
  resources and waking re-renders the kept scene.

## Order of work (one heavy process at a time)

1. Dependencies, scene types, recorder, device, an empty renderer that clears;
   headless run writing a blank frame. Commit.
2. Fills and plain strokes; groups, clips, masks, blends, effects. Port the
   compositing fixtures as a parity test against today's Skia renderer. Commit.
3. Brushes, paper, smudge; pictures and placement; text. Commit.
4. Wash and hatching; one small lit example. Commit.
5. Port the three examples: the walker sheet (`intra-walk-styles`), one Intra
   room with panning (`intra-rooms`, the Hallway), the chemistry figure with
   controls (`balance-reaction-2`). Exhibit against the Stage 0 baselines, with
   browser and headless timings. Commit.
6. Browser mount, sleep and wake; one synthetic figure through beebox's real
   browser card and headless figure command. Commit.
7. Dev-loop checklist: deliberately bad scenes and their expected output.
8. Drawing round: three agents draw against the running spike with render
   cycles, matched briefs, accounts.
9. Astra reads the exhibits; Checkpoint 4 summary.

Chunks 1–4 each get a cross-model (Codex) review of the diff before the next
starts.

## Progress and known limitations

- **Chunks 1–2** (commit after `0865b900d`): scene types, recorder, Dawn and
  browser device setup, headless runner, fills and strokes on the exact-area
  coverage atlas, gradients, transforms, groups, clips, masks, blends, effects.
  Matches today's Skia on 24 compositing fixtures and 16 shape cells. Codex
  review: four findings fixed and verified.
- **Known limitation, for the implementation subplan:** clip coverage keeps at
  most 16 edge crossings per pixel band, so a pixel crossed by more than 16
  clip edges (for example nine overlapping thin shapes in one union) gets too
  much coverage. Effects under a rotated non-uniform scale or a skew are
  refused with an error.
- **Chunk 3:** brushes for every preset (today's expansion reused, dabs
  instanced, mark opacity once, an expansion cache), paper grain anchored to
  the call's coordinates, smudge and wet as compute passes, pictures with
  versions and the testing-mode stale-capture audit, fixed-resolution pixel
  images, and text through a glyph atlas. Brush crops within parity limits
  (worst: bristle, 1% luminance, 10.4% contrast); text positions and sizes
  identical to today; a brushed shape moved by `at` or placement keeps its
  texture. 500 brushed marks: 36 ms headless with the cache warm (today's Skia:
  373 ms). Core brush and text modules moved into folders to satisfy the
  layout check; all 736 gallery frames are byte-identical to the Stage 0
  baselines. Codex review: five findings fixed; draft 2.4 records the decisions.
- **Deferred from chunk 3:** faint-mark, missing-glyph and overlap checks; the
  "deps change every frame" warning and placement-scale hint;
  `effects.paper`; caching picture rasters and bristle vertices; ligatures and
  complex scripts; browser font-load re-recording.
- **Chunk 4** (not yet committed): `effects.wash`, `effects.hatching` and
  `effects.paper` in R5's order, in the coordinates where the group is
  called; a lit group with point, spot and directional lights, materials
  composited by coverage, 2D shadows and nesting (R8); `v.noise`. Hatching
  measures tone against the group's own range (a histogram pass) and draws
  strokes in patches with their own angle and spacing, turned toward the
  shading. Under Dawn at 640×480: wash 5.5 ms (ratio 1) and 7.9 ms (ratio 2),
  hatching 4.9 and 7.8 ms, the lit room with a moving lamp 5.8 and 9.3 ms.
- **Deferred from chunk 4:** the "no tone variation" warning (needs a
  readback); a jump-flood bevel (bevels come from blurred coverage); caster
  heights (every caster stands 32 units; done in the look round); keeping a
  static lit subtree's material layers between frames; painterly blurs and
  bevels under skew.

## Boxholder feedback on chunk 4 (2026-11-15)

- **Wash:** "too even maybe? Feels speckled." The granulation is fine uniform
  noise. Next: larger-scale variation (pooling patches, blooms, wandering
  darker edges, density varying across a shape), fine grain much fainter.
- **Hatching key series (B2–B4):** read as "just gets darker". The exhibit
  should show one image with a tone range, so lines visibly appear with tone.
- **Wash + hatching + paper together (B5):** disliked. Not a default look.
- **Lighting:** "Lighting is cool!" Priority raised from Checkpoint 3's
  "lower": caster heights and a tone curve come next for it.
- A look-iteration round on wash and hatching follows chunk 5, before the
  drawing round.

## Chunk 5: three ports (2026-11-15)

- The walker sheet, the Intra Hallway (panning, plus a wash variant) and the
  chemistry figure ported to the draft API in `canvas-loop/src/examples/scene-ports/`.
  Port changes were small: type imports, `paperTexture` became a group's
  `effects.paper`, and the Hallway's sprite strip became one wide `picture`.
- Parity with today: 99.98–99.99% (walker), 91.1% panned Hallway (crops within
  0.3% luminance), 99.2% chemistry.
- **Speed is the open problem.** Browser at ratio 2: walker 3.2 fps (today 5.6),
  Hallway 1.8 fps (today 60), chemistry 60 fps. Causes found: shape coverage
  geometry rebuilt on the CPU every frame (~85–90 ms), the room picture redrawn
  every frame (no kept image), and one full-layer pass per clip. These are the
  caches the draft allows and the spike has not built; a performance round
  comes before Checkpoint 4.
- `v.control` is a kept frame output; headless stand-ins draw above the scene.

## Performance round (2026-11-15, not yet committed)

- **What was built:** pass timing by timestamp queries (`gpu/timing.ts`);
  coverage geometry kept per shape under a structural key hashed while
  recording, with translation added afterwards (`hash.ts`,
  `gpu/geometry-cache.ts`, `gpu/shape-geometry.ts`); picture rasters kept as
  a fixed grid of 2048 px tiles aligned to the picture's origin
  (`gpu/rasters.ts`), or as one layer over the whole picture when it reads
  its surroundings: smudge, wet, wash, hatching, lighting
  (`gpu/picture-reads.ts`); every clip of a frame drawn once on shared clip
  pages (`gpu/clip-pages.ts`); per-frame bind groups.
- **Provisional draft 2.6 decision** (for the boxholder at Checkpoint 4): a
  placement's device translation snaps to whole device pixels, cached or
  not, so a panning camera reuses the room's tiles. A group does not snap.
- **Cause of the slowness:** one clip pass per clip, each looping over every
  clip edge per pixel: 99% of the walker's GPU time and 76% of the Hallway's.
  Passes per frame: walker 229 → 4, Hallway 191 → 11.
- **Browser, ratio 2:** walker 3.2 → 18.8 fps (CPU-bound: brush expansion of
  ~525 moving strokes, ~30 ms); Hallway still and panning 60 / 58.8 fps;
  chemistry 60.
- **Clips:** a one-shape clip whose outline is one simple ring reads
  exact-area coverage from the atlas; any other clip sums windings in 64
  bands, within two levels of the atlas. Kept rasters are destroyed when not
  placed in the last two frames, budget 256 MB.
- **Cache equivalence** is tested (`test/scene-spike/cache-cases.ts`,
  `raster-cases.ts`): warm, caches-off and cold renders byte-identical for
  moving frames at ratio 1 and 2 and for the three ports. It needed atlas
  and mark coverage computed in each piece's own pixels (slot positions
  depend on what else a frame draws), with slot offsets applied as integers
  (Metal's fast math reassociated them).

## Look round (2026-11-15, not yet committed)

- **Wash:** fine granulation made faint; pooling patches, occasional blooms
  with hard dark rims, pigment heavier toward edges and bottoms, and a
  wandering drying edge, from a second, shape-scale blur. Examples:
  `canvas-loop/src/examples/scene-looks/washed-shapes-tea.ts`, the Hallway's
  wash look.
- **Hatching:** one still life under a side light
  (`scene-looks/still-life-tea.ts`); fewer, thinner, longer strokes; light
  areas bare; single then crossed lines; colour lifted under the lines.
- **Lighting:** caster heights and exposure with a tone curve (draft 2.7,
  section 19); a night room with a lamp, a figure and a bookshelf
  (`scene-looks/night-room-tea.ts`).
- **Headless timing** (Dawn, mean of 30 warm renders, before → after):
  washed shapes 640×480 2.5 → 3.8 ms (ratio 1), 4.4 → 6.5 ms (ratio 2);
  Hallway with wash 1280×760 6.7 → 8.3 ms, 13.6 → 18.5 ms; still life
  hatching 2.8 → 2.9 ms, 8.2 → 8.3 ms; night room 640×380 19.3 → 20.5 ms,
  20.3 → 22.3 ms.

## Chunk 6b: one scene figure through beebox (2026-11-15)

- **Opt-in:** the figure entry exports `renderer = "scene"` and its factory
  calls `cl.mountSceneSketch`. `bbx figure run-one` reads the export (absent:
  today's runner; any other value: an error) and runs `runSpike` with the
  loaded module, card defaults and `--params`; the result line has the same
  shape. The browser namespace's `mountSceneSketch` gets the same param
  warnings and activity reports as `mountSketch` and loads the GPU code on
  first use. canvas-loop exports `./scene-browser` and `./scene-headless`.
- **Checked:** a synthetic Orbits card in the worktree's test box draws in the
  real card with WebGPU, redraws when a slider changes, stops while scrolled
  off and resumes on return; `bbx figure run` writes frames and a transcript.
- **Production would need:** `webgpu` declared by beebox (as `@napi-rs/canvas`
  is) for a packed install, since the bundled runner imports it; a Vulkan
  driver on the Linux server (a software one, lavapipe, without a GPU). The
  GPU-only browser code is about 155 KB minified; the rest of the scene chunk
  is shared with today's canvas-loop chunk.
- **Gaps:** the scene transcript does not list scripted inputs or snapshot
  labels as today's does; a draw that throws leaves no transcript.

## Chunk 7: the dev-loop checklist (2026-11-15)

- `stage4/dev-loop.md`: 46 deliberately bad sketches
  (`canvas-loop/test/scene-spike/dev-loop/cases.ts`), each run through the
  headless runner in `gpu.test.ts` and checked for the channel and what its
  message names. 18 passed as they were, 22 gaps were fixed, 6 are left with
  proposals.
- **Fixed:** a throwing step now leaves a transcript that ends with the
  frame, the step and the sketch's lines, and the run throws
  `SketchRunError`. Warnings name the sketch's line and are given once per
  run. The recorder checks numbers (NaN, Infinity, negative radii), parses
  colours at the call (headless), refuses calls after `draw` and Pictures
  from an earlier frame, and checks effects under a skew at the call.
  New warnings: picture keys recorded every frame, stale captures told apart
  from shared keys, lit groups with no light, fonts that are not installed.
  The runner freezes the model, refuses async steps and undeclared params,
  and names a canvas larger than the GPU's largest texture.
- **Left, for a decision:** clips with no area, frames with nothing on the
  canvas, hatching over a flat tone, faint marks, missing glyphs, and a pass
  budget per frame; render errors do not name the node path, and the
  browser parses colours at render.

## Drawing-round fixes (2026-11-15)

From `stage4/drawing-findings.md`; each has a test in `gpu.test.ts` or a
recorder test. Findings 4 and 5 wait for the boxholder.
- **Param lines (8):** a scripted param writes `frame N: param: name →
  value`, as today's transcript does.
- **Placement-scale hint (7):** a picture placed at a new scale or rotation
  three frames running gets one `hint:` line per run, with its key and the
  sketch's line. A key placed at several fixed scales gets none.
- **Off the canvas (6, dev-loop row 38):** a sketch line whose drawings are
  all entirely off the canvas on every frame warns once, at the end of the
  run, with the frames and the first box. Unboxed text that crosses the edge
  on every frame warns too. A thing that moves off and back, or a loop that
  draws past the edge, stays quiet. Bounds count stroke width, brush spread
  and the reach of effects around the shape; picture bodies, mask artwork
  and shadow casters in a lit group are not checked. Under a camera that
  has not reached part of the world yet, that part warns; the message says
  so.
- **`--scene first` (14):** the outline of the first captured frame only.
- **Control stand-ins (9):** the param's label in grey; a `number` param
  without `control: "field"` draws a track and a thumb at the value.
- **Canvas-edge rim (2):** a group job records where its drawing can be seen.
  The wash, its blurs and hatching read past that edge as the nearest pixel
  inside it, so a background that fills the canvas gets no holes and no
  drying line along the border. Edges inside the canvas still dry. The
  drawers' re-renders change only within about 70 device px of the edge.
- **Paper against ratio (10):** checked, no change. Rendered at ratio 1 and 2
  and box-downsampled, the texture correlates 0.87 (`effects.paper`) and
  0.996 (wash granulation); the part that differs is the paper's per-pixel
  term, which is per device pixel by design. Side by side, the drawers'
  rooms show the same blotches at both ratios.
- **Dashes (1):** plain strokes dash with Canvas2D's semantics, split before
  coverage; four parity cells match today's Skia. A brushed stroke with a
  dash is an error that says to draw each dash as its own line or curve, as
  today's runtime refuses it.
- **Light calibration (3):** in the `--scene` outline each light gives its
  peak added brightness and what a white floor below it shows; a test checks
  this against the rendered pixels. The draft's R8 has a starting pair.

