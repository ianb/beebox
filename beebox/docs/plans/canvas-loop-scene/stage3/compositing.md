# Stage 3 probe: compositing

Part of `beebox/docs/implemented-plans/canvas-loop-scene.md`, Stage 3. Brief:
`canvas-loop-scene/stage3-brief.md`. Judged against
`canvas-loop-scene/parity-criteria.md`. Run 2026-11-15 in the repo's headless
Chromium (Apple M2 Pro, WebGPU on Metal). Code: `scratch/stage3/compositing/`
(not tracked). Exhibit: "compositing: groups, clips, masks, blends and
effects, Skia vs WebGPU".

## Question

Can a WebGPU renderer do draft 2.2's lowering contract
(`scene-api-draft.md` section 3, rules R1 to R7) correctly and cheaply? How
should it allocate intermediate textures, how does it do blends that read the
backdrop, and how many passes and copies does a frame need?

## What was built

`fixtures.ts` describes 36 small drawings as data, on a 1200 × 960 sheet:
group opacity with overlapping children; erase at shape level, inside a group,
with a blur (a soft hole, R2) and inside a star clip (R4); a single star clip
and a union of a circle and a tilted bar, each with an erase and a multiply
inside; a gradient mask and a mask made from a blurred group (R6); group blur,
glow, drop shadow, all seven colour adjustments, and all of them on one group
(R5 order); a multiplied shape with a glow (R2); a group's clip option against
a clip call inside its body; all 17 blend modes, each at shape level and at
group level, over coloured bars, a see-through gradient bar and a transparent
strip; a group with screen blend, opacity, blur and a clip option; a bar and a
lamp just above the canvas edge that cast a shadow and a glow onto it. A
second scene has 200 groups, each with opacity 0.7 and a blur of 2, over a
backdrop (800 × 600). Fills are flat colours and linear gradients.

The reference is today's renderer. `skia-lower.ts` writes each fixture with
today's calls (`group`, `clip`, `mask`; a shape's effects as a group around
it; an erase with effects as a `cache` pasted with `erase`; a group's clip
option as a `clip` around the group). `sheet-tea.ts` renders it with
`cli run`; `skia.ts` drives the same Painter directly, because the CLI has no
pixel-ratio flag. At ratio 1 the two gave byte-identical PNGs. For draft
semantics, `skia.ts` can also draw on a canvas grown by 100 px on every side
and crop it: this moves today's canvas-edge cut out of reach, which is the
draft's bounds rule.

`gpu.ts` is the WebGPU renderer. Every isolating node (group, mask body, mask
artwork, shape with effects) becomes a **job**: a layer sized to its content's
bounds grown by its effects' reach (three blur radii, glow, shadow offset plus
blur), cut only at the canvas grown by that reach. Coverage is the exact area
of each polygon in each pixel (closed-form signed area per edge, looped per
pixel; circles flattened to 0.02 device px). Layers are premultiplied
`rgba8unorm`, so each step rounds to 8 bits as Skia's raster backend does.
A clip is an `r8unorm` coverage mask in the target's space: union by
a + b − ab, nesting by multiplication; every draw multiplies its coverage by
it. Normal, add, screen and erase are fixed-function blends. The other 13
modes copy the backdrop region to a texture and blend in the shader (W3C
formulas on unpremultiplied colour), then lerp by coverage. Effects run as
passes over the layer: colour matrix (CSS definitions, clamped after each),
blur, glow, shadow, then one pass that puts the result over the shadow over
the glow. Three schedulers were measured; all give byte-identical pixels:

- **One texture per job**: children drawn before the parent's pass, each in
  its own pooled texture.
- **Interleaved** (first version only): each child drawn just before it
  composites; the parent's pass ends and reopens around it.
- **Shared pages** (the recommended one): a job's level is its height above
  the leaves; jobs of one level never depend on each other, so they are
  shelf-packed into shared pages (at least 2048 px wide). One pass draws every
  job of a page, each in its own viewport. Each effect stage is one pass per
  page with one quad per job; a job without that effect passes through (an
  identity matrix, a one-tap blur), so a stage has one input texture. Reads in
  effect passes are bounded by the job's slot. Blended draws share a backdrop
  copy while their boxes miss everything drawn since the copy.

All textures come from a pool keyed by format and size rounded up to 64 px.
After the first frame no texture is created in any mode.

## Results

### Repeatability (criteria section 1)

| Runtime | Check | Result |
|---|---|---|
| Headless Skia | `cli run` and the direct driver, same scene | byte-identical |
| WebGPU, sheet and stress, ratio 1 and 2 | same frame twice | 0 bytes differ |
| | after destroying every pooled texture (nothing reused) | 0 bytes differ |
| | on a new adapter and device (as after waking) | 0 bytes differ |
| | shared pages against one texture per job, with and without shared backdrop copies | byte-identical |

