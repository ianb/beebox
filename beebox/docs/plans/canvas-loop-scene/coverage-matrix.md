# canvas-loop coverage matrix (Stage 0, first draft)

Part of [canvas-loop-scene](../canvas-loop-scene.md), Stage 0. One row per
feature. Each row says how the feature works today, whether it reads what is
already drawn, how a scene could describe it, and how each renderer could
draw it. Counts of real use are in [api-inventory.md](api-inventory.md).

All "today" paths are under `canvas-loop/src/core/`. Sketches of scene data
are drafts for Stage 1, not a settled syntax.

## Columns

- **Backdrop?** yes when the feature reads or depends on pixels drawn earlier
  in the same layer. Such features force the renderer to finish earlier
  siblings first. In a GPU renderer they usually mean a copy of the target
  texture (WebGL2 and WebGPU have no portable read of the target while drawing).
- **Skia** is the headless reference renderer. "Same code" means the shared
  CPU stage that turns brush data into geometry (see Design ideas).
- **GPU** is WebGL2 or WebGPU. **PROBE** marks a genuinely uncertain strategy.
  Each PROBE row becomes a Stage 3 probe.
- **Difficulty** is low, medium or high, with the reason.

## Design ideas the rows share

1. **Shared expansion stage.** Today one JS function turns a brushed stroke
   into dabs, polylines or an outline (`brush/render/kinds.ts`, `mark.ts`).
   Keep it as pure CPU code that outputs primitives (outline polygons, dab
   instances, polylines). Skia and the GPU renderer both draw those primitives,
   so the random character of a mark is identical in both.
2. **Seed in scene space.** `markSeed` hashes the mark's device-pixel points
   (`brush/render/mark.ts:100`). The same sketch then gets different jitter at
   pixel ratio 1 and 2. The scene should hash scene-space points. This changes
   today's baselines once; see open questions on the brush rows.
3. **Backdrop reads are explicit.** Features marked "Backdrop? yes" can be
   found by scanning the scene. The renderer can flatten only what they need.

## Shapes and plain paint

| Feature | Today | Backdrop? | Scene sketch | Skia | GPU | Difficulty | Open questions |
|---|---|---|---|---|---|---|---|
| Fill of rect, round rect, circle, ellipse, arc, triangle, polygon, path, curve | `painter/engine.ts:65-131`, `painter/core.ts:383` | no | `{ kind: "path", d, fill }`; primitives are sugar that become path or shape nodes | `SkPath` fill, AA | Circles and rects: one instanced quad with an analytic edge (SDF) gives exact AA. General paths: triangulate on CPU (earcut) or stencil-and-cover. | medium: general path fill needs AA parity | MSAA or analytic edges? Fill rule for self-crossing paths (today nonzero). |
| Plain stroke (weight, dash) | `painter/core.ts:393-407`; dash at `core.ts:401` | no | `{ stroke, weight, dash, cap, join }` | `SkPaint` stroke with Skia caps, joins, miter | Expand to triangles on CPU: joins, caps, miter limit, dashes | medium: join and cap parity with Skia | Miter limit and cap default (today butt, miter 10, from Canvas2D). Sketches ask for `lineCap: "round"` (`pelican-bicycle`). |
| Curve and path flattening | `contours.ts:25` (`curveCommands`), `contours.ts:88` (`pathContours`, step half a device pixel) | no | path data keeps curves; renderer flattens | Skia curves natively | CPU flatten with step from the transform (`painter/core.ts:314`) | low: pure code exists | Flatten tolerance must be shared, or edges differ by sub-pixel amounts. |
| Background | `painter/engine.ts:52` | no | scene `background` prop, or a root rect | `drawPaint` | clear colour, or a full-screen quad for gradients | low: one quad | Ignores transforms today; keep. |
| Linear gradient | `paint.ts:400` (`resolveGradient`) | no | `{ kind: "linear", x1, y1, x2, y2, stops }` as `fill` or `stroke` value | `SkShader` | fragment shader math, stops in a 1D texture or uniform array | low | Stop interpolation: premultiplied or not? Browsers and Skia can differ for fades to transparent. Pick one and test. |
| Radial and ellipse gradient | `paint.ts:384` (`inPaintSpace`, `scaleY`), `paint.ts:271` | no | `{ kind: "radial", cx, cy, r, scaleY?, stops }` | shader with local matrix | fragment shader; `scaleY` as a matrix | low | Today only fills squash the ellipse; strokes do not (`paint.ts:380`). Keep that rule or drop it. |
| Gradient as brush paint | `brush/render/mark.ts:208-256` (`colorize`) | no | same paint value on a brushed stroke | same code path as fills after expansion | mark coverage times gradient evaluated at user position in the composite shader | medium: user-space gradient with a device-space mark | The napi workaround at `mark.ts:222` goes away; check the result is identical. |

