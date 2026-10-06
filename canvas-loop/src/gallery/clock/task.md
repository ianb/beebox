# Task

> Reconstructed (see `reconstructed: true` in `meta.yaml`) — the design issue
> records the intent behind the task ("designed to force visual iteration")
> and its classic traps, but not the literal prompt text. This reconstruction
> follows the recorded description and the delivered sketch/events closely.

Build an **analog clock** as a TEA sketch. This task is deliberately chosen
to hit the classic traps that make analog clocks visually tricky to get
right on the first try: the 12-at-top rotation offset (0 radians is usually
"3 o'clock", not "12 o'clock"), hour-hand minute-drift (the hour hand must
move gradually between hour marks, not jump), numeral centering, and drawing
order/layering (hands over face over numerals).

- Virtual time advances at a `timeScale` param (virtual seconds per real
  second) so you can speed through time to check specific clock faces.
- A `style` select toggles numerals on/off (`"classic"` | `"minimal"`).
- A `showDigital` boolean overlays an `HH:MM:SS` digital readout — this is
  your self-verification tool: use it to confirm the analog hands agree with
  the underlying time at chosen instants, without guessing from the drawing
  alone.
- All state lives in `Model`; state changes only by `update` returning a new
  `Model`; the switch on `msg.type` must be exhaustive. `draw` only paints.
- Script an events file, run it, and read the rendered transcript to verify
  the hands are actually correct — don't just trust the trig.
