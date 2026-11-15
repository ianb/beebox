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

Draft 2, after review round 1 (see "Review round 1" near the end).

**Issues addressed:** none filed. Searched `issues/` (not `closed/`) for
`webgpu`, `compute pass`, `brush expan`, `perfect-freehand`, `walker`,
`brush`, `canvas-loop`: no open item covers brush expansion speed. The hits
(`issues/exploration/2026-11-11-look-at-klad-shared-human-agent-painting.md`,
`issues/closed/bugs/2026-07-18-canvas-loop-figure-post-merge-followup.md`) are about
other things.

## Design

No design section: canvas-loop is a developer library, and this subplan
changes no API. A person sees brush marks drawn faster. Stamp, bristle and
smear marks change only in floating-point detail. Ink may change shape at
corners, tight curves and short tapers (chunk 4). The ink look is not
settled by this plan: chunk 1 is a gate where the boxholder judges it on
real walker details before the new ink goes in.

## Smallest fix and budget

**The problem in numbers.** Stage 0 target 1 is *"The walker sheet in full
ink, ratio 2: 60 fps"* with *"draw and render under about 12 ms"*
(`canvas-loop-scene/browser-profile.md:76-77`). Target 3 is six animated
figures at 30 fps each. The spike reaches 22.8 fps and 11 fps
(`canvas-loop-scene/stage4-plan.md:209`: *"walker sheet 16.8–18.6 → 22.8 fps
(record 11.4, lower 23.5, atlas 4.0)"*).

**Measured CPU time per frame, by source.** The numbers come from different
runs and are not one breakdown of one frame.

| Step | Code | Source | ms per frame |
|---|---|---|---|
| Record | `recorder/view.ts` | Stage 4, after the speed round | 6.7 Node; 11.4 Chromium |
| Lower (all) | `gpu/lower.ts` | Stage 4, after | 23.5 Chromium |
| Atlas (all) | `gpu/atlas.ts`, `gpu/mark-atlas.ts` | Stage 4, after | 4.0 Chromium |
| Brush expansion | `brush/expand.ts:106` `expandIn` | Stage 4, after | 14.6 Node |
| …resampling and pressure; stamp dabs; ink outlines | `shapeSamples`, `paintStamp`, `paintInk` | Stage 4, **before** the speed round (`stage4-plan.md:194-195`) | 6; 4; 5 Node |
| Mark placement | `gpu/marks.ts:59` `linMarks` | Stage 4, before | 6 Node |
| Brush expansion, cache off | `expandIn` | this subplan's probe, revision 2 | median 16.7–17.0, p95 17.6–18.0 Node |
| What would stay on the CPU | probe, revision 2 | median 2.9–3.1, p95 5.8–10.2 Node | |

The probe (`scratch/stage5/brushes/prep.ts`, outputs `prep2.out` and
`prep3.out`) runs the walker's brushed strokes for 30 frames in Node. Its
"what would stay on the CPU" step: brush space, flattening, `sample.ts`'s
`prepare` (dedupe, closing point), seed, the `f64` arc-length prefix, the
exact sample count of `resample`'s loop, bounds, and packing the typed arrays
an upload would send. It does not upload, and it allocates its arrays each
frame; the p95 is likely garbage collection (not checked). Per frame: 526
brushed strokes (286 ink, 240 stamp, no bristle or smear), 776 contours,
40,119 input points, 35,434 ink samples, 71,335 stamp samples, no
single-sample contours, 544 KB of packed input.

**Projections are hypotheses until chunk 6 measures them.** Hypothesis: the
walker frame in Chromium drops by the brush expansion, mark placement and
most atlas data (together about 20 ms), and gains about 3 ms of preparation
and upload. The record step (11.4 ms) does not change. If that holds, the
walker frame is still over the 12 ms budget, and targets 1 and 3 are not met
by (b) alone. The six-figure page and lavapipe are not projected; chunk 6
measures them.

**The smallest fix** moves only what the walker uses: the shared sampling,
stamp dabs and ink (chunks 1–6, through the stop point, about 1,830 changed
lines). Bristle and smear stay CPU-expanded and drawn by the same WebGPU
renderer.

**The chosen scope** continues past the stop point only if the boxholder
chooses to (chunks 7–9). Estimated changed lines (additions plus deletions):

| Chunk | Source | Tests | Notes |
|---|---|---|---|
| 1. Ink gate (prototype, crops, Astra, boxholder) | 0 tracked | 0 | about 300 lines in `scratch/stage5/brushes/` |
| 2. Stroke preparation and the sample pass | 420 | 260 | |
| 3. Stamp dabs on the GPU | 300 | 220 | |
| 4. Ink on the GPU (capsules, or the fallback) | 250 | 200 | the fallback is about 320 + 180 |
| 5. Batching and limits | 120 | 80 | |
| 6. Measurement, visual review; **stop point** | 60 | 20 | plus doc lines below |
| 7. Bristle on the GPU | 280 | 150 | after the stop point |
| 8. Smudge and wet from GPU samples | 130 | 70 | after the stop point |
| 9. Retire the CPU expansion; final verification | 650 deleted, 60 added | 140 | after the stop point and after subplan (a) |
| **Through the stop point (1–6)** | **1,150** | **780** | **about 1,930** |
| **All chunks** | **about 2,270** | **about 1,140** | **about 3,410** |

**BIG CHANGE** at both sizes. Through the stop point, about 1,930 lines; the
size comes from a WGSL port of the sampling and two brush kinds, numeric
readback tests against the CPU expansion, and the batching rules. All
chunks, about 3,410, a fifth of them deletions. Approval of the scale is
needed at Checkpoint 5 (`canvas-loop-scene.md`, Stage 5: *"the boxholder
approves the order and each BIG CHANGE"*), and again at the stop point for
chunks 7–9.

Authored docs, counted apart: draft section 9 and a draft 2.10 note
(`canvas-loop-scene/scene-api-draft.md`), one line in `canvas-loop/BRUSHES.md`,
`ACKNOWLEDGEMENTS.md` entries; about 70 lines. Generated output: frozen
reference PNG crops, golden expansion numbers (JSON), the gate's crops.

## Stated preferences this plan trades against

- **Principle 4, speed** (`canvas-loop-scene.md:40`: *"Speed so animation is
  reasonable and works. In the browser."*). This subplan's reason to exist.
- **Brushes are not fixed** (`canvas-loop-scene.md:98-99`: *"A brush may be
  reimplemented differently on the GPU and still be valid, judged by eye, not
  by matching today's pixels."*). This permits an ink change, judged at the
  chunk 1 gate.
- **Principle 2, art that does not look like lazy digital art.** The risk:
  GPU ink with swollen corners, scalloped tight curves or different short
  tapers. Capsules keep the authored pressure and wobble (today's ink uses
  `smoothing: 0.08`, `streamline: 0`, `kinds.ts:37-38`), so the risk is in
  the details, which the gate examines at 4×.
- **Determinism.** Draft section 6 and its 2.8 note: *"Cache equivalence in
  the browser is byte-identical within one browser on one machine"*
  (`scene-api-draft.md:584-586`). Headless stays byte-identical run to run
  (`parity-criteria.md`, section 1). This plan treats both as requirements
  that tests check, not as consequences of the design.
- **Bias toward strict** (boxholder memory). Limits are checked before a
  dispatch. A split never changes pixels; a stroke that cannot be split
  without changing pixels is an error that names the call.
- **Minimize invented concepts.** No new API. The kernels write the instance
  layouts the existing dab and bristle pipelines read
  (`gpu/mark-atlas.ts:17-18`).

## What already exists

- **The expansion in brush space** (draft decision 7). `brush/expand.ts:5-13`:
  *"Expansion runs in a "brush space" that depends only on the stroke's data
  and the scale of its transform, never on the pixel ratio or the
  translation"*. Reuse: the GPU kernels run in the same space, and the CPU
  keeps `brushSpace` (`expand.ts:66`) and the seed (`expand.ts:112`).
- **The expansion cache and its key.** `expand.ts:161`:
  *"const key = `${keyOf(req.geom)}|${req.weight}|${keyOf(brush)}|${keyOf(gesture)}|${linearKey(b)}|${paint}`"*.
  Reuse the key for the cached preparation.
- **Contour flattening.** `brush/contours.ts` `geomContours`, called at
  `expand.ts:109`: *"const local = geomContours(req.geom, 0.5 / s);"*. Reuse.
- **Contour preparation and the sample loop.** `core/brush/sample.ts:31-43`
  `prepare` (drops consecutive duplicates; a closed contour repeats its start)
  and `sample.ts:62-78`, the loop that adds `step` to `s` in `f64` until `s`
  is not below `total − step × 0.5`, then places the last sample at `total`.
  A contour shorter than one step gives one start sample (`sample.ts:55`).
  Reuse on the CPU for counts; port the placement.
- **The hash randomness.** `core/brush/random.ts:7-15` `mix` (lowbias32 with
  `Math.imul`) and `random.ts:18-20` `rand`. Port to WGSL bit for bit.
- **The shared sampling** `core/brush/render/mark/render.ts:109-138`
  `shapeSamples` (pressure, wobble). Port.
- **The kind painters.** `core/brush/render/kinds.ts:58-89` `paintStamp`,
  `:179-210` `paintBristle`, `:26-52` `paintInk` (perfect-freehand). Port
  stamp and bristle; ink depends on the gate.
- **Colour jitter.** `core/brush/render/ink.ts:22-30` `jitteredInk` and
  `colour.ts:79-82` `shiftColour` (HSL). Port.
- **The mark atlas.** `gpu/mark-atlas.ts:108-128` packs marks into slots and
  lays dabs (one instanced draw) and bristle runs (one triangle-list draw) per
  page. `gpu/shader-mark.ts:7-9`: *"Tips and distances are computed in the
  mark's own pixels (the fragment's page pixel less the slot corner), so a mark
  looks the same wherever it is packed."* Reuse unchanged.
- **The coverage atlas** draws ink outlines today as exact-area pieces
  (`gpu/marks.ts:61`: *"if (set.polys.length > 0) {"* returns `kind: "piece"`).
  The ink fallback writes edges into it.
- **The smear compute pass.** `gpu/smear.ts:81`
  *"cp.dispatchWorkgroups(1);"*; its shader carries the paint load and, for
  wet paint, a copy of the backdrop from dab to dab (`shader-smear.ts:41-58`).
  Reuse; chunk 8 changes only where its dabs come from.
- **GPU pass timing.** `timed(f, …)` works on compute passes (`smear.ts:78`:
  *"f.enc.beginComputePass(timed(f, "smear"))"*).
- **Kept picture tiles** have no items, so nothing in them is expanded again
  (`gpu/lower.ts:333`: *"if (kept !== undefined) return { name: `kept tile
  ${key} of "${v.key}"`, rect: kept.rect, items: [] …"*).
- **Tests:** `canvas-loop/test/scene-spike/brush-cases.ts` (parity crops
  against today's Skia, blends and erase, expansion cache, stability under
  translation, paper scopes) and `gpu.test.ts` (cache equivalence on the three
  ports, repeatability). They share one device opened in `before`
  (`gpu.test.ts:39`: *"gpu = await openGpu();"*).
- **The walker-speed harness**, `scratch/stage4/walker-speed/` (`measure.sh`,
  `bpage.sh` with the GPU lock). Not tracked. Reuse for chunk 6.

## Prior art (external)

- **GPU stroke expansion with prefix sums.** Levien and Uguray, "GPU-friendly
  Stroke Expansion" (2024), https://arxiv.org/abs/2405.00127. Evaluated only.
  This subplan keeps the arc-length prefix on the CPU, because the walker
  has 40,119 input points against 106,769 samples.
- **Distance to a tapered capsule**, Inigo Quilez, "2D distance functions",
  "Uneven Capsule", https://iquilezles.org/articles/distfunctions2d/ (the
  reviewer got a 403; not re-read). Evaluated only: chunk 4 uses the
  projected axis distance defined below, not the exact hull distance.
- **perfect-freehand 1.2.3**: its radius formula (`size × (0.5 − thinning ×
  (0.5 − pressure))`) is adopted by the capsule ink and already acknowledged
  (`ACKNOWLEDGEMENTS.md:31-35`). Its outline code
  (`getStrokeOutlinePoints.ts`, `getStrokePoints.ts`, tag v1.2.3 on GitHub)
  is what the fallback ports.
- **WebGPU limits** (https://www.w3.org/TR/webgpu/#limits). Defaults as
  reported by a reading of the spec, not checked verbatim:
  `maxComputeWorkgroupsPerDimension` 65535, `maxStorageBufferBindingSize`
  128 MiB, `maxBufferSize` 256 MiB, `maxStorageBuffersPerShaderStage` 8.
  The design reads the device's limits at run time.
- **WGSL integer overflow wraps** (§6.2.3,
  https://www.w3.org/TR/WGSL/#integer-types): *"Expressions on concrete
  integer types that overflow produce a result that is modulo 2^bitwidth."*
- **WGSL permits floating-point reassociation and fusion**
  (https://www.w3.org/TR/WGSL/#floating-point-reassociation), per the
  reviewer. So determinism across compilers is not assumed; repeatability on
  one device and one build is tested.
- **Unverified, avoided:** the `u32` → `f32` conversion rounding rule (the
  port converts `h >> 8u`, under 2^24 and exact) and the `min`/`max` blend
  factor rule (chunk 4 sets both factors to `"one"`).

## Ontology

Existing names are kept. New nouns:

- **Prepared contour** (new). One contour after `prepare`, in brush space:
  its points (`f32`), its cumulative arc lengths (computed in `f64`, stored
  `f32`), its exact sample count from `resample`'s loop, its step, its seed
  (`hashNumbers([i], seed)`, `expand.ts:116`). Not samples.
- **Prepared stroke** (new). A stroke's prepared contours, brush space `b`
  and `q` (`expand.ts:66`), its jitter base colour and a conservative
  brush-space box. Identified by today's expansion key (`expand.ts:161`).
  Kept by `BrushExpander` as `MarkSet` is today.
- **Sample** (existing CPU type, `core/brush/sample.ts:5`). On the GPU, one
  32-byte record per sample, wobble applied.
- **Records buffer** (new). One storage buffer per frame: a header, then
  contour records, then mark records (device map `e`, fractional offset,
  slot, output ranges, brush numbers). Rebuilt every frame.
- **Geometry buffer** (new). One storage buffer per frame: every prepared
  point as (x, y, cumulative length), 12 bytes.
- **Fractional offset** (new). For a mark at box corner `(x0, y0)` and device
  translation `(tx, ty)`: `(tx − x0, ty − y0)` in `f64` on the CPU. A mark's
  pixel is `L·p + offset` in `f32`, so a whole-pixel move leaves it unchanged.
- **Batch** (new). A range of one atlas page's work whose outputs fit the
  output buffers: one compute dispatch per entry point, then the page's draws
  for that range. Batches of a page run in order.
- **Expansion pass** (new). The compute work of one batch: entry points
  `samples`, `dabs`, `capsules`, `bristles`.
- **Capsule** (new, if the gate passes). One ink segment between consecutive
  samples: two centres and two radii, drawn into the mark atlas with `max`
  blending.
- **Dab** and **Run** (existing, `brush/record-ctx.ts:10-24`); their instance
  layouts stay (`DAB_FLOATS = 12`, `RUN_FLOATS = 24`, `mark-atlas.ts:17-18`).
- **TexMark** (existing, `gpu/jobs.ts`). Gains a `gpu` field in place of
  `dabs` and `runs` once its kind runs on the GPU.

## Tracks / scope

One track in nine chunks, with a gate at chunk 1 and a stop point after
chunk 6.

### Per brush kind: where it runs and why

| Kind (presets) | Today | Decision | Why |
|---|---|---|---|
| Sampling: resample, pressure, wobble | CPU `shapeSamples` | **compute**, entry `samples`, one thread per sample | 106,769 samples on the walker; each depends only on its contour's prefix, step and seed |
| `prepare`, arc-length prefix, sample counts, seed, flattening, bounds | CPU | **stays on CPU** | 2.9–3.1 ms median (probe); the counts must be fixed before the dispatch so every output index is fixed; `f64` there keeps counts equal to today's |
| `stamp` (pencil, chalk, airbrush, wash) | CPU `paintStamp`, `linMarks`, `#lay` | **compute**, entry `dabs`, one thread per sample, writes `DAB_FLOATS` instances | 71,335 dabs on the walker; the existing `dabVs`/`dabFs` pipeline draws them; a skipped dab (`kinds.ts:66`: *"if (radius <= 0.05 \|\| alpha <= 0) continue;"*) is written with alpha 0, which leaves source-over unchanged |
| `ink` (ink, marker) | CPU perfect-freehand, a coverage piece | **decided at the chunk 1 gate**: capsules (compute, entry `capsules`, plus a capsule draw) or the fallback (one GPU thread per contour runs perfect-freehand's outline) | the capsule union is order-independent; perfect-freehand's outline is sequential per stroke |
| `bristle` (bristle) | CPU `paintBristle` | after the stop point: **compute**, entry `bristles`, one thread per bristle walking its samples | runs break where the alpha level changes and take the run's average width (`kinds.ts:160`); a sequential walk per bristle keeps that rule exactly |
| `smear` (smudge, wet) | CPU samples; one workgroup per stroke | after the stop point: **samples from the `samples` entry**; the smear pass stays | the smear is order-dependent (`coverage-matrix.md:61`) |
| Hue and light jitter (stamp, bristle) | CPU `jitteredInk` | **in the `dabs` and `bristles` entries** | a WGSL `shiftColour` per dab or bristle index |
| Hatching effect | fragment shader (`gpu/shader-painterly.ts:249`) | **no change** | not brush expansion |
| Hatch marks drawn with a brush (`walker-sheet/ink-tea.ts:89`) | stamp | as stamp | a brushed path |
| Dashes on plain strokes | CPU `geometry/dash.ts` | **no change** | not brush expansion |
| Paper grain, opacity, blend, erase | the mark's composite draw (`gpu/records.ts:76`) | **no change** | applied once per mark after expansion |

**Compute writing instance buffers, not vertex-shader instancing.** A vertex
shader could compute each dab from `(stroke, k)`. That runs the sample and
hash code six times per dab, needs a new dab pipeline, and leaves nothing to
read back. Compute writes the existing layouts once, and a test reads them
back and compares them with the CPU expansion while both exist.

### The contour contract

The CPU decides, per contour and once, everything that sets an index:
1. `prepare` exactly as `sample.ts:31-43` (consecutive duplicates dropped; a
   closed contour of more than two points repeats its start).
2. Segment lengths and the cumulative prefix in `f64`, from the prepared
   points, so a closed contour's closing edge is counted once.
3. The sample count by running `resample`'s own loop (`sample.ts:62-66`):
   repeated `f64` addition of `step`, the last sample at `total`. A closed-form
   formula is not used: for `total = 2.85`, `step = 0.3` the loop gives 11
   samples and `ceil(total / step − 0.5) + 1` gives 10. A contour with
   `total < step` or fewer than two prepared points has one sample at its
   start (`sample.ts:55`).
4. A contour with one sample (step 3's short case) is placed first, before
   any endpoint rule: at its start, `s = t = 0`, normal `(0, −1)`, pressure
   1, as `sample.ts:55` does. Otherwise the GPU places sample `k < n − 1` at
   `s_k`, uploaded per contour as the `f64` value of `step` and computed as
   `k × step` in `f32`, and places the last sample at the contour's end
   point. `s_k` on the GPU can differ from
   the CPU's repeated sum in the last bits; the count cannot.

Per kind, short and closed contours:
- **Stamp:** one sample, one dab, as today.
- **Ink, one sample:** a disc of radius `r(p)` at the sample. Today
  perfect-freehand draws a single point as an off-centre dot (measured: for
  one point of size 4 at pressure 1, outline distances from the point run
  from 1.62 to 4.41). The gate shows this case.
- **Ink, closed:** the samples already end at the start (step 1), so no extra
  closing segment is added. (Draft 1 added one; that was wrong.)
- **Ink, a zero-length segment:** a disc of the larger radius.
- **Bristle, one sample:** a dab (`kinds.ts:181-191`), written by `dabs`.

### Ink: capsule geometry (if the gate passes)

For a segment from `A` (radius `rA`) to `B` (radius `rB`), length `L`, and a
pixel centre `q` in the mark's own pixels:
- `t = clamp(dot(q − A, B − A) / L², 0, 1)`; `c = A + t (B − A)`;
- `d = |q − c|`, the **unsigned** distance from the axis segment, `d ≥ 0`;
- `r = rA + t (rB − rA)`;
- coverage `= max(0, min(d + 0.5, r) − max(d − 0.5, −r))`: the length of the
  pixel's span `[d − 0.5, d + 0.5]` inside the band `[−r, r]`, the 1-D box
  filter the bristle run shader uses across its centreline
  (`shader-mark.ts:68`). Examples: `r = 2, d = 3` gives 0; `r = 2, d = 2`
  gives 0.5; `r = 0.3, d = 0` gives 0.6, so lines under one pixel keep their
  tone.
- At `t = 0` or `t = 1` the shape is the end disc of that radius.
- **What the taper does.** With `rA ≠ rB`, this field is not the distance to
  the convex hull of the two end discs. The hull's sides lean by an angle
  `θ` with `sin θ = (rB − rA) / L`; the projected field puts the edge at
  `r(t)` measured square to the axis, which is out by about `r (1 − cos θ)`.
  On ink, `L` is the sample step (at least 0.5 brush px) and `rB − rA` comes
  from the pressure envelope: for a 2.2-wide walker line tapering over 5 px,
  `sin θ ≈ 0.15` and the edge moves about 1% of the radius. When
  `|rB − rA| ≥ L`, one end disc contains the other; the capsule is drawn as
  the larger disc alone.
- **The union.** The blend is `max` on every channel, both factors `"one"`.
  `max` of each capsule's filtered coverage is not the filtered coverage of
  the union: inside a joint or a crossing, two partial coverages in one pixel
  give a value below the true one. The gate measures this against a 16×16
  supersampled reference on straight segments, round ends, sharp bends,
  subpixel crossings and varying radii. Pass: mean edge error under 0.05
  coverage and no pixel over 0.25 (the parity criterion for edges is a mean
  under 0.15).

What else changes against perfect-freehand: joins are round, there is no
outline smoothing or short-start filtering, caps are the end discs, and
edges are 8-bit coverage in the `rgba8unorm` mark atlas.

### The ink fallback (if the gate fails)

One GPU thread per ink contour runs a port of perfect-freehand 1.2.3's
`getStrokePoints` and `getStrokeOutlinePoints` over that contour's GPU
samples, with today's options (`kinds.ts:32-41`). It writes the outline as
edges into the coverage atlas's edge buffer at a fixed range per contour:
the CPU reserves the outline's upper bound, and unused edges are zero-length,
which add no area. Two points per sample plus the caps is not a bound:
perfect-freehand emits extra points at each sharp corner (its corner loop,
`getStrokeOutlinePoints.ts` lines 296–316 at v1.2.3). In the round-2 review,
100 samples alternating between `(0,0)` and `(0.5,0)` with today's options
gave 2,594 outline points against 242 under that rule. The bound is derived
from the port's own loop (points per sample including the corner arc, plus
the caps and `getStrokePoints`' added points), checked in batching and the
limits, and tested on that repeated-sharp-turn case. Ink stays a
coverage piece; its look stays today's up to `f32`. Cost: a sequential walk
per contour (286 contours of up to a few hundred samples on the walker) and
a larger edge buffer. Tests compare the outline points with perfect-freehand's
on the CPU. If the boxholder rejects both, ink stays CPU-expanded and only
stamps move.

### Determinism, as tested requirements

- **Fixed output indices.** Every output range is fixed on the CPU before the
  dispatch; a thread writes only its own indices; no atomics or compaction.
  Draw order within a slot is instance order, which is sample order.
- **Hashes bit for bit.** `rand` becomes `f32(mix(...) >> 8u) / 16777216.0`:
  the same 24 high bits as the CPU's value, converted exactly. The seed stays
  on the CPU (`random.ts:71-79`).
- **Floats against the CPU.** Positions, pressure and noise are `f32`. Noise
  cells (`floor(s / cell)`) and bristle gaps (`kinds.ts:139`: *"Math.floor(c.s
  / 2.5)"*) can fall on the other side of an integer from the CPU's `f64`.
  That is the parity criteria's allowance for brush detail.
- **Run to run.** Fixed indices remove scheduling races; they do not prove
  repeatability, because the compiler may reassociate and fuse (WGSL spec,
  above). Tests check it: the same frame twice in one process, in a fresh
  process with a new device, after `release()` and wake, and after a batch's
  output buffers are reused within a frame (chunks 3, 5, 9).
- **Device-space seeding** (`canvas-loop-scene.md:342-344`: *"Brush seeds
  depend on device-space geometry today … so a change of pixel ratio or
  transform changes texture"*). Decision 7 fixed this on the CPU
  (`expand.ts:10-12`). The uploaded points are in brush space; `e = ratio · q`
  and the fractional offset apply only when an instance is written. So ratio
  1 and 2 get the same dabs, scaled (`brush-cases.ts:63`: *"a translation and
  another pixel ratio keep the expansion"*).
- **Cross-backend.** Dawn under Node and Chromium on this Mac give
  byte-identical output today (Checkpoint 4, decision 1), while their Dawn
  builds match. Lavapipe differs in the last bits (`stage3/dawn-linux.md`).

### Buffers, bindings and batches

**Bindings.** Each entry point binds at most four storage buffers and one
uniform:

| Binding | `samples` | `dabs`, `capsules` | `bristles` |
|---|---|---|---|
| 0 records (read) | yes | yes | yes |
| 1 geometry (read) | yes | no | no |
| 2 samples | write | read | read |
| 3 output (`STORAGE \| VERTEX`) | no | write | write |
| uniform: the batch's ranges | yes | yes | yes |

**Inputs.** The records and geometry buffers are written once per frame with
`queue.writeBuffer` (walker: 544 KB packed). `writeBuffer` runs before the
frame's command buffer, so an input buffer is never rewritten within a
frame. If either input exceeds `B = min(maxStorageBufferBindingSize,
maxBufferSize, 64 MiB)`, it is split at contour boundaries into several
buffers, each bound by the batches that need it. A single contour over `B`
(about 5.6 million points) is an error that names the call.

**Outputs.** The samples buffer and the output buffer are sized to `B` and
are frame-temporary, as the spike's buffers are (`f.temp`, freed at frame
end, `renderer.ts`). No pool. They are reused from batch to batch inside the
frame's one command encoder: batch `i`'s draws are encoded before batch
`i + 1`'s dispatch, and command order within an encoder is execution order.
A page with more than one batch uses `loadOp: "load"` for its second and
later render passes. Frame memory for brushes is then at most two buffers of
`B`, plus the inputs.

**Where a batch may split, per kind.** A split must not change any pixel.
- **Samples:** at any sample index; a sample depends only on its contour's
  prefix, step and seed.
- **Stamp:** at any sample index; dab `k` depends only on sample `k`.
- **Capsule:** at any segment; the batch also holds the segment's second
  sample (one sample of overlap).
- **Fallback ink outline:** only between contours; one contour must fit.
- **Bristle:** only between bristles or contours; a bristle's whole run list
  depends on its whole contour (run breaks, average width per run,
  `kinds.ts:160`; mitres need the neighbours, `mark-atlas.ts:23-53`). Its
  output is `(n − 1) × 6 × 96` bytes for `n` samples, so one bristle fits in
  64 MiB up to about 116,000 samples. A bristle over that is an error that
  names the call. (A 64-bristle stroke of 4,000 samples, 141 MiB in all,
  splits into batches by bristle.)
- **Smear:** never split. A smear's dabs carry the load and, for wet paint,
  the backdrop copy from dab to dab (`shader-smear.ts:41-58`). A smear whose
  samples exceed `B / 32` bytes is an error that names the call.

Each kind gets a test that renders with `B` forced small (so every split
point is used) and checks the bytes equal an unsplit render.

**Dispatch size.** Workgroups of 64 threads; past `65535 × 64` threads, a 2-D
dispatch with a linearized index.

**Lavapipe.** Dawn there printed *"a storage-buffer limit was reduced"*
(`stage3/dawn-linux.md:22`); the value was not recorded. Chunk 6 runs the
GPU tests in the Lima VM after chunks 2–5, and chunk 9 runs them again after
chunks 7–8.

### Caches and picture keys

- The prepared stroke replaces the `MarkSet` in `BrushExpander`'s cache, under
  the same key; it is ratio-independent, so a ratio change keeps it.
- The cache of placed marks, `kept.get(`m|${ex.key}|${linearKey(e)}`, …)`
  (`gpu/marks.ts:139`), goes for GPU kinds.
- Nothing per stroke is kept on the GPU. A stroke drawn every frame is
  expanded every frame; a static stroke inside a picture is drawn once into a
  kept tile and not expanded again (`lower.ts:333`).
- Picture versions, keys and `deps` do not change.
- `release()` clears the prepared strokes; wake prepares them again.
- Cache equivalence: the expansion is a function of the records and geometry
  buffers, which are a function of the prepared strokes and their placement.
  Slot positions differ between frames and do not change pixels
  (`shader-mark.ts:7-9`). Tests check it (existing cache-equivalence test).

### No CPU fallback for the renderer

WebGPU compute is core WebGPU, and the renderer needs WebGPU already
(`canvas-loop-scene.md:90`: *"A WebGL2 fallback is not required."*). The CPU
expansion that remains for bristle and smear before the stop point is drawn
by the same WebGPU renderer.

### Seams with the other subplans

- **(a) scene core** (`canvas-loop-scene-core.subplan.md`). Decision:
  **(b) builds on the spike first**, in `canvas-loop/src/scene-spike/`, or on
  (a)'s renamed files if (a)'s first chunk moves them. Reasons: the
  walker-speed harness and the three ports run on the spike now; and (a)'s
  gallery migration takes new PNG baselines, so (b)'s ink change (chunk 4)
  should land before those baselines, or they are taken twice. Chunk 9 waits
  for (a) to retire the Canvas2D painter, because `core/brush/render/` is
  still that painter's code.
- The parity test's reference is today's Skia through `teaView`
  (`brush-cases.ts:17`: *"const ref = teaView(s.size);"*). Whichever subplan
  lands first freezes those reference renders as fixtures; chunk 2 does it if
  (a) has not.
- **The frame budget beyond brushes** (record, non-brush lowering) is
  owned by subplan (a), chunk 4b. See open question 1.
- **(c) box figures.** Not in scope; chunk 6 reports the lavapipe number for
  (c).

### Chunk 1: the ink gate

- **What.** A prototype in `scratch/stage5/brushes/` (CPU only, TypeScript,
  `f64`): it takes the walker's own ink strokes (samples from today's
  `shapeSamples`) and rasterizes them by the capsule rule above, then cuts the
  same crops from today's perfect-freehand render (the spike renderer, run
  under the GPU lock, or today's Skia through `teaView`). Crops: a head
  outline, a hand (tight curves), a foot (a sharp corner), a long tapered
  limb outline, a short tapered stroke, a single-point dot; at ratio 2, at
  normal size and at 4×. Also the supersampled checks of the union (above).
  Astra reads the pairs through `codex exec` (model `gpt-6-astra`, crops
  attached); the boxholder then judges.
- **Why.** The ink look is a principle 2 question that the crop averages in
  `brush-sheet.ts:85` (luminance and contrast) cannot answer.
- **Pass:** the boxholder accepts the capsule ink. **Fail:** chunk 4 builds
  the fallback. The boxholder may also choose to leave ink on the CPU.
- **Checkpoint.** The boxholder's decision, recorded in this plan.
  **Measurement:** the supersampled union errors; the crops.

- **Gate result (2026-11-15).** The prototype's crops, the union errors (mean
  0.022, worst pixel 0.447 at near-reversing bends and subpixel crossings;
  the walker's own crops 0.017 and 0.399) and Astra's pass are in
  `scratch/stage5/brushes/gate/` and the exhibit "Ink: today's outline beside
  the faster capsule ink". The boxholder: "they both basically look the same
  to me, so if there's one that's more efficient or something then choose
  that." **Decision: capsules as specified, with no special dot rule.** The
  fallback is not built. The max-pixel threshold is not met at those
  geometries; the boxholder's visual judgement replaces it.

### Chunk 2: stroke preparation and the sample pass

- **What.** `BrushExpander` returns a prepared stroke for every kind (still
  with the `MarkSet` beside it while the CPU path draws). A new
  `gpu/brush-pass.ts` packs the records and geometry buffers and runs the
  `samples` entry of a new `gpu/shader-brush.ts`: find the contour (binary
  search over contour sample offsets), place the sample by the contour
  contract, find its segment (binary search over the prefix), interpolate
  position and normal, evaluate pressure (the presets of `envelope.ts:5-12`
  and keyframes), add wobble (`noiseOf(1, period)`, `render.ts:123-135`).
  WGSL `mix`, `rand`, `noise1`. Freeze the Skia reference crops if (a) has
  not.
- **Signatures.** `prepare(req: ExpandRequest): Prepared | undefined` in
  `brush/expand.ts`; `class BrushPass { encode(marks: readonly TexMark[], f:
  { enc; temp; timer }): BrushOutputs }`.
- **Tests.** Sample readback against `shapeSamples` for the brush sheet, the
  walker's first frame and focused contours: a contour shorter than one
  step, a closed rectangle, a polygon with duplicate consecutive points, a
  closed polygon whose last point already equals its first, and a contour of
  length `2.85` at step `0.3`. Same count per contour; positions within 1e-3
  brush px; pressure within 1e-5; the last sample equal to the end point, except a
  one-sample contour, whose sample is its start. The
  WGSL `mix` against JS `mix` on 65,536 inputs, bit for bit.
- **Checkpoint.** No pixel changes. **Measurement:** preparation and upload
  ms per frame on the walker, Node and Chromium, median and p95; the
  `samples` pass GPU time.
- **As built (chunk 2).** `prepare` and `brushSamples` (the CPU reference)
  are in `scene/brush/expand.ts`; `Expanded.prepared()` makes the prepared
  stroke on first use and keeps it in the expansion cache. `gpu/brush-pass.ts`
  and `gpu/shader-brush.ts` hold the pass. Details settled here:
  - `BrushPass.encode` takes prepared strokes (`Prepared[]`), not
    `TexMark[]`: ink is a coverage piece until chunk 4 and smear a
    `SmearRec` until chunk 8, and the sample pass serves every kind.
  - Normal rendering does not prepare, upload or dispatch anything yet
    (review round on chunk 2: the unread pass cost about 3 ms of CPU per
    walker frame, and its one-batch cap could fail a frame). The pass runs
    only through `GpuRenderer.sampleBrushes(strokes)`, a verification and
    measurement path that the readback tests and the measurement script
    call; it reads the samples back and reports the pack-and-upload CPU
    time and the pass's GPU time. It also keeps `brush-pass.ts` in the
    renderer's unit for `layout-check`. Chunk 3 moves the pass into the
    frame, where its samples are read. Over one buffer
    (`min(maxStorageBufferBindingSize, maxBufferSize, 64 MiB)`, about two
    million samples) that path fails with a `GpuRenderError` that gives the
    sizes, until chunk 5 splits batches.
  - A sample's segment is not found from float arc lengths. A sample at a
    corner (`(0,0) → (1.8,0) → (1.8,3)`, step 0.3: `6 × 0.3` in `f32` lands
    past the `f32` corner) would take the outgoing normal where the CPU
    takes the incoming one, about 0.04 px off with wobble 1. Preparation
    runs `resample`'s loop (`sample.ts` `sampleSegments`) and stores, per
    segment, the index of the first sample the loop puts on it or past it;
    the GPU searches those integers. A point is 16 bytes (x, y, arc length,
    that index), not 12. A contour with no points gets 0 samples (it had 1,
    reading another contour's geometry).
  - A sample is 8 words: x, y, nx, ny, s, t, p, and its contour's index.
    Contour records are 16 words after a 4-word header, and keyframes follow
    them (a keyframe followed by one at the same t is dropped, as
    `envelope.ts` skips it). The uniform is binding 4; binding 3 stays for
    the output.
  - A one-sample contour's pressure is the envelope at `t = 0`, as
    `shapeSamples` gives it, not 1 (contract step 4 quotes `resample`,
    whose 1 `shapeSamples` overwrites). A closed one-sample contour with
    wobble gave NaN on the CPU (its wobble cell was `0 / 1`); `wobbleLattice`
    now gives it the open cell, so its wobble is read at 0 on both sides,
    and the readback tests include it.
  - `sample.ts` exports `preparePoints` and `sampleSegments` (the loop, run
    without placing samples); `render.ts` exports `stepFor` and
    `wobbleLattice`; `MIX_WGSL` is split out of `PAPER_WGSL` with the same
    shader text.
  - The brush sheet's and smear sheet's Skia renders are frozen in
    `canvas-loop/test/fixtures/scene-parity/` (`brush-sheet.png`,
    `brush-smear.png`, 176 KB), and `brushParity` reads them. The other
    parity tests still read Skia live; (a)'s chunk 6 freezes those.
  - Readback (Metal): the brush and smear sheets, 5,842 samples, largest
    position difference 7.6e-5 brush px, pressure 6.9e-7; focused contours
    (with the corner, an empty contour and a closed dot), 1,995 samples over
    20 contours, 3.2e-5 and 2.5e-7; walker frame 0, 108,099 samples over
    775 contours, 2.9e-4 and 1.1e-6. Counts are equal everywhere, and no
    wobbled sample at a corner took the other segment's normal. The hash
    matches on all 65,536 inputs.
  - **Measurement** (Node, Dawn on Metal, walker frames 0–59, three passes
    after a warm-up; `scratch/stage5/b2/measure.ts`, after the review
    fixes): per frame 529 strokes, 779 contours, 107,237 samples, about
    676 KB uploaded. Preparation of every stroke: median 2.96 ms, p95 6.34.
    Preparation through the expansion cache: median 3.11 ms, p95 3.87,
    because every walker stroke changes every frame (530 of 530 expanded),
    so the cache saves nothing here. Packing, upload and encoding: median
    0.60 ms, p95 0.77. The `samples` pass on the GPU: median 0.066 ms, p95
    0.131. Chromium was not measured: the walker-speed browser pages need
    a new bundle and the router; chunk 6 measures Chromium.
  - No pixel changes: the walker at ratio 1 and 2, Hallway and chemistry
    (21 PNGs) hash the same before and after, and `gallery:check` passes
    with the same output (`scratch/stage5/b2/before.sha256`,
    `after.sha256`).

### Chunk 3: stamp dabs on the GPU

- **What.** The `dabs` entry writes one `DAB_FLOATS` instance per stamp
  sample: size jitter and scatter (`randOf(11)`, `randOf(12)`,
  `kinds.ts:54-55`), radius and alpha (`kinds.ts:64-65`), tip, and jitter
  colour (channels 13 and 14). Positions are `e · p + offset` in the mark's
  own pixels. A stamp mark's box is the prepared stroke's box grown by
  `width / 2 × (1 + sizeJitter / 2) + scatter × width / 2 + wobble + 1`,
  mapped by `e` and translated.
- **Tests.** Dab readback against the CPU dabs after `linMarks`: same count,
  centres within 2e-3 device px, radius and alpha within 1e-4, the same
  zero-alpha dabs, and **RGB within 1/255 for a stamp with nonzero
  `hueJitter` and `lightJitter`** (a new case; the brush sheet has none). A
  bounds test at the extremes of `scatter`, `sizeJitter` and `wobble`.
  Existing: `brushParity`, `brushStability`, `expansionCache`, cache
  equivalence on the three ports. New: the walker frame byte-identical in a
  fresh process with a new device.
- **Checkpoint.** Crops within the brush criteria. **Measurement:** walker
  lowering and atlas CPU ms, Node and Chromium.
- **As built (chunk 3).** Stamp strokes are no longer expanded on the CPU:
  the expander keeps a `StampSet` (the prepared stroke, the brush, the tint)
  in place of a `MarkSet`, and `expandOnCpu` keeps the CPU expansion as the
  tests' reference. Ink, bristle and smear are unchanged. Details settled here:
  - **The box.** `prepared.box` already includes the wobble, so the mark's
    box grows it by `width / 2 × (1 + sizeJitter / 2) + scatter × width / 2`
    in brush space, maps the four corners by `e`, and adds 1 **device** px
    (the dab quad's edge) after the mapping, where the plan adds `wobble + 1`
    before it. At the extremes (scatter 10, sizeJitter 1, wobble up to 20)
    the closest dab stays 7.8 px inside its box at ratio 1 and 15.9 px inside
    at ratio 2. The placed-marks cache (`kept`, `m|…`) no longer holds stamps.
  - **The pass.** The mark atlas owns the `BrushPass`. After `shelfPack`, it
    sorts the frame's stamp marks by page and encodes them in one compute
    pass: `samples`, then `dabs`. Each page then draws its contiguous range
    of instances with the existing dab pipeline (`draw(6, n, 0, first)`).
    `dabs` is a second shader module in `shader-brush.ts` (`DABS_WGSL`)
    because binding 2 is read-write in `samples` and read-only in `dabs`.
    Contour word 13 holds the address of a 24-word stroke record (`lin`, the
    offset to the mark's own pixels, the slot, width, ratio, the brush
    fields, the jitter base). Stroke records follow the keyframes. The dab
    buffer is `STORAGE | VERTEX` and frame-temporary. Pipelines compile on
    first use.
  - **Tests** (`brush-pass.gpu.test.ts`) go through
    `GpuRenderer.stampBrushes`, a verification path like `sampleBrushes`.
    The test places each stroke as the lowering does (`stampBox`, the offset,
    a fractional translation) and does not read the frame's own buffer;
    parity, stability and cache equivalence cover that wiring. Dabs against
    `linMarks` of the CPU expansion, at ratio 1 and 2:
    - brush sheet: 2,546 dabs;
    - focused contours: 1,049 dabs;
    - walker frame 0: 72,655 dabs.

    Largest differences: centre 4.7e-4 device px, radius 6.2e-6, alpha
    2.6e-7. A new jitter case (`test/gpu/stamps.ts`) covers grey, wrap-around
    hue, near white and near black, rotation and non-uniform scale, and
    zero-pressure ends: 1,714 dabs, RGB equal, and the same 72 dabs skipped.
    The walker frame at ratio 1 and 2 hashes the same in a child process
    with a new device.
  - **Pixels.** Stamps changed less than expected. Against chunk 2:
    - the brush sheet: 9 pixels by 1/255;
    - the smear sheet: no change;
    - walker frames 0 and 30: 3 to 18 pixels by 1/255.

    The parity crops against the frozen Skia references are unchanged at the
    reported precision (pencil: luminance 0.08%, contrast 6.27%; chalk 0.02%
    and 0.27%; airbrush 0.06% and 0.3%; wash 0.08% and 0.83%). No gallery
    exercise uses the scene renderer, so gallery output does not change;
    `gallery:check` passes. Images: `scratch/stage5/b3/{before,after,diff}`.
  - **Measurement** (Node, Dawn on Metal, walker frames 0–59, three passes
    after a warm-up, `scratch/stage5/b3/measure.ts`; ms per frame, median
    and p95):

    | Ratio | Lowering, before | Lowering, after | Atlas, before | Atlas, after | Both, before | Both, after |
    |---|---|---|---|---|---|---|
    | 1 | 29.0, 83.0 | 19.8, 71–82 | 5.36, 5.92 | 3.74, 4.20 | 34.3, 88.6 | 23.5, 75–86 |
    | 2 | 33.1, 89.1 | 22.0–22.5, 75–83 | 6.34, 7.36 | 4.20–4.27, 24–30 | 39.3, 95.2 | 26.1–26.8, 79–89 |

    The atlas p95 at ratio 2 is V8 garbage collection. On every spike frame
    `--trace-gc` shows a Mark-Compact of 17–34 ms inside the atlas step,
    where before it fell in lowering; the step it lands in varies, and in one
    case it was `shelfPack`, normally 0.1 ms. The p95 of lowering plus atlas
    together fell. Chromium was not measured; chunk 6 measures it.
  - **Stroke-local coordinates** (from the cross-model review). Converting
    absolute brush-space points to `f32` moved a stamp at x = 16,777,217
    one device pixel when it was translated back near 0. The CPU path keeps
    doubles until placement. A prepared stroke now keeps an `origin` (its
    first point, f64), and its points and GPU samples are relative to it.
    `stampWords` adds `lin · origin` to the placement offset in f64. A
    regression test places that stamp at device x = 10. Readback
    differences shrank (walker samples 2.9e-4 → 1.3e-5 brush px, dabs
    4.7e-4 → 3.6e-5 device px). The walker frame hashes changed by rounding.

### Chunk 4: ink on the GPU

- **What, capsules.** The `capsules` entry writes one instance per segment
  (and one disc per single-sample contour). A capsule pipeline in
  `gpu/mark-atlas.ts` (vertex: the bounding quad of both end discs grown by
  one pixel; fragment: the capsule rule above; `max` blend) draws them into
  ink marks' slots. Ink marks become `kind: "tex"` (`gpu/marks.ts:101`) and
  draw as coverage (`records.ts:76`, `src` 3).
- **What, fallback.** As described above, into the coverage atlas.
- **Tests, capsules.** The supersampled checks from the gate, as tests;
  `brushBlends` (marker multiplies; ink erase, half erase); the ink and
  marker crops; a thin-line case (width 0.6 and 1.0 device px, mean tone per
  row within 3% of the frozen Skia reference); a self-crossing loop no darker
  at the crossing; the same capsules in reverse order give the same bytes.
- **Tests, fallback.** Outline points against perfect-freehand on the CPU,
  within 1e-3 px; the same crops.
- **Checkpoint.** Ink crops; Astra reads the walker at 4× again.
  **Measurement:** the walker in Chromium at ratio 2 (`measure.sh`, under the
  GPU lock): fps, record, lower, atlas, encode, GPU pass times.
- **As built (chunk 4).** Ink strokes are no longer expanded on the CPU: the
  expander keeps an `InkSet` (the prepared stroke and the brush), and ink
  marks are `tex` marks drawn as coverage (src 3). perfect-freehand stays only
  in `expandOnCpu`, for the tests, until chunk 9. Details settled here:
  - **One capsule per sample, not per segment.** Sample `i` writes capsule
    `i`, from it to sample `i + 1` of its contour. The contour's last sample
    writes radius 0, which the vertex shader collapses to nothing. A
    one-sample contour writes a disc. A capsule instance has the dab's 12
    floats (ax, ay, ra, bx; by, rb, 0, 0; the slot). Stamps and inks share
    one instance buffer: the pass packs stamp strokes first (a stable
    reorder), runs `dabs` over the stamps' samples and `capsules` over the
    inks'. `capsules` is a second entry in the dabs module (`INSTANCES_WGSL`).
    The radius is perfect-freehand's, `width / (1 + thinning) × (0.5 −
    thinning × (0.5 − p))`, times the ratio.
  - **Per-contour origins** (from the cross-model review). Chunk 3's one
    origin per stroke let a far contour move a near one: a path with moves
    to x = 67,108,864 and x = 10.25 put the near ink disc at x = 12. Each
    prepared contour now keeps its own origin (its first point, f64), and
    its record holds where that origin lands in the mark's own pixels,
    summed in f64 (contour words 14–15; stroke words 4–5 are unused).
    Regression tests for ink and for a stamp place the near mark at 10.25.
  - **The box.** Ink grows the prepared box by `width / 2` in brush space
    (pressure 1), then adds 1 device px after mapping, as stamps do
    (`gpuBox`, was `stampBox`). On the brush sheet and the walker the nearest
    capsule quad stays 0.06–0.15 px inside its box.
  - **Renames.** `StampJob` → `BrushJob`, `TexMark.stamp` → `gpu`,
    `encodeStamps` → `encodeMarks`, `GpuRenderer.stampBrushes` →
    `brushInstances`. A new verification path, `GpuRenderer.capsulePage`,
    draws given capsule instances with the atlas's capsule pipeline and reads
    the page back. `brushRequests` (tests) now keeps each call's translation.
  - **Tests** (`test/gpu/mark-atlas.ink.gpu.test.ts`; the layout check wants
    the name of a module):
    - Capsule readback against the CPU samples (brush sheet, walker frame 0,
      ratio 1 and 2, 35,444 walker capsules): ends within 6.4e-5 device px,
      radius within 2.3e-6.
    - The gate's union checks against a 16×16 supersampled union. On the 69
      cases: mean edge error 0.0218, worst pixel 0.4471. The gate measured
      0.0218 and 0.4468. On the walker's ink in the gate's windows, each mark
      on its own: mean 0.0165, worst pixel 0.400. The gate measured 0.0172 and
      0.399. The test asserts the mean under 0.05 and within 0.003 of the
      gate's. The worst-pixel limit of 0.25 was waived by the boxholder at the
      gate, so the test holds the worst pixel within 0.01 of the gate's
      measurement instead.
    - 1,944 capsules in one cell, drawn forward and in reverse: the same
      bytes.
    - A closed bowtie in half-alpha ink and in a marker without grain: the
      crossing has the side's colour, and no nearby pixel is darker.
    - `brushBlends` and the ink and marker crops of `brushParity` pass
      unchanged. Ink: luminance 0.01%, contrast 0.07%. Marker: 0.05% and
      0.63%.
    - The walker frame is byte-identical in a fresh process.
  - **Thin lines: the Skia reference does not hold at 0.6 px.** The frozen
    Skia sheet is `test/fixtures/scene-parity/ink-thin.png`. Rows at 1.0 px
    are within 0.75% of it. Rows at 0.6 px are 7.2% darker (even pressure)
    and 4.3% darker (taper). Skia antialiases by sampling a pixel at 4 × 4
    points, and that loses tone on lines thinner than a pixel. Today's
    perfect-freehand outline filled by exact area, which is what the GPU
    renderer drew before this chunk, is as dark as the capsules: 4.460
    against 4.449, where Skia gives 4.144. The same outline sampled at 4 × 4
    points gives 4.153 (`scratch/stage5/b4/thin.log`). No exact-area
    renderer can meet 3% against Skia at 0.6 px. The test asserts every row
    within 3% of today's outline by exact area (worst 0.5%), the 1.0 px rows
    within 3% of Skia, and the 0.6 px rows within 8% of Skia.
  - **Pixels.** The walker frame at ratio 2 changes only along ink. In the
    gate's crop windows, 6–17% of pixels change, and mean luminance moves by
    at most 0.7 (eyebrow: 117.83 → 117.12). Crops:
    `scratch/stage5/b4/crops/`. Astra, with the two methods shown only as A
    and B (`scratch/stage5/b4/astra.out`), found the same line character:
    *"They share the same irregular, hand-drawn line character. B has a
    modest tendency toward fuller small marks and harder terminations"*
    (B is capsules). It notes a blunter eyebrow start and a squarer heel, and
    says they are subtle at normal size. Gallery output does not change.
  - **Measurement**, the walker at ratio 2, before and after (ms per frame;
    `scratch/stage5/b4/`):

    | | Chromium, before | Chromium, after | Node, before | Node, after |
    |---|---|---|---|---|
    | fps (rAF) | 27.4 | 34.8 | | |
    | frame, waited to GPU completion (mean) | 41.4 | 33.0 | | |
    | record (mean) | 12.2 | 11.7 | | |
    | lower (median) | 16.8 | 9.3 | 20.6 | 10.2 |
    | atlas (median) | 2.3 | 2.1 | 3.7 | 3.4 |
    | encode (median) | 1.1 | 1.1 | 2.6 | 3.2 |
    | GPU span (mean) | 7.8 | 7.0 | | |
    | GPU: coverage, marks, clip, draw (mean) | 2.4, 0.9, 2.3, 2.1 | 1.5, 1.8, 1.8, 2.0 | | |

    Chromium runs the walker page (`scratch/stage5/b4/walker-page.ts`, the
    Stage 4 browser entry moved to the current modules) built with the
    walker-speed `build.ts` and served at the exhibit path on port 3230
    (`measure.sh`). The "before" page is the same entry bundled from HEAD's
    source extracted into scratch. The brush pass shows about 0 ms because
    Chromium quantizes timestamps to 0.1 ms and the pass is shorter than
    that. Ink moved GPU time from the coverage pass to the marks pass. Node
    is `scratch/stage5/b3/measure.ts`, frames 0–59, three passes after a
    warm-up.

### Chunk 5: batching and limits

- **What.** The batch rules above: `B` from the device's limits, input
  splits at contours, output reuse within the encoder, `loadOp: "load"` for
  later passes, 2-D dispatch, the named errors.
- **Tests.** For samples, stamp and ink: `B` forced small, bytes equal to an
  unsplit render. Inputs split. The over-limit errors name the call. The
  walker byte-identical after `release()` and wake.
- **Checkpoint.** **Measurement:** none beyond the tests; batching adds no
  pass on the walker at the real `B`.

### Chunk 6: measurement and visual review; the stop point

- **What.** A `brush` field in `stats.cpu`. Run targets 1 and 3 in Chromium;
  record the six-figure page directly. Headless walker and Hallway timing in
  Node. The GPU tests and a walker run on lavapipe in the Lima VM. Crops of
  the brush sheet, stress frame and three ports at ratio 1 and 2; Astra read;
  an exhibit. Measure the CPU expansion that is left: bristle on the Stage 3
  stress frame (12% bristle) and smear on the smear scene, so the boxholder
  can weigh chunks 7–9. Update draft section 9 (*"A shared CPU step expands
  it"*, `scene-api-draft.md:285`) and add a draft 2.10 note; one line in
  `canvas-loop/BRUSHES.md` if ink changed.
- **Stop point.** The boxholder decides whether chunks 7–9 go ahead, on these
  facts: (1) the measured CPU time of bristle and smear expansion on scenes
  that use them; (2) maintenance: before chunk 9, two expansion paths exist
  (CPU for bristle and smear, GPU for the rest), with two sampling
  implementations whose outputs differ in `f32` detail; chunk 9 removes about
  650 lines (`RecordingCtx`, the kind painters, `linMarks`, the CPU parts of
  `#lay`). Both paths draw through the one WebGPU renderer, so stopping here
  does not break "one renderer". perfect-freehand is ink-only
  (`kinds.ts:4`); whether it stays depends on the ink decision, not on
  chunks 7–9. Lean: continue only if bristle or smear expansion is a
  measurable share of a scene box agents draw.

### Chunk 7: bristle on the GPU (after the stop point)

- **What.** The `bristles` entry: one thread per (contour, bristle). It makes
  the bristle (`kinds.ts:104-118`), walks the samples (`kinds.ts:132-153`),
  splits runs where the level changes and shares the boundary point
  (`kinds.ts:199-204`), and writes each run's mitred strip
  (`mark-atlas.ts:23-86`, ported) in a fixed range of `(n − 1) × 6`
  vertices; unused vertices are degenerate.
- **Tests.** Strip readback against the CPU runs (positions within 2e-3 px;
  levels equal except where a gap index is within 1e-3 of an integer); RGB
  for a bristle with jitter; `B` forced small splits by bristle with equal
  bytes; the over-limit error. `brushStability` moves a bristle stroke.
- **Checkpoint.** Bristle crops. **Measurement:** the stress frame, CPU and
  GPU ms.

### Chunk 8: smudge and wet from GPU samples (after the stop point)

- **What.** The smear pass reads its dabs from the sample buffer (radius and
  alpha from `p`, as `expand.ts:120`) in place of `SmearRec.dabs`.
  `SmearPass.region` (`smear.ts:26-37`) uses the conservative box, clamped as
  now. A smear is never split.
- **Tests.** Smear crops in `brushParity`; `smudgeAcrossTiles`; the
  over-limit error.
- **Checkpoint.** **Measurement:** the smear scene, before and after.

### Chunk 9: retire the CPU expansion; final verification (after the stop point and subplan (a))

- **What.** Delete `brush/record-ctx.ts`, `expandIn`'s kind painters,
  `linMarks`, the CPU parts of `#lay`, and what (a) has left of
  `core/brush/render/` and the CPU sampling. If ink moved to capsules, remove
  the `perfect-freehand` dependency (`canvas-loop/package.json:50`) and update
  its `ACKNOWLEDGEMENTS.md` entry (formula kept). The readback tests switch
  to golden numbers recorded from the CPU path before deletion.
- **Final verification.** Fresh-process repeatability, wake, and batch-reuse
  tests across all kinds; the GPU tests on lavapipe again.
- **Checkpoint.** Typecheck, lint, scene tests; the three ports render the
  same bytes as after chunk 8. **Measurement:** changed lines against the
  estimate.

## Could this be simpler?

- **Web Workers** (option (b) at Checkpoint 4). Same pixels, no WGSL; about
  155,000 primitives a frame to transfer (`stage4-plan.md:219-221`), and
  `linMarks` and `#lay` stay on the main thread. The boxholder chose the GPU.
- **Stop after chunk 6.** It moves everything the walker, Hallway and
  chemistry use. Bristle and smear stay CPU-expanded through the same
  renderer. What chunks 7–9 buy is the measured CPU time of those kinds on
  scenes that use them, and the removal of a second expansion path; the stop
  point weighs both.
- **Keep ink on the CPU.** The walker's ink outlines cost about 5 ms (before
  the speed round) plus their edge data; this leaves most of a target's gap.
  It is the floor if both GPU inks fail the gate.
- **No records buffer, one dispatch per stroke.** 526 dispatches a frame;
  draw-call count dominated cost in Stage 3 (`stage3/brushes.md:226`).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| The WGSL `mix` uses a signed shift or `i32` multiply | new (chunk 2, bit for bit) | no | silent |
| The sample count differs from `resample`'s loop (closed-form drift, missing closing edge) | new (chunk 2, focused contours incl. 2.85/0.3) | the CPU runs the loop | silent |
| A one-sample ink contour draws nothing | new (chunk 4, gate crop) | a disc per single-sample contour | silent |
| A closed ink contour gets a doubled closing segment | new (chunk 2 count, chunk 4 crops) | no extra segment | silent |
| The capsule union is too light at joints or crossings | new (gate and chunk 4, supersampled reference) | none beyond the bound | silent visually |
| A conservative box is smaller than the dabs' reach; `inSlot` discards the overflow | new (chunk 3 bounds test) | the reach formula | silent |
| An input or output exceeds a device limit | new (chunk 5, forced small `B`) | batching; named errors | clear |
| A split changes pixels (bristle runs, smear state) | new (chunks 5, 7, 8: split equals unsplit) | split points restricted per kind; smear never split | silent without the test |
| An output index written twice or not at all | readback tests (chunks 2, 3, 7) | no | silent |
| A rewritten input buffer within a frame | chunk 5 split test | inputs written once per frame | silent |
| Run-to-run difference from compiler or resource reuse | new (chunks 3, 5, 9: fresh device, wake, reuse) | fixed indices | clear in tests |
| Colour jitter wrong | new (chunks 3, 7: RGB readback) | no | silent |
| Lavapipe's reduced storage limit below four | chunk 6 and 9 VM runs | four per entry | clear: pipeline creation throws |
| The fractional offset rounds and the texture crawls under a whole-pixel move | existing `brushStability` | `f64` offset | clear in tests |

No critical gap: every silent row has a test in the chunk that adds the code.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED. No API changes; validation stays at
  record time (`core/brush/presets.ts:179` `resolveBrush`).
- **Stale ref:** ADDRESSED. Prepared strokes are keyed by recorded data.
- **Two agents touching the same card:** not applicable; figures on one page
  share a device and pop their error scopes per frame already.
- **Hand-edit drift; fabricated free-form value:** not applicable.
- **Validation error UX:** ADDRESSED. A stroke over a limit raises an error
  naming the call and the limit; other GPU errors name the pass.
- **Partial migration / transition state:** ADDRESSED. Between chunks 3 and 9
  a frame mixes CPU- and GPU-expanded kinds; each mark is one kind. Ink
  changes once, at chunk 4. The transcript line *"brushed strokes N: expanded
  X, expansion cache hits Y"* (`gpu.test.ts:113`) keeps its wording;
  "expanded" means prepared on the CPU, and draft 2.10 says so.

## NOT in scope

- **The record step's cost** (11.4 ms in Chromium on the walker) and
  non-brush lowering. Unowned; open question 1.
- **Curve flattening on the GPU.** Inside the 2.9–3.1 ms CPU step.
- **A GPU-side expansion cache or a buffer pool.** Frame-temporary buffers as
  now; revisit only if chunk 6 measures allocation cost.
- **The faint-mark warning.** Left for a decision at Checkpoint 4.
- **Plain-stroke geometry, dashes, fills and clips on the GPU.**
- **Box figures, the server driver, deployment.** Subplan (c).
- **New brush looks** (for example radius noise on ink). A separate decision.
- **A Chromebook-class check.** Desktop numbers accepted (Checkpoint 4,
  answer 7).

## Open design questions

1. **The rest of the frame budget** (recording and non-brush lowering) is
   owned by subplan (a), chunk 4b, which closes on whole-frame browser
   measurements taken after this plan's chunk 6.
2. **The ink look.** Decided at the chunk 1 gate by the boxholder.
3. **Chunks 7–9.** Decided at the stop point after chunk 6.

## Knowledge audits

Skip: no agent-facing concept changes. The brush API, presets and errors
stay the same, apart from the new over-limit errors, which name the call.

## What will hold this after it ships

- **Readback tests** (chunks 2, 3, 7): GPU samples, dabs and strips against
  the CPU expansion while it exists, then against golden numbers. They catch
  porting errors that crops pass. Existing GPU test tier (`onGpu`).
- **Contract tests** for counts, short and closed contours.
- **Split-equals-unsplit tests** per kind.
- **Repeatability tests** with a fresh device, after wake, and with buffer
  reuse.
- **The WGSL hash test**, bit for bit.
- **Existing pixel tests**: brush crops, blends and erase, stability, cache
  equivalence on the three ports.
- **Speed** is not held by a test. Chunk 6 records the numbers in this plan;
  the harness stays in scratch, as in Stage 4.

## Implementation order

1. Chunk 1: the ink gate. No dependency; can run beside chunk 2.
2. Chunk 2: preparation and the sample pass.
3. Chunk 3: stamp dabs. Needs 2.
4. Chunk 4: ink, capsules or fallback. Needs 1 and 2; lands before (a) takes
   its gallery baselines.
5. Chunk 5: batching and limits. Needs 3 and 4.
6. Chunk 6: measurement and review. Needs 5. **Stop point.**
7. Chunk 7: bristle. Needs 6 and the boxholder's go-ahead.
8. Chunk 8: smudge and wet. Needs 6 and the go-ahead.
9. Chunk 9: retire the CPU expansion. Needs 7, 8 and (a)'s retirement of the
   Canvas2D painter.

Each chunk is a commit or a few. The subplan ships with the rest of the
redesign, when the boxholder says so.

## Rollout shape

**Done when** these pass:
- Chunk 1: the boxholder's decision; the supersampled union bounds.
- Chunk 2: sample readback and the contour cases; the WGSL hash.
- Chunk 3: dab readback with RGB; bounds; existing brush and
  cache-equivalence tests; fresh-device repeatability.
- Chunk 4: the capsule or fallback tests above.
- Chunk 5: split-equals-unsplit for samples, stamp and ink; over-limit
  errors; wake.
- Chunks 7–8: their readback, split and crop tests.
- Chunk 9: all of the above against golden numbers and frozen crops;
  repeatability across all kinds; lavapipe.

**Acceptance measurements** (chunk 6, Chromium on this machine, ratio 2,
under the GPU lock; median and p95 over at least 300 frames):

| Measure | Now | Acceptance |
|---|---|---|
| Brush CPU on the walker (`stats.cpu.brush`: preparation, packing, upload) | about 15 ms expansion plus placement and atlas data | under 3.5 ms median |
| Brush GPU passes on the walker (timestamp queries) | the dab pass only | under 2 ms |
| Walker frame minus record | 32.8 ms (44.2 − 11.4) | under 12 ms |
| Target 1, walker sheet fps | 22.8 | reported; 60 needs open question 1 |
| Target 3, six figures fps each | 11.0 (ratio 1), 10.8 (ratio 2) | reported directly |
| Headless walker frame (Node, Dawn) | 59.1 ms | reported |
| Lavapipe walker frame (Lima VM, ratio 1) | not measured | reported, for subplan (c) |
| Brush crops (sheet, stress, smear, three ports) | pass today | pass: luminance within 3%, contrast within 15%; Astra: same character |
| Repeatability, cache equivalence | byte-identical | byte-identical, including a fresh device |

No migration: the scene data does not change.

## Review round 1

Codex (`gpt-6-astra`), `scratch/cross-model/2026-11-15T13-32-47-840Z-codex.md`,
8 findings, each checked against the source.

1. **Capsule coverage formula.** Held, as an ambiguity: the formula is right
   only for the unsigned distance from the axis segment. Now specified, with
   the taper's effect and the contained-disc case. The sub-point that `max`
   of filtered coverages is not the union's filtered coverage also holds;
   kept as a bounded approximation, measured against a supersampled
   reference at the gate, rather than replaced.
2. **Ink look unproved.** Held. The ink gate is now chunk 1, before any
   capsule pipeline, with a named fallback. The reviewer's suggestion of
   radius noise is out of scope.
3. **Buffer limits.** Held: there was no per-stroke cap (`MAX_SEGMENTS` is
   per curve segment, `core/contours.ts:14-18`), bristles reach 64
   (`presets.ts:149`), and draft 1 needed five storage bindings. Now: packed
   bindings (four), inputs written once, outputs reused in encoder order, no
   pool.
4. **Splitting changes appearance.** Held for bristle (`kinds.ts:160`) and
   smear (`shader-smear.ts:41-58`). Split points are now restricted per kind,
   smear is never split, and each kind has a split-equals-unsplit test.
   Lavapipe is run again after chunks 7–8.
5. **Projections beyond the probe.** Held: the probe did not store or pack,
   reported a minimum, and the table mixed runs. The probe now packs the
   arrays and reports median and p95 (2.9–3.1 ms median, 5.8–10.2 ms p95, up
   from 1.79 ms minimum); the table names each number's source; projections
   are labelled hypotheses; the frame budget beyond brushes is unowned.
6. **Short and closed contours.** Held: `resample` returns one start sample
   (`sample.ts:55`); draft 1's extra closing capsule doubled an edge; the
   probe missed `prepare`'s closing point; the count formula was wrong
   (checked: 11 against 10 for 2.85 and 0.3). Now a contour contract with
   focused tests. On the walker the corrected probe gives the same counts.
7. **"One renderer" justification.** Held: CPU-expanded bristles drawn by
   WebGPU are one renderer, and perfect-freehand is ink-only (`kinds.ts:4`).
   Chunks 7–9 are now justified by measured benefit and maintenance cost,
   behind a stop point after chunk 6.
8. **Verification gaps.** Held: the tests share one device
   (`gpu.test.ts:39`), and no test exercised colour jitter. Determinism is
   now a tested requirement (fresh device, wake, buffer reuse), with RGB
   readback for jitter.

Rejected: no finding outright. Partly rejected: in finding 1, replacing the
`max` union with an exact union coverage; the bound is tested instead,
because an exact union needs an outline or a per-pixel list of capsules,
which is the sequential work this plan removes.

## Review round 2

Codex (gpt-6-astra) verified the round-1 fixes. Six held; two were partly
open and are fixed above: the ink fallback's outline bound now counts
perfect-freehand's corner points, and a one-sample contour is placed at its
start before the endpoint rule. The rejected exact-union point was accepted as
a gated approximation whose thresholds chunk 1 must demonstrate.