## Brush kinds

| Feature | Today | Backdrop? | Scene sketch | Skia | GPU | Difficulty | Open questions |
|---|---|---|---|---|---|---|---|
| `ink` (perfect-freehand outline) | `brush/render/kinds.ts:26`, preset `brush/presets.ts:6` | no | stroke with `brush: "ink"` and `gesture`; renderer expands | Same code, fill outline polygon | Same code on CPU, triangulate outline, draw into a coverage texture, composite once | low-medium: needs the coverage pass for opacity | Overlaps inside one mark must not darken (`brush/types.ts` `BrushCommon.opacity`): one coverage pass per mark, not per primitive. |
| `marker` (ink, multiply) | `brush/presets.ts:32` | yes: multiply blend with backdrop | ink brush with `blend: "multiply"` | same | blend pass: see multiply row | low once blends work | none |
| `pencil`, `chalk` (hard stamp) | `brush/render/kinds.ts:53`, `presets.ts:8`, `presets.ts:34` | no | `brush: "pencil"` | Same code, dabs as circles | One instanced draw: a quad per dab, circle by SDF, per-dab alpha, into coverage texture with premultiplied source-over | low-medium: dab count in the hundreds per mark | Canvas2D accumulates 8-bit alpha per dab; float accumulation differs a little. Tolerance in baselines? |
| `airbrush`, `wash` (soft stamp) | `brush/render/kinds.ts:64-75`, `brush/render/dab.ts:33` (64 px soft dab), `presets.ts:48`, `presets.ts:62` | no | `brush: "airbrush"` | Same code, radial-gradient dab | Instanced quads, soft falloff in the fragment shader (same ramp as `dab.ts:18`) | low | Ramp is linear black to clear in sRGB 8-bit; match the shape, not the bits. Note `wash` the brush is not the wash effect. |
| `bristle` | `brush/render/kinds.ts:97-203`, `presets.ts:21` | no | `brush: "bristle"` | Same code, polyline runs | Same expansion; one triangle strip per run with round joins; alpha level per run | medium: runs use one average width (`kinds.ts:153`) | Keep the 5 alpha levels and average widths, or smooth them? Smoothing changes baselines. |
| `smudge` | `brush/render/smear.ts:114-157`, `presets.ts:76` | **yes**: picks up the live drawing and keeps dragging it | brush `smudge`; the renderer must have all earlier siblings drawn | Run today's loop on a CPU surface (`drawImage` between layers) | **PROBE**. Each dab reads a patch of the target, mixes with a load texture, writes back. Options: (a) copy the patch from the target per dab and draw a small quad (hundreds of tiny passes per stroke); (b) read the target back once and run the loop on CPU; (c) approximate with a compute or iterated shader. | high: sequential, order-dependent, reads the target | Baked once into a texture (cached keyed node) or live each frame? A smudge in an animation is expensive in every option. Which result is the reference: today's? |
| `wet` | `brush/render/smear.ts:160-191` (`copyBefore`), `presets.ts:90` | **yes**: reads a copy taken before the stroke | brush `wet` | same as `smudge` | **PROBE**, as `smudge`, but the pickup source is one fixed copy, so the dab loop has no feedback into it | high: copy of the backdrop plus load mixing | `wet` needs a solid stroke colour (`smear.ts:59`); keep as a validation. |
| Mark composite (opacity, blend, erase) | `brush/render/mark.ts:336-342` | per blend mode | stroke style `blend`, `erase`, brush `opacity` | `drawImage` with mode | composite coverage times colour times opacity with the chosen blend | low: part of every mark | Smear brushes cannot blend or erase (`smear.ts:56`). |

