# Stage 3 probe: geometry

Part of `beebox/docs/plans/canvas-loop-scene.md`, Stage 3. Brief:
`canvas-loop-scene/stage3-brief.md`. Judged against
`canvas-loop-scene/parity-criteria.md`. Run 2026-11-15 in the repo's headless
Chromium (Apple M2 Pro, WebGPU on Metal, WebGL2 on ANGLE Metal). Code:
`scratch/stage3/geometry/` (not tracked).

## Question

Which browser backend draws canvas-loop's plain shapes well and fast enough:
(a) our own WebGPU renderer, (b) PixiJS v8 on WebGPU, or (c) CanvasKit (Skia
in WebAssembly on WebGL)?

## What was built

One content module (`sheet.ts`) describes two scenes as data. The test sheet
(1280 × 760) has filled circles, ellipses, rounded rects, polygons and a
concave star; Catmull-Rom curves through points (the same math as
`canvas-loop/src/core/contours.ts`); a self-crossing filled curve; plain
strokes 0.5, 1, 2, 8 and 24 px wide with butt, round and square caps and
miter, round and bevel joins; a sharp join past the miter limit; a see-through
stroke that crosses itself; a hairline grid on and between pixels; linear and
radial gradient fills and a gradient stroke; shapes under rotation and
non-uniform scale. The stress frame has 2000 seeded random shapes (circles,
rects, rounded rects, polygons, rotated ellipses; see-through colours; a
quarter of them stroked). The reference is a canvas-loop sketch that draws the
same data through its Skia context (`v.ctx`) and renders with `cli run`. Ratio
2 renders at 2560 × 1520 with a scale of 2. Each browser page rebuilds the
whole frame from the data every frame. A fourth page draws with the browser's
own Canvas2D, as today's browser runtime does; it is a baseline, not a
candidate.

