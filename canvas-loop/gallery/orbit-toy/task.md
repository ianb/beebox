# Task

> Reconstructed (see `reconstructed: true` in `meta.yaml`) — the exact prompt
> text given to the agent was not recorded verbatim in the design issue, only
> paraphrased. This reconstruction follows the paraphrase and the delivered
> sketch/events closely.

You have the canvas-loop README only — no existing example sketch to copy
from. Build an **orbit toy**: a sun with three planets orbiting it.

Requirements:

- Three planets, each on its own circular orbit at its own radius and angular
  speed.
- **Click a planet to select it** — even while it's moving. Draw a highlight
  ring around the selected planet. Clicking empty space deselects.
- While a planet is selected, **ArrowUp speeds it up, ArrowDown slows it
  down**.
- A HUD in the top-left corner shows the current frame count and, when a
  planet is selected, its name and current angular speed (e.g. `selected:
  Earth  speed: 0.023`); otherwise `selected: none`.
- Write an events file that scripts a full test pass: select a planet by
  clicking it while it's in motion, nudge its speed a few times with the
  arrow keys, then deselect by clicking empty space. Verify the result by
  reading the rendered transcript, not by guessing.

This is the first agent exercise of the sandbox (no prior sketches exist to
imitate) — a test of whether the write → run → Read-frames → iterate loop
works at all before any other exercise is attempted.
