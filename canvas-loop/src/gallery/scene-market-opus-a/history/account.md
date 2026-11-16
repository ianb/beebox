# opus-a: drawing account

Three sketches: `market-tea.ts` (178 lines), `night-room-tea.ts` (173),
`pendulum-tea.ts` (160). 14 renders of the 25 allowed. Frames are under
`scratch/stage4/draw/opus-a/`; the best are `market6/frame-0060.png`,
`room3/frame-0060.png` and `pend3/frame-0030.png`.

## What felt natural

The shape calls and the style-per-call rule. I wrote `PAINT(fill)` (ink
outline plus fill) and `DAB(color, w)` (bristle with jitter) once and used
them everywhere. `group({ lighting, effects: { wash, paper } }, body)`
around a whole scene was one line, and it moved the result from flat
digital fills to something that reads as painted (`market2/frame-0030.png`
against `market1/frame-0030.png`). `v.light` placed next to the lamp it
belongs to, `material: { emissive: 1 }` on the flame, and
`material: { castsShadow: 40 }` on a placement all did what I expected on
the first try. Pictures with `deps` for two vendors in different coats
were easy, and the `--scene` outline confirmed two versions of `"vendor"`
plus `"vendor-tall"`. `v.noise` for flicker and `tube` for arms needed no
thought.

## What I reached for and did not find

- `style.dash`. It is in the draft as unchanged and in TEA.md, but the
  spike throws `UnsupportedCallError: scene spike: line with style.dash is
  not supported yet`. I wrote a `dashed()` helper.
- A way to say "this layer fills the whole canvas". A wash group whose
  content stops at the canvas edge dries a ragged white deckle along that
  edge (`market4/frame-0089.png`, `room2/frame-0089.png` bottom edge). The
  fix was to draw the background 30–40 px past every edge. That is a
  reasonable rule, but nothing tells you; an option such as
  `wash: { edgesAtCanvas: false }`, or a doc line, would help.
- A label for an on-canvas control. Headless, `v.control("length", …)`
  draws a bare text box showing `1.2`, with no slider and no name, so I
  drew the label myself.
- Something between "per-shape material" and "whole picture": the bevel and
  relief I gave the armchair barely register at this light height. I could
  not tell whether I used them wrong or they are subtle by design.

## Guesses, and what the render said

- `v.at({ translate: [x + 50, COUNTER_Y], scale: [1, breath(phase)] }, () => v.place(pic, -50, -150, { material: { castsShadow: 40 } }))`
  — I guessed a per-frame non-uniform scale on a placement would be fine
  and might draw a performance hint. It rendered correctly and drew no hint.
- `v.light({ kind: "point", at: [lx, ly], height: 60, … reach: 420 })` with
  `ambient: "#5b6390"`: the first render had almost no visible pool. Darker
  ambient (`#3c4170`) and `energy` 2.6 made the lantern read. Energy 1 as "a
  normal lamp" is too weak against a mid-blue ambient.
- Lamp shade `fill: "#f0c27a"` with `emissive: 0.5–0.9`: rendered almost
  paper-white, as if transparent (`room1/frame-0000.png`). A more saturated
  `#e09a48` read as a lit shade. Emissive plus wash seems to lift light
  colours toward paper.
- The camera `at` outside the washed group, as section 4 says: the pigment
  moved with the room and did not swim. The guess was right.
- Spot light from the window pointing down (`direction: Math.PI / 2`,
  `cone: 0.9`): a faint cool patch on the sill, much weaker than I expected.

## The feedback loop

- One error, the `dash` one above. It named the call, the file and the
  line. Good.
- No warnings at all in 14 renders. Some of that is right. Some things went
  wrong silently:
  - The period label box ran off the right edge of the canvas
    (`pend1/frame-0030.png`). Text drawn at a point with no `w` has no box,
    so no overflow is reported, and the rounded rectangle behind it is
    unchecked.
  - Two hanging pepper strings were placed off canvas or behind the lantern
    by an offset bug (`market3`). Nothing tells you a shape fell entirely
    outside the canvas.
  - The scripted `param` event at frame 50 does not appear in the
    transcript, although TEA.md says param changes get a line. I confirmed
    it only from the control stand-in showing `0.5`.
- `--scene` was useful once, to check the picture versions. It is long
  (939 lines for 4 frames); a flag for the first frame only would do.

## The look

Easy to make good: a dusk palette under a lit group with a single warm
lamp. The light pool, the soft shadow of the lantern bearer cast up onto
the awning, and the wash's dark drying lines at colour edges did most of
the painterly work (`market6/frame-0060.png`). The watercolour room reads as
one picture rather than shapes on a background (`room3/frame-0060.png`).

What fought me: wash at `granulate: 0.7, blotch: 0.45` with `paper: 0.8`
turned walls into mottled plaster with stain-like blooms
(`room2/frame-0030.png`); half those values looked like paper. The
granulation speckle is strong at ratio 2 even at 0.35–0.6 and sits over
everything, sky included. Thin bristle strokes (peppers, curtains at 6 px)
fade to near nothing under the wash and lighting. My figures are simple; the
renderer did not limit them, my time did.

The clean pendulum figure was plain to make: no effects except two small
drop shadows, text measured with `textBounds` for the box.

## Speed

Each render took 1–2 s wall time for 90 frames at ratio 1 or 2, and 7 s
once when it waited on the GPU lock. That is fast enough that I never
batched changes to save renders. The transcript reports brush expansion
cache hits (474 strokes, 331 hits on frame 0 of the market); nothing seemed
slow.

## Compared with Canvas2D, p5, SVG

Better: lighting, shadows, glow, and wash are one option each; in Canvas2D
they would be hand-built compositing passes. Pictures with value `deps`
beat hand-managed offscreen canvases. Brushes beat anything p5 or SVG gives
by default. Determinism makes before/after comparison trivial.

Worse: no `dash` yet. The painterly effects are global to a group, so tuning
one wall's texture means splitting groups. Effects need slack past the
canvas edge that you learn by seeing the deckle. Lighting values (energy,
height, ambient) need two or three renders to calibrate, where a 2D fill
colour does not.

## What I would change

1. Implement `dash`, or remove it from the scene types until it exists.
2. Warn when a shape or text lands entirely off canvas, and when unboxed
   text crosses the canvas edge.
3. Write the `param` event line in the spike transcript.
4. Either let a wash group treat the canvas edge as continuous, or say in
   the doc to draw past it.
5. Give headless control stand-ins the param's `label` and draw sliders as
   sliders.
6. Document a starting point for lighting: an ambient and energy pair that
   gives a visible lamp pool on the first try.
