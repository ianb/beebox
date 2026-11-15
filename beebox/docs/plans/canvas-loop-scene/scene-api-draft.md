# Stage 1: the scene API, draft 2.9

Part of `beebox/docs/plans/canvas-loop-scene.md`, Stage 1. Types:
`canvas-loop/src/scene-draft/scene-api.ts`. Example sketches that
type-check against them: `canvas-loop/src/scene-draft/examples/`. Nothing runs
yet. Draft 1 (commit `882c1300e`) was reviewed by Codex (gpt-6-sol); draft 2
replaced its informal rules with the lowering contract in section 3. Draft 2.1
answers the second review round (section 13). Draft 2.2 makes the changes the
Stage 2 drawers asked for (`stage2-findings.md`; section 14).

## 1. The stance: same calls, recorded

A sketch looks almost the same as today. `draw(v, model, params)` calls
`v.rect`, `v.curve`, `v.text`, `v.at`, `v.group`, with a style on every call.
Each call adds a node to a **scene** instead of painting. When `draw` returns,
a renderer draws the scene: Skia headless, the GPU in a browser.

The calls stay because agents already write them well (principle 5): 39
gallery exercises and the path-form experiment use this vocabulary, and
styles, brushes and gestures are plain data already. A returned-value API
(`h("rect", …)`, as Elm and React do) rhymes with UI frameworks, not with
drawing APIs (Canvas2D, p5, Processing). Composition still works the React
way: a component is a plain function of `v` and props.

## 2. What changes for a sketch

| Today | Draft 2 | Why |
|---|---|---|
| `v.ctx` | removed | Its 10 users are covered: plain drawing by existing calls plus stroke `cap` and `join`; skew by `at`; pixel fields by `pixels`; hand-built lighting by `lighting`. |
| `v.cache`, `v.sprite`, `v.image` | `v.picture(options, body)`, `v.place(picture, x, y)` | One mechanism for reuse; versions by `deps` (section 5). |
| `v.paperTexture(n)` | `effects: { paper: n }` | An effect, scoped to a group. |
| `v.paper(settings)` changes canvas-wide state | sets the paper for the rest of the current group, picture or scene | No hidden state (R9). |
| `at` translate, rotate, scale | adds `skew`, `matrix` | Covers `v.ctx.transform`. |
| stroke style | adds `cap`, `join` | `pelican-bicycle` set `lineCap` through `v.ctx`. |
| group effects: colour, blur, glow, shadow | adds `wash`, `hatching`, `paper` | Painterly effects on any group. |
| (none) | `style.effects` | Effects on one shape. |
| (none) | `group({ lighting })`, `v.light`, `style.material` | Lighting, rhyming with Godot 2D lights (`energy`, `color`, `height`) and occluders (`castsShadow`). |
| (none) | `v.pixels(options, fill)` | A fixed-resolution image from computed pixels. |

Everything else stays as it is today: shapes, paths, curves, text and its
measurement, gradients, brushes, gestures, `clip`, `mask`, `tween`, `ease`,
`control`, `cursor`, `log`, `snapshot`, `debugBox`, `tube`, `offset`,
`textBounds`.

## 3. The lowering contract

This section is normative: both renderers produce this result, and no cache
may change it. A **layer** is a premultiplied RGBA image. The **target** is the
layer drawing currently lands on. The scene starts with one target, the
canvas.

| Call | Rule | New layer? | Reads what is below? |
|---|---|---|---|
| shape (`rect`, `curve`, `path`, …) | R1 | no | with a blend other than `normal`, with `erase`, or with a `smudge`/`wet` brush |
| shape with `style.effects` | R2 | yes, for its source | at its final composite |
| `at(options, body)` | R3 | no | as its children do |
| `clip(shape, body)` | R4 | no | as its children do |
| `group(options, body)` | R5 | yes | at its final composite |
| `mask(maskBody, body)` | R6 | yes, one per body | at its final composite |
| `place(picture, x, y, options)` | R7 | yes | at its final composite |
| `group({ lighting }, body)` | R8 | yes | at its final composite |
| `paper(settings)` | R9 | no | no |

