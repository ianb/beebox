# Stage 1: the scene API, draft 1

Part of `beebox/docs/plans/canvas-loop-scene.md`, Stage 1. The types are in
`canvas-loop/src/scene-draft/examples/scene-api.ts`; seven example sketches that
type-check against them are in `canvas-loop/src/scene-draft/examples/`.
Nothing here runs yet.

## The stance: same calls, recorded

A sketch looks almost the same as today. `draw(v, model, params)` still calls
`v.rect`, `v.curve`, `v.text`, `v.at`, `v.group` with a style on every call.
The difference is underneath: each call adds a node to a **scene** instead of
painting. When `draw` returns, a renderer draws the scene: Skia headless, the
GPU in a browser.

Why keep the calls: agents already write them well. The path-form experiment
and 39 gallery exercises were done in this vocabulary (principle 5), and
styles, brushes and gestures were designed as plain data from the start. A
returned-value API (`h("rect", …)`, as Elm and React do) was considered; it
rhymes with UI frameworks, not with drawing APIs (Canvas2D, p5, Processing),
and agents draw in the drawing idiom. Composition still works the React way:
a component is a plain function that takes `v` and props (`lit-room/citizen.ts`).

## What changes for a sketch

| Today | Draft | Why |
|---|---|---|
| `v.ctx` | removed | The 10 files that used it are covered: plain drawing by existing calls, skew by `at`, pixel fields by `pixels`, hand-built lighting by `lighting` and `light`. |
| `v.cache(key, body)` | `v.picture({ key, deps, width, height }, body)` + `v.place` | One mechanism for "reuse this drawing". `deps` says what the drawing depends on, so a stale cache cannot happen silently; there is no size limit and no fixed position. |
| `v.sprite(…)` + `v.image(sprite, …)` | `v.picture` + `v.place` | Same; the renderer picks the resolution from where the picture is placed, so zooming stays sharp. |
| `v.paperTexture(n)` | `effects: { paper: n }` on a group | An effect like the others, scoped to a group. |
| `at` translate, rotate, scale | adds `skew` and `matrix` | Covers `v.ctx.transform`. |
| group effects: colour, blur, glow, shadow | adds `wash`, `hatching`, `paper` | Painterly effects on any group. |
| (none) | `style.effects` | Effects on one shape without writing a group. |
| (none) | `group({ lighting })`, `v.light`, `style.material` | Lighting (rhymes with Godot 2D: lights with `energy`, `color`, `height`; occluders as `castsShadow`). |
| (none) | `v.pixels(options, fill)` | A picture from computed pixels, recomputed only when `deps` change. |

Everything else stays: shapes, paths, curves, text and its measurement,
gradients, brushes, gestures, `clip`, `mask`, `tween`, `control`, `cursor`,
`log`, `snapshot`, `debugBox`, `paper`, `tube`, `offset`.

## How drawing composes (the renderer's contract)

These rules are the semantics both renderers implement. They follow CSS where
CSS has an answer, because agents know it.

1. **`at` transforms; `group` isolates.** `at` changes coordinates only: what
   it draws composites with its siblings as if drawn directly. `group` draws
   its body into its own layer, then composites that layer once. Today's rule,
   kept (`canvas-loop/src/core/painter/core.ts:129`).
2. **Inside a group, in order:** draw the body; apply effects in their fixed
   order (colour adjustments, blur, wash, hatching, then glow and shadow drawn
   beneath); apply `clip`; apply `mask`; apply `opacity`; composite with
   `blend`. This is CSS's order for `filter`, `clip-path`, `mask`, `opacity`,
   `mix-blend-mode`. For another order, nest groups.
3. **A shape with `effects`** is a group of one: `v.circle(…, { effects })`
   means `v.group({ effects }, () => v.circle(…))`.
4. **A shape's `blend` and `erase`** apply to the shape as one unit: fill and
   stroke first combine, then blend with what is below. (Today fill and stroke
   blend separately; the coverage matrix notes this change.)
5. **Backdrop reads stop at the nearest group.** `smudge` and `wet` read what
   was drawn earlier inside their nearest enclosing group (or the whole picture
   at the top level). Blends do too: a `multiply` shape multiplies with what is
   below it in its group. This is CSS's isolation rule. It is what lets a
   renderer cache a group without changing how it looks.
6. **Pictures are isolated.** A picture is recorded in its own coordinates and
   composited as one layer where it is placed. A smudge inside a picture
   cannot read the scene behind the placement.
7. **Effects work in the group's own coordinates.** Pigment noise, hatching
   lines and paper grain inside a group move with the group's transform. A
   panning camera (an `at` inside the group) is different: put the camera
   outside the group to keep the pigment fixed to the world (`lit-room/room.ts`
   shows the pattern).
8. **Paper grain for brushes** is anchored to the coordinates of the nearest
   picture, or the scene. A picture carries its grain with it, like a paper
   cut-out.
9. **Lighting** applies inside a group with `lighting`. A `v.light` anywhere in
   that group (at any depth, in its current coordinates) lights everything in
   the group. Shapes take light by their `material`; without one they are flat
   matte. A lit group nested in another uses only its own lights. A `light` or
   `material` outside any lit group draws nothing and warns in testing mode.