## Brush fields that change the drawing mechanism

| Feature | Today | Backdrop? | Scene sketch | Skia | GPU | Difficulty | Open questions |
|---|---|---|---|---|---|---|---|
| `grain` with paper | `brush/render/mark.ts:318-333`; paper at `brush/paper.ts:29` | no | brush `grain`; scene `paper: { scale, contrast, seed }` | Same code: paper alpha cut from coverage with `destination-out` | Paper as an R8 texture (built once on CPU, or hash noise in the shader); coverage times (1 minus grain times paper) in screen space | low-medium: paper is fixed to the canvas, not to the mark | Paper is canvas-sized and device-pixel. Tile it? Zoom in a browser figure scales the tooth today (`paper.ts:93`, by pixel ratio). |
| `hueJitter`, `lightJitter` | `brush/render/ink.ts:14-35`, `colour.ts:79` | no | brush fields | Same code, colour per dab or bristle | Colour is a per-instance attribute | low | `parseColour` needs a canvas context (`colour.ts:27`); make colour parsing pure so the shared stage can run anywhere. |
| Pressure envelope | `brush/envelope.ts:64` | no | `gesture.pressure` | Same code | CPU only; output goes to instances | low | none |
| Wobble and seed | `brush/render/mark.ts:100-137`, `brush/random.ts:18` | no | `gesture.wobble`, `gesture.seed` | Same code | CPU only | low | Seed from device points (design idea 2). |
| `faint` mark warning | `painter/faint.ts:9`, `brush/render/mark.ts:343`, `brush/render/peak.ts:8` | reads own mark pixels | testing mode flag | Read back the mark's strongest pixel, as now | Not needed in the browser (warnings are headless, `painter/core.ts:61`) | low | Could compute from brush data without a read-back; not needed. |
| Brush width under a transform | `brush/render/mark.ts:269-271` | no | node transform | width times square root of the transform determinant | same value in the expander | low | A skew matrix gives a round brush, as today. Confirm that is wanted. |

## Effects (on a group)

| Feature | Today | Backdrop? | Scene sketch | Skia | GPU | Difficulty | Open questions |
|---|---|---|---|---|---|---|---|
| `blur` | `painter/effects.ts:116`, `effects.ts:128` | no (the group only) | group `effects: { blur: 3 }` | Skia image filter blur | Group to texture, two-pass Gaussian, ping-pong | low-medium: padding for the blur edge | Layer is cut at the canvas or sprite edge today (BRUSHES.md Effects). Pad by 3 sigma, or keep the cut for parity? |
| `glow` | `painter/effects.ts:81-93` | no | `effects: { glow: { blur, color, strength } }` | blur, tint, repeat `strength` times | One blur pass, tint, then alpha from `1 - (1 - a)^strength` (equal to repeated source-over of the same image) | low once blur exists | Halo is drawn under the group; composite order must stay. |
| `shadow` | `painter/effects.ts:48` (CSS `drop-shadow`) | no | `effects: { shadow: { x, y, blur, color } }` | image filter drop shadow | blur pass on the silhouette, offset and tint, draw under | low once blur exists | CSS `drop-shadow(blur)` uses sigma = blur / 2; `blur(r)` uses sigma = r. The renderer must match this exactly. |
| Colour adjustments (hue, saturation, brightness, contrast, grayscale, sepia, invert) | `painter/effects.ts:14-22`, `effects.ts:100` | no | `effects: { saturation: 0.3, sepia: 0.4 }` | colour matrix filters in CSS order | One colour-matrix shader pass; build the matrix from the same CSS definitions | low: 4x5 matrix | Order is fixed: adjustments, blur, shadow (`compose.ts:57`). Keep it. |
| Effects layer sizing | `painter/layers.ts:111` (`LayerPool`, canvas-size layers) | no | renderer decides bounds | bounds-sized surface | FBO sized to group bounds plus padding; pool by size class | medium: bounds need a pass over the subtree | Bounds of brushed marks are known only after expansion. |

