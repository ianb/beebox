# opus-a: account of the Stage 2 probe

Three sketches, all type-check: `market.ts` (187 lines), `night-room.ts`
(147), `figure.ts` (124). `night-room/room.ts` imports the vendor from `night-room/market.ts` (moved into a folder after the probe, for the repo layout check).

## Natural, written without thinking

- Shapes, styles, `at`, brushes, gradients, `textBounds`, `control`: unchanged
  and automatic. Spreading a `material` into a style (`{ ...wood, ...OUTLINE }`)
  felt like any other style key.
- `picture` + `place` is `sprite` + `image` with a better key. "Two vendors,
  one drawing, different colours" became `deps: [look, castsShadow]` with no
  thought. Calling `v.picture(...)` every frame and trusting the version lookup
  felt right.
- `style.effects` on one shape: the window glow and the lantern flame needed
  no wrapper group.
- `v.light(...)` as an ordinary call in the body, its `energy` driven by the
  frame, was the most direct way to write a flickering lamp I know of.

## Reached for and did not find

- **`interface` values in `deps`.** `interface Look {…}` is not assignable to
  `Dep` (TS2322: no index signature). I wrote `type Look = {…}` and had to
  suppress `@typescript-eslint/consistent-type-definitions`. The draft's own
  `Material` is an interface, so I could not put a `Material` in `deps` and
  passed a boolean instead.
- **Everything from one import.** The brief says to import from
  `scene-api.js`, but `DeepReadonly`, `Msg`, `ParamsDecl`, `ParamValues`,
  `TextOptions`, `BrushPreset` and `Util` are only in `core/tea.js`.
- **A point in outer coordinates.** The flame must be drawn outside the washed
  group, at the hand. I had no way to ask where the hand is, so I repeat the
  whole transform chain: `standing(v, { i: 1, …, body: () => lantern(v, {
  frame, part: "flame" }) })`, with `lantern` split into `"body"` and
  `"flame"` passes. Canvas2D has `getTransform()`.
- **Opting one child out of its group's effects.** Same problem from the other
  side: "draw this above the wash" would remove the second pass.
- **One picture, lit and unlit.** The vendor needs `material: { castsShadow }`
  in the room and must not carry it in the market (it would warn). So the
  material became a dep and the picture has two versions.
- **Draw-side noise.** `flicker(frame)` is hand-mixed sines.

## Guesses

- `v.light({ kind: "spot", …, direction: Math.PI * 0.72, cone: 0.6 })`: I
  guessed radians from +x, clockwise (y down), as Canvas2D `arc`.
- `height: 140` on the lamp: the lighting is a top-down 2D model and my room
  is a side view. I guessed that height still reads as "softer, wider pool"
  and that the table's shadow falls away from the lamp in the picture plane.
- `v.paper({ scale: 4, contrast: 0.8, seed: 3 })` is the first call inside the
  lit, washed group's body. I guessed the group's own `effects: { paper: 0.5 }`
  uses that paper. R9 says "the scope's paper"; I cannot tell if that is the
  body's scope or the scope where the group is called.
- `v.rect(…, { fill: sky, material: { emissive: 0.9 }, effects: { glow: … } })`
  inside the lit group: I guessed an R2 shape layer still carries its material
  into the lit group's material layer, and the glow pixels count as emissive.
- `v.curve(flame, true, { fill: "#ffd36b", blend: "add", effects: { glow: … } })`:
  I read R2 as "the glow and the flame add together". Intended.

## Rules that confused me, or that I may have broken

- **Breathing defeats the cache.** I breathe each vendor with
  `scale: [1, breath]` around the placement. Section 6 reuses a picture's
  raster only when "placement scale and rotation" are unchanged, so every
  vendor replays every frame. Nothing warns. I would not have noticed without
  reading section 6 twice. The fix is to breathe by translating parts, which
  is less natural.
- **Decision 1 under that scale.** The flame's glow is under the same
  non-uniform breathing scale, so its blur is very slightly elliptical. Correct
  by the rule; surprising to write.
- **Effects order vs. draw order.** A shape-level glow inside a washed group
  gets washed (it is inside the layer). A group-level glow is drawn beneath,
  from the layer before effects. I had to work out which applied to the flame;
  I chose to move it out.
- **`background` and lit groups.** I kept `v.background` outside the lit
  group. Is a background inside a lit group lit? The draft does not say.

## Compared with Canvas2D, p5, SVG

Better: no `save`/`restore`; transforms end with their body; reuse keyed by
data instead of hand-managed offscreen canvases; lighting and watercolour on
any group, which none of the three has; CSS-like effects on one shape.
Worse: no way to read the current transform; effect scope is tied to draw
order and nesting, which forces duplicated transform chains; p5 has `noise()`.

## What I would change

1. Type `deps` so interfaces pass (for example `readonly unknown[]` checked
   at runtime), and re-export the TEA types from `scene-api`.
2. Add `v.toCanvas(point)` (current coordinates to canvas), or an
   `overlay(body)` that records at the current transform above the enclosing
   groups' effects.
3. Let a picture carry materials that are ignored without a warning when it
   is placed outside a lit group, so one version serves both.
4. Warn in testing mode when a picture's placement scale changes every frame,
   as section 10 already does for deps.
5. Document the light `direction` convention and what `height` means.
