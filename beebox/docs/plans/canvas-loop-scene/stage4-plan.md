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
  heights (every caster stands 32 units); keeping a static lit subtree's
  material layers between frames; painterly blurs and bevels under skew.