**R1, shape.** The fill, then the stroke, each composite onto the target with
the style's blend. This is today's order. A brushed stroke's blend is the
style's `blend` when the style sets one, including `"normal"`; otherwise the
brush preset's (`marker` multiplies). Today an explicit `"normal"` still falls
back to the brush's blend (`canvas-loop/src/core/painter/core.ts:410`);
**decision 8** changes that, so `blend: "normal"` means normal. `erase` removes target alpha
by the shape's coverage times its paint's alpha (an `rgba(0,0,0,0.5)` erase
removes half), as today. `weight: 0` draws no stroke. A colour the runtime
cannot parse is an error when the call is recorded. `smudge` and `wet` read the target as it is when the
stroke starts (and, for `smudge`, as it changes along the stroke). Near an
edge of the target, the pickup patch is moved inside the target, as today, so
a smudge that starts past an edge drags nearby paint instead of erasing.

**R2, shape with effects.** The shape draws with `normal` blend into a new
transparent layer; inside it, a brushed stroke still uses its own blend over
the fill (a `marker` multiplies over the fill). The effects apply to that
layer. The layer then composites onto the target with the style's `blend`
(`normal` if unset; the brush's blend stays inside), or erases with it. So
`circle(…, { erase: true, effects: { blur: 4 } })` cuts a soft hole, and a
`multiply` shape with a glow multiplies its glowing result. A `smudge` or
`wet` stroke with `effects` is an error: its source would be an empty layer.

**R3, at.** Changes coordinates for its body. The body draws onto the current
target.

**R4, clip.** The body draws onto the current target, restricted to the clip
shape or the union of shapes, with antialiased edges. Erase, blends and
smudges inside act on the target within the clip. Single and union clips
behave the same (today they already do, by different means:
`core.ts:155-172`).

**R5, group.** The body draws into a new transparent layer. Then, in order:
1. lighting, if the group is lit (R8);
2. effects, in their fixed order: colour adjustments, blur, wash, hatching,
   paper; glow and shadow are drawn beneath the result, made from the layer
   as it was before these effects (today's glow source,
   `canvas-loop/src/core/painter/effects.ts:138`);
3. the group's `clip` option;
4. `opacity`;
5. composite onto the outer target with `blend`.

This follows CSS (`filter`, `clip-path`, `opacity`, `mix-blend-mode`).
**Bounds:** a group's layer covers its content's bounds grown by every
effect's reach (three blur radii, glow blur, shadow offset plus blur, wash
bleed). Nothing is cut except by the canvas edge, so a shape just off the
canvas still casts its glow or shadow onto it. A
`clip(…)` call inside the body is R4 and acts before the effects; the `clip`
option acts after them. For any other order, nest groups.

**R6, mask.** `body` draws into a new layer and `maskBody` into another. The
body layer is kept in proportion to the mask layer's alpha, and the result
composites onto the target with `normal` blend. Both bodies are isolated: a
smudge in either reads only its own layer. Effects inside the mask body shape
the mask (a blurred group in the mask gives a soft mask).

