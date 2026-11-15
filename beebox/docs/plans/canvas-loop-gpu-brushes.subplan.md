---
title: "canvas-loop scene: brushes on the GPU"
status: draft
workstream: canvas-brushes
issues: []
---
# canvas-loop scene: brushes on the GPU

Stage 5 subplan (b) of `beebox/docs/plans/canvas-loop-scene.md`. Brushed
strokes in the scene renderer are expanded on the CPU today: about 15 ms per
frame for the walker sheet, more than the whole frame budget. This subplan
moves the per-sample work (resampling, pressure, wobble, dabs, ink, bristles)
into WebGPU compute passes, in the browser and headless under Dawn, so the
CPU keeps only a small, cacheable preparation step. The boxholder chose this
at Checkpoint 4 (`canvas-loop-scene/stage4/checkpoint4.md`, "The boxholder's
answers", item 2): *"isn't that the whole point of what we've done?"*

**Issues addressed:** none filed. Searched `issues/` (not `closed/`) for
`webgpu`, `compute pass`, `brush expan`, `perfect-freehand`, `walker`,
`brush`, `canvas-loop`: no open item covers brush expansion speed. The hits
(`issues/exploration/2026-11-11-look-at-klad-shared-human-agent-painting.md`,
`issues/bugs/2026-07-18-canvas-loop-figure-post-merge-followup.md`) are about
other things.

## Design

No design section: canvas-loop is a developer library, and this subplan
changes no API. A person sees brush marks drawn faster and ink edges that
differ slightly in detail. The parity criteria
(`canvas-loop-scene/parity-criteria.md`) judge those edges, as the boxholder
agreed at Checkpoint 4 ("Ink outlines change slightly, held to the parity
criteria instead of identical pixels").

## Smallest fix and budget

**The problem in numbers.** Stage 0 target 1 is *"The walker sheet in full
ink, ratio 2: 60 fps"* with *"draw and render under about 12 ms"*
(`canvas-loop-scene/browser-profile.md:76-77`). Target 3 is six animated
figures at 30 fps each. The spike reaches 22.8 fps and 11 fps
(`canvas-loop-scene/stage4-plan.md:209`: *"walker sheet 16.8–18.6 → 22.8 fps
(record 11.4, lower 23.5, atlas 4.0)"*).

**Where the CPU time goes now** (from the Stage 4 profile and this subplan's
probe, `scratch/stage5/brushes/prep.ts`, walker sheet, 30 frames, Node):

| Step | Code | ms per frame |
|---|---|---|
| Record (sketch code and structural hashing) | `recorder/view.ts` | 6.7 Node, 11.4 Chromium |
| Brush expansion, all of it | `brush/expand.ts:106` `expandIn` | 14.6–16.5 Node |
| …resampling, pressure, wobble | `core/brush/render/mark/render.ts:109` `shapeSamples`, `core/brush/sample.ts:49` `resample` | about 6 (before the Stage 4 speed round) |
| …stamp dabs | `core/brush/render/kinds.ts:58` `paintStamp` | about 4 |
| …ink outlines | `core/brush/render/kinds.ts:26` `paintInk` (perfect-freehand) | about 5 |
| Mark placement (each dab mapped to device pixels) | `gpu/marks.ts:59` `linMarks` | about 6 before the speed round |
| Atlas data (dab floats, ink outline edges) | `gpu/mark-atlas.ts:131` `#lay`, `gpu/atlas.ts:61` `edgeData` | 4.0 Chromium in all, about 5 of it ink edges per `stage4-plan.md:218` |
| What would stay on the CPU (brush space, flattening, seed, arc length, sample counts, bounds) | probe | **1.79** (full expansion in the same run: 16.51) |

The walker's work per frame (probe): 526 brushed strokes (286 ink, 240
stamp, no bristle or smear), 776 contours, 40,119 flattened input points,
35,434 ink samples and 71,335 stamp samples.

**The smallest fix** moves only what the walker uses: stamp dabs and ink, plus
the shared sampling (chunks 1–4, about 1,450 changed lines). Bristle and
smear keep the CPU path, so two expansion paths exist side by side.

**The chosen scope** also moves bristle and smear samples to the GPU and
deletes the CPU expansion once subplan (a) retires the Canvas2D painter
(chunks 5–7). Estimated changed lines (additions plus deletions):

| Chunk | Source | Tests | Notes |
|---|---|---|---|
| 1. Stroke preparation and the sample pass | 350 | 200 | |
| 2. Stamp dabs on the GPU | 300 | 150 | |
| 3. Ink as a chain of capsules | 230 | 120 | |
| 4. Measurement and visual review | 60 | 20 | plus doc lines below |
| 5. Bristle on the GPU | 250 | 100 | |
| 6. Smudge and wet from GPU samples | 110 | 40 | |
| 7. Retire the CPU expansion | 650 deleted, 60 added | 80 | after subplan (a) |
| **Total** | **about 2,010** | **about 710** | **about 2,700** |

**BIG CHANGE.** About 2,700 changed lines, a quarter of them deletions. What
drives the size: a WGSL port of the sampling and three brush kinds (the
dab, capsule and bristle kernels), numeric tests that compare GPU output with
the CPU expansion while both exist, and the deletion of the CPU path. The
boxholder's approval of the scale is needed at Checkpoint 5
(`canvas-loop-scene.md`, Stage 5: *"the boxholder approves the order and each
BIG CHANGE"*).

Authored docs, counted apart: draft section 9 and a draft 2.10 note
(`canvas-loop-scene/scene-api-draft.md`), one line in `canvas-loop/BRUSHES.md`,
the `ACKNOWLEDGEMENTS.md` entries; about 60 lines. Generated output: frozen
reference PNG crops and golden expansion numbers (chunk 1 and 7), binary or
JSON test fixtures.

**What (b) buys and what it does not.** Projected walker frame in Chromium
after (b), from the table: record 11.4 + lowering without brushes 6–9 +
atlas 1–2 + encode 1.1 + preparation and upload about 2, so **about 21–25 ms,
40–48 fps**. Six figures (two walker sheets, two chemistry, two Hallways;
`scratch/stage4/mount-page.ts:3`): about 20–23 fps each. **(b) alone does not
meet targets 1 or 3 on this evidence.** The record step in Chromium (11.4 ms)
is by itself about the whole 12 ms budget. See "Open design questions",
question 1.

## Stated preferences this plan trades against

- **Principle 4, speed** (`canvas-loop-scene.md:40`: *"Speed so animation is
  reasonable and works. In the browser."*). This subplan's reason to exist.
- **Brushes are not fixed** (`canvas-loop-scene.md:98-99`: *"A brush may be
  reimplemented differently on the GPU and still be valid, judged by eye, not
  by matching today's pixels."*). This permits the ink change in chunk 3.
- **Principle 2, art that does not look like lazy digital art.** The risk of
  this subplan: a GPU ink that reads as a uniform vector line. The Astra read
  in chunk 4 judges it.
- **Determinism.** Draft section 6 and its 2.8 note: *"Cache equivalence in
  the browser is byte-identical within one browser on one machine"*
  (`scene-api-draft.md:584-586`). Headless stays byte-identical run to run
  (`parity-criteria.md`, section 1). Every kernel here writes to an index
  fixed before the dispatch; no atomics decide output order.
- **Bias toward strict** (boxholder memory). Limits are checked before a
  dispatch, and a stroke that exceeds a limit is split, never dropped.
- **Minimize invented concepts.** No new API. The kernels write the instance
  layouts the existing dab and bristle pipelines read
  (`gpu/mark-atlas.ts:17-18`), so the draw side stays as it is.
- **One renderer** (`canvas-loop-scene.md`, Stage 5 (a): *"the spike becomes
  canvas-loop's one API and renderer"*). This is why the chosen scope deletes
  the CPU expansion instead of keeping it as a fallback.

## What already exists

- **The expansion in brush space** (draft decision 7). `brush/expand.ts:5-13`:
  *"Expansion runs in a "brush space" that depends only on the stroke's data
  and the scale of its transform, never on the pixel ratio or the
  translation"*. Reuse: the GPU kernels run in the same space, and the CPU
  keeps `brushSpace` (`expand.ts:66`) and the seed (`expand.ts:112`).
- **The expansion cache and its key.** `expand.ts:161`:
  *"const key = `${keyOf(req.geom)}|${req.weight}|${keyOf(brush)}|${keyOf(gesture)}|${linearKey(b)}|${paint}`"*.
  Reuse the key for the cached preparation (chunk 1).
- **Contour flattening.** `brush/contours.ts` `geomContours`, called at
  `expand.ts:109`: *"const local = geomContours(req.geom, 0.5 / s);"*. Reuse on
  the CPU.
- **The hash randomness.** `core/brush/random.ts:7-15` `mix` (lowbias32 with
  `Math.imul`) and `random.ts:18-20` `rand`. Port to WGSL bit for bit.
- **The shared sampling** `core/brush/render/mark/render.ts:109-138`
  `shapeSamples` and `core/brush/sample.ts:49-80` `resample` (*"Fixed spacing
  from the start (plus the exact end point)"*, `sample.ts:56`). Port to WGSL.
- **The kind painters.** `core/brush/render/kinds.ts:58-89` `paintStamp`,
  `:179-210` `paintBristle`, `:26-52` `paintInk`. Port stamp and bristle; ink
  gets a new form (chunk 3).
- **The mark atlas.** `gpu/mark-atlas.ts:108-128` packs marks into slots and
  lays dabs (one instanced draw) and bristle runs (one triangle-list draw) per
  page. `gpu/shader-mark.ts:7-9`: *"Tips and distances are computed in the
  mark's own pixels (the fragment's page pixel less the slot corner), so a mark
  looks the same wherever it is packed."* Reuse unchanged: the kernels fill its
  vertex buffers.
- **The coverage atlas** draws ink outlines today as exact-area pieces
  (`gpu/marks.ts:61`: *"if (set.polys.length > 0) {"* returns `kind: "piece"`).
  Chunk 3 moves ink to the mark atlas.
- **The smear compute pass.** `gpu/smear.ts:81`
  *"cp.dispatchWorkgroups(1);"*, one workgroup running the dabs in order.
  Reuse; chunk 6 changes only where its dabs come from.
- **GPU pass timing.** `gpu/frame.ts` `timed(f, …)` works on compute passes
  (`smear.ts:78`: *"f.enc.beginComputePass(timed(f, "smear"))"*). Reuse for
  the acceptance numbers.
- **Kept picture tiles.** A kept tile has no items, so nothing in it is
  expanded again (`gpu/lower.ts:333`: *"if (kept !== undefined) return { name:
  `kept tile ${key} of "${v.key}"`, rect: kept.rect, items: [] …"*). No change
  needed.
- **Tests:** `canvas-loop/test/scene-spike/brush-cases.ts` (parity crops
  against today's Skia, blends and erase, expansion cache, stability under
  translation, paper scopes) and `gpu.test.ts` (cache equivalence on the three
  ports, repeatability). Reuse all; they run on the new path unchanged.
- **The walker-speed harness**, `scratch/stage4/walker-speed/` (`bench.ts`,
  `measure.sh`, `bpage.sh` with the GPU lock). Not tracked. Reuse for chunk 4.

## Prior art (external)

- **GPU stroke expansion with prefix sums.** Levien and Uguray, "GPU-friendly
  Stroke Expansion" (2024), https://arxiv.org/abs/2405.00127, as used in
  Vello. Evaluated only. It expands plain strokes (joins, caps) fully on the
  GPU. This subplan keeps the arc-length prefix on the CPU instead, because
  the walker has 40,119 input points against 106,769 samples, and the probe
  measures the CPU part at 1.79 ms.
- **Distance to a tapered capsule** (a segment with a different radius at
  each end), Inigo Quilez, "2D distance functions", "Uneven Capsule",
  https://iquilezles.org/articles/distfunctions2d/. Adopted in chunk 3:
  `ACKNOWLEDGEMENTS.md` entry in that chunk.
- **perfect-freehand's radius formula** (`radius = size × (0.5 − thinning ×
  (0.5 − pressure))` with linear easing), already acknowledged
  (`ACKNOWLEDGEMENTS.md:31-35`). Chunk 3 keeps the formula; chunk 7 updates the
  entry's "Where it landed".
- **WebGPU limits** (https://www.w3.org/TR/webgpu/#limits). Defaults as
  reported by a reading of the spec, not checked verbatim:
  `maxComputeWorkgroupsPerDimension` 65535, `maxStorageBufferBindingSize`
  128 MiB, `maxBufferSize` 256 MiB, `maxStorageBuffersPerShaderStage` 8,
  `maxComputeInvocationsPerWorkgroup` 256. The design reads the device's
  actual limits at run time, so a wrong default changes nothing.
- **WGSL integer overflow wraps.** WGSL §6.2.3
  (https://www.w3.org/TR/WGSL/#integer-types): *"Expressions on concrete
  integer types that overflow produce a result that is modulo
  2^bitwidth."* So `mix` ports to `u32` exactly.
- **Unverified, avoided:** the rounding rule for `u32` → `f32` conversion
  (WGSL §15.7.6 was not read). The port converts `h >> 8u`, which is under
  2^24 and exact, so no rounding rule is involved. The rule for `min`/`max`
  blend factors was not read; chunk 3 sets both factors to `"one"`, which is
  valid under any reading.

## Ontology

Existing names are kept. New nouns:

- **Prepared stroke** (new). The CPU part of a brushed stroke's expansion:
  brush space `b` and `q` (`expand.ts:66`), each contour's points in brush
  space (`f32`), its cumulative arc lengths, its sample count and step, its
  seed (`hashNumbers([i], seed)`, `expand.ts:116`), its jitter base colour,
  and a conservative brush-space box. Identified by today's expansion key
  (`expand.ts:161`). Kept by `BrushExpander` as `MarkSet` is today. It is not
  dabs: it holds no per-sample data.
- **Sample** (existing CPU type, `core/brush/sample.ts:5`: x, y, nx, ny, s,
  t, p). On the GPU, one 32-byte record per sample in a frame-wide storage
  buffer, wobble applied, as `shapeSamples` returns it.
- **Stroke table** (new). The frame's storage buffer of prepared strokes that
  are drawn this frame: per contour its point range, sample range, step,
  seed, kind and brush numbers; per mark its device map `e` (linear part),
  the fractional offset (below), its slot and its output ranges. Rebuilt every
  frame; never kept.
- **Fractional offset** (new). For a mark at box corner `(x0, y0)` and
  device translation `(tx, ty)`: `(tx − x0, ty − y0)`, computed in `f64` on the
  CPU. A mark's pixel is `L·p + offset` in `f32`. A move by whole device
  pixels leaves the offset unchanged, so the texture moves exactly with the
  shape (parity criteria section 3).
- **Expansion pass** (new). One compute pass per frame, before the atlas
  render passes: entry points `samples`, `dabs`, `capsules`, `bristles`.
  Writes the mark atlas's instance and vertex buffers.
- **Capsule** (new). One ink segment between consecutive samples: two
  centres and two radii, drawn into the mark atlas with `max` blending. Not a
  piece: ink stops being coverage-atlas geometry.
- **Dab** and **Run** (existing, `brush/record-ctx.ts:10-24`). Their GPU
  instance layouts (`DAB_FLOATS = 12`, `RUN_FLOATS = 24`,
  `gpu/mark-atlas.ts:17-18`) stay as they are; the kernels write them.
- **TexMark** (existing, `gpu/jobs.ts`). Gains a `gpu` field (its prepared
  stroke, `e`, offset, output ranges) in place of `dabs` and `runs` once its
  kind runs on the GPU.

## Tracks / scope

One track, in seven chunks. Every chunk keeps the spike's tests green.

### Per brush kind: where it runs and why

| Kind (presets) | Today | Decision | Why |
|---|---|---|---|
| Sampling: resample, pressure, wobble (all kinds) | CPU, `shapeSamples` | **compute**, entry `samples`, one thread per sample | 106,769 samples on the walker; each is independent once the contour's arc-length prefix is known (`sample.ts:62-77` places sample k at s = k × step) |
| Arc-length prefix, sample counts, seed, flattening, bounds | CPU | **stays on CPU** | 1.79 ms for the walker (probe); sample counts must be fixed before the dispatch so that every output index is fixed; `f64` there keeps counts the same as today's |
| `stamp` (pencil, chalk, airbrush, wash) | CPU `paintStamp`, then `linMarks`, then `#lay` | **compute**, entry `dabs`, one thread per sample, writes `DAB_FLOATS` instances | 71,335 dabs on the walker; the existing `dabVs`/`dabFs` pipeline draws them unchanged; a skipped dab (`kinds.ts:66`: *"if (radius <= 0.05 \|\| alpha <= 0) continue;"*) is written with alpha 0, which leaves source-over unchanged |
| `ink` (ink, marker) | CPU perfect-freehand outline, a coverage piece | **compute**, entry `capsules`, one thread per segment; **new instanced capsule draw** with `max` blend in the mark atlas | perfect-freehand builds its outline sequentially; a union of tapered capsules is order-independent (`max` is exact and commutative), and needs no outline or edge list |
| `bristle` (bristle) | CPU `paintBristle` | **compute**, entry `bristles`, **one thread per bristle**, walking its samples in order | runs break where the alpha level changes and take the run's average width (`kinds.ts:160`); a sequential walk per bristle keeps that rule exactly; bristles of all strokes run in parallel |
| `smear` (smudge, wet) | CPU samples; compute pass with one workgroup per stroke | **samples from the `samples` entry**; the smear pass stays as it is | the smear is order-dependent by nature (`coverage-matrix.md:61`); only its dab list moves |
| Hue and light jitter (stamp, bristle) | CPU `jitteredInk` (`core/brush/render/ink.ts:22-30`), HSL shift | **in the `dabs` and `bristles` entries** | a WGSL `shiftColour`; per dab or bristle index, as today |
| Hatching effect | fragment shader (`gpu/shader-painterly.ts:249` `hatch`) | **no change** | not brush expansion |
| Hatch marks drawn with a brush (the walker's pencil hatching, `walker-sheet/ink-tea.ts:89`) | stamp | as stamp | a brushed path |
| Dashes on plain strokes | CPU, `geometry/dash.ts` | **no change** | not brush expansion; a dashed brushed stroke is an error today (`stage4-plan.md`, drawing-round fix 1) |
| Paper grain, opacity, blend, erase | the mark's composite draw (`gpu/records.ts:76`) | **no change** | applied once per mark after expansion |

**Compute writing instance buffers, not vertex-shader instancing.** A vertex
shader could compute each dab from `(stroke, k)` directly. That runs the
sample and hash code six times per dab (one per quad corner), needs a new dab
pipeline that reads storage in the vertex stage, and leaves nothing to read
back. Compute writes the existing layouts once, the existing pipelines draw
them, and a test can read the buffers back and compare them with the CPU
expansion number by number while both exist (chunks 1–3).

### Determinism

- **Fixed output indices.** The CPU computes every contour's sample count
  (in `f64`, as `resample` does) and every mark's output range before the
  dispatch. A thread writes only its own index. No atomics, no compaction.
  Draw order within a slot is the instance order, which is sample order, as
  the CPU's dab order is today.
- **Hashes bit for bit.** `mix` is `u32` multiply, xor and shift; WGSL wraps
  on overflow (above). `rand` becomes `f32(mix(...) >> 8u) / 16777216.0`: the
  same 24 high bits as the CPU's value, converted exactly. The seed stays
  CPU-side (`hashNumbers` rounds to 1/1000 in `f64`, `random.ts:71-79`).
- **Float differences against the CPU, not run to run.** Positions, pressure
  and noise are `f32` on the GPU. Noise lattice cells (`floor(s / cell)`) and
  bristle gaps (`kinds.ts:139`: *"Math.floor(c.s / 2.5)"*) can fall on the
  other side of an integer than the CPU's `f64`. Within one device and one
  Tint build, the same inputs give the same bits every run. This is the
  "detail may differ, character must match" allowance (`parity-criteria.md`,
  brush row).
- **Device-space seeding** (`canvas-loop-scene.md:342-344`: *"Brush seeds
  depend on device-space geometry today … so a change of pixel ratio or
  transform changes texture"*). Decision 7 already fixed this on the CPU
  (`expand.ts:10-12`). The GPU keeps it: the uploaded points are in brush
  space, which has no ratio and no translation; `e = ratio · q` and the
  fractional offset are applied only when a dab is written. Ratio 1 and 2 get
  the same dabs, scaled, as `brush-cases.ts:63` checks: *"a translation and
  another pixel ratio keep the expansion"*.
- **Cross-backend.** Dawn under Node and Chromium on this Mac give
  byte-identical output today (Checkpoint 4, decision 1). This holds while
  their Dawn and Tint builds match; a Chrome update can break it, as it can
  for every other pass. Lavapipe differs in the last bits (`stage3/dawn-linux.md`:
  99.99–100% of pixels within 4/255).

### Data per frame

| Buffer | Walker, per frame | Kept? |
|---|---|---|
| Points in brush space (`f32` x, y) | 40,119 × 8 B = 321 KB | uploaded every frame |
| Cumulative arc lengths (`f32`) | 40,119 × 4 B = 160 KB | uploaded every frame |
| Contour records | 776 × 32 B = 25 KB | uploaded every frame |
| Mark records (e, offset, slot, ranges, brush numbers) | 526 × 96 B = 50 KB | uploaded every frame |
| Samples (GPU only) | 106,769 × 32 B = 3.4 MB | frame-temporary |
| Dab instances (GPU only) | 71,335 × 48 B = 3.4 MB | frame-temporary |
| Capsule instances (GPU only) | 35,434 × 32 B = 1.1 MB | frame-temporary |

About 0.56 MB uploaded per frame with one `writeBuffer` per buffer. The
GPU-only buffers come from a size-classed pool, as textures do
(`gpu/pool.ts`).

### Caches and picture keys

- The prepared stroke replaces the `MarkSet` in `BrushExpander`'s cache, under
  the same key. It is ratio-independent, so a ratio change keeps it (as now).
- The second cache, `kept.get(`m|${ex.key}|${linearKey(e)}`, …)`
  (`gpu/marks.ts:139`), goes: there is no CPU mark placement left to keep.
- Nothing per stroke is kept on the GPU. A stroke drawn every frame is
  expanded every frame on the GPU. A static stroke inside a picture is drawn
  once into a kept tile and then not expanded again (`lower.ts:333`).
- Picture versions, their keys and `deps` do not change: expansion depends only
  on recorded data, the linear transform and the ratio.
- `release()` (`gpu/renderer.ts`, sleep) clears the prepared strokes with the
  rest; wake prepares again with the same bytes.
- Cache equivalence holds by construction: the expansion pass is a pure
  function of the stroke table, and the stroke table is a pure function of
  the prepared strokes and their placement. Slot positions on the page differ
  between frames, and do not change pixels (`gpu/shader-mark.ts:7-9`, above).

### Limits and fallback

- **No CPU fallback.** WebGPU compute is part of core WebGPU; a device that
  runs the scene renderer runs compute. Checkpoint 0 needs no WebGL2 fallback
  (`canvas-loop-scene.md:90`: *"A WebGL2 fallback is not required."*).
- **Dispatch size.** Workgroups of 64 threads. A pass with more than
  `65535 × 64` threads dispatches in 2-D and linearizes the index.
- **Buffer size.** Before the pass, the CPU sums each mark's output size per
  atlas page. When a page's samples or instances exceed the device's
  `maxStorageBufferBindingSize`, the page's marks are split into batches in
  order, each with its own dispatch and draw. A single stroke larger than one
  batch is split by contour, then by sample range; nothing is dropped.
  Today the CPU expansion has no such limit either; the flattening cap stays
  (`core/contours.ts:14`: *"const MAX_SEGMENTS = 4000;"*).
- **Storage buffers per stage.** At most 4 per entry point. Dawn on lavapipe
  printed *"a storage-buffer limit was reduced"* (`stage3/dawn-linux.md:22`);
  the reduced value was not recorded. Chunk 4 runs the GPU tests in the Lima
  VM to check.
- **Lavapipe cost.** About 107,000 short threads per walker frame on CPU
  cores; small next to the 1.3–1.5 s lit frame there. Chunk 4 measures it.

### Ink: a chain of capsules

Each ink contour's samples become segments `k → k+1` (closed contours add the
last → first segment, as `kinds.ts:30` closes the points). Each segment is a
tapered capsule with radius `r(p) = width / (1 + thinning) × (0.5 − thinning
× (0.5 − p))` at each end, perfect-freehand's formula with the size set at
`kinds.ts:33`. The capsule draw writes coverage `max(0, min(d + 0.5, r) −
max(d − 0.5, −r))` across the signed distance `d` (the 1-D box filter the
bristle run shader already uses, `shader-mark.ts:68`), so lines under one
pixel keep their tone (Checkpoint 3's thin-line finding). The blend is `max`
on every channel with both factors `"one"`. The union's coverage is then the
coverage of the nearest capsule, the same in any draw order.

What changes against perfect-freehand: joins are always round, the outline
has no smoothing step, and caps are the end discs. Edges become 8-bit
coverage in the `rgba8unorm` mark atlas instead of the float exact-area
coverage atlas.

### Seams with the other subplans

- **(a) scene core** (`canvas-loop-scene-core.subplan.md`, written in
  parallel). Decision: **(b) chunks 1–6 build on the spike first**, in
  `canvas-loop/src/scene-spike/`, or on (a)'s renamed files if (a)'s first
  chunk moves them. Reasons: the walker-speed harness and the three ports run
  on the spike now; and (a)'s gallery migration takes new PNG baselines, so
  (b)'s pixel changes (chunk 3 above all) should land before those baselines,
  or the baselines are taken twice. Chunk 7 waits for (a) to retire the
  Canvas2D painter, because `core/brush/render/` is still that painter's code.
- The parity test's reference is today's Skia through `teaView`
  (`brush-cases.ts:17`: *"const ref = teaView(s.size);"*). Whichever subplan
  lands first freezes those reference renders as fixtures; chunk 1 does it if
  (a) has not.
- **(c) box figures.** Not in scope. (c) depends on (b) only through the
  renderer's speed and the server's lavapipe; chunk 4 reports the lavapipe
  number for (c).

### Chunk 1: stroke preparation and the sample pass

- **What.** `BrushExpander.expand` returns a prepared stroke for every brush
  kind (it still returns a `MarkSet` beside it while the CPU path draws). A new
  `gpu/brush-pass.ts` builds the stroke table and runs the `samples` entry of
  a new `gpu/shader-brush.ts`: per thread, find its contour by binary search
  over the contour sample offsets, find its segment by binary search over the
  cumulative lengths, interpolate position and normal, evaluate pressure
  (the six presets of `envelope.ts:5-12` and keyframes), and add wobble
  (`noiseOf(1, period)`, `render.ts:123-135`). The last sample is the
  contour's end point, as `sample.ts:63-66` sets it. WGSL `mix`, `rand`,
  `noise1`.
- **Why.** Every later chunk reads these samples.
- **Direction.** Signatures:
  `prepare(req: ExpandRequest): Prepared | undefined` in `brush/expand.ts`;
  `class BrushPass { encode(marks: readonly TexMark[], f: { enc; temp; timer }): BrushOutputs }`.
- **Vocabulary lock-ins.** `Prepared`, `BrushPass`, the entry point names.
- **Tests.** A GPU test reads the sample buffer back for the brush sheet and
  the walker's first frame and compares with `shapeSamples`: same count per
  contour, positions within 1e-3 brush px, pressure within 1e-5, the end
  sample equal to the end point within 1e-4. A second test checks the WGSL
  `mix` against JS `mix` on 65,536 inputs, bit for bit. The frozen Skia
  reference crops are written if (a) has not written them.
- **Checkpoint.** No pixel changes (samples are computed, not yet drawn).
  **Measurement:** CPU preparation ms per frame on the walker in Node (target:
  under 2.5 ms; probe 1.79) and the `samples` pass GPU time from
  `timed(f, "brush")`.

### Chunk 2: stamp dabs on the GPU

- **What.** The `dabs` entry writes one `DAB_FLOATS` instance per stamp
  sample at its fixed index: size jitter and scatter (`randOf(11)`,
  `randOf(12)`, `kinds.ts:54-55`), radius and alpha (`kinds.ts:64-65`), soft
  or hard tip, jitter colour (channels 13 and 14). Positions are `e · p +
  offset` in the mark's own pixels. Stamp marks get a conservative box from
  the prepared stroke: the contour box grown by `width / 2 × (1 + sizeJitter /
  2) + scatter × width / 2 + wobble + 1`, mapped by `e` and translated. The
  mark atlas draws the GPU-written instance range instead of `#lay`'s floats
  for these marks.
- **Why.** 71,335 of the walker's dabs; `paintStamp`, `linMarks` and `#lay`
  leave the frame for stamps.
- **Tests.** Read back dab instances for the brush sheet and compare with the
  CPU dabs after `linMarks`: same count, centres within 2e-3 device px,
  radius and alpha within 1e-4, the same zero-alpha dabs. A bounds test draws
  strokes at the extremes of `scatter`, `sizeJitter` and `wobble` and checks
  that no coverage reaches a box edge. Existing: `brushParity`,
  `brushStability`, `expansionCache`, the cache-equivalence test on the three
  ports, repeatability.
- **Checkpoint.** Pixels within the brush criteria (crops); headless
  byte-identical run to run. **Measurement:** walker lowering and atlas CPU
  ms in Node, before and after.

### Chunk 3: ink as a chain of capsules

- **What.** The `capsules` entry writes one instance per ink segment. A new
  capsule pipeline in `gpu/mark-atlas.ts` (vertex: the segment's bounding
  quad grown by one pixel; fragment: distance to the tapered capsule, box
  filtered, `max` blend) draws them into the ink marks' slots. Ink marks
  become `kind: "tex"` (`gpu/marks.ts:101`) and are drawn by the mark draw as
  coverage (`records.ts:76`, `src` 3). `ACKNOWLEDGEMENTS.md` gains the capsule
  distance entry.
- **Why.** The walker's 286 ink strokes, 35,434 segments; `paintInk`, the
  ink rings and their `edgeData` leave the frame.
- **Tests.** The existing `brushBlends` (marker multiplies; ink erase, half
  erase) and `brushParity` ink and marker crops. New: a thin-line test (ink at
  width 0.6 and 1.0 device px; mean tone per row within 3% of the frozen
  Skia reference); a self-crossing loop draws no darker at the crossing
  (opacity applies once); a draw-order test (the same capsules in reverse
  order give the same bytes).
- **Checkpoint.** Ink edges change; judged by crops. **Measurement:** the
  walker sheet in Chromium at ratio 2 (`scratch/stage4/walker-speed/measure.sh`,
  under the GPU lock): fps, record, lower, atlas, encode, and GPU pass times.

### Chunk 4: measurement and visual review (a checkpoint for the boxholder)

- **What.** A `brush` field in `stats.cpu` (preparation and upload), so the
  harness splits the frame. Run targets 1 and 3 in Chromium; headless walker
  and Hallway timing in Node; the GPU tests and a walker run in the Lima VM on
  lavapipe. Crops of the brush sheet, stress frame and three ports at ratio 1
  and 2, today's Skia beside the GPU brushes; an Astra read through
  `codex exec` (model `gpt-6-astra`, crops attached), then an exhibit for the
  boxholder. Update draft section 9 and add a draft 2.10 note; one line in
  `canvas-loop/BRUSHES.md` about ink joins.
- **Why.** Targets 1 and 3 are this subplan's acceptance, and principle 2 is
  judged by eye.
- **Checkpoint.** Boxholder reads the exhibit and the target table.
  **Measurement:** see "Rollout shape".

### Chunk 5: bristle on the GPU

- **What.** The `bristles` entry: one thread per (contour, bristle). It makes
  the bristle (`kinds.ts:104-118`), walks the samples (`kinds.ts:132-153`),
  splits runs where the level changes and shares the boundary point
  (`kinds.ts:199-204`), and writes each run's mitred strip vertices
  (`mark-atlas.ts:23-86`, ported) at a fixed range of `(samples − 1) × 6`
  vertices per bristle. Unused vertices are degenerate. A one-sample contour
  is a dab (`kinds.ts:181-191`), written by the `dabs` entry.
- **Tests.** Read back the strip vertices for the brush sheet's bristle row
  and compare with the CPU runs (positions within 2e-3 px, levels equal
  except where a gap index lies within 1e-3 of an integer). `brushStability`
  already moves a bristle stroke.
- **Checkpoint.** Bristle crops within criteria. **Measurement:** the Stage 3
  stress frame (500 marks, 12% bristle), CPU and GPU ms.

### Chunk 6: smudge and wet from GPU samples

- **What.** The smear pass reads its dabs from the sample buffer (radius and
  alpha from `p`, as `expand.ts:120` computes them) instead of the CPU's
  `SmearRec.dabs`. `SmearPass.region` (`smear.ts:26-37`) uses the conservative
  box, clamped to the layer as it is now.
- **Tests.** Existing smear crops in `brushParity`;
  `smudgeAcrossTiles` in `gpu.test.ts`.
- **Checkpoint.** Smear crops within criteria; no CPU sampling is left in the
  scene renderer. **Measurement:** the smear scene time, before and after.

### Chunk 7: retire the CPU expansion (after subplan (a) retires the Canvas2D painter)

- **What.** Delete `brush/record-ctx.ts`, `expandIn`'s kind painters,
  `linMarks` and the dab and run parts of `#lay`, the ink piece path, and what
  (a) has left of `core/brush/render/` and `core/brush/sample.ts`. Remove the
  `perfect-freehand` dependency (`canvas-loop/package.json:50`) and update its
  `ACKNOWLEDGEMENTS.md` entry (formula kept). The numeric tests of chunks 1, 2
  and 5 switch from the live CPU expansion to golden numbers recorded from it
  before deletion (a few small strokes, JSON).
- **Checkpoint.** `pnpm typecheck`, lint and the scene tests pass; the three
  ports render the same bytes as at the end of chunk 6.
  **Measurement:** changed-line count against the estimate.

## Could this be simpler?

- **Simplest: Web Workers, option (b) at Checkpoint 4.** Same pixels, no
  WGSL. It costs a transfer of about 155,000 primitives a frame
  (`stage4-plan.md:219-221`) and still runs `linMarks` and `#lay` on the main
  thread. The boxholder chose the GPU.
- **Simpler GPU: chunks 1–4 only** (stamp and ink, about 1,450 lines). It
  meets the walker's brush share. It fails on "one renderer": bristle and
  smear keep the CPU expansion, `RecordingCtx` and `perfect-freehand`, and
  two expansions of one stroke kind could differ by `f32` against `f64`. The
  full scope buys one code path per kind. If the boxholder declines the BIG
  CHANGE, this is the fallback.
- **Simpler still: keep perfect-freehand and build its outline on the
  GPU.** Its outline is sequential (a running list of left and right points,
  corner handling); a GPU port needs a scan or one thread per stroke and
  still needs edge data for the coverage atlas. The capsule union is
  order-independent and reuses the mark atlas. This is why chunk 3 changes
  ink pixels.
- **Simpler: no stroke table, one dispatch per stroke.** 526 dispatches a
  frame; draw-call count was the dominant cost in Stage 3 (`stage3/brushes.md`:
  *"Draw-call count matters more than pixels"*). One pass per frame instead.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| The WGSL `mix` uses a signed shift or `i32` multiply and gives other bits | new (chunk 1, 65,536 inputs bit for bit) | no | silent: plausible but different randomness |
| The CPU's sample count and the GPU's last sample disagree (an end dab missing or doubled) | new (chunk 1 sample readback, end sample) | the count is uploaded, never recomputed on the GPU | silent |
| A conservative box is smaller than the dabs' reach; `inSlot` discards the overflow | new (chunk 2 bounds test at parameter extremes) | the reach formula | silent clipping of a mark's edge |
| A page's buffers exceed `maxStorageBufferBindingSize` | new (chunk 1, with the batch limit lowered in the test) | batching per page | clear: a validation error becomes `GpuRenderError` if batching is wrong |
| An output index is written twice or not at all (bad offset arithmetic) | the readback comparisons (chunks 1, 2, 5) | no | silent: stale data from a pooled buffer; buffers are cleared on acquire to make it visible |
| Run-to-run difference from a race | existing repeatability and cache-equivalence tests | no atomics by design | clear in tests |
| Ink below one pixel too light or too dark | new (chunk 3 thin-line test) | the box filter | silent visually |
| Capsule `max` blend applied to a dab slot | new (chunk 3 draw-order test) and slot discard | separate pipelines per kind | silent |
| Lavapipe's reduced storage-buffer limit below the pass's need | chunk 4 run in the VM | at most 4 per entry point | clear: pipeline creation throws |
| The fractional offset is computed in `f32` and the texture crawls under a whole-pixel move | existing `brushStability` | `f64` offset on the CPU | clear in tests |
| A smear's region from the conservative box reaches outside the layer | existing `smudgeAcrossTiles` | the clamp in `SmearPass.region` | clear |

No critical gap: every silent row has a test in the chunk that adds the code.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED. No API changes; brush validation
  stays at record time (`core/brush/presets.ts:179` `resolveBrush`).
- **Stale ref:** ADDRESSED. Prepared strokes are keyed by recorded data
  (`expand.ts:161`); a picture version re-recorded gets new keys.
- **Two agents touching the same card:** not applicable: a renderer instance
  serves one figure; figures on one page share a device, and the error scopes
  are popped per frame already (`renderer.ts`, `#frame`).
- **Hand-edit drift:** not applicable: no hand-written data.
- **Fabricated free-form value:** not applicable.
- **Validation error UX:** ADDRESSED. Limits never surface to the sketch
  (batching); a GPU error names the pass (`GpuRenderError`).
- **Partial migration / transition state:** ADDRESSED. Between chunks 2 and
  6, a frame mixes CPU-expanded and GPU-expanded kinds. The mark atlas draws
  both; each mark is one kind. A sketch's ink look changes once, at chunk 3.
  The transcript line *"brushed strokes N: expanded X, expansion cache hits
  Y"* (`gpu.test.ts:113`) keeps its wording; "expanded" means prepared on the
  CPU from chunk 1 on, and draft 2.10 says so.

## NOT in scope

- **The record step's cost** (11.4 ms in Chromium on the walker). It belongs to
  the recorder, which subplan (a) promotes. See open question 1.
- **Moving curve flattening to the GPU.** 40,119 input points at 0.5 brush px
  are cheap enough on the CPU (inside the 1.79 ms).
- **A GPU-side expansion cache.** The upload is 0.56 MB a frame; kept tiles
  already cover static drawing.
- **The faint-mark warning** (dev-loop row "faint marks", left for a decision
  at Checkpoint 4). The spike does not have it; GPU expansion does not change
  that.
- **Plain-stroke geometry, dashes, fills and clips on the GPU.** Not brush
  expansion; they are about 4 ms of lowering (`stage4-plan.md:195`).
- **Box figures, the server driver, deployment.** Subplan (c).
- **New brush looks** (for example Astra's "straight, even hatch marks"
  finding at Checkpoint 4). This subplan keeps each kind's character.
- **A Chromebook-class device check.** The boxholder accepted desktop numbers
  (Checkpoint 4, answer 7).

## Open design questions

1. **Who owns the rest of the frame budget?** After (b), the walker frame is
   projected at 21–25 ms; the record step alone is 11.4 ms in Chromium.
   Targets 1 and 3 need the recorder (sketch code plus structural hashing)
   at roughly 5 ms or less, and lowering without brushes under about 4 ms.
   Lean: a short "frame budget" chunk in subplan (a), since (a) owns the
   recorder; (b)'s acceptance is then its own share (below) plus the measured
   target numbers, reported.
2. **Ink look.** Round joins everywhere and no outline smoothing. Lean:
   accept, judged at chunk 4 by Astra and the boxholder; if the joins read as
   too uniform, vary the radius along the stroke with a seeded noise channel,
   which is a brush look change and a separate decision.
3. **Full scope or chunks 1–4 only** (the BIG CHANGE). Lean: full scope, for
   one expansion path.

## Knowledge audits

Skip: no agent-facing concept changes. The brush API, its presets and its
errors stay the same. Box-agent figure guidance is subplan (c)'s.

## What will hold this after it ships

- **Numeric readback tests** (chunks 1, 2, 5): the GPU's samples, dabs and
  strips against the CPU expansion while it exists, then against golden
  numbers. They catch porting errors that crops would pass. They use the
  existing GPU test tier (`onGpu` in `gpu.test.ts`); no new tier.
- **The WGSL hash test**: bit-for-bit, so randomness cannot drift silently.
- **Existing pixel tests**: brush crops (parity criteria), blends and erase,
  stability under translation, cache equivalence on the three ports,
  repeatability. They run on the new path unchanged.
- **Speed** is not held by a test (timings vary by machine). Chunk 4 records
  the numbers in the plan doc; the walker-speed harness stays in scratch, as
  in Stage 4.

## Implementation order

1. Chunk 1: stroke preparation and the sample pass. No dependency.
2. Chunk 2: stamp dabs. Needs 1.
3. Chunk 3: ink capsules. Needs 1. Lands before (a) takes its gallery
   baselines.
4. Chunk 4: measurement and visual review. Needs 2 and 3. Checkpoint for the
   boxholder.
5. Chunk 5: bristle. Needs 1.
6. Chunk 6: smudge and wet. Needs 1.
7. Chunk 7: retire the CPU expansion. Needs 5, 6 and (a)'s retirement of the
   Canvas2D painter.

Each chunk is a commit or a few. The subplan ships with the rest of the
redesign, when the boxholder says so.

## Rollout shape

**Done when** these pass:
- Chunk 1: sample readback, WGSL hash, existing scene tests.
- Chunk 2: dab readback, bounds at extremes, `brushParity`,
  `brushStability`, `expansionCache`, cache equivalence on the three ports.
- Chunk 3: `brushBlends`, ink and marker crops, thin-line, self-crossing,
  draw order.
- Chunk 5: strip readback, bristle crops.
- Chunk 6: smear crops, `smudgeAcrossTiles`.
- Chunk 7: all of the above against golden numbers and frozen crops;
  typecheck, lint.

**Acceptance measurements** (chunk 4, Chromium on this machine, ratio 2,
under the GPU lock):

| Measure | Now | Acceptance |
|---|---|---|
| Brush CPU on the walker (preparation, upload; `stats.cpu.brush`) | about 15 ms expansion plus placement and atlas data | under 2.5 ms |
| Brush GPU passes on the walker (timestamp queries) | the dab pass only | under 2 ms |
| Walker frame minus record | 32.8 ms (44.2 − 11.4) | under 12 ms |
| Target 1, walker sheet fps | 22.8 | reported; 60 needs open question 1 |
| Target 3, six figures fps each | 11.0 (ratio 1), 10.8 (ratio 2) | reported; 30 needs open question 1 |
| Headless walker frame (Node, Dawn) | 59.1 ms | reported |
| Lavapipe walker frame (Lima VM, ratio 1) | not measured | reported, for subplan (c) |
| Brush crops (sheet, stress, smear, three ports) | pass today | pass: luminance within 3%, contrast within 15%; Astra: same character |
| Repeatability, cache equivalence | byte-identical | byte-identical |

No migration: the scene data does not change. Knowledge audits: none.
