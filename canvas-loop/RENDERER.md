# The renderer's contract

A reference for work on canvas-loop itself; boxes do not get it. Sketch
authors read [TEA.md](./TEA.md) and [BRUSHES.md](./BRUSHES.md). The rules
here started in `beebox/docs/plans/canvas-loop-scene/scene-api-draft.md`
(draft 2.11) and keep its rule numbers (R1–R9), so code comments can cite
them. Where the draft and this file differ, this file is current.

## Pipeline

1. `draw` returns a drawing: nodes made by the `View`'s constructors
   (`scene/recorder/view.ts`). Scope constructors copy their children into a
   list they own (`scene/recorder/children.ts`). Each node carries the frame
   that made it (`MADE_IN`); a node from an earlier frame is refused.
2. The resolve walk (`scene/recorder/resolve.ts`) turns the returned drawing
   into a `Scene` (`scene/nodes.ts`). It holds every check that needs a
   node's ancestors: the transform (effect scales, off-canvas bounds,
   `keepInside` layout), the paper scope, the lit depth and the mask flag.
   Picture bodies are resolved when they are recorded, under the picture's
   own size, identity transform and paper.
3. Lowering (`gpu/lower.ts`) turns the scene into GPU work: coverage, brush
   expansion (a compute pass), layers, effects and lighting.
4. The frame is drawn on WebGPU: the browser's, or Dawn headless.

## The lowering contract

Both runtimes produce this result, and no cache may change it. A **layer** is
a premultiplied RGBA image. The **target** is the layer drawing currently
lands on. The scene starts with one target, the canvas.

| Node | Rule | New layer? | Reads what is below? |
|---|---|---|---|
| shape (`rect`, `curve`, `path`, …) | R1 | no | with a blend other than `normal`, with `erase`, or with a `smudge`/`wet` brush |
| shape with `style.effects` | R2 | yes, for its source | at its final composite |
| `at(options, children)` | R3 | no | as its children do |
| `clip(shape, children)` | R4 | no | as its children do |
| `group(options, children)` | R5 | yes | at its final composite |
| `mask(maskArt, children)` | R6 | yes, one per part | at its final composite |
| `place(picture, x, y, options)` | R7 | yes | at its final composite |
| `group({ lighting }, children)` | R8 | yes | at its final composite |
| `paper(settings, children)` | R9 | no | no |

**R1, shape.** The fill, then the stroke, each composite onto the target with
the style's blend. A brushed stroke's blend is the style's `blend` when the
style sets one, `"normal"` included; otherwise the brush preset's (`marker`
multiplies). `erase` removes target alpha by the shape's coverage times its
paint's alpha. `weight: 0` draws no stroke. A colour the runtime cannot parse
is an error at the call. `smudge` and `wet` read the target as it is when the
stroke starts (and, for `smudge`, as it changes along the stroke). Near an
edge of the target, the pickup patch moves inside the target. `smudge` and
`wet` with a blend or erase are errors.

**R2, shape with effects.** The shape draws with `normal` blend into a new
transparent layer; inside it, a brushed stroke still uses its own blend over
the fill. The effects apply to that layer. The layer then composites onto the
target with the style's `blend` (`normal` if unset), or erases with it. A
`smudge` or `wet` stroke with `effects` is an error.

**R3, at.** Changes coordinates for its children, which draw onto the current
target. The options compose as Canvas2D calls in the order `matrix`,
`translate`, `rotate`, `skew`, `scale`.

**R4, clip.** The children draw onto the current target, restricted to the
clip shape or the union of shapes, with antialiased edges. Erase, blends and
smudges inside act on the target within the clip.

**R5, group.** The children draw into a new transparent layer. Then, in order:
1. lighting, if the group is lit (R8);
2. effects, in their fixed order: colour adjustments, blur, wash, hatching,
   paper; glow and shadow are drawn beneath the result, made from the layer
   as it was before these effects;
3. the group's `clip` option;
4. `opacity`;
5. composite onto the outer target with `blend`.

This follows CSS (`filter`, `clip-path`, `opacity`, `mix-blend-mode`). A
group's layer covers its content's bounds grown by every effect's reach
(three blur radii, glow blur, shadow offset plus blur, wash bleed). Nothing is
cut except by the canvas edge.

**R6, mask.** The children draw into a new layer and the mask art into
another. The children's layer is kept in proportion to the mask layer's
alpha, and the result composites onto the target with `normal` blend. Both
parts are isolated: a smudge in either reads only its own layer. Effects in
the mask art shape the mask.

