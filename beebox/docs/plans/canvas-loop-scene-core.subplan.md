---
title: "canvas-loop scene core: the spike becomes the one API and renderer"
status: draft
workstream: canvas-brushes
issues: []
---
# canvas-loop scene core: the spike becomes the one API and renderer

Stage 5 subplan (a) of `beebox/docs/plans/canvas-loop-scene.md`. The Stage 4
spike (`canvas-loop/src/scene-spike/`) records each `draw` as a scene and
renders it with our own WebGPU renderer, in the browser and headless through
Dawn. This subplan promotes that spike into canvas-loop's only API and
renderer. The Canvas2D painter and `v.ctx` retire, the headless CLI and the
gallery run on Dawn, the dev-loop tools run on the new renderer, and the docs
describe the new API. Subplan (b) moves brush expansion to the GPU; subplan
(c) moves beebox's figure card, `bbx figure run`, the server and the box
guidance. This plan leaves a clear seam for each.

**Issues addressed:** none. Searched `issues/` and `private-issues/` for
canvas-loop, Canvas2D, painter, WebGPU, Dawn, gallery and scene: nothing open
is about the renderer. Related, not closed by this plan:
`issues/closed/bugs/2026-07-18-canvas-loop-figure-post-merge-followup.md` (item 1,
canvas overflow at phone width). Its fix is already in the stylesheet that the
scene mount keeps: `canvas-loop/src/browser/figure.css:12` *".cl-canvas {
display: block; max-width: 100%; height: auto; …"*. Confirming it at 390 px
is subplan (c)'s card work.

## Design

No design section: this plan changes a developer library and its reference
docs. A person meets canvas-loop only through beebox's figure card, which
subplan (c) owns. canvas-loop's `TEA.md` and `BRUSHES.md` ship to boxes as
docs (`beebox/src/core/docs-gen/package-docs/canvas-loop-doc.ts:41`
*`return shipped("TEA.md", "canvas-loop.md");`* and `:45`), so the rewritten
docs reach box agents, but only when (c) lands, because this plan does not
merge without (c) (Rollout shape).

## Smallest fix and budget

**Smallest change that meets the boxholder's decisions.** Make the spike's
runner and mount the defaults, delete the painter, and fix whatever the
gallery breaks. That leaves two runners' worth of features half-merged: the
spike runner has no determinism guards, no engagement verdicts, no sound, no
`--zoom`, `--outline` or `--timing` (What already exists). It also leaves the
gallery unjudged against the Stage 0 baselines, and docs that describe an API
that no longer exists. Each of those fails principle 1 (agent DX) or 2 (art
that does not look lazy) directly.

**The chosen design**, in chunks (Implementation order):

| Chunk | What | Authored source | Authored tests | Whole-file deletes | Moves (renames) |
|---|---|---|---|---|---|
| 1 | Final module layout, names cleaned | ~600 | ~150 | ~1,370 (`scene-draft/` sketches) | ~13,000 |
| 2 | One headless runner | ~1,050 | ~680 | ~550 (spike runner, util) | — |
| 3 | Existing checks ported, error paths, off-canvas fold | ~500 | ~380 | — | — |
| 4 | `material.receivesShadow` | ~150 | ~200 | — | — |
| 4b | Frame budget, closed on whole-frame browser measurements | ~300 | ~100 | — | — |
| 5 | Gallery and examples migrated and judged | ~1,500 (sketches, meta) | ~100 | ~3,900 (`scene-ports/`) | ~1,400 (`scene-drawers/`) |
| 6 | The switch: painter and `v.ctx` retire; browser consumers, React readiness | ~1,250 | ~950 | ~4,500 (painter, Canvas2D surfaces, old tests) | — |
| 7 | Docs | — | ~50 | — | — |
| 8 | Baselines and hand-off | — | — | — | — |

- **Authored source and tests:** about 8,000 changed lines (additions plus
  deletions), including about 150 in beebox (chunks 2 and 6).
- **Whole-file deletions:** about 10,300 lines. They are mechanical, but they
  count.
- **Moves:** about 14,400 lines renamed with import-path edits; the import
  edits are counted in chunk 1.
- **Authored docs:** about 1,500 lines (`TEA.md`, `BRUSHES.md`, `README.md`,
  `AGENTS.md`, a new `RENDERER.md`, `CHANGELOG.md`, the gallery README, the
  gallery judging table).
- **Generated output:** none committed except the frozen parity references
  (chunk 6, under 2 MB of PNG).

**BIG CHANGE.** About 19,800 changed lines in all, about 9,500 of them
authored (re-estimated after review round 1: the three new diagnostics and
the lowered-job cache are out; React readiness, the browser consumers and the no-adapter
case are in). What drives the size:
- the painter, its tests and the Canvas2D surfaces are deleted (about 4,500
  lines);
- two runners become one, with every feature of both (chunk 2);
- 18 gallery exercises use calls that are removed, and each is ported and
  judged by eye against its Stage 0 frames (chunk 5);
- today's faint-mark, missing-glyph and label-overlap checks are ported to
  the GPU renderer (chunk 3);
- the whole drawing reference is rewritten (chunk 7);
- the recorder and the non-brush lowering are cut until whole-frame browser
  measurements meet targets 1 and 3, or the miss goes to the boxholder
  (chunk 4b).

The spike itself (9,456 lines) moves, it is not rewritten. Implementation
needs the boxholder's approval at this size.

## Stated preferences this plan trades against

- **The boxholder's Checkpoint 4 answers**
  (`beebox/docs/plans/canvas-loop-scene/stage4/checkpoint4.md:131-140`): our
  own WebGPU renderer with Dawn headless, confirmed; placement snapping kept;
  `material.receivesShadow` added; hatching coverage left as it is; desktop
  numbers accepted. No Skia fallback and no WebGL2: this plan deletes the
  painter outright instead of keeping it as a reference renderer.
- **"Don't worry about backward compatibility."** No compatibility layer for
  the old `View`. The one concession is a clear error for a removed call
  (chunk 3), because box figures written for the old API will meet the new
  runtime until their agent regenerates them (subplan c).
- **Principle 1, agent DX** (`canvas-loop-scene.md`, "The principles"):
  "Testing, diffs, warnings, etc." Every dev-loop tool of today's runner
  survives (chunk 2), and today's checks the spike lacks are ported
  (chunk 3).
- **Principle 4, speed in the browser.** Checkpoint 4 says targets 1 and 3
  miss "for one reason: brush expansion runs on the CPU"
  (`checkpoint4.md:72`). That is incomplete. The Stage 4 profile gives
  the walker's record step as 11.4 ms per frame in Chromium
  (`stage4-plan.md:209` *"walker sheet 16.8–18.6 → 22.8 fps (record 11.4,
  lower 23.5, atlas 4.0)"*), nearly the whole 12 ms budget of target 1
  (`canvas-loop-scene/browser-profile.md:76-77`). Subplan (b) projects the
  walker frame after GPU expansion at "about 21–25 ms, 40–48 fps"
  (`canvas-loop-gpu-brushes.subplan.md:95-96`) and assigns the recorder and
  the non-brush lowering to this plan (its open question 1). Chunk 4b takes
  them.
- **Principle 2, art.** The gallery is judged against the Stage 0 baselines by
  eye and by the parity criteria (chunk 5), with an Astra read first
  (main plan, "Visual reviews use Astra").
- **Engineering principles** (`beebox/docs/engineering-principles.md`):
  - §8 *One way to do each thing*: one runner, one mount, one `View`, one
    error class per kind. The transition marker (chunks 2–5) reuses the
    spike's existing `renderer` export instead of a new mechanism, and chunk 6
    deletes it.
  - §4 *Resilient AND never silent*: a removed call, a render error and a
    missing GPU adapter each fail with a message that names the cause, or
    for a missing adapter its possible causes.
  - §10 *Testability is architectural*: the decisions in the new warnings
    (off-canvas folding, removed-call messages) are pure functions over
    recorded data, tested without a GPU.
- **Repo rule on dependencies** (root `AGENTS.md`, "Implement and verify"): no
  new dependency. `webgpu` and `@webgpu/types` are already in
  `canvas-loop/package.json` (lines 50 and 66 of the dependency lists).
  `@napi-rs/canvas` stays: the recorder measures text with it, the glyph atlas
  rasterises with it, and PNG encoding and `cli zoom` use it
  (`canvas-loop/src/scene-spike/device.ts:64` *`const { createCanvas } = await
  import("@napi-rs/canvas");`*).
- **Precedent for migrating the gallery:** retired sketch forms were
  "rewritten mechanically", with `meta.yaml` saying so in `migrated`
  (`canvas-loop/src/gallery/README.md`, "Some exercises were first written…"),
  and `runs.jsonl` has a `ported` action
  (`canvas-loop/src/gallery/README.md:72` *"or `ported` (rewritten for a new
  tier or API shape)"*). This plan follows that precedent.
