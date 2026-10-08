# Working in canvas-loop

Use canvas-loop to see what a program draws (sketches, simulations, generative
figures, interactive canvas toys, `SketchFigure` embeds) without a live
browser. Real DOM or CSS app UI stays with the browse skill.

Reference, read before writing: [README.md](README.md) (mutable tier, `Sketch`
API, events file, capture policy, `<SketchFigure>`), [TEA.md](TEA.md) (TEA tier;
prefer it for new work and name the file `*-tea.ts` so its lint applies), and
[src/gallery/README.md](src/gallery/README.md) (exercise corpus).

## The loop

1. Write the sketch.
2. Render it: `pnpm --dir canvas-loop run cli run <sketch.ts> --events <events.json> --out out [--seed 42] [--frames 120]`.
3. `Read out/transcript.md`; its inline frame images render in `Read`.
4. Fix and re-run. A re-run reproduces the exact pixels.

Script interactions as events: one events file is a test, a reproduction, and a
demo. Events for frame N dispatch before frame N's `draw`, so compute click
coordinates from the sketch's own position math. Pin a frame the capture policy
would skip with `{ "frame": 40, "type": "snapshot", "label": "peak" }`.

Use determinism to verify. Add params that land frames on round instants (a
`timeScale`) or draw a readout of the model's belief, then spot-check chosen
frames against the closed form. Only aesthetic targets need many iterations.

## Gallery

To bank or re-run an exercise, follow [src/gallery/README.md](src/gallery/README.md):
`src/gallery/<slug>/` with `task.md`, `sketch*.ts`, `events.json`, `meta.yaml`,
one appended `runs.jsonl` line, then `pnpm --dir canvas-loop run gallery:check`
must pass before commit. Do not commit PNGs or transcripts.

## Audit norms

- Verify by frames, not logs. Logs state what the code believes; render-only
  bugs (stale labels, ghosting, phantom shapes) show only in the PNGs.
- Report only what a stranger would see in the image. Self-grades of a final
  frame drift from the pixels; ask for independent eyes on aesthetic results.
