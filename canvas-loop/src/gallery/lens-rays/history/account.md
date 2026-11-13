# lens-rays: account

## What a learner sees and does

A 960×640 figure. The header has the title, a one-line instruction ("Drag the
object along the axis; drag its tip to change its height"), a **Lens** select
(converging / diverging) and a **Focal length f = [10] cm** field (5–30) placed
in the drawing with `v.control`.

The diagram is a white box on a faint 5 cm grid: the principal axis, the lens
(biconvex or biconcave outline with a dashed centre plane), F, F′, 2F and 2F′
marked on both sides, and a dark object arrow. A grip with ◀ ▶ arrows sits at
the object's foot (drag it to move the object along the axis); a ring around
the tip (drag it to change the height and position). Both light up yellow on
hover and while dragging. Distance snaps to 0.5 cm, and to F and 2F within
0.6 cm, so "object exactly at F" is reachable by hand.

From the tip come the three principal rays in orange, green and blue, each with
a direction chevron, and a legend that names them ("parallel to the axis, then
through F′", "through the centre, straight on", "through F, then parallel"; the
diverging wording is "away from F′" / "towards F"). When the image is virtual,
the rays' backward extensions are dashed in the same colour, and the
"through F" ray gets a dashed construction line from F to the tip. The image is
a violet arrow (solid for real, dashed with a hollow head for virtual),
labelled "image (real)" or "image (virtual)". u and v dimension lines run along
the bottom of the diagram (v in violet, pointing left when negative). If the
image falls outside the box, a note says "image off the diagram →".

Object at F of a converging lens: rays 1 and 2 leave parallel, ray 3 is listed
as "(none: the object stands on F)", a red note in the diagram says "the rays
leave parallel: they never meet", and the cards say v = ∞, NO IMAGE.

Below, three cards:

- **Measurements**: u, v, f (signed), m = −v/u, object and image heights.
- **Thin-lens equation**: 1/f = 1/u + 1/v as stacked fractions, the same with
  the numbers substituted, then 1/v = 1/f − 1/u = 0.06 so v = 16.7 cm, and a
  line stating the real-is-positive convention.
- **The image**: chips REAL/VIRTUAL, UPRIGHT/INVERTED,
  MAGNIFIED/DIMINISHED/SAME SIZE, and the textbook case sentence ("Object
  between F and 2F: the image is beyond 2F′, real, inverted and magnified.").

The scripted session (480 frames) drags the object from 25 cm to 2F, 15 cm, F
and 6 cm, raises the tip to 8 cm, moves back to 30 cm, types f = 20 and 15,
switches to diverging, types 5, and switches back to converging. Each drag
reads `grab-object`, `drag-object`, `grab-tip` or `drag-tip` in the
transcript.

## What was easy

- TEA fit the problem. The model is three fields (u, h, a drag mode union);
  the optics are a pure function in `optics-tea.ts`, recomputed in `draw`.
  Typing f or switching the lens needed no update code.
- `v.control` put real inputs in the header with no layout work, and the
  headless stand-in showed the typed value in every frame.
- Events dispatch on known frames and the sketch's position math is the hit
  test, so every scripted grab connected on the first try. The engagement
  verdicts showed it without reading pixels.
- `v.path` with many `move`/`line` pairs made dashed lines and the grid one
  call each. `v.clip` kept the rays inside the box.
- Determinism: cycle 7 rendered byte-identical to cycle 6, so a no-change
  confirmation run was cheap to trust.
- `--zoom` and `cli zoom` found a fault I could not see at 1×: the white
  backings of the F′ and 2F′ labels cut a gap in a ray that passed 2 px under
  them.

## What fought me

- **No dashed strokes.** `Style` has no dash key. Dashed rays are a large part
  of a ray diagram; I built them from path pieces. That works, but a dashed
  line through a transform or along a curve would need more code.
- **No text halo.** Labels over rays need a backing. I wrote `tag()` (measure
  with `textWidth`, draw a rounded rect, then the text), recomputing the box
  from `align`/`valign` myself. `v.text` returns the bounds, but only after it
  has drawn, so the backing cannot go under the text from that call.
- **Label placement is the real work.** About six of ten cycles went to
  collisions: chevrons on F′, the image label over the 2F′ label, backings
  hiding rays, notes running off the canvas. Each was a small rule ("short
  image: label beyond the tip, clear of the F row"; "chevron at the first
  position not on a label"). The library cannot know these rules, but a
  collision readout (text boxes that overlap other text boxes) would have
  found several before I looked.
- **Glyphs.** "◀ ▶" rendered as empty boxes headless with Helvetica/Arial;
  the transcript said nothing. I replaced them with triangles. "F′", "−", "∞"
  rendered.
- **Fixed scale.** At 7 px/cm, f = 5 cm puts everything within 70 px of the
  lens, and the figure gets crowded. I kept a fixed scale so the learner sees
  F move when they type a new f; auto-fit would read more clearly at small f
  but hide that. That is a design choice, not a library problem.
- **Typecheck after lint.** Lint passed while `tsc` found three errors (a
  boolean `none` flag did not narrow the `Image` union). `run` does not
  type-check, so the renders were fine and the error showed up only when I
  ran typecheck.
- **The render-and-read loop** was fast (about 2 ms per frame, a few seconds
  per run). The cost was in the reading: each cycle meant opening 3–6 frames
  at 960×640, and small faults such as a chevron on a label, or a ray gap
  under a backing, show only when you crop. I captured only event frames
  (`--every 1000`), about 25 PNGs per run, and read the frames where the
  case changed.

## Cycles and why I stopped

10 of 16 cycles. **Why I stopped: satisfied.** In the last render, every
scripted case (beyond 2F, at 2F, between F and 2F, at F, inside F, image off
the edge, diverging at two focal lengths) draws correct rays, image and
numbers. Labels are legible and no ray is hidden. The known weakness is
crowding at f = 5 cm.

## What I would want from the library

1. A `dash` style key (`dash: [7, 5]`) for strokes, plain or brushed.
2. A text backing option on `v.text` (`halo: color` or `background: color`,
   with padding), drawn under the text in the same call.
3. A transcript warning when text uses a glyph the font lacks (missing glyph
   or fallback box).
4. An optional overlap check: with `--outline` or a flag, log text boxes that
   overlap each other, and text drawn over strokes, with their positions.
5. An arrowhead helper or a `markerEnd` style for lines; every diagram sketch
   rewrites the triangle math.
6. A way to measure text bounds before drawing (`v.textBounds(s, box,
   options)`), matching what `v.text` would return.
