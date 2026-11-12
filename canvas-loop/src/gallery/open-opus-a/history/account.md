# Account — "Nell Rows Out"

## The book and the page

The book is *Nell Rows Out*. A girl finds an old lantern in the boathouse and learns that it belonged to the great carp who lives in the middle of the lake. At dusk she rows out to give it back. This page is the meeting: "The water went quiet, and something very old came up to see." Nell kneels in the bow and holds the lantern out over the water. The carp lifts its head into the light with its mouth open in a round "o", and Nell's mouth makes the same "o". Behind them are a painted dusk sky, a far shore with one lit window (home), mist on the far water, and the carp's long body dim under the surface. An oar trails off the stern, lily pads and reeds sit in the foreground, and two moths fly at the lantern.

Why this idea: the lantern gives one warm light source against a cool dusk, so the light tells you where to look. The tools are good at glows (radial and ellipse gradients) and at soft horizontal water strokes. A creature half under water also let me use groups and clips for something they suit: a body seen dimly through the water, and a head clipped to the part above the waterline. I avoided the obvious "child and moon" and "fox in a forest".

## What fought me

- **State leaks between marks.** In cycle 1 the evening star came out as a pink disc 46 px wide. I had called `noBrush()` but not `noStroke()`, so the glow circle took the pink 18 px cloud stroke. This was my bug, but the API invites it: `noBrush()` sounds like it ends the stroke, and it only ends the brush. I spent a probe sketch on it.
- **`arc` for water rings.** I used `arc` for ripple rings and got tall circular arcs standing up in the air. Rings on water need half-ellipses. I wrote `ellipseArc()` to return points for `curve`. An `ellipse` that takes start and end angles, or an `ellipseArc` helper, would be useful.
- **Faint-mark warnings for marks the clip or the canvas edge removes on purpose.** Strokes that start past the right edge and scale arcs clipped off at the bottom each gave "reaches only 0% opacity" warnings. The warning helped once: it told me paintRow was wasting strokes off canvas. For a clipped mark it is noise.
- **Bristle texture needs much more contrast than I expected.** In cycle 4 the sky had 48 bristle strokes at ±14 levels and 0.4 opacity, and they changed almost nothing visible. The diff counted the sky as unchanged. BRUSHES.md warns about this ("texture needs size and contrast"), and it was still easy to underdo.
- **Blunt bristle ends make seams.** A `line` with "even" pressure starts and stops square, so rows of strokes that end at similar x values leave vertical seams (plaid). A pressure envelope that tapers both ends, plus varied stroke lengths and start points, fixed it. I wrote the `paintRow` helper for this. A built-in "fill this region with painted strokes" would cover a common need.
- **`noUncheckedIndexedAccess`** made small index-based helpers (the colour-stop sampler, `HEAD_F[6]`) fail typecheck at the end. This is not a library problem, but it is worth knowing before writing helpers.

## What I wanted and did not have

- A way to sample a gradient's colour at a point. I wrote `sample()` to interpolate my own stops so the painted strokes could follow the gradient underneath.
- An ellipse arc, and an `ellipse` rotated at an angle. Rotated scale arcs needed hand-built axis vectors.
- A "region fill with strokes" helper (hatching or painting a clip region with strokes that follow a direction).
- Soft-edged clipping. Everything clipped has a hard edge, so to sink the fish body I used a group's opacity and a separate deep-water gradient, not a soft mask.

## Brushes and helpers, and what each did

- **bristle**: the painted sky and water rows (the biggest change in the picture's character), the hull planks, the inside of the boat, brushwork on the coat, and the lily pads. Good once contrast was high enough. On short marks it reads as flat tone.
- **wash**: clouds, the soft column of the lantern reflection, koi patches on the carp, the sky rim on the lily pads. Reliable.
- **airbrush**: the mist band on the far water. One stroke, exactly as described.
- **ink**: every outline (with "swell" pressure and a little wobble, it gives the varied line I wanted), barbels, the gill cover, ripple rings, reflection glints (thin tapered dashes), the carp's scales seen through water, and the reeds ("taper-out"). The most useful brush.
- **pencil**: hat ribbing. As scales seen through water at 40% group opacity it disappeared, and ink did better there.
- **chalk**: one highlight stroke on the hat. It hardly shows.
- **clip + offset + shift**: form shadows on the coat, face, hat, fish head and fish body. This works well.
- **tube**: the arm and the oar shaft. Easy and clean.
- **group**: the submerged body (opacity), reflections, the vignette (multiply).
- **radialGradient / ellipseGradient**: all the lantern light, the star glow, the window, the light pool on the water. Without these the picture would have no light.
- **paperTexture(0.35)**: ties the flat fills to the painted strokes.

The disappointments were pencil and chalk at the sizes I used: the image got nothing from them.

## Ways of seeing

- **Whole frame**: the only view for composition and subject reading. It showed me that the cycle-1 carp read as an eel, that the left water was empty (which led to the oar, then the lily pads), and that the picture looked like vector art with grain. I looked at it every cycle.
- **Zoom crops**: the view for shape and texture judgements at the scale of a face or a fish. Zoom 2 in cycle 2 showed the carp head as a "loaf with a mouth on its side", which led to the reshaped snout. Zoom 1 in cycle 4 (sky corner at 2×) showed that the bristle strokes were present but too faint, which the whole frame could not tell me. Zoom 1 in cycle 10 at 4× confirmed that the moths read as moths.
- **Diff highlight**: the best view for "did my change land, and where?", especially for small or low-contrast changes. In cycle 4 it showed that the sky strokes made no visible change while the oar, coat strokes and koi patches did. In cycle 9 the stats said 0.3% changed and I suspected the scale edit had failed; the highlight showed the new diagonal scale rows clearly. In cycle 2 it also showed the hard edge of a rectangle over the fish that I had barely seen in the frame. It is no use when everything changes (cycle 2 was mostly magenta and green).
- **Diff change crops**: the view for judging one new element before and after at a larger size. The lily-pad crop in cycle 7 showed that they were too saturated and Pac-Man-like. The crops in cycle 3 confirmed that each edit stayed in its own region. In cycle 8 one crop showed the warm patch on the boat's reflection, which I would not have noticed otherwise.
- **Side by side**: the clearest view for a global texture change. In cycle 6 the plaid seams on the left and their absence on the right were obvious at once. I used it rarely otherwise; for local edits the change crops do the same job better.
- **Stats**: a quick check, but the pixel-change threshold hides low-contrast work. I stopped trusting the percentage alone after cycle 9.

I stopped opening side by side for local edits and relied on highlight plus change crops.

## How I feel about it, and what it still lacks

I think the process worked. Every cycle changed something I could name, and the diff tools let me check small edits without guessing. The result reads as a picture-book page with a clear moment: a girl, a lantern, an old fish, both mouths open. The light leads the eye. The sky and water look painted, not filled.

What it still lacks:
- The figures are flat-shape cartoons, more vector than painted. The coat, face and fish head use a flat fill plus one offset shadow, and they look less painterly than the sky.
- The girl is small and stiff. Her pose has no strain in the reach, and her lower body is hidden by the gunwale, which is convenient but avoids the hard part.
- The carp's above-water head is endearing, but leans toward cartoon seal. Its lips and the koi patches could be stronger.
- The lantern does not light the scene as strongly as a real lantern at dusk would. The face of the carp and the bow get warmth, but the water around them could take more of it.
- The vignette is almost invisible, and the moths are small at 1×.

Final frame: `<scratch>/open-opus-a/cycle-10/frame-0000.png`
