# opus-b: account of the Stage 2 probe

Three sketches: `market.ts`, `night-room.ts` (reuses the market vendor),
`figure.ts`. All three type-check. I read only the draft, `scene-api.ts`,
`TEA.md` and `BRUSHES.md`.

## Natural, written without thinking

- Shapes, styles, brushes, gestures, `at`, `clip`, text: unchanged and fluent.
  `cap: "round"` on the pendulum rod went in without a second look.
- `v.picture({ key, deps, width, height }, body)` returning a handle, then
  `v.place`: easier than `sprite` + `image`, and `deps` is the right place for
  what used to be baked into the key string.
- A lit group: `group({ lighting })`, `v.light(...)` beside the lamp drawing,
  `material` in the style. Putting the light call inside `ceilingLamp()` next to
  the bulb felt right; the lamp is one component.
- `effects: { wash, paper }` on the outer group: one line made the room
  "watercolour". `textBounds` → `roundRect` → `text` for a label box.

## Reached for and did not find

- **Types.** `scene-api.ts` exports `View`, `Style`, `Material`, `Picture`,
  `Vec2`, but not `TextOptions`, `BrushPreset`, `DeepReadonly`, `ParamsDecl`,
  `ParamValues`. I imported them from `../../../core/tea.js`.
- **A material for a placed picture.** The vendor picture is shared with the
  unlit market, so it has no materials and in the room it is flat matte and
  casts no shadow. I wanted `v.place(pic, x, y, { material: { castsShadow: true } })`
  or a group-level default material. Putting materials in the picture would
  make every market placement warn ("material outside a lit group").
- **Interfaces as deps.** `Dep` needs an index signature, so an `interface Look`
  is not a `Dep`, and lint forbids the `type` alias that would be. I wrote
  `deps: [look.robe, look.trim, look.hat, look.skin],` and a new field on
  `Look` will go stale until testing mode catches it.
- **Paper for a picture.** I wanted to set grain once for the sketch.

## Where I guessed

- Calling `v.picture` inside `at`/a lit group: I assumed the body ignores the
  enclosing transform and lighting and only the `place` matters:
  `v.place(vendorPicture(v, SLEEPER), -VENDOR_W / 2, -VENDOR_H);` inside a
  scaled `at`.
- Light direction convention: `direction: Math.PI * 0.7` for a spot pointing
  down-left from the window, assuming canvas angles (y down, as `arc`).
- I put the spot light at the window centre, which is on the glazing bars
  (`castsShadow`). Does a light inside a caster block itself? Does `height`
  lift a light above 2D casters? The draft does not say.
- `market.ts`: I drew the lantern outside the washed group ("so its glow stays
  clean"). That also took it out of the breathing transform; the lantern
  floats beside the hand.
- Glow: window uses `effects.glow` plus `material.emissive`; the lantern uses
  a `blend: "add"` group with a glow. I did not know which is preferred.

## Rules I broke without meaning to

- **Paper scope (R9).** In `night-room.ts` I wrote `v.paper({ scale: 3, contrast: 0.8 })`
  at the top of the lit group and then placed `room-shell` and the vendor:
  both pictures use the default paper, not that one. I found this only while
  writing this account. In `market.ts` I had remembered, and repeated
  `v.paper(...)` inside each picture body, but the shared vendor picture
  still uses the default grain, so grain differs between stalls and vendors.
  A testing warning ("picture placed under `v.paper` it does not use") would
  have caught it.
- **Cost of breathing.** Vendors breathe with `scale: [1, breath]` around
  `place`, which changes the placement scale every frame; per section 6 the
  raster cannot be reused, so each vendor's bristle strokes re-expand every
  frame. Nothing in the code shows this; I learnt it from section 6.
- In `figure.ts` I wrapped one `roundRect` in a `group` just for a shadow
  (old habit). `style.effects` does it on the shape.
- Inside a picture body `v.width` is the picture width; in `market.ts`
  `width: v.width` outside and `v.rect(0, 280, v.width, …)` inside read the
  same name with two meanings. It worked only because they are equal.

## Compared with Canvas2D, p5, SVG

Better: no save/restore; effects, lighting and watercolour are declarative and
scoped; pictures with value `deps` replace manual offscreen canvases and key
strings; a light travelling with a picture is something none of them has.
Worse: cost is invisible (raster reuse depends on placement scale, the lit
room recomputes lighting on a 1200-px layer every frame because the lamp
flickers); scoping rules that are not in the call (paper, picture
coordinates, `v.width`) must be remembered; two ways to glow. Layering is
the same everywhere: vendors between counter and awning forced two pictures,
`market-back` and `market-front`.

## Changes I would make

1. Re-export every type a sketch needs from `scene-api.ts`.
2. Let `deps` accept interfaces (a generic constraint), or a lint exception.
3. `PlaceOptions.material` (or a group default) so an unlit picture can take
   light and cast shadows.
4. A `paper` option on `PictureOptions`, and a testing warning when a picture
   is placed inside a scope whose `v.paper` it ignores.
5. Document light `direction` convention, light-inside-caster, and how
   `height` relates to 2D shadows.
6. Say when to use `effects.glow` vs `material.emissive` vs a light.