**Own WebGPU renderer: exact-area coverage.** CPU code flattens each shape to
device-space polygons (chord error 0.1 device px; Wang's formula for cubics)
and expands strokes in the shape's own space before the transform, so a
squashed shape gets a squashed outline, as Skia does. A stroke is a union of
pieces: one quad per segment, a wedge per join on the outer side, a cap per
open end, all with one orientation. Each shape gets a slot in a 4096 × 4096
float "coverage atlas". Pass 1 draws one instanced quad per polygon edge,
from the edge to the slot's right side; the fragment shader adds the signed
area of the pixel to the right of the edge, in closed form. The sum per pixel
is the exact covered area with nonzero winding. Pass 2 draws one instanced
quad per shape: coverage is min(|area|, 1), times a solid colour or a gradient
evaluated per pixel, composited source-over in draw order. A frame is two
draw calls per atlas page. Why this approach: Skia's raster backend uses
analytic (exact-area) antialiasing, so exact area is the shortest path to
edge parity. MSAA 4× gives only five coverage levels and visible steps on
near-horizontal edges; stencil-then-cover still needs an antialiasing method.
One coverage value per shape also gives the right answer for a see-through
stroke that overlaps itself, and the same pass is what brush marks need
(coverage-matrix row `ink`: one coverage pass per mark).

**PixiJS 8.22.0** from jsdelivr (`dist/pixi.min.js`): one `Graphics` per op,
cleared and rebuilt each frame; `antialias: true` (MSAA), `resolution` = ratio;
gradients as `FillGradient` in global texture space.

**CanvasKit 0.42.0** from jsdelivr (`bin/canvaskit.js` and `.wasm`): a WebGL
surface (`MakeWebGLCanvasSurface`, sample count 1, so Skia's own analytic AA
on the GPU); `drawCircle`, `drawOval`, `drawRRect`, `PathBuilder` paths, Skia
stroke paints and gradient shaders. The page carries the policy
`script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; default-src 'self' https://cdn.jsdelivr.net data: blob:`.
It loads and draws under it: WebAssembly needs `'wasm-unsafe-eval'`, not
`'unsafe-eval'`.

## Results

### Repeatability (criteria section 1)

| Backend | Same frame twice | Same after drawing the other scene | Same across page loads |
|---|---|---|---|
| Own WebGPU | yes, all 4 cases | yes | yes |
| CanvasKit | yes | yes | yes |
| PixiJS | yes | yes | yes |
| Browser Canvas2D (baseline) | **no**, all 4 cases | no | yes |

All three candidates meet the browser rule on this machine. The Canvas2D
baseline gave different bytes for two draws in one page; the cause was not
found (one guess: the 1-pixel readback used for timing moves the canvas to
another raster path).

### Appearance against Skia (criteria section 2)

"Flat" is the share of non-edge pixels within 4/255 (pass: 99%). "Edge" is the
mean coverage difference across antialiased edges (pass: under 0.15): for each
pixel whose 3 × 3 neighbourhood in the reference spans more than 24 levels,
the luminance difference divided by that span. p99 and the share over 0.25
show the worst edges.

| Backend | Scene, ratio | Flat within 4/255 | Edge mean | Edge p99 | Edges over 0.25 |
|---|---|---|---|---|---|
| Own WebGPU | sheet, 1 | 99.99% | 0.019 | 0.21 | 0.5% |
| Own WebGPU | sheet, 2 | 100% | 0.015 | 0.17 | 0.4% |
| Own WebGPU | stress, 1 | 99.39% | 0.025 | 0.16 | 0.2% |
| Own WebGPU | stress, 2 | 99.70% | 0.025 | 0.18 | 0.3% |
| CanvasKit | sheet, 1 | 99.99% | 0.026 | 0.25 | 0.9% |
| CanvasKit | sheet, 2 | 100% | 0.019 | 0.22 | 0.5% |
| CanvasKit | stress, 1 | 99.09% | 0.029 | 0.19 | 0.2% |
| CanvasKit | stress, 2 | 99.54% | 0.029 | 0.21 | 0.4% |
| PixiJS | sheet, 1 | **98.11%** | 0.047 | **0.99** | 4.1% |
| PixiJS | sheet, 2 | **98.12%** | 0.042 | **0.98** | 3.1% |
| PixiJS | stress, 1 | 98.82% | 0.037 | 0.26 | 1.2% |
| PixiJS | stress, 2 | 99.40% | 0.036 | 0.26 | 1.3% |
| Canvas2D (baseline) | sheet, 1 | 99.99% | 0.032 | 0.32 | 2.1% |
| Canvas2D (baseline) | stress, 2 | 99.49% | 0.032 | 0.24 | 0.8% |

By content, from the 4× crops (exhibit):

| Content | Own WebGPU | CanvasKit | PixiJS |
|---|---|---|---|
| Flat fills | match (differences of 1/255 in see-through layers) | match | match where the fill is right |
| Circle, ellipse, polygon edges | match | match | match |
| Self-crossing fill (nonzero) | match | match | **wrong**: one lobe missing, a wedge filled |
| Strokes 2 to 24 px, caps, joins, miter limit | match | match | match |
| See-through stroke crossing itself | match (one coverage per shape) | match | **wrong**: darker where it crosses |
| 0.5 and 1 px strokes | same tone, fewer and darker pixels on diagonals | match | same tone, fewer and darker pixels; dark dots where grid lines cross |
| Gradients | match (±1/255) | match | match |
| Rotation, non-uniform scale | match (the outline squashes with the shape) | match | match |

On 0.5 and 1 px lines the mean tone over each row is within 0.3% of Skia for
every backend; only the spread differs. Skia spreads a thin line over more,
lighter pixels.

### Stability over time

Not measured: this probe draws still frames. Every candidate redraws a frame
to the same bytes, which is the precondition.

## Timing

Mean and 95th percentile over 120 frames after 20 warm-up frames. Each frame
rebuilds everything from the data and waits for the GPU (`onSubmittedWorkDone`
for WebGPU, a 1-pixel `readPixels` for WebGL, a 1-pixel `getImageData` for
Canvas2D). Frames are not presented, so this is draw cost, not frame rate.

| Backend | Sheet, ratio 1 | Sheet, ratio 2 | 2000 shapes, ratio 1 | 2000 shapes, ratio 2 |
|---|---|---|---|---|
| Own WebGPU | 1.5 / 2.0 ms | 3.3 / 4.0 ms | 6.8 / 8.0 ms | 8.5 / 11.3 ms |
| CanvasKit | 1.4 / 1.7 ms | 2.4 / 2.6 ms | 8.0 / 8.6 ms | 8.0 / 8.3 ms |
| PixiJS | 1.8 / 1.9 ms | 1.9 / 2.2 ms | 10.2 / 11.1 ms | 11.0 / 12.3 ms |
| Canvas2D (baseline) | 1.1 / 1.2 ms | 2.8 / 2.9 ms | 9.2 / 9.4 ms | 14.8 / 16.1 ms |

- **Own WebGPU:** CPU lowering (flatten, stroke, pack, upload) is 0.5 ms of
  the sheet and 4.2 to 5.2 ms of the 2000-shape frame (93,000 to 126,000
  edges). The rest is GPU. At ratio 2 the stress frame needs two atlas pages.
  Each page clears the whole 64 MB float atlas; that is most of the sheet's
  ratio-2 cost and can be cut by clearing only the used rows. Single frames
  reached 15 ms.
- **CanvasKit:** the 2000-shape frame is the same at both ratios, so it is
  bound by the JavaScript-to-WebAssembly calls and Skia's CPU work, not by
  pixels. Start-up after the download is cached: 45 ms.
- **PixiJS:** cost is in rebuilding `Graphics` (triangulation on the CPU).
- No stalls other than the single slow frames named above.

### Download size

| Backend | Size |
|---|---|
| Own WebGPU (renderer and tessellator, minified) | 14 KB, 5.6 KB gzip |
| PixiJS 8.22.0 `pixi.min.js` | 841 KB, 231 KB brotli |
| CanvasKit 0.42.0 `canvaskit.js` + `canvaskit.wasm` | 121 KB + 7.3 MB; 33 KB + 2.6 MB brotli |

## Integration cost for canvas-loop

**Own WebGPU.** The scene maps directly: a path or primitive node lowers to
rings, a stroke style to rings, a paint to a paint record. The coverage atlas
is the general mechanism the scene needs elsewhere: a brushed mark is coverage
then one composite; a clip or mask multiplies a second coverage slot; erase
is a different composite blend (destination-out); groups render to a texture
and composite once. Separable blend modes are fixed-function; the others need
a copy of the backdrop, as in any WebGPU renderer. Custom shaders for brushes
and effects are ours to write in the same pipeline. What we must write and
own: dashes (not in the probe), arcs, the full Canvas2D stroker (it matched on
this sheet; corner cases remain), text (another probe), atlas tiling for a
shape larger than 4096 device px, and CPU lowering cost. The pure-JS lowering
also runs headless, so both runtimes can share the geometry code.

**CanvasKit.** It is Skia, the same engine as the headless reference, so
semantics match by construction: nonzero and even-odd fills, Skia's stroker,
gradients, all 30 Skia blend modes, erase (`Clear`/`DstOut`), path clips,
offscreen surfaces, and runtime shaders in SkSL (`RuntimeEffect` is in the
default build). Costs: a 2.6 MB WebAssembly download; WebGL, not WebGPU
(this build has no WebGPU device context), so a WebGPU pass for brushes or
effects cannot share textures with it without a copy through the CPU or a
canvas; per-call overhead from JavaScript into WebAssembly, which makes it
CPU-bound on many small shapes; and memory managed by hand (`delete()`).

**PixiJS.** A retained display tree maps to scene nodes; it has blend modes
(advanced ones as an add-on), an `erase` blend, stencil and alpha masks,
render textures, filters and custom WGSL meshes. Against it: fills are
triangulated, so a self-crossing shape fills wrongly; a stroke's overlapping
pieces darken where a see-through stroke crosses itself; and the CDN build
does not run without `'unsafe-eval'` ("Current environment does not allow
unsafe-eval, please use pixi.js/unsafe-eval module"); avoiding that needs an
npm bundle that imports `pixi.js/unsafe-eval`. Fixing the two drawing faults
would mean replacing its shape pipeline, which is most of what we would use
it for.

## What surprised me

- Exact-area coverage on the GPU matched Skia's edges better than CanvasKit's
  own WebGL backend did (edge mean 0.019 against 0.026 on the sheet). The
  shader is about 20 lines.
- A float precision bug: for a nearly vertical edge, the closed-form area
  divides two nearly equal large numbers and leaks thin horizontal streaks to
  the right of the shape. Treating "fully left of the pixel" and "fully right"
  as exact cases fixed it.
- CanvasKit runs under a policy without `'unsafe-eval'`; PixiJS from the CDN
  does not.
- The browser's own Canvas2D was not repeatable within one page here, while
  every GPU candidate was.

## Answer for the backend choice

Ranking for plain shapes:

1. **Own WebGPU renderer.** Passes every parity measure, the closest edges to
   Skia, repeatable, 14 KB, fastest on the 2000-shape frame at ratio 1, and the
   coverage-atlas design is the same mechanism that brush marks, clips, masks
   and erase need. Its costs are code we write and own, and CPU lowering that
   should be cached per unchanged node.
2. **CanvasKit.** Passes every measure and matches Skia by construction, with
   all blends, clips and SkSL. It ranks second for a 2.6 MB download, a WebGL
   context that cannot share textures with our WebGPU brush and effect
   passes, and CPU-bound cost on many shapes. It is the fallback if the own
   renderer's work grows too large.
3. **PixiJS.** Fails flat-fill parity (98.1%) because it fills a self-crossing
   curve wrongly and darkens a see-through stroke where it overlaps itself,
   needs `'unsafe-eval'` from the CDN, and is the slowest of the three on many
   shapes.

## Open problems

- Dashes, arcs, even-odd fill and the stroker's rare cases were not built in
  the own renderer.
- Shapes larger than the atlas (4096 device px) need tiling.
- The own renderer's frame is about two-thirds CPU on the 2000-shape frame; a
  scene that keeps lowered geometry for unchanged nodes would remove most of
  it. Not measured.
- Atlas clear cost at ratio 2: clear only the used part.
- Thin lines (0.5 and 1 px): Skia spreads them over lighter pixels; ours
  follow exact area. Tone matches; whether the boxholder sees a difference is
  for Checkpoint 3.
- The Canvas2D baseline's repeatability failure is unexplained.
- A low-end GPU (Chromebook class) was not tried.
