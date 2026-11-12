# Account: alien-curve

## What fought me

- **No way to clip to a curve.** `clip(shape, body)` takes a polygon or `PathCommand[]`, but not the Catmull-Rom points I had just passed to `s.curve(points, true)`. To shade inside a part I wanted to write `s.clip(HEAD, …)` with the same points. A polygon clip through those points would cut corners off the smooth outline, so I copied the Catmull-Rom-to-bezier conversion into the sketch (`closedCurvePath`). The library has `curveCommands` in `src/core/contours.ts`, but the package does not export it.
- **Bristle preset defaults are faint for shading.** In cycle 1, bristle strokes at opacity 0.55 (with the preset flow 0.55) were almost invisible at 1x over the green fill. I needed opacity 0.75, flow 0.8, 22 bristles, load 1.4 and a darker shade colour before the shading showed. This is tuning, not a bug, but the first draft gave no hint which field mattered most.
- **Short bristle strokes look like ruled lines.** Three short horizontal pink bristle strokes for a cheek came out as a barcode of separate streaks with dry ends. The look suits a long stroke and does not suit a dab. I replaced the cheeks with a flat curve fill plus pencil.
- **A 3-point open curve made a V.** `curve([[180,213],[200,222],[220,213]])` for the smile gave a sharp corner at the middle point instead of a U. That follows from Catmull-Rom with clamped end points (the end tangents are short). Five points fixed it. This is predictable once known; a newcomer will not expect it.
- **Lint strictness.** The sketch lint allows at most 2 parameters and no default parameters, so my first helpers (`ellipsePts(cx, cy, rx, ry, n = 10)`, `outline(s, pts, weight = 3.2, closed = true)`) failed. Object parameters fixed it, at the cost of more verbose call sites.
- **My own mistake, not the library:** a stray `cat > /dev/null` in one shell command waited on stdin and timed out the cycle-2 render. The render itself takes about 4 seconds.

## What I wanted and did not have

- `clip()` that accepts curve points (or a `{ curve: points, closed }` shape), so the clip and the outline come from the same data.
- A soft or blended shading mark: a wide, soft-edged, low-flow stroke that fades to nothing at its sides. To approximate a gradient I stacked a wide low-opacity bristle stroke under a narrow stronger one.
- A scribble/hatch helper with jittered spacing and angle. My evenly spaced pencil hatch on the ground shadow looks mechanical.
- A way to see the frame at 2-3x zoom from the CLI. I cropped and upscaled with `sips` to judge texture.
- A pressure envelope expressed around a closed loop by angle or by "which side". I wrote `heavyAt(t)` (cosine keyframes) and had to work out where each loop's first point is so 0.3 means "lower-left" for an ellipse.

## The path form

Specifying outlines as `s.curve(points, closed)` worked well for this subject. The alien is built from ovals and soft tubes. For the ovals I generated points with an ellipse sampler; for the body, arms and legs I typed 4-12 points read off the guide, and the curve made them smooth without any control-point thinking. Changing the body from a box to a bell in cycle 4 was editing a list of 12 coordinates. The costs: corners are hard (the legs are rounded rectangles because a 4-point closed curve rounds every corner, which here was acceptable), a 3-point open curve bulges or pinches unexpectedly, and the curve passes through every point, so a single misplaced point creates a visible bump (the shoulder of the raised arm has a small one). I would choose it again for soft, rounded characters, and would want bezier or line segments for anything with straight edges or sharp corners.

## Judging brush texture from the frame

At 1x (400x500), I could judge whether shading existed and roughly where, but not its texture: bristle streaks, pencil grain and outline wobble all read as smooth tone. The zoomed crops (3x via `sips`) showed the bristle striations, the pencil hatch in the eyes and the outline weight change. Without the crops I would have under-judged cycle 1 as "no shading" and not seen that the cheeks were streaky. Edges of clipped shading were easy to judge; the ink outline covers them.

## How I feel about the process and the result

The loop was efficient: renders are fast and deterministic, and each cycle had a visible effect, so I could tell what each change did. The process was mostly about turning up contrast until the brushes showed, then making the shading fade instead of stripe. The result is a clean, faithful version of the guide, with ink that varies in weight, bristle shading that gives the head and body volume, and soft pink cheeks. It is closer to tidy digital clip-art with texture added than to a loose picture-book painting; the flat fills under everything keep it from looking painted. The last change (hatched ground shadow) made that part slightly worse, and I kept it only because the budget ran out.

Final frame: `<scratch>/alien-curve/cycle-6/frame-0000.png`