**R7, placement.** A picture is a recorded subtree with its own coordinates.
Placing it replays the recording under the current transform plus a
translation to (x, y), into a new transparent layer. That layer composites
onto the target with the placement's `opacity`, `blend` and `erase`. Brush
widths, effect lengths and text follow the placement transform as if the
subtree were drawn there, so a non-uniform scale keeps brush tips round, as
today (widths scale by the square root of the transform's determinant).
Replay, not a stretched bitmap, is the meaning. A renderer may reuse a raster
only where the result matches (section 6).

**R8, lit group.** Lighting has its own scope, separate from isolation.
- **Materials are a second layer.** Alongside colour, the body draws a
  material layer: each pixel holds surface direction (from `bevel` and
  `relief`), `shine`, `emissive` and shadow-casting amount, with coverage.
  Shapes without a material draw flat matte into it. The material layer
  composites the way colour does, by coverage: a shape at 10% alpha moves the
  material underneath 10% of the way toward its own (so a faint overlay barely
  changes what is below), `erase` removes material coverage with colour
  coverage, and `clip`, `mask` and `opacity` cut both alike.
- **Effects touch colour, not material.** Blur, wash, hatching and paper change
  colour only. Pixels that a glow adds are emissive (a glow is light); pixels
  that a shadow adds are flat matte. A smudge moves colour, not material.
- **Lights.** Every `light` inside the body, at any depth and inside placed
  pictures, lights the group, transformed by its placement: a picture holding
  a lamp brings its light wherever it is placed. A `light` inside a mask body
  does nothing and warns; mask artwork contributes no material.
- **Shading.** After the body, each pixel is lit: colour × ((1 − e)(ambient +
  the lights' sum, each blocked by casters between it and the pixel) + e),
  where e is the pixel's emissive amount. A fully emissive pixel keeps its
  colour whatever the lighting; this is what makes a nested lit group's result
  (emissive to the outer group) not lit twice.
  Casters are the material layer's shadow-casting amount, so a half-transparent
  or half-erased caster blocks half as much.
- **Nesting.** A lit group inside a lit group is lit only by its own lights. To
  the outer lighting its result counts as emissive: it is not lit twice.
- **Outside a lit group,** `material` is ignored silently, so one picture can be
  placed both lit and unlit. A `light` outside any lit group does nothing and
  warns in testing mode.
- **A placement can supply a material:** `place(picture, x, y, { material })`
  gives that material to the picture's shapes that have none (so an unlit
  drawing can cast shadows in a lit room).
- **Conventions.** Angles are radians from +x, clockwise (y down), as `arc`.
  `height` is the light's distance above the picture plane: higher lights
  give wider, softer pools and shorter shadows. A caster never blocks a light
  that sits inside it. `background` inside a lit group is lit like any shape.
- **Starting values.** A lamp that shows as a pool on the first render:
  ambient `"#2e3448"` and a point light at `height: 120`, `energy: 1.5`, with
  the default reach (400). `run --scene` prints each light's peak added
  brightness, where it peaks (below a point light; beside a spot on its
  beam) and what a white floor there shows, ambient alone and lit; for this
  lamp, `peak +0.83 below (240,110), over ambient 0.20 (a white floor there:
  0.49 → 1.00)`. A peak several times the ambient reads as a pool; a peak
  near the ambient barely shows.
- Lighting happens before the group's effects (R5), so a wash paints over the
  lit result.

**R9, paper.** `v.paper(settings)` applies to brushes drawn after it in the same
group, picture or scene, and in their children. It ends with that scope. A
picture's brushes use the paper in effect where `v.picture` is called (or a
`v.paper` inside its body), and that paper is part of the picture's version,
as if it were in `deps`. A picture never depends on where it is placed.
`effects.paper` uses the paper in effect at the end of the group's body.

## 4. Coordinate spaces

| Thing | Space | Today | Change |
|---|---|---|---|
| Geometry, text, gradient positions | current coordinates (after `at`) | same | none |
| Plain stroke widths | current coordinates; under a non-uniform scale the pen stretches, as Canvas2D does | same | none |
| Brush widths | current coordinates; under a non-uniform scale the tip stays round, its width scaled by √\|det\| | same | none |
| Effect lengths and directions (blur, glow, shadow offset, wash bleed, hatch spacing and angle) | the coordinates where the group is called | canvas pixels and canvas directions (`canvas-loop/BRUSHES.md:234`) | **decision 1**: effects scale, rotate and skew with their group; a picture placed at half size blurs half as much, and a rotated picture's shadow rotates with it |
| Wash pigment, hatching lines, paper-effect texture | the coordinates where the group is called | new | none |
| Brush paper grain | the coordinates in effect at the brushed call (draft 2.4) | canvas pixels | a shape moved by `at` or placed as a picture keeps its grain |
| Brush randomness seed | the stroke's own geometry as passed to the call (its points in the coordinates of the call), or `gesture.seed` if given; never its order among other marks | device-pixel geometry (`mark.ts:100`) | **decision 7**: texture no longer changes with pixel ratio or placement; adding or removing other marks still never changes a mark (as `canvas-loop/BRUSHES.md:168` promises); brushed baselines change once |
| Light positions | current coordinates at the `light` call, then the placement | new | none |

The panning-camera pattern follows from this. Put the camera's `at` outside a
group with a wash, and the pigment moves with the world. Put it inside, and the
pigment stays on the screen. `lit-room/room.ts` uses the first.

## 5. Pictures: versions, dependencies, size

- **A version** is identified by `key`, `width`, `height` and the values of
  `deps`. `v.picture` returns the version for the current values and records
  it if it does not exist. Several versions of one key can live at once: the
  citizens in `lit-room/citizen.ts` (looks A, B, A) make two versions.
- **`deps` hold plain data** (numbers, strings, booleans, `null`, and arrays
  and plain objects of these). They are compared by value, deeply. The type is
  `readonly unknown[]`, so sketch interfaces pass; the check happens when the
  picture is recorded, and a function, class instance or cycle is an error
  naming the value. React's `useMemo` compares
  with `Object.is`; canvas-loop models are plain data, so value comparison is
  the safer default here. Omitting `deps` means "never changes".
- **Key scope** is the sketch. Two unrelated drawings under one key with equal
  `deps` share a version; the audit below reports it.
- **Stale captures are caught in testing mode.** A body that reads a value not
  in `deps` (for example `model.color` in a closure) records once and then goes
  stale. In testing mode (headless), every picture is re-recorded each frame
  and compared with its cached version. A difference warns, naming the picture,
  its `deps`, and the first node that differs.
- **Size.** `width` and `height` are the picture's layout box: `place` puts its
  top-left at (x, y). Inside the body, `v.width` and `v.height` are these
  values, and `keepInside` text keeps inside this box (**decision 2**; today it
  keeps inside the canvas). Drawing outside the box is kept, not cut
  (**decision 3**; today a sprite cuts glows and shadows at its edge,
  `canvas-loop/BRUSHES.md:235`).
- **Eviction.** The renderer keeps versions placed in recent frames and may
  drop others. A dropped version is recorded again when it is asked for.
  Because bodies are pure and the audit checks that `deps` are complete, this
  is invisible.
- **Pixels.** `v.pixels(options, fill)` makes a fixed-resolution image of
  exactly `width × height` pixels. `fill({ data, width, height })` writes RGBA
  bytes into a zeroed array when the version is new. Placed, it is sampled
  smoothly (bilinear), like an image; it does not gain resolution when scaled
  up. In testing mode, a fill that leaves every pixel transparent warns.

## 6. What a renderer may cache

The renderer, not the sketch, decides what to keep. It may keep:
- expanded brush geometry for a stroke whose data, transform scale and pixel
  ratio are unchanged;
- a rasterized group or picture layer whose recorded data, placement scale and
  rotation, pixel ratio, paper and fonts are unchanged (a move by whole device
  pixels may reuse it);
- inside a lit group, the colour and material layers of a static subtree, but
  never the lit result while any light in the group changes.

A picture whose body measured text is recorded again when fonts finish
loading (browser).

**Cache equivalence.** Within one runtime, a frame rendered with caches,
without caches, and after waking gives the same pixels: byte-identical
headless, and identical up to the GPU's own rounding in the browser. The
cross-renderer tolerance (headless against browser) is a separate,
looser measure, set before Stage 3.

**Captured by value.** Every drawing call captures its arguments as they are at
the call: a point array changed after `v.curve(points, …)` does not change the
recorded curve. `deps` are captured the same way, and a `pixels` version owns
its finished bytes. A renderer may avoid copies only where it keeps this
meaning.

## 7. Measurement

`v.text` returns its bounds. `v.textBounds`, `v.textWidth`, `u.textWidth` and
`u.textBounds` answer during `draw`, `init` and `update`, as now
(`canvas-loop/TEA.md:190`). The recorder measures with the runtime's fonts at
the call. Inside a picture, bounds are in the picture's coordinates.

## 8. What one `draw` produces

| Part | Kind | Rules |
|---|---|---|
| the scene | kept | drawn by the renderer; kept for waking and redraws |
| control placements (`v.control`) | kept | DOM inputs in the browser, as today; headless stand-ins are drawn above the scene in call order (**decision 9**: today they paint where `control` is called, inside any open layer) |
| cursor (`v.cursor`) | kept | the last call in the frame wins |
| debug boxes (`v.debugBox`) | kept | shown with `run --outline`; inside a picture they are part of the recording and move with it |
| logs (`v.log`), snapshots (`v.snapshot`) | events | once per `draw` call, in order |

Inside a picture body, `control`, `cursor`, `log` and `snapshot` are errors
(**decision 6**): a body runs only when its version records, so these would
come and go with the cache. Waking from sleep re-renders the kept parts and
does not call `draw`, so events neither repeat nor go missing.

## 9. Brushes

- A brushed stroke is a node with its brush and gesture. A shared CPU step
  expands it into dabs, outlines or bristle runs. Both renderers draw those, so
  a mark's random character is the same in both.
- Backdrop-reading strokes (`smudge`, `wet`, non-`normal` blends) make the
  renderer finish everything before them on the same target first. They limit
  batching; Stage 3 measures how much.
- Brushes may be reimplemented for the GPU and look different from today; they
  are judged by eye (Checkpoint 0).

## 10. Testing mode and tools

Headless rendering is testing mode. It keeps every check it has today and adds
new ones. Each message names the node by its path, for example
`group "room" > place "citizen" at (240,360) > picture "citizen" {suit: …} > circle #4`
(group names come from `group({ name })`),
so a shared picture's problem shows where it was defined and where it was
placed.

| Check | Status |
|---|---|
| Faint marks (`painter/faint.ts`) | kept |
| Text overflowing its box | kept |
| Labels overlapping in one frame (`painter/text-watch.ts`) | kept |
| Characters the font has no glyph for | kept |
| Picture recorded differently with the same deps (stale capture) | new warning |
| Picture recorded every frame because its deps change every frame | new warning |
| `light` outside a lit group | new warning |
| picture re-expanded every frame because its placement scale or rotation changes | new performance hint |
| Wash or hatching over a group with no tone variation | new warning |
| `pixels` fill left fully transparent | new warning |
| `smudge`/`wet` with `effects`; `control`, `cursor`, `log`, `snapshot` in a picture body; non-plain `deps` | new errors |

Tools:
- `run --scene` writes each captured frame's scene, as an indented outline, into
  the transcript, with picture versions and placements; `run --scene first`
  writes only the first captured frame's. Each light's line gives its peak
  added brightness (R8, "Starting values").
- `cli diff` adds a scene diff beside the pixel diff: pictures added or
  re-recorded and why (which dep changed), and changed nodes. Siblings are
  aligned as sequences (longest common subsequence on node kind and data), so
  one inserted shape shows as one insertion; pictures and named groups also
  match by key and name.
- `group({ name })` names a group in messages, outlines and diffs. It changes
  nothing drawn.
- `run --timing` adds per-frame counts: pictures recorded, cache hits and
  misses with reasons, strokes expanded, render passes and layer copies, bytes
  held, and time spent comparing deps.

## 11. Coverage

Every row of `coverage-matrix.md` maps to the draft. Where the matrix's early
sketches differ (keys on arbitrary nodes; screen-space paper), this draft
decides. The matrix keeps its Skia and GPU strategy columns, and its PROBE rows
remain Stage 3 probes.

| Matrix rows | Draft 2 |
|---|---|
| Shapes, paths, curves, plain strokes, gradients, background | unchanged calls, R1; stroke gains `cap`, `join` |
| Brushes: ink, marker, pencil, chalk, airbrush, wash, bristle | unchanged; section 9 |
| Brushes: smudge, wet | unchanged; R1; error with effects (R2) |
| Brush fields: grain, hue jitter, pressure, wobble, seed, faint, spacing, scatter, size jitter | unchanged; seed per section 4 |
| Effects: colour adjustments, blur, glow, shadow | unchanged; lengths per section 4 |
| Opacity, blends, erase, mask, single and union clip, `at`, `group` | R1–R6 |
| Paper grain, paper texture | R9; `effects.paper` |
| Text drawing, measurement, warnings | unchanged; sections 7, 10 |
| Cache, sprite, image | pictures, sections 5–6 |
| Controls, cursor, log, snapshot, debugBox | section 8 |
| New: light, material, wash, hatching, pixels, matrix, skew | R8, section 5, effects |

No row is dropped.

## 12. Decisions for the boxholder

Behaviour that changes from today, or new policy. Each needs a yes or no.
1. **Effects follow their group's transform:** lengths scale, and offsets and
   angles rotate and skew with it (section 4). Today they stay in canvas
   pixels and canvas directions.
2. **`keepInside` inside a picture keeps text inside the picture's box.**
   Today, inside a sprite, it keeps text inside the canvas.
3. **Pictures keep what overflows their box.** Today sprites cut glows and
   shadows at their edge.
4. **`effects.paper` darkens colour only where the group drew and leaves alpha
   unchanged,** using the scope's paper (R9). Today `paperTexture` multiplies a
   paper layer over everything drawn so far and paints into transparent areas.
5. **New lighting policy** (no lighting exists today): lights inside a picture
   travel with each placement; materials composite by coverage; a nested lit
   group is not lit twice (R8).
6. **`control`, `cursor`, `log`, `snapshot` are errors inside a picture body**
   (section 8). Today they work inside `cache` and `sprite` bodies on the
   frames those bodies run.
7. **Brushed drawings change texture once,** because seeds hash the stroke's
   own geometry instead of device pixels (section 4).
8. **`blend: "normal"` on a brushed stroke means normal** (R1). Today it falls
   back to the brush's blend (`marker` still multiplies).
9. **Headless control stand-ins draw above the scene** (section 8). Today they
   paint at the call, inside any open layer.
10. **Paper is scoped** (R9): `v.paper` lasts until its group, picture or scene
    ends, and pictures do not inherit the paper where they are placed; brush
    grain moves into picture coordinates. Today `v.paper` is canvas-wide.
11. **Pictures replay instead of stretching** (R7): a picture placed under a
    non-uniform scale keeps round brush tips. Today a scaled sprite stretches
    its pixels.
12. **`pixels` makes a fixed-resolution image** (section 5). Today pixel fields
    were written at device resolution through `v.ctx`.
13. **`smudge` or `wet` with `effects` is an error** (R2). Today the pairing
    cannot be written (shapes have no effects).

## 13. Review rounds

Round 1 (draft 1) findings and their answers: shape effects (R2); lighting
across caching (R8, section 6); stale captures (section 5); picture versions
(section 5); clip and mask (R4–R6); coordinate spaces (section 4); bounds and
pixels (R5, section 5); paper (R9); measurement (sections 5–7); output
lifetimes (section 8); coverage (sections 2, 11; matrix reconciled);
diagnostics (section 10).

Round 2 (draft 2) findings and their answers in draft 2.1:

| Finding | Answer |
|---|---|
| final blend of an effected marker | R1, R2; decision 8 |
| materials through alpha, erase, masks, effects, smudge | R8 rewritten |
| plain stroke vs brush width under non-uniform scale | section 4, two rows |
| effect bounds | R5 |
| paper operation | decision 4 |
| matrix rows not reconciled | `coverage-matrix.md` scene column updated |
| scene diff alignment; group names | section 10 |
| seeds depending on call position | section 4 (geometry only) |
| cache equivalence vs cross-renderer tolerance | section 6 |
| argument ownership | section 6 |
| section 12 incomplete | decisions 8–13 added; 1, 2, 4, 5, 6 corrected |

## 14. Draft 2.2: changes from the Stage 2 drawers

From `stage2-findings.md`:
- The API module exports every type a sketch uses.
- `deps` are typed `readonly unknown[]` and checked as plain data when
  recorded (section 5).
- Pictures take the paper of the scope where `v.picture` is called, as part of
  their version (R9).
- Materials outside a lit group are ignored silently; `place` can supply a
  default material; light conventions are stated (R8).
- A performance hint when a placement's scale or rotation changes every frame
  (section 10).
- New calls:
  - `v.toCanvas(point)`: a point in canvas coordinates under the current
    transform, for drawing something in another scope at the right place.
  - `v.noise(x, y?, z?)`: seeded value noise of coordinates, 0..1, for
    flicker and texture. It is a pure function, so `draw` stays pure; it
    rhymes with p5 `noise`.
- Docs to write with the implementation: "Making something glow" (emissive,
  light, glow, and a lamp that uses all three), where shape and group glows sit
  relative to a group's wash, and `v.width` inside a picture.

## 15. Draft 2.3: details settled while building the spike

From the Stage 4 builder (chunks 1–2):
- **Erase** removes coverage times paint alpha (R1). `weight: 0` means no
  stroke. An unparsable colour is an error at the call.
- **`at` order:** the options compose as Canvas2D calls in this order:
  `matrix`, `translate`, `rotate`, `skew`, `scale`. So `scale` acts on points
  first and `matrix` last.
- **Effects under non-uniform transforms** (section 4, decision 1): an
  axis-aligned scale gives blur, glow and shadow separate horizontal and
  vertical sizes; a rotation with uniform scale keeps them round. Rotated
  non-uniform scale and skew transform the kernel too (the spike defers
  these and says so with an error).
- **`background`** inside a group or clip fills the canvas rectangle into the
  current layer, inside any clip, as today.
- **Gradients** interpolate unpremultiplied colours, as Canvas2D and Skia do.
- **`noise`** is seeded by the run's seed (the same seed as `u.random`), so
  `--seed` changes it and two runs with one seed agree.

## 16. Draft 2.4: details settled in chunk 3

- **Smudge at an edge:** the pickup patch moves inside the target (R1), as
  today.
- **Brush seed:** a hash of the call's own numbers (points, widths, brush and
  gesture data as passed), never of the flattened outline, so zooming never
  re-rolls texture.