**R7, placement.** A picture is a recorded subtree with its own coordinates.
Placing it replays the recording under the current transform plus a
translation to (x, y), into a new transparent layer, which composites with
the placement's `opacity`, `blend` and `erase`. Brush widths, effect lengths
and text follow the placement transform as if the subtree were drawn there;
under a non-uniform scale, brush widths scale by √|det|. Placement means
replay; a renderer may reuse a raster only where the result matches (What a renderer may keep). The translation part of a
placement's final device transform is rounded to whole device pixels, cached
or not.

**R8, lit group.**
- **Materials are a second layer.** Alongside colour, the children draw a
  material layer: per pixel, surface direction (from `bevel` and `relief`),
  `shine`, `emissive`, caster height and `receivesShadow`, with coverage.
  Shapes without a material draw flat matte. Material composites by coverage
  with normal blend, whatever the shape's blend; `erase`, `clip`, `mask` and
  `opacity` cut it as they cut colour. Material values used for shading are
  per unit of coverage; the casting amount stays coverage-weighted.
- **Effects change colour only.** Pixels a glow adds are emissive; pixels a
  shadow adds are flat matte. A smudge moves colour only.
- **Lights.** Every `light` in the children, at any depth and inside placed
  pictures, lights the group, transformed by its placement. A light in mask
  art does nothing and warns.
- **Shading.** colour × ((1 − e)(ambient + the lights' sum, each blocked by
  casters between it and the pixel) + e), where e is the pixel's emissive
  amount. Light and ambient colours are sRGB values applied to linear surface
  colour. `exposure` (stops) and `toneCurve` (an S-curve in linear light,
  monotonic at every strength) apply to the lit part; emission keeps its value.
- **Casters.** `castsShadow: true` stands 32 logical pixels high; a number is
  the height (0..1024; 0 casts nothing). A shadow ends where the ray from the
  floor to the light clears the caster's top. A pixel on a caster sits at its
  height, so only taller casters shadow it. A caster never blocks a light
  inside it. Soft shadows march through the caster layer blurred by 3 logical
  pixels; hard shadows read it unblurred. A caster's outline pixel mixes the
  visibility at both heights by each part's share. `receivesShadow: false`
  takes no shadow and is still lit.
- **Nesting.** A lit group inside a lit group is lit only by its own lights;
  to the outer group its finished colour alpha counts as emissive.
- **Outside a lit group,** `material` is ignored silently, and a `light`
  warns in testing mode. `place(…, { material })` supplies a material to the
  picture's shapes that have none.
- **Conventions.** Angles are radians from +x, clockwise (y down), as `arc`.
  A point or spot light's `height` is its distance above the picture plane; a
  directional light's `height` is an elevation slope (height ÷ 100). Spot
  cones accept up to π.
- Lighting happens before the group's effects (R5).

**R9, paper.** `paper(settings, children)` sets the paper for every brushed
stroke and every effect in its children (`brush.paper` and `effectsPaper` are
resolved apart, so a shape with `effects.paper` and no brush gets it too). A
nested scope wins. A group's `effects.wash` and `effects.paper` use the paper
of the scope around the group. The scope leaves no node in the scene: the walk
replaces it with its children. A picture uses its own `paper` option (part of
its version), never the paper where it is placed.

## Coordinate spaces

| Thing | Space |
|---|---|
| Geometry, text, gradient positions | current coordinates (after `at`) |
| Plain stroke widths | current coordinates; under a non-uniform scale the pen stretches, as Canvas2D |
| Brush widths | current coordinates; the tip stays round, its width scaled by √\|det\| |
| Effect lengths and directions (blur, glow, shadow offset, wash bleed, hatch spacing and angle) | the coordinates where the group or shape is; an axis-aligned scale gives separate x and y sizes |
| Wash pigment, hatching lines, paper-effect texture | the coordinates where the group is |
| Brush paper grain | the coordinates at the brushed call, before any placement |
| Brush randomness seed | a hash of the mark's geometry as passed to the call, or `gesture.seed`; never its order among other marks, the pixel ratio or the placement |
| Light positions | current coordinates at the `light` call, then the placement |

Put a panning camera's `at` outside a washed group and the pigment moves with
the world; put it inside and the pigment stays on the screen.

## Pictures

- **A version** is the key, `width`, `height`, `paper` and the values of
  `deps`. `v.picture` returns the version for the current values and records
  it if it does not exist. Several versions of one key can live at once.
- **`deps`** are plain data, compared deeply by value. A function, class
  instance or cycle is an error naming the value. Omitted `deps` mean "never
  changes". Key scope is the sketch.
- **Captured by value.** Every call captures its arguments at the call; a
  `pixels` version owns its finished bytes.
