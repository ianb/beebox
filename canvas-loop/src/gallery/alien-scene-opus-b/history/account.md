# Account: alien-scene-opus-b

Picture: "Hello, Earth!" At dusk, the green alien stands on a meadow and waves at the reader. His saucer hovers behind him on the right with a warm beam on the grass. A moon, stars, two pink-lit clouds, a row of dark trees and a small cottage with one lit window complete the scene. 800×600. Final frame: `cycle-10/frame-0000.png` in the round-2 scratch directory.

## What fought me

- **My own draw order under a transform, which I misdiagnosed twice.** In cycle 6 I added a heavy "accent" line on the body's shadow side. A doubled outline appeared. In cycle 6 I blamed hand-placed points and moved the accent onto the BODY points. In cycle 7 I blamed the lowered arm's edge and re-angled the arm. The real cause: I had inserted the accent just above a comment ("head over the body") that was by then inside `push(); translate; rotate(0.08)` for the head tilt, so the accent was rotated 4.6° about the neck. The zooms showed the symptom well but not the cause. I found it only when I read the code instead of the picture. This is not a library bug. It is a hazard of the mutable tier: a `push`/`pop` block with a rotate has no visible scope in the file, and code inserted by text anchor ends up inside it without warning.
- **Translucent colour over green turns brown.** I wrote `fill("rgba(240,130,130,0.55)")` for cheeks and expected pink. Over green it came out brown-grey. I fixed it with an opaque pink core and an airbrush blush around it.
- **Screen blend washes toward grey, not toward the colour.** An orange `wash` beam in a `screen` group over the blue-grey hill gave grey haze (cycles 2–4). Normal blend at lower group opacity gave yellow. That is how screen works, but the README describes `blend` only as "blend with the drawing underneath", which gave me no hint.
- **A circular radial gradient in a flat ellipse shows a hard edge.** `radialGradient` is concentric, so a wide, flat light pool cut the gradient off at the ellipse's top and sides. A set of horizontal `wash` strokes replaced it.
- **`curve` rounds away "bumps".** A closed `curve` through 10 points meant as a bumpy cloud gave a smooth lens. The right-hand cloud looked like a second flying saucer. I built the clouds from overlapping circles instead. I combined their `curvePath`s into one command list for `path` and `clip`, and the union filled correctly.
- **Weak marks give no error.** An airbrush at opacity 0.6 inside a group at 0.55 over a light area produced nothing visible (cycle 9). A cheek airbrush at 18 px did not show either (cycle 1). The only way to find these was to render and look. I had several cycles where the intended change was invisible.
- **Typecheck strictness came at the end.** `noUncheckedIndexedAccess` flagged `center[i]` in my `tube()` helper and `leg[0][0]`. Lint flagged `() => undefined`. The renderer ran fine with all of these, so I found them only after cycle 10. I fixed them with behaviour-preserving edits and did not re-render, to stay inside the 10-render budget. The final `sketch.ts` therefore differs from `history/cycle-10.txt` in those lines only.

## What I wanted and did not have

- A union or silhouette primitive, or clip-to-several-shapes, so one "scene light" pass can cover the whole figure. I got this effect per part (a multiply gradient inside each part's clip), which works but repeats the gradient 12 times.
- An offset or stroke-to-outline helper. I wrote `tube(centerline, width)` to make limbs that can be filled, clipped and outlined. Limbs are the most common shape in a character, so this belongs in the library.
- A way to make a stroke follow part of a closed `curve` exactly, for line-weight accents ("thicken this outline from point 0 to point 4"). An open `curve` through the same points is close but not identical at the ends.
- A way to view a mark's own bounds or alpha, or a warning when a mark's final opacity is below a few percent. It would have saved two cycles.
- Elliptical radial gradients (or a gradient transform).

## Brushes: what for, and what disappointed

- **ink**: all outlines (taper, thinning 0.55, wobble 0.3–0.6), grass blades (`taper-out`, thinning 0.8, thicker and longer toward the front: the best texture in the picture), wave ticks, a white rim highlight on the saucer. Reliable.
- **wash**: form shadows on the alien (multiply), warm rim light (screen), the beam, the light pool, value bands under the grass, dark patches on the moon, cloud undersides. The workhorse. Its slight paper mottling gives the green skin a painted look in the zoom.
- **airbrush**: moon glow, antenna-tip glows, firefly glows, the cool top-light on the head, the tummy lightening, cheek blush. Good for glows, but it disappears easily at moderate opacity.
- **chalk**: texture on the middle hill (good), a highlight on the dark trees (barely visible), and the cycle-1 belly ring (bad: it read as a printed "0").
- **pencil**: hatching on the alien's shadow side (multiply). On the body it reads as drawn pencil in the zoom and as faint texture at full size. The head contour hatching is still faint even at opacity 0.85 and weight 3.
- **bristle**: used in cycle 1 for horizontal meadow bands. It disappointed: the bands read as stripes with stair-stepped ends. I replaced it with ink blades and did not use bristle again.
- **marker**: not used.

## Did the zoom crops change my judgments?

Yes, both ways. Zoom 2 in cycle 1 showed the bristle bands' square, staircase starts, which at 1× looked like vague texture. Zoom 3 in cycle 2 showed that the saucer's legs ended in mid-air and that its dome outline cut across the dome. That led to the decision to make the saucer hover. In cycle 7 the zoom made the "second saucer" cloud obvious. The zooms also misled me: they showed the doubled line very clearly, and that clarity made me trust my visual guess about its cause twice. Some changes, such as the warm rim on the head and the head hatching, were visible only in zooms, so at full frame they contribute little. I should have judged those at 1× and made them stronger.

## How I feel about the process and the result

The loop worked well for big structural problems (draw order, a hard edge, a story-confusing shape). Each one was obvious in one render and fixed in the next. It worked badly for subtle tone: about a third of my changes were invisible on the first try, and with 10 renders each of those cost 10% of the budget. I also changed several things per cycle to save renders, which made some Seen notes about attribution less clean.

The result is a coherent, readable picture-book page: a clear character, a story (he has just been beamed down, the saucer is still lit, a cottage is nearby), dusk light that falls on him (cool left, warm right), and painted grass he stands in rather than on. It still lacks:
- A pose with real gesture. He is frontal and symmetrical below the head. The head tilt helps, but a picture-book illustrator would turn the body, lift one foot, or show the waving arm in motion.
- Brushwork in the large areas. The sky is a gradient, the hills and clouds are mostly flat fills with light texture, and the saucer is gradient fills. Only the grass and the alien's skin look painted.
- A brighter beam with a visible core and a stronger warm light on the alien from it. The beam is still a soft haze.
- Line variety: outside the shadow-side accents, the outline is one even dark line.
- The cottage and trees are simple stamped shapes.