- **GPU load.** The machine crashed once under parallel GPU load during
  Stage 4. The spike already keeps GPU tests in one process
  (`canvas-loop/test/scene-spike/gpu.test.ts:1-2` *"Everything that needs a
  GPU, in one file so one process holds one Dawn device"*). When every
  headless test needs Dawn, that rule needs a mechanism (chunk 2).

## What already exists

Reused (moved, renamed, kept):
- **Recorder** (`canvas-loop/src/scene-spike/recorder/view.ts`, 346 lines,
  plus 17 modules): the scene `View`, checks at the call, picture versions,
  the stale-capture audit, off-canvas tracking, stand-ins, light checks.
  Reuse.
- **GPU renderer** (`canvas-loop/src/scene-spike/gpu/`, 37 modules): coverage
  atlas, marks, smear, clips on shared pages, effects, wash, hatching, paper,
  lighting, kept rasters, pass timing. Reuse.
- **Brush expansion** (`canvas-loop/src/scene-spike/brush/expand.ts:1-3` *"The
  shared CPU step for brushed strokes (draft section 9): a stroke becomes
  dabs, ink outlines or bristle runs by canvas-loop's own sampling and kind
  painters (core/brush)"*), through a recording context
  (`brush/record-ctx.ts:1-4` *"A Ctx2D that records what canvas-loop's brush
  kinds … paint instead of rasterising it"*). Reuse unchanged; subplan (b)
  replaces it.
- **Browser mount and sleep** (`scene-spike/browser/mount.ts`, `surface.ts`,
  `sleep.ts`, `shared-gpu.ts`) on today's fixed-step runtime
  (`canvas-loop/src/browser/runtime/engine.ts`, through its `DrawSurface`
  interface, `runtime/engine-types.ts:34`). Reuse.
- **Dev-loop cases** (`canvas-loop/test/scene-spike/dev-loop/cases.ts`, 46
  rows) and the cache-equivalence, raster, light, paint, picture, text and
  brush cases under `canvas-loop/test/scene-spike/`. Reuse.

Reused from today's runtime, with the Canvas2D surface swapped out:
- **The headless runner** (`canvas-loop/src/headless/tea-runtime.ts`): event
  dispatch, engagement verdicts, activity lines, sound, frame dedup through
  `FrameRecorder`, checkpoints, and the determinism guards
  (`tea-runtime.ts:198` *`withGuards(() => this.#execute());`*). Keep it as
  the one runner. The spike runner lacks these: its `#call`
  (`scene-spike/run/runner.ts:183`) installs no guard against `Math.random`
  or `Date.now`, and its `Util.handled` is empty
  (`scene-spike/util.ts:52` *`handled(_name: string): void {}`*), so it gives
  no engagement verdicts.
- **CLI, gallery check, diff, zoom, checkpoints** (`headless/cli.ts`,
  `gallery.ts`, `diff.ts`, `recorder/zoom.ts`, `checkpoint/`): they read PNGs
  or call `teaRun`, so they keep working once `teaRun` is async. Reuse.
- **Text measurement** (`canvas-loop/src/core/painter/text/measure.ts`,
  `layout.ts`): the recorder already uses them. Move to `core/text/`.
- **Text checks** (`canvas-loop/src/core/painter/text-watch.ts`): label overlap
  and missing glyphs. Port into the recorder (chunk 3); the spike has
  neither.
- **Faint-mark rule** (`canvas-loop/src/core/painter/faint.ts:6` *`const FAINT
  = 0.08;`*). Port the rule; the measurement moves to the GPU (chunk 3).

Rebuilt, with the reason:
- **The spike runner's transcript writer** (`runner.ts:120-131`): replaced by
  `FrameRecorder`, which already writes the transcript format agents know.
- **`SpikeUtil`** (`scene-spike/util.ts`): replaced by today's `TeaUtil`
  (`headless/tea-view.ts:119`), rebuilt on a seeded random stream and the text
  measurer, because `TeaUtil` reports `handled` names.

Deleted (chunk 6): `core/painter/` (except `text/`), `core/view.ts`,
`headless/surface.ts`, `headless/tea-view.ts`'s `TeaView`,
`browser/runtime/{canvas-surface,browser-view,layer}.ts`, `scene-spike/run/`,
`scene-draft/`, `examples/scene-ports/`, and the exports `./scene-browser`
and `./scene-headless` (`canvas-loop/package.json:25,29`).

beebox's current use (`beebox/src/cli/commands/figure/run-one.ts:89-92`
branches on `figureRenderer(imported) === "scene"` to `runSpike`;
`beebox/src/frontend/src/lib/figure-canvas-loop.ts:77` `rendererMismatch`
checks the same export against `mountSceneSketch`). Chunk 6 removes both
branches, because one renderer remains.

## Prior art (external)

No design decision here depends on a new external premise. Dawn
(`webgpu` 0.6.2) was chosen and probed in Stages 3 and 4; its fit is
recorded in `canvas-loop-scene/stage3/dawn-linux.md` and
`stage4/checkpoint4.md`. One premise is checked, evaluated only: Node's test
runner serialises test files with `--test-concurrency=1`
(https://nodejs.org/api/cli.html#--test-concurrency); this machine runs Node
24.18.0, where the flag exists. Chunk 2 uses it to keep Dawn processes from
running in parallel.

## Ontology

Every noun exists in the spike or today's runtime; this plan adds one value
(`receivesShadow`) and renames none of the sketch-facing nouns.
- **View:** what `draw(v, model, params)` receives. After chunk 6 it is the
  scene View, the type now in `canvas-loop/src/scene-draft/scene-api.ts`
  (`View`), exported from the package root as `View`. It is not the Canvas2D
  View in `canvas-loop/src/core/tea.ts:200` (which has
  `readonly ctx: SKRSContext2D;` at `:281`).
- **Scene:** one frame's recorded nodes (`scene-spike/scene.ts`). Plain data,
  kept for waking and re-rendering.
- **Recorder:** the class that implements View and builds a scene
  (`SceneRecorder`, `recorder/view.ts`).
- **Renderer:** `GpuRenderer` (`gpu/renderer.ts`), one per run or per figure,
  over a **GPU handle** (`GpuHandle`, `device.ts`): one device per process
  headless, one per page in the browser.
- **Testing mode:** a headless run. The recorder audits pictures, parses
  colours at the call, and gives warnings; the renderer may read back for
  checks (faint marks, flat hatching).
- **Transcript:** `transcript.md` written by `FrameRecorder`. One format for
  every run.
- **Surface:** what a runtime draws a frame through. Browser: `DrawSurface`
  (`browser/runtime/engine-types.ts:34`), implemented by `SceneSurface`.
  Headless: chunk 2 adds the same seam to `TeaRunner` for the transition; after
  chunk 6 only the scene surface remains, and the seam stays as the place
  subplan (b) does not need to touch.
- **Transition marker:** `export const renderer = "scene"` in a sketch module
  (`beebox/src/cli/commands/figure/run-one.ts:44-49` describes it). It exists
  only between chunks 2 and 6 and only on the branch.
- **Stage 0 baselines:** the gallery's frames from the Canvas2D renderer at
  commit `570e8ef21`, in `canvas-loop/out/baselines/570e8ef21/` (untracked;
  present on this machine; the script to recreate them is in
  `beebox/docs/plans/canvas-loop-scene/README.md`).
- **Scene baselines:** the same frames from the GPU renderer at the end of
  chunk 8, in `canvas-loop/out/baselines/<commit>/`, with (b)'s GPU
  expansion in. The reference for renderer work after this redesign.
- **`material.receivesShadow`:** a material value, default `true`; `false`
  means no light's shadow falls on that shape (draft 2.9, section 21). It
  composites by coverage like the other material values. It is not
  `castsShadow`, which says whether the shape blocks light.

## Tracks / scope

Ordered by dependency: layout first, so subplan (b) can start on final paths;
then the runner, which every later chunk runs through; then checks and
`receivesShadow`, which the gallery migration benefits from; then the gallery;
then the switch that deletes the old code; then docs.

### Track 1: final module layout (chunk 1)

- **What:** move the spike to its final paths and remove "spike" from names.
  No behaviour change.
- **Why:** subplan (b) edits brush expansion and lowering; it needs final
  paths before it starts, or both subplans edit moving files.
  `scene-spike/` and `SpikeRun` describe a phase that ends.
- **Direction:** the layout after chunk 6:

  | Directory | Holds | GPU? |
  |---|---|---|
  | `src/core/` | the authoring types (`tea.ts`, `paint.ts`), brush presets and kinds, sound, ease, shapes, contours, prng, format, errors, `text/` (from `core/painter/text/`) | no |
  | `src/scene/` | `scene.ts`, `recorder/`, `hash.ts`, `mat.ts`, `colors.ts`, `call-site.ts`, `outline.ts`, `geometry/`, `brush/` (`expand.ts`, `record-ctx.ts`, `contours.ts`), `errors.ts` | no |
  | `src/gpu/` | `renderer.ts`, `lower.ts`, passes, shaders, `device.ts`, `browser-device.ts` | yes |
  | `src/headless/` | one runner (`tea-runtime.ts`), `tea-util.ts`, CLI, gallery check, diff, checkpoints, `recorder/` | via `gpu/` |
  | `src/browser/` | `mount.ts` (`attachSketch`, `mountSketch`), `runtime/engine.ts`, `scene-surface.ts`, `sleep.ts`, `shared-gpu.ts`, controls | via `gpu/` |

  In chunk 1 the draft types move from `scene-draft/scene-api.ts` to
  `scene/api.ts`; chunk 6 merges them into `core/paint.ts` and `core/tea.ts`.
  Renames: `runSpike` → deleted in chunk 2; `SpikeRunOptions` → deleted;
  `SceneMountError` → `SketchMountError` in chunk 6; messages that say
  "scene spike:" (for example `scene-spike/mat.ts:87`) say what is not
  supported, without the word "spike". Comments that cite "draft section N"
  cite `RENDERER.md` or `TEA.md`/`BRUSHES.md` sections after chunk 7.
  `scene-draft/examples/` and `scene-draft/probe/` are deleted: they were
  written against types with no runtime, and git keeps them.
  `test/scene-spike/` moves to `test/scene/` and `test/gpu/`.
- **Vocabulary lock-ins:** directory names `scene/`, `gpu/`; file names
  `scene/brush/expand.ts`, `gpu/lower.ts`, `gpu/marks.ts`,
  `gpu/mark-atlas.ts`, `gpu/shader-mark.ts`, which subplan (b) names.
- **First implementation chunk:** `git mv` per the table, fix imports, rename
  as listed, delete `scene-draft/examples/` and `probe/`, update the
  `scene-browser`/`scene-headless` export paths and the `typecheck` script's
  `-p src/scene-spike/browser/tsconfig.json`. Done when typecheck, lint,
  `pnpm layout-check`, the tests and `gallery:check` pass, and the three
  ports render the same PNG bytes as before the move.

- **As built (commit `64f107a74`).** The table failed `pnpm layout-check`
  (unit directories; names that repeat their directory), so the paths are:
  `scene/nodes.ts` (was `scene.ts`), `scene/api.ts`; `device/open.ts` and
  `device/browser.ts` (were `device.ts`, `browser-device.ts`);
  `headless/scene/` (`runner`, `guards`, `png`, `util`);
  `browser/scene/` (`mount`, `surface`, `shared-gpu`, `sleep`);
  `core/text/`. Tests: `test/scene/`, `test/gpu/` (`renderer.test.ts`),
  `test/headless/scene/`, `test/browser/scene/`. The paths subplan (b) names
  are unchanged. Later tracks read with these paths.

### Track 2: one headless runner (chunk 2)

- **What:** `teaRun` becomes the only headless runner. It runs a sketch
  through the recorder and the GPU renderer, with every feature of today's
  runner and every fix of the spike runner.
- **Why:** each runner lacks what the other has. The spike runner has no
  determinism guards (`runner.ts:183`), no engagement verdicts
  (`util.ts:52`), no sound, no `--zoom`, `--outline`, `--timing` or `--fps`,
  no frame dedup, and does not list scripted inputs or snapshot labels
  (`stage4-plan.md`, chunk 6b, "Gaps"). Today's runner has no scene, no
  `SketchRunError`, no once-per-run warnings with the sketch's line, no
  undeclared-param guard and no `--scene`.
- **Direction:**
  - `teaRun(options): Promise<RunResult>`; `RunResult` keeps its shape
    (`headless/recorder/frame-recorder.ts`, `transcriptPath`, `framesRun`,
    `imageCount`, `errors`), so beebox's result line does not change.
  - `TeaRunner` takes a headless surface with two methods, `draw(view
    callback)` and `capture(): Promise<Pixels>`. During the transition the
    Canvas2D `Surface` and a new scene surface both implement it; the module's
    `renderer` export picks one, as beebox does today. `toTeaModule` drops
    unknown exports today (`headless/tea-load.ts:170-173` returns only
    `params`, `canvas`, `init`, `update`, `draw`, `sound`, `activity`), so
    `LoadedTeaModule` gains an optional `renderer: "scene"` for the
    transition, and `gallery.ts:105-121`, the CLI and beebox's `run-one.ts`
    get it through that one loader. Chunk 6 deletes the field and the
    Canvas2D surface.
  - Guards: today's `withGuards` wraps the whole run synchronously
    (`tea-runtime.ts:198`). With an async render it wraps each sketch call
    (`init`, each `update`, `draw`, `sound`, `activity`) instead, so no await
    happens under it.
  - Capture: `FrameRecorder` decides whether frame N is captured, as now
    (`frame-recorder.ts:125-135`); the runner then awaits the render and hands
    the pixels to `FrameRecorder` for dedup and encoding. Only captured frames
    are rendered, as in the spike.
  - A step that throws: the transcript ends with the spike's error line
    (`frame N: error in <step>: …` and the sketch's stack lines), and
    `RunResult.errors` holds the same text. The failed frame has no image;
    the frames before it stay. Today's runner captures the half-painted
    canvas (`frame-recorder.ts:118-120`); the scene equivalent would need
    the recorder to close open scopes mid-throw, and the line already says
    where it stopped.
  - Kept from the spike: undeclared-param guard (`run/guards.ts`
    `guardParams`), once-per-run warnings and hints with the line, the
    `param:` line, control stand-ins above the scene, `--scene [first]`,
    `--ratio` (default 1).
  - `--outline`: the recorder's debug boxes (`recorder/debug.ts`), clip
    outlines and picture placements are appended to the captured scene as
    plain strokes with labels, the way stand-ins are appended
    (`runner.ts:159`). `--timing`: one summary line as today
    (`headless/recorder/timing.ts`) plus, per captured frame, the renderer's
    counts (passes, effect passes, copies, draws, strokes expanded, cache
    hits, kept-raster bytes) and pass times when the device grants
    timestamps. Without `--timing`, the per-frame counts line is not
    written (the spike writes it every frame, `runner.ts:155`).
  - One GPU handle per process, opened on first use and kept; `gallery check`
    runs every exercise twice on it.
  - Tests: every test file that opens Dawn is named `*.gpu.test.ts`. The
    `test` script runs the other files in parallel, then the GPU files with
    `--test-concurrency=1`, one process at a time.
  - No GPU adapter: `teaRun` writes the transcript with the failure line,
    then throws `NoGpuAdapterError` with a `transcriptPath` field naming that
    transcript (subplan (c) reads it); the error is not put in
    `RunResult.errors`, so a caller (subplan (c)) catches it by class. Its
    message lists possible causes (no Vulkan driver, such as Mesa's
    lavapipe on Linux; a driver this user cannot open; a sandbox that hides
    the GPU) and does not claim which. A test opens the runner on a GPU
    entry whose `requestAdapter` returns `null` (the injection point is
    `openOn(gpu, …)`, `browser-device.ts:44`) and checks the class, that
    `transcriptPath` names the written transcript, the
    transcript line and that no frame was written.
  - Exports: the `./scene-headless` export (`package.json:29`) is removed in
    this chunk with the spike runner it points at.
  - beebox: `run-one.ts` calls `await teaRun(…)` for both renderers and stops
    importing `./scene-headless`.
- **Vocabulary lock-ins:** `teaRun` is async; `--ratio`, `--scene [first]`
  join the CLI; `*.gpu.test.ts`.
- **First implementation chunk:** the async `teaRun` with the two surfaces,
  per-step guards, the merged features above, the CLI flags, the test-script
  split, the beebox `run-one.ts` change, and today's `tea-runtime.*.test.ts`
  files run against both surfaces. Done when those tests, the spike's runner
  tests (`run.guards`, `run.params`, `--scene first`, the 46 dev-loop rows)
  and `gallery:check` pass, and `scene-spike/run/runner.ts` and `util.ts`
  are deleted.

- **As built (chunk 2).** Paths: `layout-check` makes the runner and its
  guards one unit, and `max-lines` (300) refuses them as one file, so the
  runner is `headless/tea-runtime/runner.ts` with `tea-runtime/guards.ts`;
  the CLI is `headless/cli/main.ts` with `cli/args.ts` (`--scene [first]`);
  the seam is `headless/frame-surface.ts` (`FrameSurface`, and
  `CanvasFrameSurface` over today's `Surface`); the scene surface is
  `headless/scene/surface.ts` with `scene/outlines.ts` (clip and placement
  outlines for `--outline`); `TeaUtil` is `headless/tea-util.ts`. Later tracks
  read with these paths. Details settled here:
  - The surface has, beside `draw` and `capture`, `text` (what `u.textWidth`
    and `u.textBounds` measure with), `adapter`, `finish` (end-of-run
    warnings) and `close`. `capture` returns the pixels, the `--timing` lines
    and the `--scene` outline.
  - One transcript format on both surfaces. The error line is
    `frame N: error in <step>: Name: message (at <sketch line>)`, then a
    fenced block of the sketch's stack lines; `RunResult.errors` holds the
    same line. It replaces `**[frame N]** ERROR Name: message` with the full
    stack. No surface captures the failed frame. Recorder warnings are
    `**[frame N]** warn:`, hints use a new log level (`**[frame N]** hint:`),
    and the off-canvas warnings are tagged with the last frame (the spike's
    `end of run: warning:` prefix is gone). The `--scene` outline is a fenced
    block after the frame's image. A scene run's header adds `- ratio:` and
    `- adapter:`.
  - The undeclared-param guard and the spike's starting-param check (`refused,
    since it would be clamped …`) apply on both surfaces.
  - `--ratio` other than 1 and `--scene` on the Canvas2D surface are errors.
  - Guards (after two review rounds): each synchronous sketch call (`init`,
    each `update`, `draw`, `sound`, `activity`, and the check and freeze of
    its result) runs with `Math.random`, `Date.now`, `performance.now` and
    argless `Date` replaced. Scheduling is replaced too: the timers,
    `queueMicrotask`, `process.nextTick`, `Promise.prototype.then` and
    `requestAnimationFrame`. Each stub throws a `DeterminismError` at the
    call ("sketch code runs synchronously; it cannot schedule work"). All of
    it is restored synchronously in a `finally` around the call. No process
    handlers are touched. Console capture is per run, and a second concurrent
    `teaRun` in the process is refused.
    *Accepted limitation:* an `async` function the sketch starts and does not
    return. Native `await` does not call `Promise.prototype.then`, so its
    continuation runs after the call, unguarded. A test in
    `tea-runtime.guards.gpu.test.ts` shows this; nothing more is built for it.
  - The process's device is opened with timestamps asked for (`--timing` pass
    times) and is never destroyed; Dawn does not keep Node from exiting.
  - beebox: `figureRenderer` and `FigureRendererError` are deleted; the check
    is in `toTeaModule`, and its test moved to canvas-loop
    (`test/headless/tea-load.test.ts`). `run.ts` reads only the
    `**[frame N]** warn:` form.
  - Tests: today's `tea-runtime.*` files are `tea-runtime.*.gpu.test.ts`, each
    test once per surface; `test/gpu/renderer.gpu.test.ts`; the no-adapter
    test (`tea-runtime.no-adapter.test.ts`) uses a stand-in GPU entry and opens
    no device. The three ports export `renderer = "scene"` so `cli run`
    renders them; their PNGs are byte-identical to chunk 1's, and chemistry's
    three frames that equalled frame 0 are now written once (frame dedup).

### Track 3: dev-loop completion (chunk 3)

- **What:** port today's checks that the spike lacks (faint marks, missing
  glyphs, label overlap), fix the three "other finds" in
  `stage4/dev-loop.md`, fold the off-canvas warning under a moving camera,
  and give old sketches a clear error. The three new diagnostics the
  checklist proposed (`empty-clip`, `flat-hatching`, `deep-nesting`) are
  deferred (NOT in scope); their rows stay `todo`.
- **Why:** principle 1. Today's runtime has a faint-mark check and a
  label-overlap check (`canvas-loop/TEA.md:231-235`), and draft section 10
  lists both as "kept"; the spike has neither. The checklist has no row for
  label overlap, so its 46/46 accounting does not show that gap.
- **Direction** (each warning is once per run, with the sketch's line):

  | Item | Decision |
  |---|---|
  | `faint-mark` (row 42) | Today's rule (`faint.ts:6`, 8% peak opacity after group opacities; `gesture({ faint: true })` silences it; at most 8 warnings). The measure is the mark's resolved alpha: coverage × paint alpha × paper grain × brush opacity, as the mark's composite draw computes it. Paint and paper are applied there, apart from coverage (`gpu/records.ts:73-76`), and ink reads the coverage atlas while stamps read the mark atlas (`gpu/marks.ts:59-61`, `records.ts:74` `src` 0 or 3/4), so the maximum is taken in that composite draw, not from either atlas. In testing mode only, a variant of the draw also writes each mark's maximum into a storage buffer (atomic max), read back once per captured frame; the CPU multiplies group opacities. Cases: a translucent pencil line (today's row), a translucent ink line, an ink line under a 5% group, and an opaque marker that must not warn. A test checks the colour output is byte-identical with and without the variant. |
  | `missing-glyph` (row 43) | Port `text-watch.ts`'s glyph check to the glyph atlas, which already rasterises each glyph on the CPU (`gpu/glyphs.ts:1-4`). Headless only, as today. |
  | Label overlap (missing row) | Port `text-watch.ts`'s overlap check to the recorder: text bounds under their transform, once per pair, at most 10 pairs, as `TEA.md:231-233` says. |
  | Render errors name the node | `lower.ts` keeps the node path while lowering (`group "room" > place "citizen" … > circle #4`, draft section 10) and `GpuRenderError` carries it. |
  | Browser parses colours at render | The browser recorder gets a colour parser from an `OffscreenCanvas` 2D context made at mount, before the GPU code loads (`browser-device.ts` `browser2d`). |
  | Canvas exactly 8192 px wide | The atlas piece for a shape is clamped to the device canvas, so the 4 px padding no longer pushes it past the texture limit. |
  | Off-canvas under a moving camera | A candidate line whose canvas box changed during the run joins one summary warning ("N lines draw only off the canvas while moving, on every frame 0–89: lines …; a camera that has not reached them, or a wrong sign"). A line whose box never moved warns on its own, as now (`recorder/off-canvas.ts:157`). The drawer's room that gave 7 warnings (`checkpoint4.md:41-43`) gives one. |
  | Removed calls | The recorder answers `v.ctx`, `v.cache`, `v.sprite`, `v.image` and `v.paperTexture` with a `RemovedCallError` (a `SketchUsageError`, with `call` and `replacement` fields) that names the replacement and the doc section (`v.picture` and `v.place`; `group({ effects: { paper } })`; `at({ matrix })`, `v.pixels`, `lighting` for `ctx`). These members are not in the `View` type; they exist so an old compiled figure fails with a message instead of `v.cache is not a function`. |

  The folding and message decisions are pure functions with their own
  tests; only the faint-mark readback needs the GPU.
- **Vocabulary lock-ins:** the warning texts above, which agents will read.
  The readbacks happen only in testing mode, never in the browser.
- **First implementation chunk:** all rows in the table, each with a
  dev-loop case in `cases.ts` and its expected text. Done when rows 42 and
  43 pass, three new rows (label overlap, removed call, moving off-canvas)
  pass, the 41 rows that pass today still pass, and rows 37, 41 and 45 stay
  `todo` with a pointer to the follow-up list.

- **As built (chunk 3).** Paths: `scene/recorder/audit.ts` (testing mode's
  checks made together: off-canvas, text, and each brushed mark's call site),
  `scene/recorder/text-checks.ts` (label overlap, missing glyphs, the
  unknown-font check moved here), `scene/recorder/removed.ts`,
  `gpu/node-path.ts`, `gpu/peaks.ts`, `headless/scene/faint.ts`; `GlyphWatch`
  is in `gpu/glyphs.ts` beside the glyph atlas, reached through
  `GpuRenderer.glyphMissing` (a separate `gpu/` module made `layout-check`
  call `gpu/` two units). Details settled here:
  - Faint marks: `GpuRenderer({ peaks: true })` measures in every `render`;
    the headless surface always asks for it, the browser never. A mark's slot
    index rides in the draw record's spare word (`clipA.z`); the peak is taken
    before any clip, so a clipped mark is judged by what its brush and paint
    give it. The message is today's, with the call in place of a position:
    `faint mark (line): it reaches only 3% opacity and will barely show
    (gesture({ faint: true }) marks it as intended) (at …)`. The marker
    preset peaks at 70%, its brush opacity.
  - Warnings found after the call (overlap at the frame's end, faint marks
    after the render) name the line through a kept stack (`callSite()` in
    `call-site.ts`), formatted only when a warning is given.
  - Missing glyphs are checked at the `v.text` call, through the glyph
    atlas's rasteriser, not when the atlas is built: the call gives the line,
    and frames that are not captured are checked too.
  - Render errors: `UnsupportedCallError` and `GpuRenderError` raised while
    lowering become a `GpuRenderError` with `path` and the original as
    `cause`; other errors (a `SketchUsageError` for a colour) pass through.
  - 8192 px: besides the cut's padding, an atlas page also added its 1 px
    gap past a piece at the page's edge (8193 wide); the page is now capped
    at the atlas side. `failedFrames` fails late through a blurred group
    instead, whose mark is wider than the atlas.
  - Browser colours: `SceneSurfaceDeps.colors`, made at mount from
    `browser2d()`; its case is in `test/browser/scene/surface.test.ts`, as
    `cases.ts` runs headless only.
- **Review fixes (chunk 3).** Each peak slot is one mark item, multiplied by
  its own layer's opacity before the largest per mark is taken. A picture
  tile drawn while measuring keeps its marks' strengths (relative to the
  tile) beside its kept raster; a frame that reuses the tile takes them times
  the opacity around the reuse, so raster reuse and its hit counts are
  unchanged. (Bypassing raster reuse while measuring was smaller, but every
  headless run would then skip the tile cache the browser uses.)
  `shelfPack` caps the packing width at the atlas side before fitting. A
  label in a picture keeps its four corners through placements; the upright
  box is taken once, after the transforms compose.
- **Follow-ups (chunk 3).** Rows 37 (`empty-clip`), 41 (`flat-hatching`) and
  45 (`deep-nesting`) stay `todo`; they are the new diagnostics under "NOT
  in scope", with their proposals in `stage4/dev-loop.md` ("Gaps left").

### Track 4: `material.receivesShadow` (chunk 4)

- **What:** draft 2.9, section 21: `receivesShadow: false` on a material
  stops every light's shadow on that shape; the shape is still lit and still
  casts.
- **Why:** side views (Checkpoint 4, decision 4): casters throw shadows up a
  sky.
- **Direction:** the two material layers have no spare channel
  (`gpu/material.ts:4-7`: layer 0 holds normal x, y, shine and coverage;
  layer 1 holds emissive, casting amount, caster height and coverage). A third
  layer holds the non-receiving amount, premultiplied, with coverage, so it
  composites through erase, clip, mask and opacity like the others. Every
  shape in the group draws into it (receiving shapes as 0), so its alpha is
  the pixel's whole material coverage. The shader reads it per unit of
  material coverage, as draft section 17 requires and the shader already does
  for normal, shine and emissive (`gpu/shader-light.ts:176-180`):
  `nonReceiving = L2.r / L2.a` where `L2.a` is above the shader's existing
  1e-4 floor, else 0. A translucent non-receiving shape alone therefore
  receives no shadow, antialiased edges included; over an opaque receiving
  surface at half alpha it is half non-receiving. The recorder marks a lit
  group that contains `receivesShadow: false` (in a style or a placement's
  `material`); only those groups draw the third layer, so other scenes pay
  nothing. Each light's shadow factor becomes `mix(shadow, 1,
  nonReceiving)`. The recorder checks the value
  is a boolean and names the field otherwise.
- **Vocabulary lock-ins:** `material.receivesShadow?: boolean`, default
  `true`.
- **First implementation chunk:** the field in the types and recorder, the
  third layer and the shader change, tests: a sky behind a caster keeps its
  lit pixels; a half-transparent non-receiving shape alone receives no
  shadow on any pixel, its antialiased edge included; the same shape over an
  opaque receiving rect receives half the shadow; a placement's `material` supplies it; a non-receiving caster still
  casts; a group without the value draws two material layers, as before.
- **As built (chunk 4).** The mark is `GroupNode.nonReceiving`, set by
  `holdsNonReceiving` (`scene/recorder/light.ts`); it looks through
  placements, unlit groups and mask bodies, and skips nested lit groups and
  mask artwork, which add no material of their own to the outer group. A
  placement's `material` with the value marks the group even when every shape
  in the picture has its own material; the extra layer then holds zeros. A
  pixel that is wholly non-receiving skips the shadow march. Cases:
  `test/gpu/receives-shadow-cases.ts`. The night-room drawers and the Hallway
  port render the same bytes as before.

### Track 4b: frame budget (chunk 4b)

- **What:** after (b)'s chunks 1–6, measure whole frames in the browser and
  cut recording and non-brush lowering until targets 1 and 3 are met, or
  hand the miss to the boxholder.
- **Why:** principle 4. Targets 1 and 3 cannot be met by subplan (b) alone
  (Stated preferences). The walker's frame in Chromium at ratio 2 is
  record 11.4 + lower 23.5 + atlas 4.0 + encode 1.3 ms
  (`stage4-plan.md:209`; encode 1.3 from `:196`). (b) takes brush expansion, mark placement
  and mark atlas data (about 15 + 6 + 4 ms before the speed round,
  `canvas-loop-gpu-brushes.subplan.md:48-56`) to under 2.5 ms of CPU. What
  is left is this plan's: the record step and the rest of lowering (fill and
  clip geometry, about 4 ms in Node, `stage4-plan.md:195`; "lowering without
  brushes 6–9" in Chromium, `canvas-loop-gpu-brushes.subplan.md:95`).
- **What the record step is made of** (Node, before the Stage 4 speed round,
  `stage4-plan.md:191-196`): 17.2 ms, of it structural hashing 5.6,
  `structuredClone` of path commands 3.6, the sketch's own code about 2.
  After that round: 6.7 ms in Node, 11.4 in Chromium. The Chromium figure has
  no breakdown; the profiles in `scratch/stage4/walker-speed/`
  (`browser-main.cpuprofile`, `cpu*.txt`) are Node profiles of the whole
  frame, where garbage collection is the largest self entry (13.8% in
  `cpu1.txt`). The first step of this chunk is a Chromium profile of the
  record step alone.
- **Direction.** Levers, in the order they are tried, each measured before
  the next:
  1. Testing-mode work stays out of the browser: stack reads for call sites
     (`scene/call-site.ts`), off-canvas tracking, the picture audit and
     warning bookkeeping run only headless. Check each is gated.
  2. Structural hashing only where a key is read: a subtree's hash is
     computed when a cache asks for it (picture versions, shape geometry
     keys), not for every node while recording.
  3. Fewer allocations per call: argument capture writes into the scene's
     own arrays (draft section 6 allows avoiding copies "only where it keeps
     this meaning"); number checks without building option objects.
  4. Non-brush lowering through the existing caches only: hit rates and key
     cost of the shape geometry cache (`gpu/geometry-cache.ts`) and of the
     clip pages; no per-frame bind-group rebuild for unchanged pipelines. A
     cache of lowered jobs is not built: lowering depends on ancestor
     transforms, clips, materials and lighting (`gpu/lower.ts:40`), and a
     job holds frame-specific GPU resources (`gpu/jobs.ts:125`), so such a
     cache needs its own plan.
  Moving hashing out of recording can move its cost into lowering, since
  brush expansion and shape geometry read the keys (`scene/brush/expand.ts:161`,
  `gpu/shape-geometry.ts:28`); this is why acceptance is the whole frame.
  Output must not change: the three ports and the cache cases stay
  byte-identical, as in the Stage 4 speed round.
- **Acceptance** (Chromium on this machine, ratio 2, the Stage 4 speed pages,
  one heavy GPU process at a time, after (b)'s chunks 1–6):

  | Measure | Now | Acceptance |
  |---|---|---|
  | Target 1: walker sheet, whole frames | 22.8 fps | 60 fps sustained over 600 frames |
  | Target 3: six figures (two walker sheets, two chemistry, two Hallways, `scratch/stage4/mount-page.ts`) | 11.0 fps each | 30 fps or better each, and no dropped input: scripted pointer moves at 60 Hz all reach `update`, and the 95th-percentile time from an input event to the next drawn frame is at most 33 ms |
  | Target 2: lit panning room with walkers | not measured live | reported |
  | Record step; lowering without brushed strokes | 11.4 ms; 6–9 ms | guides of about 4 ms each, reported, not acceptance |
  | Headless frame (Node, Dawn) | 59.1 ms | reported |

- **Projection to 60 fps.** After (b) and this chunk: record 4 + non-brush
  lowering 4 + brushes 2.5 ((b)'s acceptance) + atlas 1–2 + encode 1.1, about
  13 ms of main-thread CPU per walker frame. That fits a 16.7 ms frame, so
  target 1 (60 fps) is reachable, but it is about 1 ms over the Stage 0
  "about 12 ms" draw-and-render budget. Target 3 (six figures at 30 fps,
  33 ms shared on one main thread) needs about two walker frames (26 ms) plus
  four lighter figures; the chemistry figure and the still Hallway run at
  60 fps today, so this is at the edge. The sum shows the targets are plausible; only
  the whole-frame measurement shows they are met.
- **A miss** of target 1 or 3 after the four levers is not "done": the
  chunk's checkpoint gives the boxholder the measurements and the profile,
  and the boxholder decides: relax the target, or plan further work (for
  example recording off the main thread, or a lowered-job cache), each its
  own plan.
- **Vocabulary lock-ins:** none; no API change.
- **First implementation chunk:** the Chromium profile of the record step,
  then the levers in order. Done when targets 1 and 3 are met, or the
  boxholder has decided on the miss; output stays byte-identical either way.

- **As built (chunk 4b): targets 1 and 3 missed (target 1 by about 2 fps); the boxholder decides.**
  Scripts, logs and profiles are in `scratch/stage5/a4b/` (`measure.sh`
  and `run.sh` for the pages, `profile.sh` for DevTools CPU profiles,
  `compare.sh` for output bytes). Measured in Chromium on this Mac at
  ratio 2 under the GPU lock, after the brushes subplan's chunks 7 and 8
  and their review fixes (`e4db1f99c`). The walker page is chunk 6's
  (`walker-page.ts`, 10 s of rAF, then 300 frames waited to GPU
  completion); the six-figure page is chunk 6's at device scale 2, with
  120 scripted pointer moves at 60 Hz on a chemistry figure. A game was
  running on the machine for most runs, so fps varies by about ±2 between
  equal builds; the per-step CPU medians are steadier. Medians, ms:

  | Step | Walker fps | Record | Lower | Brush (in lower) | Atlas | Encode | Six figures, fps each | Pointer p95 |
  |---|---|---|---|---|---|---|---|---|
  | Before (`5dd04b53e` + `e4db1f99c`) | 37.5 | 11.3 | 8.5 | 4.5 | 2.0 | 1.0 | 17.0 | 110 |
  | Lever 1: testing-mode work out of the browser | no change: already gated | | | | | | | |
  | Lever 2a: hash when a cache asks | 34.4 | 2.2 | 18.3 | 8.7 | 2.1 | 1.1 | 16.5 | 93 |
  | Lever 2b: geometry keys in a fixed layout (`9423cd94a`, with 2a) | 39.9 | 2.2 | 14.1 | 7.2 | 2.1 | 1.0 | 19.8 | 81 |
  | Lever 2c: one flat buffer per key (`c7ef43bde`) | 38.9 | 2.0 | 12.9 | 7.2 | 2.3 | 1.1 | 19.9 | 82 |
  | Lever 2d: keys as four code units (`d8afddfd3`) | 44.0 | 2.1 | 11.2 | 6.1 | 2.0 | 1.0 | 22.1 | 95 |
  | Lever 3: brush presets resolved once per value | 43.0 | 2.3 | 11.2 | 6.0 | 2.2 | 1.0 | 21.5 | 72 |
  | Lever 4: clip simplicity test without per-edge objects | 38.0 | 2.2 | 13.9 | 7.4 | 2.4 | 1.1 | 18.6 | 86 |
  | Lever 5: gesture keys in a fixed layout (`bf4ea4d8b`) | 46.9 | 2.1 | 10.7 | 5.7 | 2.0 | 1.0 | 21.7 | 181 |

  Lever 3 and lever 4 changed nothing outside noise and are not kept. The
  record step alone (no rendering) went from 10.6 to 1.9 ms. Every pointer
  move reached `update` in every run (120 of 120); the input-to-frame
  time follows the six figures' frame time.
  - **The record step's profile** (before): structural hashing was 8 of
    its 11.8 ms (the generic walk 5.7, key strings by code point 2.2), the
    sketch's own code about 1.5. Testing-mode work (call-site stacks,
    off-canvas tracking, audits, warning bookkeeping) does not appear: it
    is gated by `audit`, which only the headless surface sets.
  - **Lever 2.** The recorder no longer hashes; the geometry cache and the
    brush expander ask for keys, and lowering asks for every shape's key
    every frame, so 2a alone moved the cost (Track 4b predicted this).
    What cut it was cheaper keys: `geomKey` and `gestureKey` write a fixed
    layout per kind into one buffer and hash its words in one loop, short
    strings get an id on first sight, and a key is four UTF-16 code units
    (base-36 text was most of a key's cost once hashing was cheap). In a
    Chromium bench over one walker frame's 1187 geometries
    (`hash-page.ts`): 6.0 ms before, 1.4 ms after, of it 0.2 ms the memo
    and key text.
  - **Lever 4.** The walker's caches miss by design: of about 1470 geometry
    lookups a frame 540 hit, and none of its 529 brushed strokes
    (`hits.ts`); every figure moves. `isSimpleRing` on the 228 clip rings
    (25,500 points) costs about 2 ms; a version with flat arrays and a
    native sort was no faster (the sort and 54,000 edge pairs are its
    floor). Bind groups are already made per frame only for the frame's
    textures; encode is 1.0 ms in all.
  - **Output** is byte-identical at every kept step: raw RGBA of the three
    ports over 15–16 frames each, the cache cases' moving frames and the
    brush, smear and stress scenes at ratio 1 and 2, and the CLI's PNGs and
    transcripts for the ports (`hash-<step>-ref.txt` against
    `hash-<step>-new.txt`, where `ref` is the same tree with this chunk's
    files from the commit before).
  - **Where the walker's frame goes now** (profile `frame8-top.txt`, ms
    per frame, self time; the profiler adds about 15%): garbage collection
    2.2; clip simplicity 2.1; brush preparation 3.5 (`prepareContour` 1.4,
    `sampleSegments` 1.0, path flattening 0.5, the rest of `brushContours`
    0.6); key memo and text 1.1; geometry hashing 1.4; atlas edges 0.6;
    brush packing 0.8; the sketch's own drawing about 1.1. Main-thread CPU
    is record 2.1 + lower 10.7 + atlas 2.0 + encode 1.0 = 15.8 ms against
    the 16.7 ms of a 60 fps frame, with the GPU's 6.4 ms after it.
  - **Acceptance.** Target 1: 46.9 fps (rAF interval median 20.4 ms, p95
    25.5), short of 60. Target 3: 21.7 fps each, short of 30; no dropped
    input, but input-to-frame p95 72–181 ms against 33. Brush CPU 5.7 ms,
    over (b)'s 2.5 ms aim.
  - **What further steps would buy** (estimates from the profile):
    - Lowering, atlas and encode in a worker (an `OffscreenCanvas` and the
      device there): the main thread keeps the record step, about 2 ms a
      walker frame; the worker's 14 ms fits a 16.7 ms frame. Target 1
      becomes the worker's budget, and target 3's six figures need more
      than one worker or about 7 ms of lowering per walker.
    - Recording off the main thread: about 2 ms a walker frame now; it no
      longer buys a target on its own.
    - A lowered-job cache: little for the walker or the six figures,
      which move every frame; it would help scenes whose groups stand
      still.
    - Brush preparation on the GPU (contour flattening, segment lengths
      and sample placement): up to about 3.5 ms a walker frame, which with
      a cheaper clip test (about 2 ms, if an exact test can skip most of
      the sort) brings the main thread near 10 ms, enough for target 1 and
      near enough for target 3 to measure.
    - Or relax the targets to what is measured: the walker at 45 fps and
      six figures at 20.
  - **Second round** (after the cross-model review and the boxholder's
    direction to keep cutting). The review found that a getter asking for
    another key during a geometry or gesture layout erased the outer
    layout (`ebf9080e9`, with tests). Two levers followed:
    - *Clip simplicity check* (`b9c82f311`, `7c626952e`). 212 of the
      walker's 228 clip outlines change every frame (`clipreuse.ts`), so a
      cache by geometry key cannot help. The sweep now orders edges by
      merging their runs instead of a comparison sort, over flat arrays;
      it compares the same pairs with the same test (2.5 -> 1.2 ms in
      Node on the walker's clip rings; agreement with an every-pair
      reference on 800 rings).
    - *Brush preparation* (`3e5b959b3`). Contours are mapped, cleaned,
      measured and packed in reused flat buffers, with the same operations
      in the same order; 8880 prepared strokes equal the previous code's
      field for field (`prepcmp.ts`). Brush CPU 5.9 -> 5.2 ms. Garbage
      collection did not move (1.8–2.0 ms a frame before and after), so
      its source is elsewhere in lowering; flattening (`pathContours`,
      0.55 ms) was left as it is.
  - **Final measurement**, quiet machine (no game, no full suite; the
    boxholder's own Chrome was open). Before is the chunk's starting
    commit (`e4db1f99c`) rebuilt and measured in the same session
    (`measure-old.sh`); after is two runs of `cea1d7d5a`'s successors
    (`final3`, `final4`):

    | | Before | After |
    |---|---|---|
    | Walker fps (rAF, 10 s) | 36.4 | 57.9, 58.2 |
    | Walker frame interval, median / p95 ms | 25.6 / 32.9 | 16.6 / 20.7, 16.7 / 19.7 |
    | Walker record / lower / brush (in lower) / atlas / encode ms | 11.5 / 8.9 / 4.6 / 2.1 / 1.0 | 2.0 / 8.3 / 4.5 / 2.0 / 1.2 |
    | Walker frame waited to GPU completion, median ms | 32.2 | 21.8, 21.5 |
    | Six figures, fps each | 16.8 | 24.3, 24.1 |
    | Pointer moves reaching `update` | 120 of 120 | 120 of 120 |
    | Input-to-frame p95 ms | 80.2 | 97.7, 100.2 |

    Profile of the walker frame after (`final-top.txt`, ms a frame with
    the profiler's overhead): lower 10.2 (brushed strokes 4.8, of it
    expansion 4.0; clips 2.5, of it the simplicity check 1.5; geometry
    keys 1.7), record 2.8, encode 1.5, garbage collection 1.9.
  - **Acceptance.** Target 1: missed by a little: 58 fps, frame interval
    median 16.6 ms against 16.7, p95 20 ms; not 60 sustained over 600
    frames. Target 3: missed: 24 fps each against 30, input-to-frame p95
    about 100 ms against 33 (no input dropped).
  - **Review fixes.** Codex (gpt-6-sol) review of the commits above
    found two re-entry cases: a brush `spacing` getter that prepared
    another contour overwrote the shared point buffers, and a nested key
    whose walk threw left its lanes in place. Fixed in 613e55868, each
    with a test that fails without it.
  - **Decision (2026-11-15).** Work continues to chunk 5 under the
    boxholder's earlier "Accept for now" on desktop numbers
    (`stage4/checkpoint4.md`, answer 7). A main-thread worker split is
    not started; it needs the boxholder's yes.

### Track 5: gallery and examples (chunk 5)

- **What:** every gallery exercise and example runs on the scene renderer
  and is judged against its Stage 0 frames.
- **Why:** the gallery is the test corpus for every stage (main plan, "What
  already exists"), and principle 2 is judged on it.
- **Direction:**
  - **Which exercises change source.** 21 of 39 use no removed call
    (`scratch/stage5/core/notes.md`, from a grep of each exercise). The ports
    show that such an exercise changes only its type import
    (`diff -r src/gallery/intra-walk-styles src/examples/scene-ports/walker-sheet`
    shows only `SceneView as View` lines), so after chunk 6 it changes not at
    all. The 18 others use: `v.ctx` (7: `fjord-tides`, `game-world-tiles`,
    `intra-atrium`, `intra-lounge`, `intra-lounge-drawn`, `pelican-bicycle`,
    `pell-anim`), `cache`/`sprite`/`image` (16), `paperTexture` (19 files).
    The replacements are draft section 2's table: `cache` and `sprite` →
    `picture` and `place`; `paperTexture(n)` → a group with
    `effects: { paper: n }` around what it darkened; `ctx` skew → `at({ skew
    })` or `matrix`; `putImageData` fields → `v.pixels`; `lineCap` → `cap`.
    The hand-built lit rooms keep their look through `v.pixels`; rewriting
    them with `lighting` is a drawing change, not a migration.
  - **During the transition** each migrated exercise imports `SceneView as
    View` and exports `renderer = "scene"`, as the ports do; chunk 6 removes
    both with one mechanical edit.
  - **Sketches with browser consumers wait for chunk 6.** The playground
    builds a Canvas2D runtime directly (`browser/app/playground.ts:142-146`,
    `canvas.getContext("2d")` then `new Runtime({ module, ctx, … })`) over
    the sketches in `browser/app/registry.ts`, and the dev demo imports
    `examples/orbit-tea.ts` and `examples/fjord-tea.ts`
    (`dev-demo/main.tsx:17-18`). Two of those use removed calls:
    `gallery/pelican-bicycle` (`v.ctx`) and `examples/brushes-tea.ts`
    (`brushes-tea.ts:121` `v.paperTexture(p.paper);`). `examples/fjord-tea.ts`
    is a different file from `gallery/fjord-tides`; it uses no removed call
    (`fjord-tea.ts:2` *"with ZERO `v.ctx` use"*), and its one `ctx` match is
    a comment. The two are ported in chunk 6 in the same commit as the
    playground and dev demo, and judged then. The other 17 ported gallery
    exercises have no browser consumer (searched `src/` and `test/`
    for imports of `gallery/` and `examples/`: `registry.ts`, `gallery.ts`,
    `dev-demo/main.tsx`, `test/headless.tea-determinism.test.ts`,
    `test/react-ssr.test.tsx`, `gpu.test.ts`), and the two tests run through
    `teaRun` or import unchanged sketches.
  - **Judging.** For each exercise, render the gallery's frames, seed, `every`
    and events, and compare each frame with
    `out/baselines/570e8ef21/<slug>/` by `cli diff` and the parity measures
    (`canvas-loop-scene/parity-criteria.md` section 2, the functions in
    `test/scene-spike/compare.ts`). Expected differences, from the accepted
    draft decisions: brush texture changes once (decision 7), effect lengths
    follow their group (decision 1), `effects.paper` leaves transparent areas
    alone (decision 4), paper is scoped (decision 10), placements snap to
    device pixels (draft 2.6). A difference outside those is a renderer bug to
    fix, or an accepted difference written in the table with its reason. The
    table goes in `beebox/docs/plans/canvas-loop-scene/stage5/gallery-parity.md`:
    one row per exercise with the frames compared, the parity numbers, the
    expected differences seen, and the verdict.
  - **Eyes.** One exhibit with baseline and new frames side by side for every
    exercise, and 4× crops for brushed and papered ones. Astra reads it.
  - **Records.** Each exercise gets a `runs.jsonl` line: `ported` where the
    source changed, `rerun` where it did not. Changed ones get a `migrated`
    line in `meta.yaml`.
  - **Examples.** The top-level examples are migrated the same way, except
    `brushes-tea.ts` (chunk 6, above). `examples/scene-looks/` moves to
    `examples/` (`washed-shapes-tea.ts`, `still-life-tea.ts`,
    `night-room-tea.ts`). The three drawers' sketches
    (`examples/scene-drawers/`, 9 sketches) become nine gallery exercises
    with `task.md` from `stage4/drawing-brief.md`, the account as
    `history/account.md`, `meta.yaml` and an `authored` line. They are kept
    because they are the only corpus that uses lighting, wash and hatching,
    so without them `gallery check` holds none of those effects. They are
    cheap: the sketches exist and lint clean as examples; each exercise adds
    about 35 lines of copied metadata (about 330 in all) and no code. `examples/scene-ports/` is deleted once the tests
    that use it (`cache-cases.ts` `portFrames`, the speed pages) point at
    `gallery/intra-walk-styles`, `gallery/intra-rooms` and
    `gallery/balance-reaction-2`.
  - **Effects under skew.** Effects under a rotated non-uniform scale or a
    skew stay an error (`mat.ts:87`). An exercise that meets it moves the
    effect outside the skewed scope, and the table records it.
- **Vocabulary lock-ins:** the gallery-parity table's columns; the nine new
  slugs (`scene-<scene>-<drawer>`, for example `scene-market-opus-a`).
- **First implementation chunk:** the 21 unchanged exercises judged and
  recorded (no source change beyond the transition marker), and the table
  started. The 18 ported exercises follow in batches of a few, one commit
  each.
- **As built (chunk 5).** Every gallery exercise except `pelican-bicycle`
  renders on the scene renderer and has a verdict in
  `canvas-loop-scene/stage5/gallery-parity.md`.
  - **Counts.** 15 exercises used no removed call, not 21: six of the 21
    call `v.paperTexture` (`balance-reaction-2`, `gull-market`,
    `intra-scale-reference`, `open-opus-a`, `open-opus-b`, `open-sol`) and
    were ported. 23 were ported in all; `pelican-bicycle` waits.
  - **Replacements.** `cache(key, body)` became a canvas-sized picture
    placed at the origin (a paste option becomes the placement's); `sprite`
    and `image` became `picture` and `place`; a `paperTexture(n)` at the end
    of a function became that function's drawing in a group with
    `effects.paper`, with `v.paper` kept before the group. `intra-rooms`
    and `balance-reaction-2` took the ports' edits. The hand-lit rooms
    (`intra-atrium`, `intra-lounge`, `game-world-tiles`' field) write their
    pixels through `v.pixels`; the lounge's per-frame images are versioned
    by the frame's lights. `ctx.transform` became `at({ matrix })`;
    `fjord-tides`' paths, clips and gradients became polygons, paths,
    `v.clip` and `v.linearGradient`; `pell-anim`'s `fillText` became
    `v.text` on the baseline. A picture body cannot call `v.toCanvas`, so
    `game-world-tiles` reads its zoom from its own constant.
  - **Table.** Of 38 judged exercises: 30 pass, 8 accepted differences, no
    renderer bug found. The nine drawers' exercises are new (no Stage 0
    frames) and render cleanly. Examples: 7 compared with their painter
    renders, all pass.
  - **Accepted differences.** A1: the two particle fountains drew trails by
    a translucent rectangle over the last frame; each scene frame starts
    clear, so their ground turns light grey once trails are on. A2: the
    headless control stand-ins draw the param's label (added after the
    Stage 4 drawing round), so a sketch that labels its own control shows
    the label twice (six exercises, two drawers' pendulums). Also seen,
    within the parity measures: light text on a dark ground is thinner;
    frames the painter captured for edge faint-mark warnings are not
    captured; new picture hints add captured frames; sprites' cut-off
    overflow now shows (decision 3).
  - **Examples.** The top-level examples carry the marker; `scene-looks/`
    moved into `examples/`; the drawers' sketches are gallery exercises
    `scene-<scene>-<drawer>`; `scene-ports/` is deleted, and the GPU tests
    read `gallery/intra-walk-styles`, `gallery/intra-rooms` (room
    `hallway`, through a `portFrames` params override) and
    `gallery/balance-reaction-2`.
  - **Eyes.** One exhibit, "Gallery on the new renderer: before and after"
    (73 figures). Astra's read found A2 and decision 3's overflow, both
    confirmed; nothing else outside the expected list.
  - **Left for chunk 6.** `pelican-bicycle` and `brushes-tea.ts`, as
    planned; also `orbit-tea.ts` and `fjord-tea.ts`, which call no removed
    member but run in the dev demo on Canvas2D, and `orbit-tea.ts` runs in
    the CPU-phase determinism test, which would open a GPU device with the
    marker. Decisions for the boxholder: whether stand-ins keep the label
    (A2), and TEA.md's statement that each frame starts clear (A1, chunk 7).

### Track 6: the switch (chunk 6)

- **What:** the scene View becomes the package's `View`; the painter, the
  Canvas2D surfaces, `v.ctx` and the transition marker are deleted; the
  browser mount, React and the playground run on the scene surface; beebox
  compiles against the result.
- **Why:** the boxholder's decision (WebGPU and Dawn only) and §8 (one way to
  do each thing).
- **Direction:**
  - **Frozen parity references first.** The spike's parity tests compare the
    GPU renderer with today's painter (`gpu.test.ts:62` *"compositing fixtures
    match today's Skia renderer"*, `:79`, and the brush and text parity
    cases). Subplan (b)'s chunk 1 freezes the brush crops
    (`canvas-loop-gpu-brushes.subplan.md`, "Seams"); this chunk freezes
    whatever is still read live. Before the painter is deleted, its renders of those fixtures are
    written once to `canvas-loop/test/fixtures/scene-parity/*.png`, and the
    tests compare against the files with the same parity measure. The measure
    has tolerances, so the files hold on Metal and on Linux. A
    `canvas-loop/test/fixtures/**/*.png` binary line joins `.gitattributes`.
    If the files exceed 2 MB, they are cropped to the fixture cells.
  - **Types.** `scene/api.ts` merges into `core/paint.ts` (Style, Effects,
    GroupOptions, Material, Light, Lighting, AtOptions) and `core/tea.ts`
    (View). The draft's "diff on today's View" form
    (`scene-draft/scene-api.ts:1-4`) becomes one flat interface. Package root
    exports drop `Painter`, `Ctx2D`, `tracePath`, `tracePolygon`,
    `resolveGradient` and the `Scene*` aliases (`src/exports/core.ts:11-21`).
    `Ctx2D` stays an internal type for `scene/brush/record-ctx.ts` until
    subplan (b) removes CPU expansion.
  - **Headless.** `TeaRunner` keeps only the scene surface; `TeaView`,
    `headless/surface.ts` and the `renderer` export check go.
  - **Browser.** `attachSketch(canvas, opts)` becomes the scene attach: the
    runtime, the scene surface, input wiring and teardown on a given canvas;
    the device opens asynchronously and the figure draws when it is ready.
    `mountSketch` builds the shell and calls it, as today
    (`browser/mount.ts:1-7`). The spike's `mountSceneSketch` merges into
    them. `AttachedSketch` gains `ready: Promise<Runtime>`, and `runtime`
    is undefined until it resolves; `teardown` before then releases the GPU
    lease and resolves nothing. The playground builds on `attachSketch`
    instead of its own Canvas2D `Runtime` (`playground.ts:142-146`); the dev
    demo is React.
  - **React readiness.** `SketchFigure` reads `attached.runtime` at once in
    its effect (`react/SketchFigure/figure/view.tsx:203-204`), and later
    effects send controlled params and play state to `runtimeRef`. With an
    async attach it waits on `ready`: if the effect was cleaned up first
    (unmount, module or canvas-size change), nothing is applied; otherwise it
    sets `runtimeRef`, then applies the latest controlled params and the
    current `playing` state, read from refs, so a change made while the
    device opened is not lost. Tests: unmount before ready; module replaced
    before ready (only the second runtime runs); a controlled param changed
    before ready is applied when ready; play state the same. Uncontrolled
    controls (the param panel, the transport) are disabled until `ready`
    resolves, so no input needs queueing; a test edits an uncontrolled text
    control while the GPU lease is pending and checks it is disabled, then
    enabled and live once ready. Budget: about 150 lines of source and 150
    of tests, in the chunk 6 row. Without WebGPU the mount reports `NoWebGpuError`,
    and without an adapter `NoGpuAdapterError`, both through `onError`, once;
    a bad module stays `SketchMountError`. Headless, a missing adapter is
    thrown as `NoGpuAdapterError` after the transcript is written (Track 2). The spike's
    `SceneMountError` (`scene-spike/errors.ts:23`) splits into these.
  - **Deleted:** `core/painter/` except `text/` (moved in chunk 1),
    `core/view.ts`, `headless/surface.ts`, `TeaView`,
    `browser/runtime/{canvas-surface,browser-view,layer}.ts`, modules that no
    longer have an importer (checked by grepping each file's path), the
    `./scene-browser` and `./scene-headless` exports, and painter tests
    (`test/headless/tea-view.*.test.ts`, `test/core/painter/`, 1,432 lines).
    A painter test that asserts behaviour the new API keeps (dashes,
    `textBounds`, `keepInside`, halo bounds, `debugBox` with `--outline`,
    the timing line, style errors) is ported to the scene runner first; the
    rest are deleted with a one-line reason each in the commit message.
  - **beebox** (compile and tests only): `run-one.ts` drops `figureRenderer`
    and `FigureRendererError`; `figure-canvas-loop.ts` drops the
    `mountSceneSketch` wrapper and `rendererMismatch`; `FigureMount.tsx`
    drops the `renderer` prop; their tests follow. An entry that still
    exports `renderer` is ignored. Starters, card errors, server and
    guidance are subplan (c).
  - `package.json` `description` no longer says "Canvas2D sandbox"
    (`canvas-loop/package.json:4`).
- **Vocabulary lock-ins:** `View` is the scene View; `attachSketch`,
  `mountSketch`, `SketchMountError` keep their names; `RemovedCallError`,
  `NoWebGpuError`, `NoGpuAdapterError` are new error names that beebox
  matches on; `./browser`,
  `./headless`, `./react`, `./eslint`, `.` are the exports.
- **First implementation chunk:** the frozen references and the tests that
  read them, committed while the painter still exists. Then the type merge,
  the mechanical import edit across migrated sketches, and the deletions.

- **As built (chunk 6).** Commits 7e7c3b499 (frozen references),
  d106f4473 (types, browser, React, sketches, stand-ins, trails), b3fdf3c4f
  (deletions), 15d4e9001 (call sites under `bbx`), d4b5588d7 and 5911466f9
  (review fixes). The order changed: the type merge, the browser port and
  the sketch ports are one commit, since the painter typed its View against
  the old interface and the sketches against the new one; beebox's mount
  edits went with them, since layout-check refuses a re-export shim for
  `./scene-browser`.
  - **Frozen references.** `compositing.png`, `shapes.png`, `text.png` and
    `text-bounds.json` in `canvas-loop/test/fixtures/scene-parity/` (270 KB),
    each decoding within 0 levels of the render it froze; every row passes as
    before. `recorder.brushes.test.ts` holds the painter's text numbers as
    literals.
  - **Types.** As planned, with one addition: the Canvas2D context subset
    and its brush helpers moved from `core/paint.ts` to `core/ctx2d.ts`
    (internal), which kept `paint.ts` under the file limit.
  - **Browser.** The GPU half is `browser/scene/figure/start.ts`
    (`startFigure`, with `sleep.ts` beside it), loaded by `attachSketch` on
    first use. `ready` resolves once frame 0 is on screen. Every failure
    reaches `onError` once: no WebGPU (`NoWebGpuError`), no adapter
    (`NoGpuAdapterError`, now with `transcriptPath` undefined in a browser),
    no WebGPU context (`SketchMountError`, moved to `scene/errors.ts`), a
    throwing frame, a failed first frame, a device lost before frame 0, and a
    device that could not be recreated (the figure stays retryable).
    `AttachSketchOptions` gains `onLog`, `onNotice`, `inspect` and `gpu` (a
    stand-in device for tests and dev tools); `SketchFigure` takes `gpu` too.
    The canvas DOM helpers are `browser/canvas-dom.ts`. The playground and
    dev demo bundle as ES modules, since the scene code reads
    `import.meta.url`; both draw in Chrome on WebGPU. The Stage 4 speed pages
    in `scratch/` call `mountSceneSketch`; chunk 8 points them at
    `mountSketch` with `inspect`.
  - **Headless.** The runner always draws on the scene surface;
    `toTeaModule` ignores a `renderer` export.
  - **Deleted.** `core/painter/`, `core/view.ts`, `core/brush/paper.ts`,
    `headless/surface.ts`, `headless/tea-view.ts`, `CanvasFrameSurface`, the
    Canvas2D browser surface, `BrowserView`, the layer factory, the
    `./scene-browser` export, and 1,394 lines of painter tests, each file with its
    reason in b3fdf3c4f's message. Ported first: `textBounds`, halo bounds,
    `keepInside` (`test/scene/recorder.text.test.ts`), `debugBox` with
    `--outline` and the `--timing` line (`tea-runtime.gpu.test.ts`).
  - **Gallery.** Every exercise has a verdict and runs on the scene renderer.
    `pelican-bicycle` passes (9 of 9 frames). The control stand-ins draw the
    bare input, so A2 is gone: the six exercises with `v.control` and the
    drawers' pendulums pass. The particle fountains keep their last 12
    positions in the model and draw them fading over the dark ground, so A1
    passes by eye (the measures count the residue of dead particles the
    overlay kept). Examples: `brushes-tea.ts`, `orbit-tea.ts`,
    `fjord-tea.ts` pass. The table has no accepted differences left. The
    exhibit gained the four deferred drawings and new frames for the
    stand-in and particle exercises; its stale crops were removed.
  - **Found and fixed.** Under `bbx`, canvas-loop runs bundled with source
    maps, so `call-site.ts` matched no runtime frame and every warning named
    `call-site.ts` instead of the sketch's line, for any figure on the scene
    renderer. It now also takes the runtime's paths from a frame of its own.
  - **Review.** Codex (gpt-6-astra) found five problems in the async mount
    (a stale surface unconfiguring a reused canvas, teardown during start,
    an unrecreated device not reaching `onError`, `ready` before frame 0, the
    playground's stale controls); all fixed with tests. The verification
    round confirmed four and found two more (a device lost before frame 0,
    teardown while frame 0 draws), fixed with tests.
  - **For subplan (b)'s chunk 9.** No file imports `core/painter/`. What the
    CPU expansion still uses is `core/brush/render/` (the kind painters,
    `dab`, `ink`, `colour`, `mark/`), `scene/brush/record-ctx.ts`,
    `scene/brush/expand.ts`, and the internal `Ctx2D` with `withSaved`,
    `inPaintSpace` and `resolveGradient` in `core/ctx2d.ts`; chunk 9 can
    delete them with the CPU expansion. `@napi-rs/canvas` stays (PNG
    encoding, diff and zoom views, text measuring, colour parsing).

### Track 7: docs (chunk 7)

- **What:** rewrite `TEA.md`, `BRUSHES.md`, `README.md` and `AGENTS.md` for
  the new API; add `RENDERER.md`; add a `CHANGELOG.md` entry; update the
  gallery README's commands.
- **Direction:**
  - `TEA.md` keeps its anchors (`#events-file` is rewritten by
    `canvas-loop-doc.ts:29`) and gains "Pictures" (`picture`, `place`,
    `pixels`, `deps`, versions) and `toCanvas`, `noise`. Text gets the glyph
    atlas's limits (no ligatures or complex-script shaping).
  - `BRUSHES.md` keeps its file name, since beebox ships it by that name
    (`canvas-loop-doc.ts:45`), and adds wash, hatching, `effects.paper`,
    lighting (lights, materials, the starting values from draft R8,
    `receivesShadow`, one light across washed groups), and the docs draft 2.2
    asked for: "Making something glow", where glows sit relative to a wash,
    and `v.width` inside a picture. "Seeing what you made" covers `--scene`,
    `--outline`, `--timing`, `--zoom`, `--ratio`.
  - `README.md`: what renders (WebGPU in the browser, Dawn headless), what a
    machine needs (a GPU adapter or a software Vulkan driver), determinism
    per runtime ("byte-identical within one runtime on one machine";
    parity-criteria.md for across runtimes), and the CLI flags.
  - `RENDERER.md` (developer reference; not shipped to boxes): the lowering
    contract R1–R9, coordinate spaces, picture versions and what a renderer
    may cache, cache equivalence, the sleep contract, testing-mode checks,
    and the parity criteria, moved from the draft so code comments can cite
    them.
  - `AGENTS.md`: the `*.gpu.test.ts` rule and "one heavy GPU process at a
    time".
  - `CHANGELOG.md`: version 0.2.0 with every behaviour change of draft
    section 12 and the removed calls.
  - **Doc probe:** one fresh agent draws one brief from
    `stage4/drawing-brief.md` using only `TEA.md` and `BRUSHES.md`, with
    render cycles, and writes an account. Docs change where it stumbles.
  - A test lists the recorder's View members and checks each is named in
    `TEA.md` or `BRUSHES.md` as `v.<name>`, so a new call cannot ship
    undocumented.

- **As built (chunk 7).** Commits e4ee2f984 (the docs, the test, the probe
  fixes) and the review-fix commit after it. Probe, snippet sketches and the
  mistake sketches are in `scratch/stage5/a7/`.
  - **Returned form.** Written after the returned-scene subplan (R1–R5), so
    `TEA.md` and `BRUSHES.md` teach only `draw` returning its drawing: `.map`,
    `cond && node` and components, from the four R3 examples. `TEA.md` has a
    table of five returned-style mistakes with the text a run gives for each,
    copied from real `cli run` output with and without the type check. The
    gallery README says why its `out.push` form is not the style to copy.
  - **Line counts** (before → after): `TEA.md` 614 → 705, `BRUSHES.md` 366 →
    464, `README.md` 261 → 283, `AGENTS.md` 45 → 53, gallery README 103 →
    110, `CHANGELOG.md` 371 → 437, `RENDERER.md` new (252). Growth is
    pictures, lighting, glow, the mistakes table and "What draws"; the cache,
    sprite, `ctx` and `paperTexture` text went.
  - **Not as planned.** The draft's "text overflowing its box" check does not
    exist in the scene recorder; `RENDERER.md` does not list it. The
    removed-call messages cited draft sections a box agent cannot read; they
    now cite `TEA.md` and `BRUSHES.md` sections. Code comments still cite
    draft sections; `RENDERER.md` keeps the R1–R9 numbers so they resolve.
    The package version is 0.2.0.
  - **Doc probe.** One Sonnet agent drew the Stage 4 market-stall brief from
    `TEA.md` and `BRUSHES.md` alone in 3 renders, with no type error and no
    runtime error. It stumbled three times: the docs said to rock and breathe
    a picture, which the placement hint then refuses; a 4-pixel flame with a
    40-pixel glow was too faint to see; no example showed a sketch without
    `params`. Each fixed (bob by moving; glow sizing with a render to check
    it; `Util` without a type argument). The revisions were small, so no
    second probe ran.
  - **Review.** Codex (`gpt-6-sol`) traced the docs against the code and found
    eleven inaccuracies, all taken: the figure stylesheet path, effects under
    skew (an error), events in one frame seeing earlier folds, the edge
    warning covering unboxed text only, paper in a picture's version, React
    restart keys, `ctx`'s replacement, `--timing` text varying between runs,
    the paper hint's condition, the brush seed's inputs, and the font
    warning's condition.
  - **For (c).** `beebox/src/schemas/figure.ts` still describes the brushes
    doc as covering "sprites and caches"; the box-doc descriptions in
    `package-docs/core.ts` were updated here. Warning texts end with "(R8)",
    a rule number box agents cannot look up.

### Track 8: baselines and hand-off (chunk 8)

- **What:** render the gallery with the final renderer into
  `out/baselines/<commit>/` with a `manifest.json` (the Stage 0 script,
  adapted); re-run the Stage 4 speed pages once and report walker,
  Hallway panning, chemistry and six-figure fps against Checkpoint 4 (22.8,
  58.8, 60, 11.0) and chunk 4b's acceptance, and headless time per 90 frames; one exhibit; Astra's read; a short
  checkpoint summary for the boxholder in
  `beebox/docs/plans/canvas-loop-scene/stage5/`.
- **Who reads what (boxholder, 2026-11-15).** Astra's read of the exhibit is
  the review of the frames. The boxholder is shown only differences a person
  would notice in use: a lost effect, a wrong colour, overlapping text. Brush
  texture changes are not shown to the boxholder.

### Seams for subplans (b) and (c)

**Order across the three subplans**, serial, one heavy GPU process at a time:

1. (a) chunks 1–4: layout, runner, checks, `receivesShadow`.
2. (b) chunks 1–6 on (a)'s paths: GPU stamp and ink expansion (ink in
   chunk 4), batching, measurement. Chunk 6 is (b)'s stop point: the
   boxholder decides whether (b)'s chunks 7–9 go ahead
   (`canvas-loop-gpu-brushes.subplan.md`, chunk 6, "Stop point").
3. (a) chunk 4b: frame budget, measured with (b)'s expansion in place.
4. (a) chunk 5: the gallery judged against the Stage 0 baselines once, with
   (b)'s ink already in, so no exercise is judged twice
   (`canvas-loop-gpu-brushes.subplan.md:488-489` asks for this).
5. (a) chunk 6: the switch.
6. If the boxholder goes ahead at (b)'s stop point: (b) chunks 7–9
   (bristle, smudge and wet, CPU expansion retired; chunk 9 needs step 5).
   If not: bristle and smear stay CPU-expanded through `RecordingCtx` and
   draw through the same WebGPU renderer, which is still one renderer;
   nothing in this plan changes.
7. (a) chunks 7–8: docs, scene baselines, hand-off.
8. (c), then one merge of (a), (b) and (c), or (b) first and then (a) and
   (c) together, only on the boxholder's go-ahead. (b) never lands after them.

- **(b), GPU brush expansion.** Starts after chunk 1. Its surface is
  `scene/brush/expand.ts` (the CPU expansion and its cache), the brushed-stroke
  lowering in `gpu/lower.ts`, and `gpu/marks.ts`, `gpu/mark-atlas.ts`,
  `gpu/shader-mark.ts`. This plan changes those files only by the chunk 1
  move, the node path in `lower.ts` (chunk 3) and the per-mark maximum for the
  faint-mark readback (chunk 3), which (b) must keep producing. This plan
  leaves `core/brush/render/kinds.ts`, `record-ctx.ts` and the internal
  `Ctx2D` type in place. Under either outcome of (b)'s stop point this plan
  is complete: if (b)'s chunk 9 runs, it deletes them; if it does not, they
  stay as the expansion path for bristle and smear, and the chunk 6
  checkpoint's "no file imports `core/painter/`" still holds, because they
  live in `core/brush/` and `scene/brush/`. (b) judges its ink against the
  frozen Skia references; its chunk 2 freezes them if this plan has not
  (`canvas-loop-gpu-brushes.subplan.md:494`), and Track 6 reuses them.
- **(c), box figures.** (c) lists eight needs
  (`canvas-loop-box-figures.subplan.md`, "What (c) needs from (a), and the
  order"). This plan meets each:

  | (c)'s need | Where here |
  |---|---|
  | 1. One `mountSketch` in `./browser` with today's options (`module`, `initialParams`, `autoplay`, `seed`, `panel`, `transport`, `onParamsChange`, `onEvent`, `onError`), GPU code loaded lazily | Track 6, Browser; the spike's `mountSceneSketch` already takes `MountSketchOptions` (`scene-spike/browser/mount.ts:35-36`) |
  | 2. Every failure after mount goes to `onError`, once | Track 6: no WebGPU, no adapter, a lost device that cannot be recreated, a throwing frame, a removed call; a test per case with a fake lease |
  | 3. Stable error names | `RemovedCallError` (with `call` and `replacement` fields; its message names the replacement and the section heading of `TEA.md` or `BRUSHES.md`), `NoWebGpuError`, `NoGpuAdapterError`; Track 3 and Track 6 |
  | 4. A headless entry shaped like `teaRun` | `teaRun` itself, async, taking a loaded `module`; `RunResult` unchanged (Track 2) |
  | 5. Transcript parity: input lines with verdicts, `Δmodel`, `(unhandled)`, `activity {…}`, snapshot labels, overlap and font warnings, a transcript when `draw` throws | Track 2 (today's `FrameRecorder` and `TeaUtil`), Track 3 (overlap); held by beebox's `test/cli/commands/figure/run.test.ts:53-56` and the ported `tea-runtime.*` tests |
  | 6. Docs for the scene API in `TEA.md` and `BRUSHES.md` | Track 7 |
  | 7. No `GPUDevice` reaches sketch code | the recorder, `TeaUtil` and the browser `Util` expose no GPU object; the View-members test (Track 7) also checks that no member returns one |
  | 8. A Dawn no-adapter error beebox can reword | `teaRun` writes the failure transcript, then throws `NoGpuAdapterError`; (c) catches it by class; the message gives possible causes without naming one (Track 2) |

  The merge order matches: (a) and (c) land on `main` in one merge. beebox
  changes here are limited to what compiles and passes its tests (chunks 2
  and 6). (c) owns: `webgpu`
  as a beebox dependency for a packed install, the server's software Vulkan
  driver, what an old figure shows on its card, the starters, `card-figure.md`,
  box knowledge audits, and the deployment order.

## Could this be simpler?

- **Simplest version:** flip the defaults to the spike runner and mount,
  delete the painter, fix the compile errors, regenerate nothing, judge
  nothing. It fails on principle 1: the spike runner drops determinism guards
  (`runner.ts:183`), engagement verdicts (`util.ts:52`), sound, `--zoom`,
  `--outline`, `--timing` and frame dedup, which agents use today. It fails
  on principle 2: no one checks that the 39 exercises still look as they did.
- **Skip the transition marker (chunks 2–5) and switch in one commit.** That
  commit would hold the runner merge, 18 ported exercises and the deletions
  together, and could not be judged exercise by exercise. The marker already
  exists in beebox, so it adds no concept; chunk 6 deletes it.
- **Skip chunk 3.** Faint marks, missing glyphs and label overlap are
  today's warnings (`TEA.md:231-235`); dropping them makes the new runtime
  quieter than the old one about the same mistakes (principle 1, and §4
  "never silent"). The three new diagnostics the checklist proposed
  (empty clip, flat hatching, pass budget) are not today's warnings and are
  deferred. The off-canvas fold answers a measured complaint (7
  warnings on one room). The removed-call errors are the only thing an old box
  figure shows until (c)'s card error, and they cost about 60 lines.
- **Keep the React component out.** `./react` has no user outside canvas-loop
  (searched the repo for `canvas-loop/react`: `README.md`,
  `test/react-ssr.test.tsx`, `src/dev-demo/main.tsx`). Retiring it would save
  about 900 lines of code and tests. It is kept, as ruled after review round 1, with readiness and cancellation specified (Track 6,
  about 300 lines). Retiring it remains a boxholder decision.
- **Do not bank the drawers' sketches.** Saves about 330 lines of metadata.
  Then nothing in `gallery check` uses lighting, wash or hatching, and the
  only regression test for those looks is the spike's cases.
- **Skip the frame budget (chunk 4b).** Then targets 1 and 3 stay missed
  after (b): its own projection is 21–25 ms per walker frame
  (`canvas-loop-gpu-brushes.subplan.md:95-96`), and the record step is the
  largest remaining part. The chunk is levers inside code this plan already
  moves, closed on whole-frame measurements or a boxholder decision.
- **Over-builds avoided:** no scene diff in `cli diff` (the `--scene` outline
  is text and diffs with any diff tool); no GPU lock across processes (the
  test script serialises; other renders are short); no Web Worker or GPU
  expansion (subplan b).

## Subplans

None below this one. This file is subplan (a) of
`beebox/docs/plans/canvas-loop-scene.md`; its siblings are
`canvas-loop-gpu-brushes.subplan.md` (b) and
`canvas-loop-box-figures.subplan.md` (c).

## Failure modes

> **Critical gap (accepted risk):** two Dawn processes at once outside the
> test runner, for example `gallery:check` in one worktree while an agent
> renders in another. The test script serialises its own GPU files, but
> nothing serialises separate commands. The crash in Stage 4 came from heavy
> parallel GPU load (several agents rendering large scenes). Accepted with
> documentation (`AGENTS.md`: one heavy GPU process at a time), because a
> cross-process lock adds stale-lock handling for a load that agents control.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A sketch calls `Math.random` or `Date.now` in `draw` after the runner becomes async | port `tea-runtime.guards.test.ts` (chunk 2) | per-step `withGuards` | clear: `DeterminismError` naming the seeded call |
| The runner awaits a render while guards are installed, and the renderer's own timing calls throw | chunk 2 test: `--timing` run with guards | guards wrap sketch calls only | clear |
| An engagement verdict or `activity` line goes missing for scene sketches | port `tea-runtime.events` and `.activity` tests to the scene surface (chunk 2) | `TeaUtil.handled` | clear (expected lines checked) |
| Frame dedup marks a changed frame "unchanged" because pixels came from a reused buffer | port `tea-runtime.dedup.test.ts` (chunk 2) | runner copies readback pixels before `FrameRecorder` hashes them | clear |
| Several test files open Dawn in parallel | none (test-script shape) | `*.gpu.test.ts` with `--test-concurrency=1` | silent until the machine stalls; see the critical gap |
| `gallery check` gives different bytes on the second run because caches are warm | cache-equivalence cases (`test/scene-spike/cache-cases.ts`) | each run makes its own renderer | clear: `gallery check` FAIL names the file |
| A migrated exercise looks different beyond the accepted decisions, and nobody sees it | gallery-parity table, exhibit, Astra read (chunk 5) | fix or record with reason | clear when the table is complete |
| An old box figure calls `v.cache` | dev-loop row "removed call" (chunk 3) | `SketchUsageError` naming `picture` and `place` | clear |
| The off-canvas fold hides a real wrong-sign mistake that also moves | chunk 3 test: a moving off-canvas line appears in the summary with its line | the summary names every line | clear |
| A faint mark is missed because the paint alpha or the ink path is not in the measure | chunk 3 cases: translucent pencil, translucent ink, ink under a 5% group, opaque marker | maximum taken in the composite draw over resolved alpha | clear |
| A non-receiving shape's antialiased edge still receives shadow | chunk 4 isolated-shape case | non-receiving amount per unit of material coverage | clear |
| React applies params to a runtime that is not ready, or to a torn-down one | chunk 6 readiness tests | `ready` promise, cleanup flag, latest values from refs | clear |
| A migrated example breaks the playground while headless checks pass | chunk 6 playground build | browser-consumed sketches port with their consumers | clear (build or load error) |
| No GPU adapter: (c) misses the error because it is a string in a result | chunk 2 no-adapter case | thrown `NoGpuAdapterError` after the transcript | clear |
| Whole-frame speed misses target 1 or 3 after chunk 4b | the acceptance measurement | boxholder decision at the checkpoint | clear |
| A faint-mark readback adds a stall in the browser | test: browser surface makes no readback (`test/scene-spike/browser/surface.test.ts`) | readbacks only in testing mode | clear |
| `receivesShadow` set inside a placed picture is lost | chunk 4 test through `place(…, { material })` | third layer composites like the others | clear |
| A lit group without `receivesShadow` pays for a third layer | chunk 4 test: pass count unchanged | recorder flag per lit group | clear |
| A render error points at nothing | dev-loop rows 33 and 44 extended (chunk 3) | node path in `GpuRenderError` | clear |
| A bad colour in the browser fails only at render | browser surface test with a parser (chunk 3) | parser from `OffscreenCanvas` at mount | clear |
| Frozen parity references drift from what the painter drew | written once from the painter in chunk 6, before deletion | parity tolerances | clear |
| Stage 0 baselines missing on the implementer's machine | none | recreate at `570e8ef21` with the script in `canvas-loop-scene/README.md` | clear (the judging script stops) |
| beebox's figure run test opens Dawn in beebox's parallel suite after chunk 6 | `beebox/test/cli/commands/figure/run.test.ts` | figures there are 60×40, one process at a time within the file | clear |
| Docs describe a call the recorder does not have, or miss one | View-members doc test (chunk 7) | test fails | clear |
| Subplan (b) works on old paths | none | (b) starts after chunk 1 | clear (merge conflict) |
| The gallery is judged before (b)'s ink lands and must be judged again | none | cross-subplan order: chunk 5 runs after (b) chunks 1–6 | clear |
| Chunk 4b speeds recording but changes a recorded value (a dropped copy lets a later mutation leak into the scene) | captured-by-value tests (`recorder.test.ts`), the three ports byte-identical, cache equivalence | levers keep draft section 6's meaning | clear |
| This plan merges without (c): production has no Vulkan driver, old courseware figures error, box docs describe the new API | none | Rollout shape: no merge without (c) and the boxholder's go-ahead | clear |

## Agent-flow / user-flow edge cases

- **Wrong call, from memory of the old API** (`v.cache`, `v.ctx`,
  `paperTexture`). ADDRESSED: a type error when typechecked; at runtime the
  removed-call error names the replacement (Track 3).
- **Wrong one of two similar things** (`castsShadow` vs `receivesShadow`).
  ADDRESSED: the recorder checks types per field; `BRUSHES.md` shows both in
  one side-view example (Track 7).
- **Stale ref.** ADDRESSED: a Picture kept from an earlier frame is an error
  (dev-loop row 17), unchanged.
- **Two agents touching the same card.** Not applicable here: this plan
  writes no cards. Two agents rendering at once on one machine is the
  critical gap above.
- **Hand-edit drift.** ADDRESSED: misspelt style, gesture and material keys
  are errors naming the valid keys (dev-loop row 13; `recorder/light.ts:56`
  `MATERIAL_KEYS` gains `receivesShadow`).
- **Fabricated free-form value.** Not applicable: no free-form fields.
- **Validation error UX.** ADDRESSED: errors name the call, the rule, the value
  and the line (dev-loop.md, "Actual output"); chunk 3 adds node paths to
  render errors.
- **Partial migration / transition state.** ADDRESSED: between chunks 2 and 6
  the branch has two headless surfaces chosen by the `renderer` export; every
  commit passes its checks; nothing merges to `main` mid-way (Rollout shape).
  Box figures are untouched until (c) lands.

## NOT in scope

- **GPU brush expansion:** subplan (b). Targets 1 and 3 are shared: (b)
  takes brush CPU time, chunk 4b takes recording and non-brush lowering.
- **Moving recording off the main thread** (workers): a design change, raised
  only if chunk 4b's levers miss the record budget.
- **beebox's figure card behaviour, starters, server driver, `webgpu` as a
  beebox dependency, box guidance and audits, deployment order:** subplan
  (c). This plan changes beebox only to compile and pass tests.
- **New diagnostics (follow-ups):** an empty-clip warning (row 37), a
  flat-hatching warning (row 41, a tone-range readback) and a pass budget per
  frame (row 45). They are new policies, not today's checks
  (`stage4/dev-loop.md:101` *"Each needs a decision before it is built."*);
  their rows stay `todo` with the proposals in `dev-loop.md`.
- **A cache of lowered jobs:** lowering depends on context and holds
  frame resources (Track 4b); its own plan if whole-frame measurements need
  it.
- **Scene diff in `cli diff`** (draft section 10): considered; deferred until
  agents ask for it. `--scene` writes the outline as text, which any diff
  tool compares. The draft's section 10 is amended in `RENDERER.md`.
- **A light across separate lit groups:** the boxholder chose to document the
  pattern (Checkpoint 4, answer 5).
- **Hatching gated by each pixel's tone:** the boxholder chose to leave it
  (answer 6).
- **Chromebook-class check:** the boxholder accepted desktop numbers
  (answer 7).
- **Effects under a rotated non-uniform scale or a skew:** they stay an error
  (`mat.ts:87`); building them waits for a sketch that needs them.
- **Two-centre radial gradients:** stay an error
  (`recorder/style.ts:47-49`); no View call makes one, and no gallery sketch
  writes one by hand (searched `src/gallery` and `src/examples` for
  `"radial-gradient"`: none).
- **Ligatures and complex-script shaping in the glyph atlas:** documented as a
  limit; deferred from Stage 4 chunk 3.
- **A cross-process GPU lock:** see the critical gap.
- **Rewriting the hand-built lit rooms with `lighting`:** a drawing change,
  not a migration (Track 5).
- **Production deploy of anything:** needs the boxholder's go-ahead and (c).

## Open design questions

- **When to build the scene diff in `cli diff`.** Lean: after box agents have
  used the new API for a while, if their accounts show they diff outlines by
  hand.
- **Whether `./react` stays.** Kept by ruling, at about 300 lines of
  readiness work. The boxholder may still retire it.

Neither question touches chunk 1.

## Knowledge audits

None in this plan. Box agents read canvas-loop through `canvas-loop.md` and
`canvas-loop-brushes.md` in box docs; subplan (c) carries the box knowledge
audits for figure guidance, after these docs are rewritten. For dev agents,
`canvas-loop/AGENTS.md` keeps its loop and gains one rule; the doc probe in
chunk 7 tests the drawing docs with a fresh agent, which tells more than a
`knows_directly` entry about an API reference.

## What will hold this after it ships

- **The GPU test files** (`*.gpu.test.ts`, serial): renderer cases (paint,
  light, raster, cache equivalence), the dev-loop rows, the runner's
  transcript tests, `receivesShadow` cases, and parity against the frozen
  references. This is the spike's existing tier (`gpu.test.ts`), split into
  files and run serially; the serial phase is a norm future agents follow,
  stated in `AGENTS.md`.
- **Pure-function tests without a GPU:** the off-canvas fold, label overlap, removed-call messages, colour parsing.
- **`gallery:check`:** two runs per exercise, byte-identical, lint clean, now
  on Dawn and including the nine drawer exercises.
- **The gallery-parity table and the scene baselines:** a record for this
  change and the reference for later renderer work. They are evidence, not
  regression anchors; behaviour that must stay true lives in the tests above.
- **The View-members doc test:** keeps `TEA.md` and `BRUSHES.md` complete.

## Implementation order

Chunks run serially, one heavy GPU process at a time, interleaved with
subplan (b) as in "Seams for subplans (b) and (c)". Each ends at a
checkpoint where `pnpm --dir canvas-loop typecheck`, `lint` and `test` pass,
`pnpm typecheck` and `pnpm layout-check` pass from `beebox/`, and the listed
check holds.

1. **Layout.** Move and rename (Track 1). Checkpoint: the three ports render
   the same bytes as before; `gallery:check` passes on the painter.
2. **One runner.** Track 2, with beebox `run-one.ts`. Checkpoint: today's
   runner tests on both surfaces, the spike's runner and dev-loop tests, and
   `gallery:check`; Codex review of the diff.
3. **Existing checks.** Track 3. Checkpoint: rows 42 and 43 and three new
   rows pass; rows 37, 41, 45 stay `todo`; Codex review.
4. **`receivesShadow`.** Track 4. Checkpoint: its cases pass; a side-view
   render of the opus-b night room with a non-receiving sky, read by eye.

   *Subplan (b) chunks 1–6 run here, on (a)'s paths.*

4b. **Frame budget.** Track 4b, after (b)'s chunks 1–6. Checkpoint: targets
   1 and 3 met in whole-frame browser measurements, or a boxholder decision
   on the miss; output byte-identical.
5. **Gallery.** Track 5: the 21 unchanged exercises, then the 17 ported
   exercises without browser consumers in batches, then the drawers'
   exercises, then `scene-ports/` deleted. Checkpoint: every exercise except
   `pelican-bicycle` has a verdict in the parity table and runs on the scene
   surface; `pelican-bicycle` and `examples/brushes-tea.ts` still run on the
   Canvas2D surface, listed as deferred to chunk 6; `gallery:check` passes;
   exhibit; Astra read.
6. **The switch.** Track 6: frozen references first (own commit), then the
   type merge, the browser and React port with the playground, dev demo and
   their two sketches (ported and judged here), deletions, beebox edits.
   Checkpoint: no file imports `core/painter/` except `core/text/`; no
   `renderer` export remains; every gallery exercise has a verdict in the
   parity table and `gallery:check` passes with the whole gallery on the
   scene renderer; the exhibit gains the deferred exercises; beebox tests
   pass; Codex review.

   *Subplan (b)'s stop point decision applies here: chunks 7–9 (bristle,
   smudge and wet, CPU expansion retired) run here if the boxholder goes
   ahead; chunk 9 needs this chunk's painter deletion.*
7. **Docs.** Track 7, including the doc probe. Checkpoint: the doc probe's
   account; the View-members doc test passes; `pnpm doc-check` passes.
8. **Baselines and hand-off.** Track 8. Checkpoint: Astra's read of the
   exhibit; the boxholder's read of the summary and of any difference a
   person would notice in use.

No chunk merges to `main`; see Rollout shape. No external source is adopted,
so no ACKNOWLEDGEMENTS.md entry.

## Rollout shape

- **Tests first:** each track names its tests above; done when they pass,
  rows 42 and 43 pass, every gallery exercise has a verdict in
  the parity table, and `gallery:check` passes on Dawn.
- **No data migration in this plan.** Box figure sketches change by
  regeneration by the box's agent, which subplan (c) plans.
- **Merge:** canvas-loop is a shipped path
  (`bin/deployed-paths.ts:22` includes `canvas-loop` in the deploy pattern),
  so merging this plan deploys it. It must not merge before subplan (c) is
  done: production has no Vulkan driver yet, and old courseware figures would
  fail with no card-level message. (b)'s chunks 1–6 come before this plan's
  cutover (chunks 4b–6 depend on them), so (b) is in the same merge as (a)
  and (c), or lands on `main` before them. (a) and (c) never land without
  (b)'s chunks 1–6. The merge happens only when the boxholder says so.

## Review round 1

Codex (gpt-6-astra) reviewed draft 1 (`scratch/cross-model/s5a.log`). Each
finding was checked against the source; all eight hold, and none is rejected.
Changes, with the coordinator's rulings on the cross-plan points:

1. **Chunk 4b could finish without meeting its purpose.** Holds: moving
   hashing out of recording moves cost into lowering, since expansion and
   shape geometry read the keys (`brush/expand.ts:161`,
   `gpu/shape-geometry.ts:28`). Track 4b now closes on whole-frame browser
   measurements after (b): walker at 60 fps, six figures at 30 fps each with
   no dropped input. The 4 ms component figures are guides. A miss goes to
   the boxholder at the checkpoint.
2. **The intermediate states did not run as written.** Holds:
   `toTeaModule` drops the `renderer` export (`tea-load.ts:170-173`); the
   playground builds a Canvas2D runtime over gallery and example sketches
   (`playground.ts:142-146`); the `./scene-headless` export outlived its
   runner. Track 2 carries `renderer` through `LoadedTeaModule` and removes
   the export with the runner; the three browser-consumed sketches port with
   their consumers in chunk 6 (Track 5); the rollout no longer lets (b) land
   after (a) and (c).
3. **Reusing lowered jobs by subtree hash is unsafe.** Holds: lowering
   reads ancestor context (`gpu/lower.ts:40`) and jobs hold frame resources
   (`gpu/jobs.ts:125`). Lever 4 now tunes the existing geometry and clip
   caches only; a lowered-job cache is NOT in scope.
4. **`receivesShadow` transparency.** Holds: draft section 17 and the shader
   (`shader-light.ts:176-180`) read material values per unit of coverage.
   Track 4 now normalizes by material coverage, with every shape drawing into
   the third layer, and tests an isolated translucent shape and one over an
   opaque receiver.
5. **React needs more than type changes.** Holds: its effect reads
   `attached.runtime` at once (`view.tsx:203-204`). Track 6 specifies a
   `ready` promise, cancellation and replay of the latest controlled values,
   with tests, about 300 lines. Retiring `./react` stays a boxholder option.
6. **The faint-mark measure missed final opacity.** Holds: paint and paper
   are applied in the composite draw (`records.ts:73-76`), and ink reads the
   coverage atlas (`marks.ts:59-61`). The maximum is now taken in the
   composite draw over resolved alpha, with ink and translucent-paint cases.
7. **The no-adapter contract disagreed with (c).** Holds. `teaRun` writes the
   failure transcript and throws `NoGpuAdapterError`, outside
   `RunResult.errors`; (c) catches it by class. The message gives possible
   causes. A no-adapter case is added to chunk 2.
8. **New diagnostics were sized as preservation work.** Holds:
   `dev-loop.md:101` says the five proposals need decisions, and three of
   them are new. Empty clip, flat hatching and the pass budget are deferred as
   follow-ups; faint marks and missing glyphs (today's checks), label overlap
   and the off-canvas fold stay. The nine drawer exercises stay, at about 330
   lines of metadata, as the only lighting, wash and hatching corpus.

Size after this round: about 8,000 authored source and test lines (chunk 3
down about 420, chunk 4b down about 150; chunk 6 up about 400; chunks 2 and
4 up about 180), about 1,500 doc lines, about 10,300 lines of whole-file
deletions; about 19,800 changed lines in all. Still a **BIG CHANGE**.

## Review round 2

Codex (gpt-6-astra), round 2 (`scratch/cross-model/s5a-r2.answer.md`):
findings 1, 3, 4, 6 and 8 of round 1 hold as fixed. Four gaps, each checked
and fixed:

1. **Sequence with (b).** (b) now has nine chunks and a stop point after
   chunk 6, where the boxholder decides on chunks 7–9. The seams order and
   the implementation order show both outcomes; if (b) stops, bristle and
   smear stay CPU-expanded inside the one WebGPU renderer and this plan is
   still complete.
2. **Gallery checkpoint.** Chunk 5's checkpoint now allows the exercises
   deferred to chunk 6, and the whole-gallery check moves to chunk 6. The
   inventory was wrong: `examples/fjord-tea.ts` uses no removed call
   (`fjord-tea.ts:2`), and it is not `gallery/fjord-tides`. Two sketches with
   browser consumers wait for chunk 6, not three; chunk 5 ports 17.
3. **React controls before ready.** Uncontrolled controls are disabled until
   the runtime is ready, with a test that edits an uncontrolled text control
   while the lease is pending.
4. **No-adapter error.** `NoGpuAdapterError` carries `transcriptPath`; the
   test asserts it names the written transcript.

Size: unchanged within the estimate's precision (about 19,800 changed
lines).
