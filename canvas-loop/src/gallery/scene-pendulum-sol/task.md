<!-- The Stage 4 drawer brief as given (beebox/docs/plans/canvas-loop-scene/stage4/drawing-brief.md), except that the draft types file is named at its path now. This exercise is sketch 3, `pendulum-tea.ts`; the drawer wrote all three. -->

## You

You are an agent who draws with code. canvas-loop is a TypeScript library
where a sketch exports `init`, `update` and `draw`; `draw(v, model, params)`
calls drawing methods on `v`. A redesign is running as a spike: the calls
build a scene that a WebGPU renderer draws, with pictures, lighting and
painterly effects. We want to know how well it works for an agent who draws:
how natural the API is, how good the pictures can look, and how useful the
feedback is when something is wrong.

## Read, in this order

1. `beebox/docs/plans/canvas-loop-scene/scene-api-draft.md`: the API. Where it
   disagrees with today's docs, it wins.
2. `canvas-loop/src/core/tea.ts`: its types (in scene/api.ts when this was written; merged in scene core chunk 6). In a sketch, import
   them from `@ianbicking/canvas-loop` (`SceneView as View`, `Msg`,
   `ParamsDecl`, `ParamValues`).
3. `canvas-loop/TEA.md` and `canvas-loop/BRUSHES.md`: today's API, for
   everything the draft says is unchanged (shapes, text, brushes, gestures,
   params, controls).

Do not read `canvas-loop/src/examples/`, `canvas-loop/src/scene-draft/probe/`,
the plan's review and findings files, or other drawers' folders until you
have finished and written your account.

## Write three sketches

In `canvas-loop/src/examples/scene-drawers/<your-name>/`, three TEA sketch
files. Each exports `canvas`, `init`, `update`, `draw` and, where it has
controls, `params`. Real drawings, each about 80–250 lines.

1. **`market-tea.ts`, a market stall row.** Three vendors behind their
   stalls, painterly (brushes, washes), at least two vendors sharing one
   drawing in different colours. One vendor holds a lantern whose flame
   glows. Vendors move a little (breathing, a wave).
2. **`night-room-tea.ts`, a room at night.** A room wider than the canvas;
   the camera pans slowly across it. A ceiling lamp that flickers, a glowing
   window, furniture that casts shadows, a person. The whole room should look
   like a watercolour.
3. **`pendulum-tea.ts`, an educational figure.** A pendulum: a slider param
   for length, the period shown as a label in a box sized to its text, a
   faint trail of past positions, tick marks on a scale. Clean and readable
   rather than painterly.

## Render and look

Render with
`scratch/stage4/draw/render.sh <sketch.ts> <out-dir> --frames 90 --every 30`
(add `--scene` for the scene outline in the transcript, `--ratio 2` for a
sharper frame, `--events file.json` for scripted input). It writes PNG frames
and `transcript.md`, with warnings and errors. Put output under
`scratch/stage4/draw/<your-name>/`. The script waits for a GPU lock; only one
render runs at a time on this machine. Never start the renderer another way.

Look at your frames and revise. Aim for drawings you would be glad to show,
not lazy digital art. Use at most 25 renders in all.

Type-check from `canvas-loop/`:
`pnpm exec tsc --noEmit -p . 2>&1 | grep scene-drawers/<your-name>` must print
nothing.

## Then write an account

`canvas-loop/src/examples/scene-drawers/<your-name>/ACCOUNT.md`, honest and
specific, about a page and a half:
- What felt natural, and what you wrote without thinking.
- What you reached for and did not find (a call, an option, a rule).
- Where you guessed, and whether the render proved the guess right. Quote
  the line.
- The feedback loop: which warnings or errors you met, whether each told you
  what was wrong and where, and anything that went wrong silently.
- The look: what the renderer made easy to make beautiful, and what fought
  you. Name the frame file.
- Speed: how long renders took, and anything that seemed slow.
- Compared with drawing in Canvas2D, p5 or SVG: what is better, what is worse.
- Anything you would change in the API.

Name your folder by the model you are (`opus-a`, `opus-b`, `sol`). Do not
edit files outside your folder and your scratch output; if the renderer
itself is broken, say so in the account rather than fixing it.