10. **Caching never changes the look.** Because of rules 1, 5 and 6, a
    renderer may keep any group or picture as a texture and reuse it, at the
    resolution it needs. Whether it does is invisible to the sketch.

## Identity, invalidation and sharing

- **Identity:** a node is the same node across frames when it sits at the same
  position in the tree. A picture is identified by its `key`; a control by its
  param name. (React's rule, without sketch-supplied keys on ordinary nodes:
  drawings rarely reorder, and caching keys on content, below.)
- **Invalidation:** a renderer reuses work for a subtree whose recorded data is
  unchanged since the last frame. It compares data, not identity, so a sketch
  cannot make a cache stale.
- **Sharing:** a picture's body runs only when its `key` or `deps` change.
  Placing one picture three times draws one recording three times
  (`lit-room/citizen.ts`). `deps` are compared by value, as React's `useMemo`.

The cost of rebuilding a scene every frame, and of comparing it, is measured
in Stage 3 (the particles example is the worst case).

## Measurement stays immediate

`v.text` returns its bounds; `v.textBounds`, `v.textWidth`, `u.textWidth` and
`u.textBounds` answer during `draw`, `init` and `update`, as now
(`canvas-loop/TEA.md:190`). The recorder measures with the runtime's fonts at
the moment of the call; the renderer draws with the same fonts.
`chem-figure.ts` sizes a label box this way.

## Calls that are not drawing

`v.log`, `v.snapshot`, `v.cursor`, `v.debugBox` and `v.control` are outputs of
one `draw` call, not scene nodes. Rules:
- Each runs once per `draw` call, in call order, as today.
- Inside a picture body they run only when the picture records (when its key
  or deps change). `control` inside a picture body is an error: a control must
  appear every frame it shows.
- Waking from sleep re-renders the last scene; it does not call `draw` again,
  so it neither repeats nor loses these outputs.

## Brushes

- A brushed stroke is a node with its brush and gesture. A shared CPU step
  expands it into dabs, outlines or bristle runs; each renderer draws those.
  So the random character of a mark is the same in both renderers.
- Brush randomness is seeded from the stroke's points in scene coordinates
  (today: device pixels, `canvas-loop/src/core/brush/render/mark.ts:100`), so
  pixel ratio and caching do not change a mark's texture.
- Brushes may be reimplemented for the GPU and look different from today; they
  are judged by eye (Checkpoint 0 decision).

## Testing mode (headless)

Warnings and errors name the node by its path in the scene, for example
`group > picture "citizen" > circle #4`:
- **Warnings:** faint marks (as now); text that overflows its box (as now); a
  wash or hatching effect on a group whose content it cannot show (for example
  hatching over a group with no tone change); a `light` or `material` outside a
  lit group; a picture recorded every frame because its `deps` change every
  frame.
- **Errors:** `control` inside a picture; an unknown effect or style field; a
  `pixels` fill that writes the wrong length.
- **New tools:** `run --scene` adds each captured frame's scene, as an indented
  outline, to the transcript; `cli diff` gains a scene diff (nodes added,
  removed, changed) beside the pixel diff, so an agent sees what its edit
  changed in the drawing's structure as well as its pixels.

## Coverage: every row of the matrix

Every row of `coverage-matrix.md` has a place:

| Matrix rows | Draft representation |
|---|---|
| Shapes, paths, curves, plain strokes, gradients, background | unchanged calls; recorded as shape nodes |
| Brushes: ink, marker, pencil, chalk, airbrush, wash, bristle | unchanged style fields; shared CPU expansion |
| Brushes: smudge, wet | unchanged; backdrop rule 5 |
| Brush fields: grain, hue jitter, pressure, wobble, seed, faint | unchanged; seed in scene coordinates |
| Effects: colour adjustments, blur, glow, shadow | unchanged group effects; also on shapes |
| Compositing: opacity, every blend, erase, mask, single and union clip | unchanged calls; rules 1–5 |
| Paper grain, paper texture | `v.paper` unchanged; `paperTexture` becomes `effects.paper` |
| Text, text measurement, text warnings | unchanged |
| Cache, sprite, image | `picture`, `place` |
| Controls, cursor, log, snapshot, debugBox | unchanged; outputs, not nodes |
| New: light, material, wash effect, hatching effect, pixels, matrix and skew | new fields and calls above |

No row is dropped. Changes in behaviour, for the boxholder to accept: a shape's
fill and stroke blend as one unit (rule 4); backdrop reads stop at the nearest
group (rule 5; today a smudge inside a group reads only the group's layer
already, so few sketches change); brush seeds move to scene coordinates (all
brushed baselines change texture once).

## Open questions for Stage 2 and 3

- **Do agents find `picture` + `place` natural**, or do they want `v.cache`
  back for "this background never changes"? (Stage 2.)
- **Effects as one object with a fixed order**, or an ordered list as PixiJS
  `filters`? The draft picks the object: one way to write it, and nesting for
  the rare other order. (Stage 2.)
- **Lighting vocabulary:** `bevel` and `relief` from outlines may look generic.
  The lit-room probe decides whether materials need a normal-map input.
  (Stage 3.)
- **Scene rebuild cost** for the particles case. (Stage 3.)
