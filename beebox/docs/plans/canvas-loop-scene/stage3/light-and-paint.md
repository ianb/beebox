# Stage 3 probe: light and paint

Part of `beebox/docs/implemented-plans/canvas-loop-scene.md`, Stage 3. Brief:
`canvas-loop-scene/stage3-brief.md`. Judged against
`canvas-loop-scene/parity-criteria.md`. Run 2026-11-15 on an Apple M2 Pro:
the repo's headless Chromium (WebGPU on Metal, WebGL2 on ANGLE Metal), Node
24 with the `webgpu` npm package 0.6.2 (Dawn on Metal), and CanvasKit 0.42.0
(browser WebGL, Node CPU raster). Code: `scratch/stage3/light-and-paint/`
(not tracked). Exhibit: "light and paint: lit room, wash and hatching on
WebGPU".

## Question

Do draft 2.2's lighting (`scene-api-draft.md` R8: material layer composited
by coverage, normals from `bevel` and `relief`, point, spot and directional
lights with `height`, ambient, 2D shadows from `castsShadow` with partial
blocking, emissive) and the painterly effects (`wash`, `hatching`, `paper`)
look good and run fast on WebGPU? Can headless rendering produce the same
result: the same WGSL under Dawn in Node, or CanvasKit SkSL runtime effects
in Node? Scope added after the reboot: the lighting and wash passes as SkSL in
CanvasKit, in the browser and in Node.

## What was built

**Fixture** (`scene.ts`, data). A side-view room, 1280 × 760: plaster wall,
panelled wainscot, plank floor, a sofa of six bevelled pieces with fabric
relief, a table with a monitor, a wall screen, a framed picture, a person
cut-out (seven parts, one object), a ceiling lamp. Four lights: a flickering
ceiling spot (height 90), a blue point light at the wall screen, a green
point light at the monitor, a faint cool directional light, plus ambient. For
timing, the lamp swings 300 px left and right, so shapes and light move every
frame.

**WebGPU** (`render.ts`, one module for the browser and Dawn). Per frame:
(1) one instanced draw of SDF quads writes three targets with premultiplied
blending: colour, material A (bevel width, relief height, shine, coverage),
material B (shadow amount, caster height, emissive, coverage). Coverage is
the alpha of each target, so materials composite by coverage as R8 says.
(2) A second draw writes an object id per pixel (draw order = id). (3) A
jump flood (compute) finds each pixel's distance to its own object's
outline. A seed is an outline pixel whose neighbour is behind it (lower id),
so an occluding shape in front does not make a false edge. The flood starts
at the widest bevel, not the canvas size: 7 passes at ratio 2. (4) Height =
round bevel profile of that distance + relief. (5) Lighting (compute): normal
from the height gradient; per light, diffuse, Blinn-Phong shine, windowed
falloff, spot cone; shadow by marching toward the light through a caster
texture (amount, top height, id). A sample blocks when its id is higher than
the receiver's (drawn later, so in front), it is not the object the light
sits in, and its top is above the ray. Blocking is multiplied by the caster
amount, so a half-covered caster blocks half. Samples are 3 logical px apart
(max 64), offset by a fixed per-pixel hash. Lighting is linear; the tone
curve is the identity below 0.8 and a soft shoulder above. (6) Wash: a
separable Gaussian blur, then one pass with bleed (read position displaced by
noise), abstraction (30% toward the blur), and Bousseau's density model
C' = C − (C − C²)(d − 1), where d adds blotch (low-frequency noise),
granulation (paper height) and edge darkening (|colour − blur|); then a
paper multiply. (7) Hatching: tone from a small cross of samples; four line
layers (two diagonals, near-horizontal, near-vertical) appear at tone 0.3,
0.2, 0.12 and 0.06, with wobble and gaps from noise, lines fixed in scene
coordinates; ink is the colour darkened, over a tint toward paper white. All
noise is a 32-bit integer hash (PCG) on integer coordinates.

