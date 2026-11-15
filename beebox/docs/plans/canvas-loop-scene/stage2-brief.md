# Stage 2 drawer brief

What each Stage 2 drawer was given (2026-11-15). Part of
`beebox/docs/plans/canvas-loop-scene.md`, Stage 2: a paper probe of the scene
API draft 2.1. Nothing renders yet; this tests whether the API is natural to
write, not how the pictures look.

## You

You are an agent who draws with code. canvas-loop is a TypeScript library
where a sketch exports `init`, `update` and `draw`, and `draw(v, model)` calls
drawing methods on `v`. A redesign is proposed: the calls stay much the same,
but they build a scene that a renderer draws later, and there are new
features (pictures, lighting, painterly effects). We want to know how natural
the proposed API is to write, before anyone builds it.

## Read, in this order

1. `beebox/docs/plans/canvas-loop-scene/scene-api-draft.md`: the proposal.
   Where it disagrees with today's docs, it wins.
2. `canvas-loop/src/scene-draft/scene-api.ts`: its types. Your code must
   type-check against them.
3. `canvas-loop/TEA.md` and `canvas-loop/BRUSHES.md`: today's API, for
   everything the draft says is unchanged (shapes, text, brushes, gestures,
   params, controls).

Do not read the review files, the examples folder, or other drawers' folders
until you have finished your own sketches.

## Write three sketches

In `canvas-loop/src/scene-draft/probe/<your-name>/`, three files. Each exports
`draw(v: View, model: Model)` (import `View` and other types from
`../../scene-api.js`) and a `Model` interface, and may export helpers. Write
real drawings, not stubs: each about 80–200 lines.

1. **`market.ts`, a market stall row.** Three vendors behind their stalls,
   painterly (brushes, washes), at least two vendors sharing one drawing in
   different colours. One vendor holds a lantern whose flame glows. The model
   has a frame counter; vendors move a little (breathing, a wave).
2. **`night-room.ts`, a room at night.** A room wider than the canvas; the
   camera pans with `model.cameraX`. A ceiling lamp that flickers, a glowing
   window, furniture that casts shadows, a person (reuse something from
   `market.ts` if you like). The whole room should look like a watercolour.
3. **`figure.ts`, an educational figure.** A pendulum: a slider param for
   length (a control over the canvas), the period shown as a label in a box
   sized to its text, a faint trail of past positions, tick marks on a scale.
   Clean and readable rather than painterly.

Check from `canvas-loop/`:
`pnpm exec tsc --noEmit -p . 2>&1 | grep scene-draft/probe/<your-name>`
must print nothing. You cannot render; nothing implements the API yet.

## Then write an account

`canvas-loop/src/scene-draft/probe/<your-name>/ACCOUNT.md`, honest and
specific, about one page:
- What felt natural, and what you wrote without thinking.
- What you reached for and did not find (a call, an option, a rule).
- Where you guessed, and what you guessed. Quote the line.
- Rules in the draft that confused you, or that you think you broke without
  meaning to (pictures and `deps`, effects order, what isolates, lighting
  scope, coordinates of effects).
- Compared with drawing in Canvas2D, p5 or SVG: what is better, what is worse.
- Anything you would change in the API.

Name your folder by the model you are (`opus-a`, `opus-b`, `sol`).