- **Body rules.** `control`, `cursor`, `log` and `snapshot` are errors inside
  a body. `v.width` and `v.height` are the picture's box; `keepInside` keeps
  inside it; drawing outside it is kept.
- **Frames.** A `Picture` handle belongs to the frame that asked for it; a
  handle from an earlier frame is refused at `place`.
- **`pixels`** makes exactly `width × height` pixels of straight RGBA, sampled
  bilinearly when placed.

## What a renderer may keep

The renderer decides what to keep; the sketch has no say. It may keep:
- expanded brush geometry for a stroke whose data and transform scale are
  unchanged (the key omits the pixel ratio and uses exact values);
- a rasterized picture whose version, placement scale and rotation, pixel
  ratio, paper and fonts are unchanged; a move by whole device pixels reuses
  it. Kept rasters are 2048-device-pixel tiles aligned to the picture's
  origin; a picture with backdrop-reading content (`smudge`, `wet`) or
  effects that read their surroundings (hatching's tone range, wash bleed,
  blur near a tile edge) is kept as one raster for its whole extent;
- inside a lit group, the colour and material layers of a still subtree, but
  never the lit result while a light in the group changes.

Versions not asked for in the last two frames are kept while their
recordings fit an estimated 16 MB, the least recently asked for dropped
first; rasters not placed in the last two frames are kept while they and the
recordings they hold fit 32 MB, the least recently placed dropped first. So a
walk cycle's poses are recorded and rasterized once. All kept rasters stay
under 256 MB. A dropped version is recorded again when asked for. Cache keys
are 64-bit hashes of recorded data; a collision is the accepted risk. A
picture that measured text is recorded again when fonts finish loading
(browser).

**Cache equivalence.** Within one runtime on one machine, a frame rendered
with caches, without caches, and after waking gives the same bytes, headless
and in the browser, including after a new GPU device.

## Sleep (browser)

- Offscreen, a figure stops its loop at once. After two seconds offscreen it
  releases its GPU resources (kept rasters, pooled textures, caches), keeping
  the model, params, frame counter, randomness and the last scene.
- Waking re-renders the kept scene without calling `draw`, so logs and
  snapshots neither repeat nor go missing. A resize re-places controls without
  calling `draw`. Web fonts finishing loading call `draw` again; that frame's
  logs can repeat.
- One GPU device per page, shared by every figure and destroyed with the last
  one. A lost device shows a notice and is recreated on the next wake or
  click.

## Testing mode

Headless rendering is testing mode. Its checks name the node by its path
(`group "room" > place "citizen" at (240,360) > picture "citizen" {…} > circle #4`)
and, for most, the sketch line that made it.

| Check | Kind |
|---|---|
| Faint brushed marks (a readback of each mark's strongest pixel, before group and placement opacity) | warning |
| Labels overlapping in one frame (`overlay` text excepted); a missing glyph; an unknown font family | warning |
| Drawings off the canvas on every frame; unboxed text across the canvas edge | warning, after the run |
| A node made and not returned (at most 8 a frame) | warning |
| A picture recorded differently with the same deps (each picture is recorded again every frame and compared) | warning |
| A picture key that records a new version in every frame for over 30 frames, most of those from 30 frames ago not asked for again (poses that come back within half a second do not count) | warning |
| A placement at a new scale or rotation in each of the last 3 frames | hint |
| A picture on its own paper placed in a paper scope with other paper | hint |
| `light` outside a lit group or in mask art; a lit group with no light | warning (also in the browser) |
| A `pixels` fill left fully transparent | warning |
| Non-plain `deps`; `control`, `cursor`, `log` or `snapshot` in a picture body; `smudge`/`wet` with effects, blend or erase; a node from an earlier frame; a child that is not a drawing | error |

The browser shows the recorder's warnings in the console without call sites.

## Parity

Three measures, never mixed. From
`beebox/docs/plans/canvas-loop-scene/parity-criteria.md`, which holds the
reasoning:

1. **Repeatability.** Within one runtime on one machine, two renders of a
   scene are byte-identical, and cache equivalence holds.
2. **Appearance across runtimes** (headless against browser, same pixel
   ratio): flat fills, plain strokes, gradients, text and compositing have 99%
   of pixels within 4/255, excluding a 1-pixel band along edges; antialiased
   edges differ by under 0.15 coverage on average; brush marks, paper, wash
   and hatching have the same character by eye, mean luminance within 3% and
   texture contrast within 15% on 4× crops; lighting differs by under 3/255
   on average with no banding.
3. **Stability over time.** Still parts of a scene do not change frame to
   frame; a moving brushed shape's texture moves with it; a small edit
   changes only the pixels that shape and its effects reach.
