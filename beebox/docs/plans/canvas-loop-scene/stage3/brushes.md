# Stage 3 probe: brushes

Part of `beebox/docs/plans/canvas-loop-scene.md`, Stage 3. Brief:
`canvas-loop-scene/stage3-brief.md`. Judged against
`canvas-loop-scene/parity-criteria.md`. Run 2026-11-15 in the repo's headless
Chromium (Apple M2 Pro, WebGPU on Metal, WebGL2 on ANGLE Metal) and in Node.
Code: `scratch/stage3/brushes/` (not tracked). Exhibit: "brushes: today's Skia
marks vs WebGPU".

## Question

Can a GPU backend draw canvas-loop's brush marks with the same character as
today's Skia renderer, and much faster? Today the inked walker sheet takes
about 178 ms per frame at ratio 2; 53% of that is the composite of each mark
from its scratch canvas (`browser-profile.md`). The scope grew during the
probe: the same work in (a) an own WebGPU renderer and (b) CanvasKit 0.42.0,
in the browser (WebGL) and headless in Node (CPU raster).

## What was built

**Scenes** (`scene.ts`, plain data). The sheet (1000 × 800): one row per preset
(ink, marker, pencil, chalk, airbrush, wash, bristle), three strokes at
widths 0.5×, 1× and 1.6× with taper, even and swell pressure, a loop that
crosses itself, and two crossing strokes over a tinted strip. The stress frame
(1280 × 1000): 500 seeded marks in 16 figure-sized cells, mixed presets
(40% ink, 16% pencil, 12% bristle, 10% wash, 8% marker, 8% chalk, 6%
airbrush). The smear scene (480 × 240): stripes and two ink lines, then one
smudge stroke and one wet stroke across them. A small figure of five brushed
marks for the translation test.

**Reference.** `ref-node.ts` drives canvas-loop's `Painter` over
`@napi-rs/canvas`, the same code path as `cli run`. At ratio 1 its PNG is
byte-identical to `cli run` of `sheet-tea.ts`. It also renders ratio 2, which
the CLI cannot. `skia-page.ts` runs the same `Painter` on the browser's
Canvas2D, for today's browser timing.

**Shared CPU expansion** (`expand.ts`, draft 2.2 section 9). It reuses
canvas-loop's `resample`, `evalEnvelope`, `noise1`, `hashNumbers`,
`resolveBrush` and the kind painters in `brush/render/kinds.ts` unchanged.
The kind painters paint into a recording context. It keeps arcs and soft-dab
`drawImage` calls as dabs, filled paths as ink outlines, and stroked paths as
bristle runs. Expansion runs in the stroke's own coordinates; device
position is (point + placement) × ratio. So the seed hashes the call's own
points (draft 2.2 section 4, decision 7), and the dabs are the same at ratio
1 and 2. Both new backends draw this output.

**WebGPU** (`gpu.ts`). Each mark gets a slot in a 2048 × 2048 coverage atlas
(shelf packing). One atlas pass (4× MSAA plus stencil) draws all marks:
dabs as one instanced draw with an analytic hard or soft tip; ink outlines
by stencil-then-cover (nonzero); bristle runs as mitred triangle strips in
one draw. Within a slot, everything accumulates with premultiplied
source-over, as the Skia scratch layer does. Then one target pass draws one
quad per mark, in order. The quad reads the slot, cuts the paper grain,
colours the coverage and applies the mark's opacity once, with the mark's
blend (multiply is a fixed-function blend over the opaque target). The paper
is computed in the fragment shader: a port of `brush/paper.ts` with the same
32-bit integer hash, so it equals today's paper texture at whole pixels. The
paper origin is the placement, so grain moves with a placed picture. When the
atlas is full, the renderer flushes: atlas pass, target pass, next page.
Smudge and wet: copy the region the stroke reaches into a storage buffer, run
one compute dispatch (one workgroup of 256 threads; dab after dab, with
barriers between; the exact pickup and lay-down arithmetic of
`brush/render/smear.ts`), copy back. A smear ends the current batch, because
it reads what is drawn before it.

**CanvasKit** (`ck-render.ts`, the same file in the browser and in Node).
Per mark: `saveLayer` (bounds, alpha = opacity, blend) → dabs in one
`drawAtlas` call (a white 128 px dab image with mipmaps, colour per dab by
`Modulate`) → ink outline as a path → each bristle run as a stroked path →
paper grain cut with `DstOut` from a paper image → `restore`. The paper image
is generated in JavaScript, as today. An SkSL runtime shader cannot port the
paper hash: CanvasKit rejects `uint` and the bitwise operators (`>>`, `^`) in
runtime effects (tested). Smudge and wet follow `smear.ts` step by step, with
CanvasKit surfaces and a target snapshot per dab.