### Appearance against Skia (criteria section 2)

Compared in premultiplied values. "Flat" is the share of non-edge pixels with
every channel within 4/255 (pass: 99%). "Edge mean" is the mean coverage
difference over edge pixels (pass: under 0.15), measured as in the geometry
probe: pixels whose 3 × 3 neighbourhood in the reference spans more than 24
luminance levels, luminance difference divided by that span. Reference: Skia
on the grown canvas (draft bounds); WebGPU with draft semantics.

| Fixture | Ratio 1: flat, edge mean | Ratio 2: flat, edge mean | Largest flat difference (r1 / r2) | Result |
|---|---|---|---|---|
| opacity | 99.79%, 0.016 | 99.93%, 0.010 | 24 / 19 | pass |
| erase-shape | 99.68%, 0.008 | 99.85%, 0.005 | 61 / 58 | pass |
| erase-group | 100%, 0.006 | 100%, 0.003 | 1 / 1 | pass |
| erase-soft (R2) | 100%, 0.002 | 100%, 0.001 | 4 / 2 | pass |
| erase-clip (R4) | 99.52%, 0.005 | 99.82%, 0.005 | 33 / 31 | pass |
| offcanvas (R5 bounds) | 100%, 0.000 | 100%, 0.000 | 3 / 3 | pass |
| clip-single | 99.86%, 0.010 | 99.97%, 0.007 | 22 / 14 | pass |
| clip-union | 99.73%, 0.013 | 99.88%, 0.009 | 43 / 52 | pass |
| mask-gradient | 99.89%, 0.007 | 99.94%, 0.007 | 16 / 11 | pass |
| mask-blur (R6) | 100%, 0.003 | 100%, 0.002 | 2 / 2 | pass |
| group-clip-opt (R5) | 99.81%, 0.008 | 100%, 0.003 | 15 / 5 | pass |
| clip-in-body (R5) | 100%, 0.003 | 100%, 0.001 | 3 / 2 | pass |
| blur | 100%, 0.013 | 100%, 0.001 | 3 / 2 | pass |
| glow | 99.9%, 0.012 | 99.98%, 0.006 | 25 / 16 | pass |
| shadow | 100%, 0.006 | 100%, 0.003 | 1 / 1 | pass |
| adjust | 100%, 0.022 | 100%, 0.018 | 2 / 2 | pass |
| all-effects | 97.82%, 0.014 | 98.2%, 0.006 | 10 / 10 | differs by design; with today's order 100% / 100%, pass |
| shape-fx-multiply (R2) | 100%, 0.002 | 100%, 0.001 | 2 / 2 | pass |
| blend-normal | 99.98%, 0.021 | 99.99%, 0.009 | 6 / 10 | pass |
| blend-multiply | 99.69%, 0.015 | 99.98%, 0.007 | 21 / 9 | pass |
| blend-screen | 99.74%, 0.016 | 99.95%, 0.007 | 29 / 15 | pass |
| blend-overlay | 99.71%, 0.015 | 99.98%, 0.007 | 21 / 8 | pass |
| blend-darken | 99.31%, 0.007 | 99.87%, 0.005 | 43 / 19 | pass |
| blend-lighten | 99.86%, 0.018 | 99.96%, 0.007 | 29 / 13 | pass |
| blend-soft-light | 99.44%, 0.007 | 99.95%, 0.004 | 19 / 9 | pass |
| blend-hard-light | 99.97%, 0.020 | 99.99%, 0.008 | 9 / 13 | pass |
| blend-color-dodge | 99.71%, 0.015 | 99.94%, 0.006 | 29 / 15 | pass |
| blend-color-burn | 100%, 0.019 | 100%, 0.009 | 2 / 3 | pass |
| blend-add | 99.67%, 0.015 | 99.93%, 0.006 | 42 / 20 | pass |
| blend-difference | 99.55%, 0.014 | 99.88%, 0.007 | 66 / 28 | pass |
| blend-exclusion | 99.48%, 0.016 | 99.85%, 0.008 | 55 / 24 | pass |
| blend-hue | 99.13%, 0.005 | 99.83%, 0.003 | 36 / 16 | pass |
| blend-saturation | 99.13%, 0.004 | 99.74%, 0.003 | 16 / 8 | pass |
| blend-color | 99.09%, 0.005 | 99.81%, 0.004 | 46 / 21 | pass |
| blend-luminosity | 100%, 0.021 | 100%, 0.009 | 3 / 3 | pass |
| combo (screen, opacity, blur, clip option) | 99.99%, 0.006 | 99.99%, 0.005 | 7 / 8 | pass |
| stress, 200 blurred groups | 99.98%, 0.024 | 100%, 0.027 | 8 / 5 | pass |

