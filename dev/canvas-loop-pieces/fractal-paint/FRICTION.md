# Fractal paint: friction log

What got in the way while building `fractal-paint` (drag to paint; each
finished stroke grows copies of itself through maps made from its own shape:
branch, gasket, spiral, mandala). Each entry: what I tried, what happened,
the workaround, a suggested library change.

## P1. A key cannot set a param (the panel goes stale)

- Tried: keys 1–4 choose the rule, `p` the palette, as well as the panel's
  `rule` and `palette` selects.
- Happened: `Util` has no way to set a param, so a key cannot move the
  panel's select. The model has to hold the rule and palette itself, and the
  panel then shows a value the sketch no longer uses.
- Workaround: `model.rule` and `model.palette`, set by a `param` msg or a key;
  the canvas shows the current rule in a small caption.
- Suggest: `u.setParam(name, value)` in `update` (validated like a param
  event, sent to the host as a param change), or say in TEA.md that a param
  is input only and a sketch with keys for the same choice keeps it in the
  model.

## P2. A drag scripted with `mousepath` captures every frame of the drag (fixed in the library)

- Happened: the capture policy takes a PNG of every frame that ran an event,
  and each `mousepath` move is an event, so a 150-frame hover writes 150
  images (the forest story wrote about 200). The transcript is long and the
  snapshots I asked for are lost among them.
- Workaround: none needed for correctness; I read the labelled snapshots.
- Fixed: the moves between a `mousepath`'s first and last are quiet and do
  not force a capture; the ends still do.

## P3. Presented frames below rAF, with nothing new to draw (fixed in the library)

- Measured: painting with every rule, rAF steady at 60 (p95 17.6 ms), yet
  `surface.presents` ran 45–54 a second, and stayed there after the
  painting stopped and no picture was new. Per-picture costs were a few
  ms a second; each present took about 1 ms.
- Cause: `surface.records` equalled presents, and both fell short of rAF.
  The runtime runs a fixed 1/60 s step from rAF timestamps, which in Chrome
  wander (a 15.2 ms frame, then 18.2 ms). With the step clock's remainder
  low, the short frame ran no step and drew nothing, the long one ran two.
  Whether a page load landed in that phase was luck: the forest's first
  run showed 60, the paint page 45–54.
- Fix (canvas-loop, "Steady 60 Hz frames"): a frame interval within 2 ms of
  a whole number of steps counts as exactly that many. After: 60 presents/s
  while painting every rule; rAF p95 17.6 ms, p99 18.2 ms, 2 of 563 drag
  frames over 20 ms.
- Batching chain steps (one step every 3 frames, holding every generation
  due by then) also cut how often the sheet's picture is drawn again.

## What worked without friction

- The picture chain from the `paint` example carried over directly: one
  chain step per generation of one stroke keeps every frame to one placed
  picture plus the live stroke, and a growing stroke costs one generation's
  record and raster per step (headless, under 10 ms each for these).
- `v.at({ matrix })` takes the IFS products as they are; stroke widths and
  brush marks follow the matrix's scale, so deep copies thin by themselves.
- `wet` inside a chain step mixes with the earlier steps it is laid over,
  since the step's body places the step before it.