## Results

### Repeatability (criteria section 1)

| Runtime | Check | Result |
|---|---|---|
| Headless Skia (`@napi-rs/canvas`) | direct driver against `cli run`, sheet ratio 1 | byte-identical |
| WebGPU, sheet, stress, smear, ratio 1 and 2 | same frame twice; new renderer and new expansion | 0 pixels differ |
| WebGPU, sheet and stress, ratio 2 | two page loads | identical PNG |
| CanvasKit WebGL, same scenes | same frame twice; new surface and new expansion | 0 pixels differ |
| CanvasKit WebGL, sheet and stress, ratio 2 | two page loads | identical PNG |
| CanvasKit in Node (CPU), all six scene × ratio | two runs with new surfaces | byte-identical, PNG identical |

### Appearance against today's Skia (criteria section 2)

"Flat" is the share of non-edge pixels within 4/255 on every channel. Brush
marks are judged by eye on 4× crops and by mean luminance (pass: within 3%)
and contrast, the standard deviation (pass: within 15%), in each crop: 9
crops on the sheet (one per preset row, the bristle loop, the marker
crossing), 4 on the stress frame, 4 on the smear scene. The table gives the
worst crop.

| Backend | Scene, ratio | Flat within 4/255 | Worst luminance difference | Worst contrast difference |
|---|---|---|---|---|
| WebGPU | sheet, 1 | 99.93% | 0.3% | 3.8% (pencil) |
| WebGPU | sheet, 2 | 97.35% | 2.4% (bristle loop) | 4.6% (bristle) |
| WebGPU | stress, 1 | 99.79% | 0.1% | 0.6% |
| WebGPU | stress, 2 | 95.37% | 0.4% | 1.1% |
| WebGPU | smear, 1 | 98.38% | 0.5% | 0.7% |
| WebGPU | smear, 2 | 98.46% | 0.5% | 0.7% |
| CanvasKit WebGL | sheet, 1 | 99.85% | 0.3% | 4.6% (pencil) |
| CanvasKit WebGL | sheet, 2 | 97.20% | 2.4% (bristle loop) | 4.5% |
| CanvasKit WebGL | stress, 1 | 99.64% | 0.2% | 1.3% |
| CanvasKit WebGL | stress, 2 | 95.20% | 0.5% | 0.9% |
| CanvasKit WebGL | smear, 1 | 100% | 0.0% | 0.1% |
| CanvasKit WebGL | smear, 2 | 100% | 0.1% | 0.0% |
| CanvasKit Node (CPU) | sheet, 1 | 99.93% | 0.3% | 4.4% |
| CanvasKit Node (CPU) | stress, 2 | 95.26% | 0.4% | 1.1% |

All pass the brush criteria. Flat parity is not a brush criterion, but it
shows how close they are. At ratio 1 both backends draw almost the same
pixels as today, because the dabs are the same dabs. At ratio 2 they draw the
ratio-1 dabs scaled; today expands at device pixels, so its ratio-2 marks have
twice the samples and other random gaps. That is decision 7 working as
intended, and it is why ratio 2 flat parity is lower (95% to 97%) while
character stays the same.

By eye, on the 4× crops (exhibit): ink, marker, pencil, chalk, airbrush and
wash have the same weight, grain, edge softness and tone build in all three.
Bristle has the same character; single bristle gaps differ at ratio 2 for
the reason above. WebGPU hard dabs are analytic circles, as Skia's arcs;
CanvasKit hard dabs are a mipmapped image, slightly softer on dabs under 2 px
radius (pencil contrast 4.6% lower). WebGPU ink edges have 4× MSAA (five
coverage levels); at 4× zoom they look a little stepped against Skia's
analytic edges. The geometry probe's exact-area coverage would remove this.

CanvasKit in Node against CanvasKit WebGL: 99.7% to 99.9% of flat pixels
within 4/255, mean difference 0.05 to 0.2 levels per channel, largest 48
(antialiased edges of small dabs). Not byte-identical; CPU raster and GPU
differ in the last bit of blending and in edge coverage.

### Stability over time (criteria section 3)

The figure was drawn at x = 0 and moved 7 px and 7.5 px. The region inside
it was compared with the first frame shifted by the same amount.

| Renderer | Ratio | Moved 7 px: pixels that differ | Moved 7.5 px |
|---|---|---|---|
| Skia today | 1 | 27% (mean 7.3 levels) | 27% |
| Skia today | 2 | 24% | 24% |
| WebGPU | 1 | 0 | 23% (mean 3.3 levels) |
| WebGPU | 2 | 0 | 0 (15 device px) |
| CanvasKit WebGL | 1 | 0 | 22% (mean 2.3 levels) |
| CanvasKit WebGL | 2 | 0 | 0 |