**CanvasKit** (`ck-light.ts`, one module for the browser and Node). CanvasKit
has no compute and SkSL rejects `uint` and bitwise operators, so the
G-buffer is precomputed: the WebGPU renderer packs height (16 bits in two
channels), caster amount, caster top, id, shine, emissive and the wash noise
into RGBA8 images (`gbuffer()`; in Node, read from PNGs written by Dawn). Four
SkSL runtime effects port the WGSL passes: lighting (the same 64-step
march, `break` on a non-constant count), blur (25 constant taps, skipped
beyond the radius), wash, hatching. Hatching noise in SkSL uses a `sin`
hash, because the integer hash cannot be written in SkSL. Each pass draws a
paint with the shader into an offscreen surface; images are sampled nearest.

Today's references are the hand-built lit rooms, rendered with `cli run`:
`intra-atrium` (per-pixel CPU loop through `v.ctx`) and `intra-lounge` (ray
traced once, relit per frame).

## Results

### Repeatability (criteria section 1)

| Runtime | Check | Result |
|---|---|---|
| WebGPU, Chromium | flat, lit, wash, hatch, wash + hatch, ratio 1 and 2; second render on new textures | 10 of 10 identical |
| Dawn in Node | same 10 outputs, run twice | 10 of 10 identical |
| Dawn against Chromium WebGPU | same 10 outputs, SHA-256 | **10 of 10 byte-identical** |
| CanvasKit WebGL | lit, wash, hatch, both, ratio 1 and 2, twice | 8 of 8 identical |
| CanvasKit Node (CPU) | lit, wash, hatch, both, ratio 1, two runs with new surfaces | 4 of 4 byte-identical |

Dawn and Chromium both run Dawn on Metal on the same GPU here, so this proves
the same code path, not parity across GPUs. `requestAdapter({
forceFallbackAdapter: true })` returns no adapter on macOS: the package has no
CPU (SwiftShader) adapter here. A Linux host without a GPU was not tried.

### Appearance across renderers (criteria section 2)

Lighting criterion: mean per-channel difference under 3/255. Painterly
criterion: per 4× crop, mean luminance within 3% and contrast (standard
deviation) within 15%. Four crops: sofa arm and wall shadow, wall screen,
floor under the table, spot on the wall. CanvasKit reads the WebGPU
G-buffer, so these numbers compare the shading passes only.

| Pair, ratio 1 | Content | Mean diff / channel | Within 4/255 | Largest | Worst crop luminance / contrast | Result |
|---|---|---|---|---|---|---|
| CanvasKit WebGL vs WebGPU | lit | 0.017 | 100% | 21 | 0.1% / 0.1% | pass |
| CanvasKit WebGL vs WebGPU, ratio 2 | lit | 0.017 | 100% | 30 | — | pass |
| CanvasKit Node vs CanvasKit WebGL | lit | 0.008 | 100% | 6 | — | pass |
| CanvasKit WebGL vs WebGPU | wash | 0.085 | 99.86% | 72 | 0.0% / 0.1% | pass |
| CanvasKit Node vs CanvasKit WebGL | wash | 0.016 | 100% | 4 | — | pass |
| CanvasKit WebGL vs WebGPU | hatching | 1.68 | 91.9% | 121 | 1.4% / 2.2% | pass (by character) |
| CanvasKit Node vs CanvasKit WebGL | hatching | 1.36 | 92.8% | 119 | — | lines differ in place |
| CanvasKit WebGL vs WebGPU | wash + hatching | 2.33 | 90.0% | 119 | 1.3% / 1.3% | pass (by character) |

The lit result agrees to a fraction of a level when both read the same
G-buffer. Wash agrees closely; its largest differences are where the bleed
offset rounds to the other pixel. Hatching differs in where each line breaks,
because the SkSL noise is a `sin` hash and the WGSL noise is an integer hash;
the `sin` hash also differs between CanvasKit's CPU and GPU (1.36 mean). The
tone, weight and density of the hatching are the same (crops within 1.4%).

No Skia reference exists for lighting (it is new), so criterion 2 against
today's renderer does not apply. By eye against today's hand-built rooms
(exhibit): see "Does the look generalise" below.

### Stability over time (criteria section 3)

