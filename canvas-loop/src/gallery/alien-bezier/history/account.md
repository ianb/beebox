# alien-bezier — account

Final frame: `cycle-6/frame-0000.png` in the round's scratch directory (`round1/alien-bezier/cycle-6/`). After cycle 6 I made two lint-only edits to `sketch.ts`: I removed a `1.0` literal and moved the cheek colour into the `CHEEK` constant. The re-render is byte-identical to cycle 6 (checked with `cmp`), so `history/cycle-6.txt` is the pre-lint text of the same picture.

## What fought you

- **The lint preset, before the first render.** My first draft used ordinary positional helpers: `oval(cx, cy, rx, ry)`, `bristleShade(s, shape, color, strokes, weight, opacity)`, and `outline(s, shape, weight = 3.2)`. The preset rejects these with `max-params` (2) and `default/no-default-params`. To fix that, I rewrote every helper to take an options object and rewrote all the call sites. The rule is not wrong, but it costs time in an exploratory drawing loop, and the README does not mention it.
- **Small-shape shading did not behave as I expected.**
  - In cycle 4 I used the same `bristle` rim strokes on the 11–24px hands, feet and antenna balls as on the head. On those parts they rendered as two or three faint blotches, or as nothing. A bristle mark seems to need length to build tone. BRUSHES.md does not say this, and I only learned it from the frame.
  - In cycle 5, the flat-crescent fix failed because of my own geometry: a 3–5px offset is about the width of the ink outline, which covers it. This was not a library problem.
- **The outline pressure envelope was nearly invisible.** On the head I put a keyframe envelope (`HEAVY_BELOW`) on a closed path, expecting a visibly heavier lower line. Pixel sampling showed about 3px at the top and about 4px at the bottom. That is real but small at `strokeWeight(3.8)` with `thinning: 0.35`, and I could not see it at 1x. To map envelope positions onto a closed path, I had to know where my own path starts and which way it runs. For a hand-written path that is fine, but it is easy to get wrong.
- **Two small surprises:**
  - My first render failed because I redirected output to `$S/run1.txt` before the scratch folder existed. That was my shell redirect, not the CLI.
  - `Envelope`, `PathCommand` and `Sketch` are all importable from the package root, but I had to grep `src/exports/core.ts` and `src/core/tea.ts` to confirm that `Envelope` is the name of the pressure type.

I did not hit any library bugs.

## What I wanted and did not have

- **A way to shade the edge of a shape.** About half my code is crescent shading: rim strokes placed along an inset ellipse, or a shade fill with an offset base-colour oval inside a clip. A clip-difference (shape minus offset shape), or a "stroke the inside of this path at width W", would remove most of that code.
- **A zoom or crop option on the CLI.** I used ImageMagick to crop and enlarge regions so I could see the brush texture, and to sample pixels.
- **A note in BRUSHES.md** on the minimum mark length or width at which `bristle` and `pencil` read as texture rather than noise.

## The path form

Writing outlines as hand-placed `bezier`/`quad` commands worked well for this character, because it is made of ovals and sacks:

- The head is four cubic segments.
- The body is a tapered sack of four segments.
- Each arm is two beziers joined by short `line` caps that the hand covers.
- The legs are `quad` sides.

The guide's silhouette mapped onto control points with little trial and error. Cycle 1 already matched the pose, and I never moved an outline point after that. The control points also made the shading easier: I knew where each shape's centre, extent and start point were, so I could aim rim strokes and pressure keyframes at them. The cost is verbosity. True ovals I generated with a kappa (0.5523) helper, not by hand. I would choose this form again for clean, graphic characters. For looser, more gestural subjects I would want `curve` through points instead.

## Judging texture and edges from the frame

At the native 400×500, I could not judge brush texture reliably. The bristle shading read as soft tone, and I could not tell bristles from grain. To judge texture I cropped and enlarged to 3–6×. I misjudged once: zoomed, the pencil hatch on the feet looked *lighter* than the base, and pixel samples showed it was darker. After that, I checked every claim about thickness or tone by sampling pixels. Edges were easier: outline continuity, joins and covered seams were visible at 1x.

## How I feel about it

The process felt controlled. Each cycle changed one or two things, and I could say whether each change helped. Cycles 1–3 brought real gains: rim shading that hugs the edges, a highlight, a cast shadow under the head, and pink cheeks. Cycles 4–6 were mostly spent learning how to shade small parts. That fix works, but it is subtle at 1x. The result is a clean, friendly picture-book alien that stays close to the guide, with soft painted shading on the head and body, light pencil texture in the cheeks and on the feet, and an even ink line. Its weak points:

- The bristle highlight on the head reads as diagonal streaks rather than a sheen.
- The arms and legs have only a token stroke of shading.
- The line has less weight variation than real inking would give.
