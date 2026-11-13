# alien-polyline — account

Final frame: cycle 6 (`history/cycle-6.txt`). After that render, I moved the antennae code into its own function to pass lint (`max-lines-per-function`), with no other change, and did not render again.

## What fought me

- **Closed-polygon seam with wobble.** In cycle 1 the head outline (an ellipse sampled from angle 0) had a small visible step at its rightmost point, where the polygon starts and ends. I expected a closed polygon with `wobble: 0.6` to wobble continuously around the loop. It looks like the wobble offset at the end does not match the start. My workaround was to start every oval at its bottom (angle pi/2), where the seam is less visible or covered. I did not check the library to confirm the cause.
- **Shading inside a clip covers the outline.** My first `inkShape` did fill and ink stroke in one `polygon` call, then drew shading inside `clip(shape)`. The clip includes the inner half of the stroke, so shading marks painted over it and thinned the line. That is correct behaviour, but easy to miss. Fix: fill, then clipped shading, then the outline as a separate `noFill` polygon. BRUSHES.md's "clip to the shape, then draw marks" example does not mention the order.
- **Visibility of brush marks depends on contrast and width.** The pencil brush at 2–4 px in a colour close to the fill is close to invisible at 1x. The pink pencil cheeks in cycle 3 nearly vanished: they came out as broken dotted lines. Short bristle marks on the limbs (9 px, 0.6 opacity, dark green over green) did not show until I darkened the colour, raised opacity and `load`, and moved the marks inward so the outline did not cover them. It took three cycles to get limb shading to read.
- **Lint preset rules.** `max-params` of 2, no default params, no generic `Error`, `toReversed` instead of `reverse`, and a 150-line function limit. These forced option objects and splitting `draw`. None of it was hard, but it cost a rewrite before the first render and one extraction after the last.
- I assumed `PathCommand` was not exported and derived it with `Parameters<Sketch["path"]>[0][number]`. It is exported from the package entry. README's Sketch API table does not list the exported types, so I guessed.

## What I wanted and did not have

- A way to see a zoomed crop without extra tooling. PIL was not installed. `sips` crop and resize worked, but a `--crop`/`--zoom` option on the CLI would make edge and texture judgement much easier.
- A polyline helper for smooth outlines: `oval`, a spline sampler, and an offset/tube builder. I wrote all three, about 80 lines. `curve()` exists, but this condition did not allow it for outlines.
- A soft, wide, low-contrast shading brush (airbrush/wash) for gradual shadows. Bristle is streaky by design and pencil is thin and grainy; neither gives a soft gradient.
- A quick way to test one brush setting in isolation without spending a render cycle.

## The path form

Specifying outlines as straight segments was fine once I had generators. In practice I never wrote individual points for curved outlines. I wrote control points for my own Catmull-Rom sampler (12 samples per span) or centre and radii for an ellipse sampler (~1 vertex per 3 px of perimeter). At 400×500 and that density, no facets show, even in a 3–5x zoom. The real costs:
- Boilerplate to build the samplers.
- The seam problem on closed shapes: where the polygon starts matters.
- The arm `tube()` (offset a centreline into a closed outline) gives a pointed cap at the shoulder if the start is not inside the body. Cycle 1 showed that spike.

The advantage: the points are plain data, so I could reuse them. The same arm centreline gave the outline, the clip region, and an offset shading stroke. I would choose it again only together with my own sampler. For one-off curves, `curve()` or beziers would be less code.

## Judging texture and edges from the frame

At 1x, the Read image is enough for composition, colour and whether shading is present. It is not enough for brush texture: pencil grain, bristle streaks and seam steps were visible only in 2.5–5x crops made with `sips`. I made those crops every cycle and they changed my verdicts: the cycle-1 seam and shoulder spike, and the cycle-4 limb shading that existed but did not read. Without zooming, I would have said "shading is faint" without knowing why.

## Process and result

The loop (intent, render, seen) kept me honest. Two changes made things worse: the cycle-3 pencil cheeks and the cycle-5 paler ground shadow. I only saw that because I wrote down what I saw before planning the next change. Six cycles were enough to fix the structural problems and get shading onto every part, but not to move far from the guide's vector look.

The result is a clean, accurate copy of the guide with even ink outlines, curved bristle-and-pencil volume on the head, a textured shadow side on the body, and lighter shading on the limbs. It is pleasant and reads as a hand-inked picture-book alien. It is still more "shaded vector" than a painted illustration: the fills are flat under the marks, and the limb shading is subtle. With more cycles I would add a soft wash layer and more varied ink line weight (heavier on the shadow side).