Not measured as numbers. By construction: with lights still, repeated frames
are identical (above). Hatching lines are in scene coordinates, so a moving
light fades layers in and out without moving lines. The shadow sample offset
is a fixed per-pixel hash, so a still shadow does not boil; a moving shadow
edge passes across a fixed fine grain.

## Timing

Mean / 95th percentile, ms, 120 frames after 30 warm-up frames (CanvasKit
20), waiting for the GPU (`onSubmittedWorkDone`; for WebGL a 1-pixel
`readPixels`). The lamp swings every frame, so lighting is recomputed every
frame. "Full" redraws the shapes, the id buffer, the jump flood and the height
too; "light only" reuses them (a static room with moving lights, as draft
section 6 allows).

| Path | Ratio 1 | Ratio 2 |
|---|---|---|
| WebGPU, Chromium: full, lit | 4.4 / 4.7 | 17.5 / 18.2 |
| WebGPU, Chromium: light only | 2.8 / 3.0 | 10.6 / 11.0 |
| WebGPU, Chromium: light only + wash | 4.0 / 4.2 | 16.2 / 16.5 |
| WebGPU, Chromium: light only + hatching | 3.2 / 3.4 | 11.9 / 12.3 |
| WebGPU, Chromium: full + wash + hatching | 5.9 / 6.3 | 24.2 / 25.0 |
| Dawn in Node: full, lit | 4.4 / 4.7 | 17.6 / 18.1 |
| Dawn in Node: light only | 2.9 / 2.9 | 10.7 / 10.9 |
| Dawn in Node: full + wash + hatching | 6.0 / 6.6 | 24.4 / 25.3 |
| CanvasKit WebGL: light only (G-buffer given) | 3.7 / 4.3 | 12.3 / 12.9 |
| CanvasKit WebGL: + wash | 4.6 / 5.2 | 15.9 / 16.5 |
| CanvasKit WebGL: + hatching | 3.9 / 4.2 | 13.2 / 13.8 |
| CanvasKit WebGL: + wash + hatching | 4.8 / 5.5 | 16.6 / 17.3 |
| CanvasKit Node CPU: light | 107 000 (one frame) | not run (about 4× more) |
| CanvasKit Node CPU: wash / hatching after light | 25 800 / 8 600 | not run |

Where the time goes, WebGPU at ratio 2: shapes, ids, jump flood and height
6.8 ms; lighting with shadows 10.6 ms; wash 5.5 ms; hatching 1.2 ms. Time
scales with pixels (ratio 2 costs 4× ratio 1). Dawn's single slowest frames
reached 15 to 39 ms (cause not found); the browser's
stayed under 27 ms. CanvasKit has no equivalent of the G-buffer stage: it
needs the distance field from somewhere else.

CanvasKit in Node runs SkSL on the CPU through Skia's raster pipeline. The
lighting shader (four lights, up to 64 shadow samples each, four child image
reads per sample) takes 107 s for one 1280 × 760 frame.

## What surprised me

- Dawn in Node segfaults on the first completed GPU command unless the
  object `create()` returns is kept referenced: the instance is garbage
  collected while it still processes events. With a reference, it is
  byte-identical to Chromium. The default limit of 4 storage textures per
  stage also applies (one pass had to split).
- The first version composited material by the wrong alpha (the emissive
  channel), so materials summed through each other and the sofa looked
  transparent. Coverage must be the alpha of every material target.
- CanvasKit's WebGL shading is as fast as WebGPU compute for the same
  passes (12.3 against 10.6 ms at ratio 2), and its blur is faster.
- CanvasKit's CPU raster is not usable for lit frames: 107 s for one frame.
- A dark scene hatches everywhere. The first thresholds (0.62 to 0.13)
  cross-hatched the whole room; tone thresholds need to follow the scene's
  range.

## Does the look generalise

