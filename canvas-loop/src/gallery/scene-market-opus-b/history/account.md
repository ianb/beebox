# opus-b: drawing account

Three sketches: `market-tea.ts` (212 lines), `night-room-tea.ts` (179),
`pendulum-tea.ts` (191). 16 renders. Output is in `scratch/stage4/draw/opus-b/`.

## What felt natural

The calls themselves. I wrote style objects, `at`, `group`, `clip(curvePath(…))`
followed by bristle strokes and an outline, and `tube` for limbs without
looking anything up. Today's vocabulary carries over unchanged.

- **Pictures with `deps`.** One `vendor(v, look)` function, recorded twice
  under key `"vendor"` with the coat colours as `deps`, placed at two stalls.
  It worked first time. Splitting the moving arms out of the picture came
  without effort: the doc says a body that changes every frame re-records, so
  the arms are drawn live in an `at` with a rotation.
- **`toCanvas`.** The lantern hangs from a hand at the end of two nested `at`
  rotations. `hand = v.toCanvas([0, 33]);` inside the forearm's scope returned
  the right point on the first render (market1/frame-0030.png).
- **Lighting as a group option.** One `group({ lighting, effects: { wash, paper } })`
  around the whole scene, a `v.light` next to the lamp's drawing, and
  `material: { emissive: 1 }` on the flame. A light inside the lamp's `at`
  follows the lamp. This is much less work than the multiply-then-screen
  recipe in BRUSHES.md.
- **`v.noise`** for flicker, with no state in the model.
- **Effects on one shape** (`effects: { glow }` on the moon, a `circle`) also
  worked first time.

## What I reached for and did not find

- **`dash`.** `UnsupportedCallError: scene spike: line with style.dash is not
  supported yet`, with two `at` lines (pendulum-tea.ts:83 and the caller at
  :126). I wrote a `dashed()` helper of short segments.
- **A way to keep a side view's shadows out of the sky.** The lighting is a
  top-down model: a caster's shadow falls across the picture plane away from
  the light. A stall post with `castsShadow: 120` cast a long dark band up
  into the evening sky (market4/frame-0030.png, the vertical seam near
  x = 450). At 40 the band is short, but there is still a smudge above the
  middle stall's right post (market6/frame-0030.png, about x = 455, y = 75–100).
  I wanted either `receivesShadow: false` on the sky, or a way to say that
  shadows fall only on the floor.
- **A wash that ignores the canvas edge.** `effects.wash` treats the canvas
  boundary as a region edge. A `background` gave a ragged dark rim with white
  showing through on all four sides (room1/frame-0000.png, market1). The fix
  was to draw the wall, floor and sky as rects 40 px past every edge, because
  `background` fills only the canvas. It works, but I found it by looking.
  Nothing in the draft says so.
- **A calibration for light `energy`.** See guesses.
- `material: lit ? { emissive: 0.9 } : undefined` does not type-check
  (exact optional properties), so I wrote two style objects. This is minor
  and is the same today.

## Guesses, and what the renders said

- `v.light({ kind: "point", at: [lx, ly], height: 40, color: "#ffc070", energy: 1.6 + flicker * 0.5, reach: 380 })`:
  **wrong.** Over an ambient of `#5a6288` the pool was nearly invisible
  (market1). It took `height: 90, energy: 4.5 + flicker * 1.5, reach: 520` and
  a darker ambient (`#3c4166`) before the stall read as lantern-lit
  (market4). "1 is a normal lamp" did not hold at this ambient. The low height
  was the main cause: at 40 the pool stayed small.
- `castsShadow` heights in a side view (`120` for posts, `90` for vendors):
  half right. The vendors and the reader cast good shadows on the wall
  (room5/frame-0045.png: the reader's shadow falls to the left and the table
  legs cast diagonal bands across the floor). The posts went into the sky, as
  described above.
- `paper: 0.6` on the room group: at ratio 1 it looked like paper
  (room1). At ratio 2 it became a coarse, mottled speckle over the whole wall,
  like stucco (room4/frame-0135.png). I first lowered `granulate`, which
  changed nothing visible, then lowered `paper` to 0.25, which fixed it
  (room5/frame-0135.png). I did not test whether the change comes from the
  ratio or from my reading of the smaller frames.