With today's semantics (WebGPU without the draft bounds and order, against
the `cli run` output) every fixture passes, including all-effects (100% flat
at both ratios) and offcanvas (no difference: nothing reaches the canvas).

The large single differences (up to 66) are antialiased pixels along circle
and star edges that the edge detector does not catch, because the colours on
the two sides have similar luminance (for example a partly erased edge).
Their coverage differs by up to about 0.1, as in the geometry probe.

**Where draft 2.2 intends a different result than today:**

- **offcanvas.** Today a layer is the canvas, so a shape above the top edge
  casts nothing onto it. Under the draft's bounds rule the shadow and glow
  reach in. The WebGPU draft result matches Skia drawn on the grown canvas.
- **all-effects.** Today the shadow comes from the CSS filter chain, after the
  blur, so a blurred group's shadow is blurred twice. The draft makes glow and
  shadow from the layer before effects, so the shadow is sharper. WebGPU with
  today's order matches Skia exactly; with the draft order the shadow edge is
  visibly sharper (exhibit). This could not be expressed with today's calls,
  so it is judged by eye and by the matching today-order result.

### Stability over time

Not measured: still frames. Every frame is rebuilt from the scene data, and
repeated frames are byte-identical.

## Timing

Mean and 95th percentile over 200 frames after 20 warm-up frames, waiting on
`onSubmittedWorkDone`. Each frame lowers the scene, uploads buffers, encodes,
renders and copies the result to the canvas. "CPU" is the lowering and
encoding time inside that.

| Scene, ratio | Scheduler | Mean / p95 (ms) | CPU (ms) | Passes | Copies | Effect passes | Pool after warm-up |
|---|---|---|---|---|---|---|---|
| Sheet, 1 | one texture per job | 11.3 / 12.9 | 2.0 | 124 | 46 | 36 | 95 textures, 16 MB |
| Sheet, 1 | shared pages | 7.5 / 9.6 | 1.8 | 34 | 18 | 8 | 31 textures, 27 MB |
| Sheet, 2 | one texture per job | 12.3 / 12.9 | 2.5 | 124 | 46 | 36 | 101 textures, 60 MB |
| Sheet, 2 | shared pages | 10.6 / 11.4 | 2.5 | 34 | 18 | 8 | 31 textures, 94 MB |
| Stress, 1 | one texture per job | 34.9 / 37.6 | 6.5 | 601 | 1 | 400 | 205 textures, 6 MB |
| Stress, 1 | interleaved (first version) | 52.3 / 56.6 | 8.2 | 801 | 1 | 400 | 7 textures, 2 MB |
| Stress, 1 | shared pages | 6.4 / 7.6 | 4.0 | 4 | 1 | 2 | 4 textures, 10 MB |
| Stress, 2 | one texture per job | 36.0 / 38.5 | 7.1 | 601 | 1 | 400 | 205 textures, 22 MB |
| Stress, 2 | interleaved (first version) | 51.1 / 53.8 | 9.6 | 801 | 1 | 400 | 7 textures, 8 MB |
| Stress, 2 | shared pages | 10.5 / 12.1 | 5.0 | 4 | 1 | 2 | 4 textures, 36 MB |

The interleaved rows come from the first version of the renderer, before the
clip fix below; their sheet times are not comparable and are left out.

Single slow frames reached 17 ms (stress, ratio 2, shared pages). Nothing else
stalled.

**Where the time goes.** A micro-benchmark in the same page:

| Work | Cost |
|---|---|
| a render pass with one small draw (64 × 64 or 2560 × 2560 target, clear or load) | 50 to 80 µs each |
| the same plus a 100 × 100 copy | about 110 µs each |

So in this browser a pass costs about 60 µs whatever its size, and a frame
with 600 passes cannot be fast. The rest is pixel work:

- **Clip masks.** The first version computed each clip's coverage over the
  whole target. Limiting it to the clip's box cut the five clip fixtures at
  ratio 2 from 13.2 ms to 3.7 ms.
- **Coverage loop.** Each pixel loops over every edge of its shape. The 17
  blend cells at ratio 2 took 7.8 ms with circles of 137 edges and 4.1 ms
  with 28 edges, at the same pass and copy counts.
- **Blur.** Skia's blur kernel is wide (blur 10 at ratio 2 is 113 taps per
  pass). The effect fixtures cost 6.8 ms at ratio 2 in 11 passes.