## Compositing

| Feature | Today | Backdrop? | Scene sketch | Skia | GPU | Difficulty | Open questions |
|---|---|---|---|---|---|---|---|
| `at` (transform without a layer) | `painter/core.ts:129`, `paint.ts:366` | no | any node has `transform` | `concat` | model matrix uniform; no texture | low | Scene has the one transform, not two scope kinds. |
| `group` opacity (isolation) | `painter/core.ts:185`, `effects.ts:128` | no | group `{ opacity }` | `saveLayer` | Render children to a texture, composite once. A group with one child and no effect needs no texture. | low-medium: deciding when to skip the texture | Must overlaps not darken? Yes (`core.ts:181`). |
| `group` blend: `multiply`, `screen`, `add` | `compose.ts:38`, `painter/core.ts:189` | **yes** | group `{ blend }` | `SkBlendMode` | `screen`, `add` and `multiply` for opaque colour: fixed-function blend | low | 31 gallery files use `blend`; only these three modes are used. |
| Other separable blend modes (overlay, darken, lighten, soft-light, hard-light, color-dodge, color-burn, difference, exclusion) | `compose.ts:10-28` | **yes** | same | `SkBlendMode` | Copy the backdrop region to a texture, draw with a shader that reads it (no framebuffer fetch in WebGL2 or WebGPU) | medium: a copy per blended draw | Corpus uses none. Support all 17 or only the 3? An unsupported mode could be an error instead of a silent fallback. |
| Non-separable blend modes (hue, saturation, color, luminosity) | `compose.ts:24-27` | **yes** | same | `SkBlendMode` | as above, plus the non-separable formulas in the shader | medium: formula parity | Corpus uses none. |
| Style `blend` on one shape | `painter/core.ts:388`, `core.ts:403`, `core.ts:410` | **yes** | style `blend` | per-draw blend mode | Treat as a one-child group blend, so one backdrop copy per shape | medium: cost with many small shapes | Today fill and stroke blend separately; as one group their overlap blends once. Small visible change. Accept? |
| `erase` | `painter/core.ts:320-380`, `core.ts:333` (workaround) | **yes** (removes backdrop) | style `erase`, text `erase`, paste `erase` | `SkBlendMode::kDstOut` | blend function `(ZERO, ONE_MINUS_SRC_ALPHA)`; fixed-function | low | Unused in the corpus. Inside a group it removes only the group's pixels, so the group must have its own texture. The napi quadrant workaround (`core.ts:329`) can go. |
| `mask` | `painter/core.ts:202`, `painter/layers.ts:19` | no (body and mask isolated) | `{ kind: "group", mask: [...nodes] }` | `saveLayer` with `kDstIn` | Render body and mask to textures, composite shader multiplies body by mask alpha | low-medium: two offscreen passes | The mask body can hold brushes, text and pixel images (`walker-tea.ts`). A hard-edged mask could use the stencil; gradient masks cannot. |
| Single `clip` | `painter/core.ts:149`, `core.ts:156-161` | no | node `clip: path` | `clipPath` with AA | **PROBE**: stencil with MSAA, or a coverage mask texture per clip, or a scissor for rectangles. Nested clips intersect. | medium: AA edges at parity, many nested clips per frame | 43 gallery files, the most used compositing feature. Untransformed rect clips can be scissors. Edge quality of stencil clips on 1x displays. |
| Union `clip` | `painter/core.ts:164-178`, `layers.ts:47` | **yes** (reads the whole canvas with `getImageData`, `core.ts:172`) | `clip: [path, path]` | `SkPath` union, or draw each into one clip | Union of coverage masks, or stencil with one reference value | low: easier than today | Used once, in one exercise, with one shape. Today's body draws on a copy of the backdrop; with a plain clip, erase and blend inside see the backdrop anyway. Same result expected; check. |
| `cache(key, body)` | `painter/core.ts:246`, `layers.ts:87` (24 layers) | no (own layer) | node `key: "..."` on a group; renderer may keep a texture | `SkPicture` or a raster image | Render-to-texture, LRU, release when offscreen | medium: invalidation and memory | Today the caller must put everything the pixels depend on in the key (including transform). Scene could hash the subtree instead. Cost of hashing every frame? |
| `sprite` and `image` | `painter/core.ts:267`, `core.ts:277`, `layers.ts:87` (400) | no | keyed group; `image` becomes a reference by key plus a transform | cached raster, `drawImage` | Texture at sprite size, draw a textured quad under the transform | medium: resample quality under scale | Sprite pixel ratio is fixed at creation; scaling up blurs. Mipmaps and filtering rules. |
| Paste options (opacity, blend, erase) | `painter/core.ts:281-292` | per mode | props on the referencing node | as above | as above | low | `erase` unused. |