- **Brush paper grain** is anchored to the coordinates in effect at the brushed
  call (after `at`, before any placement), replacing "the nearest picture's
  coordinates" in section 4. A brushed shape moved with `at` keeps its
  texture. The paper's per-pixel hash no longer uses the canvas width, so grain
  never depends on canvas size (today's paper changes once).
- **Paper scope** (R9) also ends with a mask body; it does not end with `at` or
  `clip`.
- **`background` inside a picture** fills the picture's box under the
  placement.
- **The expansion cache key** omits pixel ratio (expansion no longer depends on
  it) and uses exact values.
- `toCanvas` inside a picture body is an error. `undefined` is allowed in
  `deps`. `pixels` bytes are straight (unpremultiplied) RGBA, as `ImageData`.
  `smudge` and `wet` with a blend or erase are errors, as today.

## 17. Draft 2.5: lighting and effect details settled in chunk 4

- **Shading** is colour × ((1 − e)(ambient + lights) + e) (R8, corrected: the
  earlier `+ colour × emissive` lit emissive pixels twice).
- **Material values** used for shading are per unit of material coverage, so
  a half-transparent emissive or shiny shape keeps its full emission or shine
  at half coverage; the shadow-casting amount stays coverage-weighted.
- **Masks** cut material by the mask artwork's colour alpha (including its
  effects), exactly as they cut colour.