**Today's headless renderer, for scale:** the sheet takes 526 ms per frame at
ratio 1 and 2.2 s at ratio 2; the stress frame takes 1.9 s at ratio 1 and
7.8 s at ratio 2. Every group, clip and mask is a canvas-sized layer, and each
blur filters the whole canvas.

## What surprised me

- **Skia's blur is not a Gaussian.** `@napi-rs/canvas` blurs with the SVG
  three-box approximation (box width ⌊σ·3·√(2π)/4 + 0.5⌋, two offset boxes
  and one centred box when the width is even). A true Gaussian failed the
  shadow fixture (92% flat). The three-box kernel matches Skia's profile
  within 0.5 levels at σ 2.5 to 10, and every effect fixture then passed.
- **Drop-shadow blur is σ = blur, not blur / 2.** `coverage-matrix.md`
  (shadow row) says CSS `drop-shadow` uses σ = blur / 2. Measured: both
  `@napi-rs/canvas` and Chromium's Canvas2D `filter` give the same profile for
  `drop-shadow(0 0 6px)` as for `blur(6px)`. Today's two runtimes agree with
  each other; the matrix is wrong. The probe uses σ = blur.
- **Pass count, not texture size, sets the cost.** A pass costs about 60 µs
  whether it covers 64 × 64 pixels or 2560 × 2560. Sharing pages cut the
  stress frame from 601 passes to 4 and from 35 ms to 6 ms.
- **Backdrop copies were cheap here.** Sharing copies cut them from 46 to 18
  but saved little time; the blend cells cost the same with 43 copies or 15.
- Timestamp queries are available but their pass intervals overlap on this
  machine, so per-pass GPU times were not usable. Costs above come from
  removing work and timing the frame.

## The answer for the backend choice

Yes. A WebGPU renderer met every compositing rule in the draft that the
fixtures exercise, at both ratios, with byte-identical repeats, and it is
cheap once passes are batched. Combined with the geometry probe (own WebGPU
with exact-area coverage passed and led), this supports the own-WebGPU
backend. The cost model to build on:

1. **Isolating nodes render to texture, batched by level.** A node's level is
   its height above the leaves. All nodes of one level go into shared pages
   (shelf-packed, each in its own viewport). Passes per level = pages ×
   (1 + effect stages used on that page); effect stages are at most matrix,
   blur (2), glow (2), shadow (2), combine. A typical frame has one or two
   levels, so 5 to 30 passes, independent of the number of groups.
2. **Layers are sized to content plus effect reach, cut at the canvas plus
   reach.** This is the draft's bounds rule and costs nothing extra.
3. **Pool by size class; never create textures in steady state.** Release a
   page when every job on it has been composited. Limit memory with the page
   size and by recycling pages between levels.
4. **Blends that read the backdrop: copy, then blend in the shader.** Normal,
   add, screen and erase are fixed-function. The other 13 modes copy the
   draw's box (a pass break plus a copy, about 110 µs) and blend with the W3C
   formulas. Draws whose boxes miss everything drawn since the last copy share
   it. Reordering draws whose boxes do not overlap would bring copies down to
   the deepest stack of blends at any pixel; not built.
5. **Clips are coverage masks**, computed only inside the clip's box, and
   multiplied into every draw's coverage. Union and nesting are exact.
6. **Match Skia's effects by construction:** the three-box blur kernel,
   σ = blur for shadows, colour adjustments applied one by one with a clamp,
   8-bit storage between stages.
7. **Pixel work:** use the geometry probe's edge-accumulation coverage atlas
   rather than a per-pixel edge loop, and do large blurs as box passes or at
   reduced resolution (as Skia's GPU backend does), so blur cost does not
   grow with the radius.

## Open problems

- **Two draft decisions need confirming:** the all-effects result (shadow from
  the layer before blur, visibly sharper than today) and the shadow blur
  convention (σ = blur, as both runtimes do today; the coverage matrix says
  blur / 2).
- Clip masks are still one texture and one pass each (6 in the sheet). They
  could share an `r8` page per level.
- Effects under a transform (decision 1: effects scale and rotate with their
  group) and fractional shadow offsets were not tested; offsets here are whole
  device pixels.
- Shared pages use more memory than one texture per job at ratio 2 (94 MB
  against 60 MB for the sheet), because pages are at least 2048 px wide and
  each effect stage needs a page. Page sizing and stage reuse need work.
- A layer taller than 8192 px, or a group larger than the page, needs tiling.
- Not covered here: brushes inside groups, `smudge` and `wet` (they read the
  target), lit groups (R8), pictures and placement (R7), and text.