## Paper texture, text, controls, host

| Feature | Today | Backdrop? | Scene sketch | Skia | GPU | Difficulty | Open questions |
|---|---|---|---|---|---|---|---|
| `paperTexture(amount)` | `brush/paper.ts:60`, `painter/core.ts:143` | **yes** (multiplies everything drawn so far) | last node: paper overlay `{ amount }`, or root `paper.amount` | multiply layer at 0.18 times amount | One full-canvas quad: black with the paper alpha, blend function `(ZERO, ONE_MINUS_SRC_ALPHA)`, no read of the target | low | Order matters ("call it last"). A root-level prop would make that rule structural. |
| Text: layout | `painter/text-layout.ts:111`, `text-measure.ts:72` | no | text node `{ content, box, options }`; layout in shared code | same measure function | same | medium: font metrics differ between runtimes | Headless and browser widths can differ (`text-measure.ts` header). Which font set is the reference? `u.textWidth` must still work in `update`. |
| Text: drawing | `painter/engine.ts:173-208` | no | text node | Skia glyph runs, halo as a stroke under | **PROBE**: glyph atlas filled by an offscreen Canvas2D; or SDF atlas; or glyph outlines as paths; or draw text to a texture per string | medium-high: crisp text at any transform, halo, many strings | 57 gallery files use text. Rotated and scaled text (`at`) must stay sharp. Subpixel positioning. Web-font load changes widths (`forgetTextWidths`). |
| Text: `fit`, `keepInside`, wrap | `painter/text-layout.ts:77`, `text-measure.ts:120` | no | text options | shared layout | shared layout | low | `keepInside` needs the canvas size and transform: layout depends on the camera. |
| Text warnings (overlap, missing glyph, nothing drawn) | `painter/text-watch.ts:43`, `text-watch.ts:113`, `painter/style.ts:64` | overlap: no; glyph: reads pixels | testing mode over the scene | overlap from layout rects; missing glyph by probe canvas | not needed in the browser | low-medium | Missing-glyph probe reads pixels (`text-watch.ts:162`); a font table lookup would work without a canvas. |
| `control` | `headless/tea-view.ts:88`, `browser/runtime/browser-view.ts:44` | no | control node `{ name, box }`, canvas space (not moved by `at`) | draw a stand-in from shapes and text | emit a placement list; the DOM draws the input | low | none |
| `cursor` | `browser/runtime/browser-view.ts:69` | no | scene root prop `cursor` | ignored | set `canvas.style.cursor` | low | none |
| `log`, `snapshot`, `debugBox` | `browser/runtime/browser-view.ts:73-77`, `headless/surface.ts:83`, `painter/core.ts:296` | no | not scene data; stay on the builder or the runtime | log line; capture; outline boxes | log only; box in debug mode | low | A `draw` that returns a scene has no place to call `log`. Keep `u.log`; decide if `v.log` stays. |
| Pixel ratio and device size | `painter/core.ts:53`, `core.ts:74` | no | renderer input, not scene data | 1 | `devicePixelRatio`, capped at 3 (`browser/mount.ts:409`) | low | Sketches with pixel loops read it through `getTransform` (2 files). A pixel-data node removes that need. |

## New features