Partly. Bevel-from-outline gives every object the same rounded, pillowed
edge. On cushions, a frame, a screen bezel or a table top it reads well. On
the person it reads as a padded cut-out, and a scene where every shape has a
bevel looks like a clay or plastic diorama. The profile is all the form there
is: a face, folds, a cylinder seen from the side, or a recessed panel cannot
come from the outline. Relief patterns (plaster, fabric, planks) carry most
of the surface interest, and in this probe they are shader patterns that the
API has no way to name. Shadows read as plausible 2.5D shadows, but their
length comes from a caster height that the draft does not have. The spot
draws a beam on the wall (the wall is lit along the plane), which reads as
haze more than a pool of light.

Against today's hand-built rooms: the atrium looks more crafted, from a
designed palette, a single warm key, and shadows placed by geometry. The
lounge has real 3D (ray traced boxes). This probe reaches "a decently lit
2.5D room with no lighting code in the sketch", not the atrium's look; the
difference is in palette, tone curve and composition more than in the
lighting mechanism.

## What the API might need

- **Caster height.** `castsShadow` needs a height (or `material.depth`), not
  only an amount. The probe used one per shape (10 to 70 px).
- **Who shadows whom.** The probe uses draw order: only shapes drawn later
  shadow earlier ones, and a shape never shadows itself. State this in R8.
- **Object identity.** Parts of one cut-out must share a bevel outline and
  not shadow each other. A lit group or picture could be one object.
- **Bevel profile and height** apart from width: round, chamfer, pillow.
- **A height or normal map input:** `material.height` from a picture or a
  pixel field, for forms the outline cannot give (faces, folds), and named
  relief patterns (plaster, fabric, wood, panels) with a scale.
- **Tone curve.** Draft R8's sum clips. The probe used identity below 0.8
  and a shoulder above; light energy units and exposure need stating.
- **Spot direction out of the plane.** The cone is an in-plane angle only.
- **Hatching levels** relative to the scene's tone range, plus angle,
  spacing and ink colour.
- **Noise as integer hash or image.** For one look in two engines, noise must
  be an integer hash (WGSL) or come from an image; SkSL `sin` hashes differ
  between CPU and GPU.

## Answer for the backend choice

**WebGPU serves lighting and painterly effects better.** It does the whole
chain on the GPU, including the parts CanvasKit cannot express: the object
id buffer, the jump-flood distance field and the caster texture are compute
work. Full lighting of a changing room takes 4.4 ms at ratio 1 and 17.5 ms at
ratio 2; with the room cached and only lights moving, 2.8 and 10.6 ms. Wash
and hatching add 1.2 to 5.5 ms. Headless can share the browser's code: the
same TypeScript and WGSL under Dawn in Node gave byte-identical output to
Chromium for all ten outputs, at the same speed. The risk is the host: Dawn
needs a GPU adapter (no CPU fallback on macOS).

CanvasKit can express the shading passes as SkSL: lighting, blur, wash and
hatching all compiled, with three limits (no `uint` or bitwise operators,
constant loop bounds, noise from images). In the browser it is as fast as
WebGPU for those passes and matches WebGPU's lit result to 0.017 levels.
But it has no compute for the distance field, so the G-buffer must come from
elsewhere (CPU distance transform, or a multi-pass SkSL jump flood, not
tried). Headless CanvasKit is byte-identical run to run but takes 107 s per
lit frame. "CanvasKit everywhere" therefore fails for lit scenes headless.
For lighting, the headless counterpart that shares code is Dawn, not
CanvasKit.

## Open problems

- Shadow edges show pixel steps at 4× (nearest caster samples). Bilinear
  caster samples or a softer penumbra would hide them.
- Wash bleed reads whole pixels, so edges wobble in steps. Use filtered reads.
- Ratio 2 full lighting (17.5 ms) misses a 16.7 ms frame. Levers not tried:
  shadows at half resolution, fewer samples for distant lights, wash blur at
  half resolution, light culling by tile.
- Dawn on a Linux host without a GPU (SwiftShader or lavapipe) was not tried.
- A CPU or SkSL jump flood for a CanvasKit G-buffer was not tried.
- Paper (`effects.paper`) is only the wash's paper multiply; brush grain
  under lighting was not combined.
- Lit nested groups, `place(..., { material })`, erase and masks on the
  material layer were not exercised.
- Light count is fixed at 8 in a uniform; more lights need a buffer and
  culling.
