# Working in canvas-loop

Use canvas-loop to see what a program draws (sketches, simulations, generative
figures, interactive canvas toys, `SketchFigure` embeds) without a live
browser. Real DOM or CSS app UI stays with the browse skill.

Reference, read before writing: [TEA.md](TEA.md) (sketch contract; `draw`
returns its drawing; name files `*-tea.ts`), [README.md](README.md) (run,
events, capture, `<SketchFigure>`), [BRUSHES.md](BRUSHES.md) (brushes,
effects, lighting). The examples in `src/examples/` show how the pieces
fit. For work on the renderer: [RENDERER.md](RENDERER.md).

## The loop

1. Write the sketch.
2. Render it from the repo root: `pnpm --dir canvas-loop run cli run <sketch.ts> --events <events.json> --out out [--seed 42] [--frames 120]`.
   `--dir` runs the command in `canvas-loop/`, so the paths are relative to it. Each run empties `--out` first.
   `run` first type-checks the sketch, its imports and its exports; a type error stops the run and is listed in the transcript.
3. `Read out/transcript.md`; its inline frame images render in `Read`.
4. Fix and re-run. A re-run reproduces the exact pixels.

If `CANVAS_LOOP_CHECKPOINTS` is set, each render is saved as a checkpoint; add
`--note "what you changed and why"` to each `run` so the record reads as a story.

Script interactions as events: one events file is a test, a reproduction, and a
demo. Name what a click should land on and aim at it with `"target"`; for an
unnamed spot, compute coordinates from the sketch's own position math (events
for frame N dispatch before frame N's `draw`). Pin a frame the capture policy
would skip with `{ "frame": 40, "type": "snapshot", "label": "peak" }`.

Use determinism to verify. Add params that land frames on round instants (a
`timeScale`) or draw a readout of the model's belief, then spot-check chosen
frames against the closed form. Only aesthetic targets need many iterations.

## Examples

Add an example only when it shows what the docs do not. An example is one
sketch, `src/examples/<name>-tea.ts`, with no sibling helpers, and one events
file, `<name>-tea-events.json`, whose last frame holds a snapshot. Its header
comment opens with its one point and names the doc section that links it.
`draw` returns lists (`.map`, `&&`, components), and a pointer hits by name.
Add it to `src/browser/app/registry.ts`, then run
`pnpm --dir canvas-loop run examples:check` before commit: it fails on a
warning and on a scripted input that reads `(unhandled)`. Do not commit PNGs
or transcripts.

## GPU

- Run one heavy GPU process at a time on a machine (`examples:check`, the test
  suite, long renders): several at once have crashed the GPU driver.
- A test that opens a GPU device goes in a `*.gpu.test.ts` file. `pnpm test`
  runs those one at a time, after the rest.

## Audit norms

- Verify by frames, not logs. Logs state what the code believes; render-only
  bugs (stale labels, ghosting, phantom shapes) show only in the PNGs.
- Report only what a stranger would see in the image. Self-grades of a final
  frame drift from the pixels; ask for independent eyes on aesthetic results.