- **A nested lit group's** emissive coverage is its finished colour alpha
  (effects included).
- **Material composites with normal blend,** whatever the shape's blend.
- **Units:** light and ambient colours are sRGB values applied to linear
  surface colour; the result clips at 1. There is no tone curve yet.
- **Directional lights:** `height` is an elevation slope (height ÷ 100).
- **Casters** all stand at one fixed height (32 units in the lit group's
  coordinates); a caster does not shadow itself or another caster. Caster
  height and object identity are deferred until lighting is wanted.
- **Spot cones** accept up to π; a full cone lights every direction.
- **Hatching `amount`** scales line density and ink together: more amount makes
  more lines appear at a given tone. Three line families (single, cross,
  dense), each line with its own tone threshold.
- **`effects.paper`** keeps today's `paperTexture` strength (at most 18% darker
  in the paper's valleys) per unit of amount.
- **`noise`** sums p5's four halving octaves, scaled to [0, 1).

## 18. Draft 2.6: caching details settled in the speed round

- **Placements snap to whole device pixels** (provisional; for the boxholder at
  Checkpoint 4). The translation part of a placement's final device transform
  is rounded, for cached and uncached rendering alike, so a panning camera
  reuses a picture's kept raster and cache equivalence still holds. Rotation
  and scale are unchanged. A group does not snap, so a picture and the same
  body drawn in a group can differ by under one device pixel of position.
  Measured: the panning Hallway goes from 25 to 58 fps at ratio 2. The
  alternative (today's) is resampling a kept raster at fractional offsets,
  which blurs slightly while moving.
- **Kept rasters** are a fixed grid of 2048-device-pixel tiles aligned to the
  picture's origin. Pictures with backdrop-reading content (`smudge`, `wet`) or
  effects that read their surroundings (hatching's tone range, wash bleed,
  blur near a tile edge) are kept as one raster for their whole extent, so
  tiles never change their result.
- **Eviction:** versions not placed in the last two frames may be dropped; all
  kept and spare rasters together stay under 256 MB.
- **Fonts:** a picture that measured text is re-recorded when fonts finish
  loading (browser); until that exists, the spike does not invalidate on font
  load.
- **Hashes:** cache keys are 64-bit hashes of recorded data; a collision
  (about 2^-64 per pair) is accepted as the only way two different inputs can
  share a cached result.

## 19. Draft 2.7: details settled in the look round

- **Caster height:** `material.castsShadow` takes `true` (32 logical pixels,
  as before) or a height, 0..1024, in the coordinates where the shape is
  drawn. A shadow ends where the ray from the floor to the light clears the
  caster's top, so a taller caster or a lower light casts a longer one. A
  pixel on a caster sits at its height, so only taller casters shadow it
  (replaces "a caster does not shadow another caster" in section 17). One
  number on the existing key was chosen over a separate `material.height`:
  a height on a shape that casts nothing would mean nothing.
- **Exposure and tone curve:** `lighting.exposure` in stops (default 0) and
  `lighting.toneCurve` 0..1 (default 0, the old clip at white). Toward 1, an
  S-curve in linear light: deeper shadows, highlights that roll off below
  white, middle tones about unchanged. Emissive light is not exposed or
  toned. The curve is monotonic at every strength.
- **Height 0** casts nothing (a floor can say `castsShadow: 0`). A caster
  scaled taller than 1024 by a transform keeps its full height.
- **Soft shadows** march through the caster layer blurred by 3 logical
  pixels, so a shadow's sides soften; hard shadows read it unblurred. The
  march covers only the caster layer and, for a light above every caster,
  only until the ray clears the tallest; samples are at most 8 device px
  apart, up to 256, then spaced wider. Each run of samples on casters is
  refined to its strongest block by a halving search on a bilinear read, so
  a penumbra is smooth; the start offset is interleaved gradient noise keyed
  to canvas pixels, so shadows do not change when unrelated shapes move the
  layer.
- **A caster's outline pixel** is partly the caster and partly what lies
  below it: each light's visibility is taken at both heights and mixed by
  each part's share of the pixel's colour.
- **Wash:** granulation is faint and has no per-pixel term. `blotch` adds
  pooling at a shape's scale and, above about 0.2, occasional blooms;
  `edges` adds a drying line whose strength wanders, more pigment toward a
  region's edges and bottom, less in its middle.
- **Hatching:** default spacing 6. The lightest third of the group's tone
  range stays bare; half tones take single lines, shadows crossed lines,
  the darkest a third family near the first. Lines turn toward the tone's
  contours (up to 0.35 rad) only where the tone changes strongly, and under
  them the colour lifts toward paper, so the lines carry the tone.

## 20. Draft 2.8: browser mount and sleep (chunk 6a)

- **Sleep in two steps.** Offscreen, a figure stops its loop at once (as
  today). After two seconds still offscreen it releases its GPU resources
  (kept rasters, pooled textures, caches), keeping the model, params, frame
  counter, randomness and the last recorded scene. A brief scroll therefore
  wakes instantly; a figure left offscreen frees its memory. Waking after a
  release re-renders the kept scene without calling `draw`; for a figure built
  on a large picture this costs a full redraw of it (measured: 160–175 ms for
  the Hallway), so the "wake under 100 ms" target applies to waking within the
  release delay.
- **Resize** re-places controls without calling `draw`.
- **Web fonts finishing loading** call `draw` again, as today; that frame's logs
  can repeat. Pictures that measured text are recorded again.
- **Cache equivalence in the browser** is byte-identical within one browser on
  one machine, including after a new GPU device (measured), not only "up to the
  GPU's rounding".
- **One GPU device per page,** shared by every figure and destroyed with the last
  one. A lost device shows a notice and is recreated on the next wake or click.

## 21. Draft 2.9: Checkpoint 4 answers

- **`material.receivesShadow`** (default `true`). `false` marks a shape on
  which no light's shadow falls, for a backdrop in a side view (a sky behind
  a figure, where top-down shadows would otherwise climb it). The shape is
  still lit and still casts if it has `castsShadow`. It composites through
  the material layer like the other material values, so a placement's
  `material` can supply it.
- **One light, several washed groups.** A light lights only the nearest lit
  group around it. To light neighbouring parts that each have their own
  wash, draw one lit group around them and give each part its wash as an
  inner group; the lights go in the outer lit group. A light across separate
  lit groups is not planned until box agents need it.
- **Hatching** keeps covering its group's whole layer (Checkpoint 4, decision
  6).
