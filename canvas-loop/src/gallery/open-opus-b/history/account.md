# Account: *Old Pell Lights the Lamps*

Final frame: `<scratch>/open-opus-b/cycle-10/frame-0000.png`

## The book and the page

The book is *Old Pell Lights the Lamps*. Every dusk an old heron in a red knitted scarf walks the long boardwalk out from a stilt village and lights the lamps one by one, so the fishing boats can find their way home. The page is the last lamp: Pell at the end of the pier, reaching the lighting pole up to the lantern, with the two lamps already lit behind, the village windows warm, the moon up, and one small boat still out on the horizon. The text sits in the sky: "At the very end of the pier, / Old Pell lit the last lamp of all."

Why this idea: a heron is mostly long simple curves (an S neck, a dagger bill, stick legs, an egg body under a folded wing), which suits `curve`, `tube` and `offset`. A dusk scene lit by lamps gives the page a clear light source and a reason for warm-against-cool colour. The boat gives the moment a stake without needing a second character.

## What fought me

- **Two-point `tube` ends come out square.** The cattail heads (`tube([[a],[b]], { width: 11 })`) render as square-ended blocks at zoom, where the docs promise round ends. Reading `shapes.ts` (not patched): the outline goes along the left side, then appends the end cap, but the cap appears to start on the right side and sweep to the left, so the path doubles back on itself and the fill reads as a square end. I left them; at 1x they pass as cattails.
- **Faint-mark warnings for intended fades.** Village reflection strokes that fade with distance (`rgba` alpha × bristle `flow`) set off a dozen warnings. The warnings are right that those marks barely show; I could not tell the tool "this fade is on purpose", so I grepped them out of my render output.
- **Work that does not show.** Cycle 6 put bristle feather strokes inside the body clip, then the wing covered almost all of the body. Diff stats reported 1.3% changed and mean delta 0.34, which told me the effort was nearly invisible before I looked at the crop.
- **A multiply group over a fading gradient is very weak.** The first cast shadow (group 0.5 multiply, gradient to transparent) did not show on the mid-value deck at all. It needed opacity 0.85, a darker colour, and a clip to the deck.
- **Text font.** `s.text` hard-codes `sans-serif`. For a printed-page serif I used the raw `s.ctx` (`font = "italic 25px Georgia"`, `fillText`), the escape hatch the README tells you to avoid.
- My own mistake: a stray `cat >/dev/null` in one shell command hung waiting on stdin and cost a timeout. That was not the library.

## What I wanted and did not have

- A font family on `text()`, so story text stays on the declarative side.
- A way to mark a deliberate fade as intended, or a warning that counts faint marks per call site, not per mark.
- A "lit shape" helper. I wrote `litShape` myself (rim colour fill, the base colour offset and shifted away from the light, a shade crescent at low opacity). The `offset` + shift recipe in BRUSHES.md works but takes three fills and a clip for every part.
- A mirror/reflection helper for water: flip a group about a line and break it with horizontal displacement. I painted reflections stroke by stroke instead.
- A union outline for overlapping shapes. Two overlapping scarf tubes, each outlined, showed their end caps inside the scarf (cycle 2); the fix was to make the scarf one tube.

## Brushes and helpers

- **bristle**: the most useful brush. Water ripples in three palettes by depth, cloud streaks (lavender body, rose underside), house wall boards, deck grain, the painted village reflections. It carries "painted" at 1x when the stroke is long and the colour differs from what is under it. Short bristle strokes on the deck and the body were too close in value and vanished.
- **wash**: lamp reflections in the water, the low rose band in the sky, the wing's dark flight-feather band, the cool shadow on the lower body, the scarf's under-shadow. Reliable for soft tone.
- **ink**: all outlines, posts, legs, stilts, the crest plume, and the moon-reflection dabs. Pressure keyframes on the closed body and wing outlines (heavy on the shadow side, thin toward the lamp) were the best single line change.
- **pencil**: plank seams, the scarf's knit ribs (these read well at zoom), belly hatching (hidden under the wing; wasted).
- **chalk, marker, airbrush**: not used. Radial and ellipse gradients did the glows.
- **tube**: neck, scarf, reed leaves (with a profile to 0, good), cattail heads (square ends, see above).
- **offset**: the rim light and shade crescents in `litShape`. With a large shift (cycle 2) the rim became a broad flat band; a 4px shift gave a clean edge.
- **clip** with an array: used for the deck-clipped shadow. **ellipseGradient**: the deck light pools and the cast shadow. **paperTexture(0.35)**: ties the flat gradients to the paper.
- Disappointed: the bristle feather texture inside the body (cycle 6), which nothing showed, and the scalloped feathers on the first try, which landed as a lumpy patch until I gave each row its own value and a dark ink edge.

## Ways of seeing

- **Whole frame**: composition and story. It showed the cycle-1 problems: the middle lamp post standing directly behind the heron, the heron too small to carry the page, the head looking up past the lamp, the empty bottom-left water, the floating feet. It also showed that the text in the sky made the picture a page. I looked at it every cycle.
- **Zoom crops**: small fixes and texture. Zoom 1 in cycle 3 showed the bill tip touching the lamp's arm, a tangent I could not see at 1x. The 3x crop of the feet in cycle 8 showed the cast shadow was not there at all. The zoom on the cattails in cycle 10 showed the square tube ends. Zoom was my main tool for anything on the heron.
- **Diff highlight**: where a change landed, and how big it really was. In cycle 2 it showed the lamp glows as large blotches that I could barely see in the frame, which told me the glows were too weak. When a pass touched the whole water (cycle 5), the highlight was all colour and useless.
- **Diff change crops**: before and after of one edit. In cycle 6 change-1 showed that the body strokes had vanished under the wing and the scallops sat as a lumpy patch. They were less useful when the crop came out at 1x and tiny (the deck shadow in cycle 8).
- **Side by side**: whole-picture texture passes. For the sky and water pass (cycle 5), where the highlight was saturated, comparing the two frames was the right view.
- **stats.txt**: the percentage and mean delta were a useful honesty check. A 1% change after a cycle of heron work told me the work did not reach the 1x picture.
- I stopped opening the highlight for texture passes and stopped opening change crops at 1x scale.

## How I feel about it, and what it lacks

The page works as a picture-book page: a clear subject, a clear moment, light from the lamp and the moon, depth from the reeds through the pier to the village and the horizon, and a line of text. The heron has some character (scarf, feather fingers on the pole, bill aimed at the flame). Most cycles brought a visible gain; cycles 6 and 7 went into heron detail that matters at zoom more than at 1x.

What it still lacks:
- The style is mostly flat vector shapes with brush texture added on top. A painted picture book would build the shapes with brushes. The sky and water come closest; the heron, deck and houses are still fills with marks inside.
- The heron's body is an egg under a wing. The breast plumes and the hunched old-bird shoulders that would make Pell *old* are missing.
- The lamp light falls only as a rim on the heron. The front of the scarf, the bill and the deck around the feet should be warmer.
- The legs read as rods, the cattails are square, and the sky's cloud streaks are thin and evenly spaced.
- The far boat is a tiny silhouette. It carries the story, so it could be larger or have its own reflection.