Today the texture boils when a shape moves: the seed hashes device points,
and the paper is fixed to the canvas. With the seed from the call's own
points and the paper origin at the placement, the texture moves with the
shape exactly on whole device pixels. A half-pixel move resamples the edges
and snaps the paper to the nearest pixel; the texture does not change
pattern.

## Timing

Draw time per frame: rebuild from the scene, draw, wait for the GPU
(`onSubmittedWorkDone` for WebGPU, a 1-pixel `readPixels` for WebGL, a
1-pixel `getImageData` for Canvas2D). 120 frames after 15 warm-up frames,
except where noted. "Full" re-expands every mark every frame (as today);
"cached" reuses the expansion (marks unchanged). Mean / 95th percentile, ms.

| Scene | Ratio | Skia today, browser | WebGPU full | WebGPU cached | CanvasKit full | CanvasKit cached |
|---|---|---|---|---|---|---|
| Sheet (42 marks) | 1 | 23.1 / 58.7 | 8.3 / 10.4 | 4.7 / 5.6 | 14.9 / 21.5 | 10.6 / 11.2 |
| Sheet | 2 | 47.0 / 139 | 8.8 / 9.9 | 5.1 / 6.0 | 15.3 / 20.9 | 11.0 / 11.9 |
| Stress (500 marks) | 1 | 82.1 / 84.7 (30 frames) | 35.4 / 40.2 | 12.7 / 13.4 | 81.8 / 87.1 (60) | 56.3 / 57.8 (60) |
| Stress | 2 | 93.5 / 96.2 (30 frames) | 37.3 / 39.3 | 14.4 / 15.4 | 82.1 / 86.4 (60) | 55.7 / 57.2 (60) |
| Smudge + wet (2 strokes) | 1 | 199 / 425 | 8.8 / 11.4 | 8.0 / 10.3 | 50.0 / 50.9 | 49.2 / 50.0 |
| Smudge + wet | 2 | 237 / 575 | 13.7 / 15.7 | 13.7 / 15.6 | 48.4 / 49.1 | 48.4 / 49.5 |

Where the time goes:
- **Expansion** (shared CPU stage, the same for both backends): 4.5 ms on the
  sheet, 23 ms on the stress frame (14,851 dabs, 4,505 bristle runs, 229 ink
  outlines). It is the largest part of a WebGPU frame. Expansion does not
  depend on ratio.
- **WebGPU, cached:** 8.7 ms of the stress frame is JavaScript that packs the
  atlas and writes the vertex arrays; the rest is GPU. Mark-level opacity
  costs two render passes per atlas page: 2 passes at ratio 1, 8 at ratio 2
  (four 2048 px pages). That is the whole cost of "opacity applies once" for
  500 marks. A first version drew each bristle run separately with a stencil
  reference ("once per run"): 68 ms for the stress frame, mostly 4,505 draw
  calls and round-join discs. Mitred strips in one draw brought it to 14 ms;
  the parity measures did not change.
- **CanvasKit, cached:** CPU-bound and the same at both ratios. Without the
  per-mark `saveLayer` the stress frame takes 40.6 ms (ratio 1) and 45.5 ms
  (ratio 2), so 500 layers cost 10 to 16 ms. The rest is about 5,000 calls
  into WebAssembly (one path per bristle run).
- **Smudge and wet on WebGPU:** about 340 dabs in one compute dispatch each
  stroke, 20 to 40 µs per dab, because one workgroup runs the dabs in order.
  Expensive per stroke, but 15 to 30 times faster than today in the browser.
  A smear in an animation needs a cached result (bake once, as the coverage
  matrix suggests).
- **Headless.** Today's `@napi-rs/canvas`, steady frames: sheet 38 / 79 ms,
  stress 264 / 708 ms, smear 96 / 315 ms (ratio 1 / 2). CanvasKit CPU in Node:
  sheet 165 / 613 ms, stress 358 / 1,272 ms, smear 98 / 305 ms. CanvasKit
  headless is 1.4 to 4 times slower than today's native Skia.

### CanvasKit start-up (browser)

| Case | Wasm fetch | `CanvasKitInit` | First frame of the figure (ratio 2) |
|---|---|---|---|
| Cold (cache-busting query on the wasm URL), 3 loads | 84, 111, 326 ms | 92, 122, 335 ms | 77 to 94 ms |
| Warm (reload, wasm from cache), 3 loads | 5 ms | 33 to 34 ms | 76 to 79 ms |

