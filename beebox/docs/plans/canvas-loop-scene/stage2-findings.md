# Stage 2: what the drawers found

Part of `beebox/docs/implemented-plans/canvas-loop-scene.md`, Stage 2. Three drawers
(two fresh Opus agents, one Codex gpt-6-sol) each wrote the three sketches in
`stage2-brief.md` against draft 2.1, without rendering, and wrote an account.
Their code and accounts are in `canvas-loop/src/scene-draft/probe/`. All nine
sketches type-check. Sol's code had five lint errors (more than two positional
parameters, `forEach`); the driver fixed them mechanically so the probe could
be committed.

## What worked

All three wrote the unchanged calls (shapes, styles, brushes, `at`, text,
`textBounds`, `control`) without looking anything up. All three found
`picture` + `place` with value `deps` easier than `sprite` + `image` with key
strings, and shared one drawing in several colours on the first try. `style.effects`
on one shape, a `light` call next to the lamp's drawing, and `effects: { wash,
paper }` on a group were each described as the most direct way they knew to
write that thing. Against Canvas2D, p5 and SVG, all three named the same
gains: no `save`/`restore`, reuse by data, lighting and watercolour on any
group.

## What they stumbled on, and the change for draft 2.2

| # | Finding | Drawers | Change in draft 2.2 |
|---|---|---|---|
| 1 | `scene-api` does not export every type a sketch needs (`TextOptions`, `BrushPreset`, `DeepReadonly`, `ParamValues`, `Msg`, `Util`) | opus-a, opus-b | The API module exports every type a sketch uses. |
| 2 | An `interface` is not assignable to `Dep`, and lint forbids the `type` alias that is; one drawer listed fields one by one, which goes stale when a field is added | opus-a, opus-b | `deps` is typed `readonly unknown[]` and checked when recorded: plain data only, else an error naming the bad value. |
| 3 | Paper scope (R9): a drawer set `v.paper` at the top of a group and placed pictures under it; they silently used the default paper. Another repeated `v.paper` in every picture body. A third could not tell which paper `effects.paper` uses | all three | A picture's brushes use the paper in effect **where `v.picture` is called**, and that paper is part of the picture's version (an automatic dep). `effects.paper` uses the paper in effect at the end of the group's body. Pictures still never depend on where they are **placed**. |
| 4 | Breathing by scaling the placement every frame stops raster reuse, and nothing says so | opus-a, opus-b | Testing mode adds a performance hint (not a warning): "picture X is re-expanded every frame because its placement scale changes". The docs show the cheaper pattern (move parts inside the picture). |
| 5 | One picture used both lit and unlit: materials inside it warn outside a lit group, so the material became a dep and made two versions; another drawer wanted to give an unlit picture a material when placing it | opus-a, opus-b | Materials outside a lit group are ignored without a warning (a light outside one still warns). `place` gains `material`: a default for the picture's shapes that have none. |
| 6 | Light conventions: which way `direction` points, what `height` means in a side view, whether a light inside a caster is blocked | all three | Documented: angles in radians from +x, clockwise (y down), as `arc`; `height` is distance above the picture plane and widens and softens the pool; casters never block a light that sits inside them. |
| 7 | Three ways to glow (`effects.glow`, `material.emissive`, a `light`) and no guidance | all three | A "Making something glow" section: emissive is not darkened by lighting, a light lights other things, a glow is a halo; a lamp usually uses all three; one worked example. |
| 8 | A glow on one shape inside a washed group gets washed; a group's glow is drawn beneath the group; which applies where was hard to work out | opus-a, sol | Documented with a picture in the docs (Stage 4); no rule change. |
| 9 | No way to draw at a point computed in another scope (the lantern flame outside the washed group, at the hand) without repeating the transform chain | opus-a | `v.toCanvas(point)` returns the point in canvas coordinates under the current transform (Canvas2D has `getTransform`). |
| 10 | No draw-side noise for flicker | opus-a | `v.noise(x, y?, z?)`: seeded value noise of coordinates, a pure function, so `draw` stays pure. Rhymes with p5 `noise`. |
| 11 | Is `background` inside a lit group lit? | opus-a | Documented: yes, like any shape, flat matte unless given a material. |
| 12 | `v.width` means the picture's width inside a picture body and the canvas's outside | opus-b | Kept; documented next to `picture`. |
| 13 | The slider value in `draw(v, model)` | sol | The brief's mistake: `draw` takes `(v, model, params)` as today. No change to the draft. |

## What this does not tell us

Nothing rendered, so nothing here judges the look (principle 2) or the cost
(principle 4). The Stage 4 drawing round, against a running spike, repeats
this with render cycles.