| Feature | Today | Backdrop? | Scene sketch | Skia | GPU | Difficulty | Open questions |
|---|---|---|---|---|---|---|---|
| Matrix transform | none; `v.ctx.transform` in `intra-lounge/screens-tea.ts:12`, `intra-lounge-drawn/light-tea.ts:34` | no | `transform: { matrix: [a, b, c, d, e, f] }` | `concat` | mat3 uniform | low | Brush width under skew (above). Text under skew. |
| Image from pixels | none; `createImageData` and `putImageData` in 5 gallery files | no | `{ kind: "image", width, height, pixels, key, smooth? }` in scene units | `SkImage` from pixels, or `putImageData` to a temp canvas then draw | `texImage2D` once per key; nearest or linear sampling | low | Plain data with a large typed array: can a scene be serialized for baselines? Key and version rules for re-upload. Renderer picks pixel density. |
| `light` | none; hand-built in `intra-atrium/room-tea.ts:354` (a few frames per second) | no | `{ kind: "light", x, y, z, color, reach, dir, focus }` in a group or scene | **PROBE**. Needs per-pixel shading. Skia options: CPU loop over pixels (as the hand-built rooms do), or SkSL runtime effects if the Skia build has them. | **PROBE**. Render children to a G-buffer (albedo and normal and height, via multiple render targets), then one full-screen lighting pass over N lights; shadows by ray-marching the height texture or a 1D shadow map | high: new pipeline, two renderers must agree | Which Skia build runs SkSL headless? Light count limit. Cost at 60 fps and pixel ratio 2. Do brush marks have normals? |
| `material` | none | no | shape prop `material: { relief, bevel, emissive, shininess }` | normals from a distance transform of the shape (CPU) | **PROBE**. Normals from a jump-flood distance field or analytic SDF for simple shapes; relief as height | high: normals from outlines | Flat shapes default to facing the viewer. Does a brush mark take a material? |
| `wash` effect | none (the `wash` brush is unrelated) | no (the group only) | `effects: { wash: { ... } }` | **PROBE**. Pipeline: abstraction, pigment edge darkening from the blurred alpha gradient, turbulence, paper granulation | **PROBE**. Multi-pass: blur, edge detect, noise displace, paper multiply; ping-pong textures | high: look and parity | Bousseau et al. 2006 as the model. One shader source for both renderers (SkSL close to GLSL)? Warnings for an unsuitable group (for example no solid fills). |
| `hatching` effect | none | no (the group only), but tone depends on content | `effects: { hatching: { ... } }` | **PROBE**. Tone from blurred luminance, hatch strokes from the brush stroke generator by tone level | **PROBE**. Tonal art map textures baked from hatch strokes, sampled by tone; screen space or object space | high: stable under motion | Praun et al. 2001 as the model. Strokes stick to objects or to the screen? Temporal flicker when shapes move. |
| Keyed identity | none; `cache` and `sprite` names | no | `key` on any node | optional picture cache | retained texture per key, LRU, release offscreen | medium | Stage 1 decides the key rules. |

## Rows to probe in Stage 3

Genuinely uncertain GPU strategy:

1. `smudge` and `wet`: sequential reads of the target, dab by dab.
2. `light` and `material`: the G-buffer, normals from outlines, shadows, and
   how Skia runs the same shading headless.
3. `wash` effect: the pass list, and one shader for both renderers.
4. `hatching` effect: tonal art maps, and stability under motion.
5. Text drawing: glyph atlas against SDF against outline paths.
6. Single `clip`: stencil or coverage mask, and edge quality.

Lower uncertainty but worth a numeric check: AA parity of general path fills
and plain strokes; soft stamp accumulation (8-bit alpha against float); blur
and drop-shadow sigma; gradient stop interpolation.

## Hardest rows

In order: `light` with `material`; `smudge` and `wet`; `wash`; `hatching`;
text drawing. The first four are new or backdrop-bound. Text is common in the
corpus (57 of 131 gallery files) and any gap shows at once.

## Not in the table

- Sound, activity and params: not drawing.
- Compositing of the canvas onto the page: the host mounts it
  (`beebox/src/frontend/src/components/FigureView/FigureMount.tsx:79`).