The wasm is 2.58 MB on the wire (brotli); the cold fetch here is from a fast
network. Each additional surface (a new canvas with its own WebGL context,
six on one page): `MakeWebGLCanvasSurface` 10 to 11 ms, first frame of the
figure 44 to 48 ms. Of that, about 31 ms is the JavaScript paper image for
the new size; a shared paper image would remove it. The rest is the new WebGL
context and its shader compiles: CanvasKit surfaces on separate canvases do
not share a GL context. Redrawing all six figures warm: 9.5 ms. Chromium
allows 16 WebGL contexts per page.

## What surprised me

- The recording context made reuse easy. `kinds.ts` runs unchanged, so both
  backends get today's dabs, bristles and outlines, and ratio-1 output is
  almost pixel-identical to today.
- Expansion, not drawing, became the largest cost of a WebGPU frame. Today it
  is hidden under the composite cost.
- Per-run stencil for bristles cost five times more than the whole rest of
  the frame. Draw-call count matters more than pixels (as `browser-profile.md`
  and the compositing probe found).
- CanvasKit's SkSL has no integer bitwise operators, so the shared paper hash
  cannot be a CanvasKit shader. WGSL ports it exactly.
- CanvasKit WebGL drew the smear scene with 100% flat parity: it runs today's
  smear algorithm in the same engine. Our compute port is 98.4%, from float
  arithmetic where Skia rounds to 8 bits at every step.
- The WebGL drawing buffer is cleared after it is shown; a CanvasKit capture
  must draw and read in the same task.

## Answer for the backend choice

**WebGPU draws brushes better.** On character the two are equal: both pass
every brush measure, both are repeatable, both make the texture move with a
placed shape. WebGPU wins on cost, by the mechanism this probe was asked to
test. All marks of a frame go into one atlas pass and one composite pass, so
mark-level opacity costs a few passes, not one layer per mark. The paper hash
runs in the shader exactly. Smudge and wet run as one compute dispatch per
stroke. Stress frame, cached expansion: 13 to 14 ms against CanvasKit's 56 ms
and today's 82 to 94 ms. Sheet: 5 ms against 11 ms and 23 to 47 ms.

CanvasKit's strength is one engine for both runtimes: the same `ck-render.ts`
runs in Node and gives byte-identical output run to run, and the browser
output is within 0.2 levels on average of Node. Its costs for brushes: one
`saveLayer` per mark, one WebAssembly call per bristle run or path, a CPU
paper image, slower headless rendering than today, 2.6 MB of wasm, and one
WebGL context per canvas.

With caching of unchanged marks, WebGPU meets target 1 for brush drawing (60
fps on a walker-sheet-sized frame at ratio 2). Without caching, expansion
alone (23 ms) misses it; that needs work in the shared stage on either
backend.

## What would change in the brush model for the GPU

- Expand in the call's own coordinates, not device pixels (decision 7). Dab
  count then does not grow with ratio; at high ratio a small dab is drawn
  bigger, not denser.
- Keep the paper as a pure function of integer coordinates, so a shader can
  compute it. Place its origin at the picture, not the canvas.
- Keep marks unchanged between frames cacheable: expansion output keyed by
  the stroke's points, brush and gesture.
- Bristle runs as strips with mitred joins (no once-per-run stencil). The 5
  alpha levels and the average run width can stay.
- Hue and light jitter: a colour per dab or run vertex (the atlas holds
  colour, not only coverage). Not exercised by the presets; not tested here.
- Smudge and wet stay order-dependent and costly; bake them in a cached node.
- Colour parsing for jitter and wet paint must not need a canvas context
  (`colour.ts`); the probe parses hex and `rgba()` itself.

## Open problems

- WebGPU ink edges use 4× MSAA; switch to the geometry probe's exact-area
  coverage for Skia-like edges.
- Gradient paint on a brushed stroke, hue and light jitter, and erase were
  not drawn by either backend.
- WebGPU multiply blend assumes an opaque target; a transparent group layer
  needs the full formula (a backdrop copy, as in the compositing probe).
- The atlas is 2048 px: a mark larger than that throws. Ratio 2 needs four
  pages for the stress frame; a larger atlas or clearing only used rows would
  cut passes.
- Expansion cost (23 ms for 500 marks) needs caching or a faster shared
  stage before animated brushed scenes reach 60 fps.
- Today's browser renderer was timed over 30 frames on the stress frame (each
  page evaluation times out near 10 s); CanvasKit stress over 60.
- Canvas2D sheet timing is bimodal (12 ms and 60 ms frames); the cause was
  not found.
- A low-end GPU was not tried.