- Pendulum physics: at frame 30 with L = 1 m the label reads `θ = -1°`.
  T = 2.01 s, so a quarter period is 0.50 s = 30 frames. Correct
  (pend3/frame-0030.png).

## The feedback loop

- The `dash` error was the only error I met. It told me what was wrong and
  where.
- **Events path.** `--events scratch/…/pendulum-events.json` fails with a
  raw Node `ENOENT` stack, because `render.sh` changes directory to
  `canvas-loop/` before the runner reads the path. An absolute path works.
  The script resolves the sketch path itself but not the events path.
- **Silent: no performance hint.** Each vendor is placed inside
  `v.at({ translate, scale: [1, breathe] })`, so the placement scale changes
  every frame. Section 10 promises "picture re-expanded every frame because
  its placement scale or rotation changes" as a hint. None appeared, with or
  without `--scene`.
- **Silent: no param line.** The transcript for the pendulum run with a
  `param` event at frame 100 has no `param: length → 0.4` line. TEA.md says
  param changes get one. The frames show the change happened.
- **Silent: overlapping labels.** In pend1/frame-0149.png the `θ = -17°`
  label crosses the protractor's ticks and touches its `40°` label. No
  overlap warning appeared. The tick overlap is outside what the check
  covers. The overlap with `40°` is a few pixels, and I cannot tell whether
  that is under a threshold.
- No run gave a warning of any kind. My scenes may have been clean, but
  checking by eye found three problems that no warning reported: the shadows
  in the sky, the dark rim at the canvas edge, and the speckle.
- `--scene` gives a readable outline. I used it once, to check that the lit
  windows had their emissive material.
- The headless stand-in for the `length` control is a box showing `1`, not a
  slider. I declared no `control: "field"`, so I expected a slider.

## The look

The renderer made it easy to make the night room beautiful. With lighting,
wash, soft shadows and `toneCurve` on one group, flat fills and ink outlines
became a convincing watercolour interior: a warm pool under the lamp, a cool
wall, pigment pooling at the edges of the rug and sofa (room5/frame-0045.png).
The best market frame is market6/frame-0030.png: the lantern lights the bread
and the counter face, and the awnings take bristle texture well.

What fought me: the top-down light model in side-view scenes, the canvas-edge
rim from the wash, and light energy that needed three tries. Brush texture
inside fills (the bristle strokes clipped to coats) mostly disappears under
the wash and lighting. You see tone, not strokes.

## Speed

Renders were fast: 1.3 s for 90 frames with 4 captured at ratio 1 (market),
2.7 s at ratio 2, and 3.7 s for 271 frames with 7 captured at ratio 2 (room,
which pans across a 1400 px world). The GPU lock never made me wait. Nothing
seemed slow, and the speed let me iterate on taste instead of rationing
renders.

## Compared with Canvas2D, p5, SVG

Better: lighting, shadows, glow and watercolour come from a few options on a
group. In Canvas2D they take hand-built multiply and screen layers, and SVG
filters cannot do the lighting at all. Pictures with value `deps` are safer
than p5 `createGraphics` with manual invalidation. A style on every call
means no stray `fillStyle` state. Renders are deterministic, so a re-render
is a real test.

Worse: the light units have to be found by trial. The lighting has one
geometry, top-down, so a side view fights it. Some Canvas2D basics (dash)
are missing in the spike. The effects change the whole image, so a small
change (paper 0.6 against 0.25) can matter more than the drawing.

## What I would change

1. `material.receivesShadow` (or `receivesLight`), so a sky or backdrop can
   opt out.
2. A wash that treats the canvas edge as open, or a `background` inside a
   washed group that extends past the canvas.
3. A light energy rule in the docs, with an example ("energy 1 doubles the
   ambient at the light's foot"). Or report each light's peak contribution
   with `--scene`.
4. Log `param` events in the spike transcript, and emit the promised
   placement-scale hint.
5. `render.sh` should resolve `--events` the same way it resolves the sketch.
