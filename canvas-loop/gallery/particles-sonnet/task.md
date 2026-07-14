# Task

> Reconstructed (see `reconstructed: true` in `meta.yaml`) — the design issue
> records the task description and results but not the literal prompt text.
> This reconstruction follows the recorded description and the delivered
> sketch/events closely. The identical task was given in parallel to a fresh
> Opus agent — see `../particles-opus/`.

You have `TEA.md` as your only guide (the TEA tier's contract) — no existing
TEA sketch to copy from except the ported orbit toy it references. Build a
**particle fountain** as a TEA sketch, exercising every declared-param type:

- A moving emitter continuously spawns particles that fall under gravity and
  fade out over a finite lifetime.
- Declare params: `rate` (particles spawned per frame, a number — handle a
  fractional rate correctly, e.g. via a stochastic remainder), `gravity`
  (downward acceleration, a number), `trails` (motion-trail vs. clean redraw,
  a boolean), `palette` (particle coloring scheme, a select with at least two
  options), and `burst` (a trigger that instantly spawns a large batch).
- Direct manipulation stays outside the params system: **mousedown** places
  an attractor that pulls every live particle toward it, **mousemove while
  pressed** drags it, **mouseup** removes it. Show a marker while it's
  active.
- All state lives in `Model`; state changes only by `update` returning a new
  `Model`; the switch on `msg.type` must be exhaustive. `draw` only paints.
- Script an events file that exercises every param at least once (including
  the trigger) plus a full attractor press/drag/release sequence, and verify
  the result by reading the rendered transcript.

Report cycle-by-cycle honestly: what you tried, what the frames showed, and
what you fixed.
