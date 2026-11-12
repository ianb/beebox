# alien-curve drawing notes

## Cycle 1

**Intent:** First full draft. Every part (head, body, arms, legs, feet, hands, eyes, antennae, smile) is a flat fill plus an ink `s.curve` outline; closed parts are ellipse-sampled or hand-placed point loops. Shading is bristle strokes clipped to each part (dark green on the lower/left sides, light green highlight on the head top and body right), pencil hatch in the eye whites, bristle-brush cheeks in a 0.75 opacity group. Coordinates read off the guide.

**Seen:** A clean, recognisable alien that matches the guide's pose and proportions closely; ink outlines are smooth with a slight wobble and read well. Problems: the bristle shading is so faint it is nearly invisible at 1x (only a pale highlight on the head top and a faint dark edge on the lower-left head and left body side); the cheeks rendered as small tan/brown smudges, not pink; the 3-point smile curve came out as a sharp V; the pencil hatch in the eye whites is barely visible; antenna stalks taper to a hairline at the ball. A 3x zoomed crop confirms the bristle texture is there but very weak.

## Cycle 2

**Intent:** Make the shading visible: bristle flow 0.7 and opacity 0.7 (was preset flow 0.55, opacity 0.55), wider strokes (head shadow 22px, body 18px) and a second head shadow stroke. Smile now 5 points for a rounded U. Cheeks: three stacked short pink bristle dabs each, opacity 1, in one 0.85 group. Eye pencil hatch darker (#9aa6b2) and more strokes. Also refactored helpers to object parameters for the lint rule (max 2 params, no default params).

**Seen:** Partly helped. The smile is now a rounded U like the guide. The eye-white pencil hatch is visible as a grey crescent under each pupil. Head shading is a little more visible (darker band lower-left, pale highlight on top) but still subtle at 1x; the dark green (#4f9a48) is too close to the base green. Cheeks are pink now but read as three ruled horizontal dashes with streaky dry ends, like a barcode, not a blush. Body and limb shading still nearly invisible.

## Cycle 3

**Intent:** More contrast in shading: darker shade green (#3a8236) and paler highlight (#c2eeab); bristle brush with 22 bristles, flow 0.8, load 1.4 so the strokes stay wet longer and cover more. Cheeks replaced with a flat pink oval (closed curve) plus four short red-pink pencil strokes, in a 0.8 opacity group per cheek.

**Seen:** Clearly helped. Shading is now visible at 1x: a darker band around the lower-left of the head, a dark edge down the left of the body and limbs, a pale glossy streak on the body's right side and on the head top. Cheeks are soft pink ovals, close to the guide. Remaining problems: each shading mark reads as one discrete stripe (the body highlight looks like a plastic gloss stripe, leg shading like pinstripes) rather than a rounded volume; the body is boxier than the guide (straight sides, square bottom corners) where the guide's body is a narrow-necked bell; antenna stalks still taper to a point at the ball.

## Cycle 4

**Intent:** Gradate the shading: under each narrow dark stroke, add a wide low-opacity (0.3-0.4) dark stroke so the shadow fades into the base green; add a soft right-side shadow on the body; make the body highlight narrower and fainter (0.5) and the head highlight a wide faint pass plus a narrow brighter one. Reshape the body as a 12-point bell: narrower neck (164..236), widest at y 345-380, rounded bottom corners. Antenna stalks use even pressure so they do not thin to a hairline.

**Seen:** Helped. The head now reads as a rounded volume: the shadow fades from a dark rim into the base green instead of a single stripe, and the highlight on top is a softer two-tone sheen. The body is now bell-shaped with rounded bottom corners, closer to the guide. Antenna stalks are even-width to the ball. Still flat-looking: the hands, feet and antenna balls (no visible shading), and the outline weight is uniform everywhere, which looks more like vector clip-art than a picture-book ink line. The left arm is thinner than the guide's.

## Cycle 5

**Intent:** Give the ink line a picture-book weight: each closed outline is heaviest on its lower/shadow side and lightest opposite, via pressure keyframes from a cosine (`heavyAt`), with base weight 3.6. The position along the loop is chosen per part from where its points start (ellipses start at the right and go clockwise, so 0.3 is lower-left). Pencil shading in orange on the lower-left of each antenna ball. Left arm widened by ~4px.

**Seen:** Helped, modestly. In the zoomed crop the head outline is visibly heavier along the lower-left and thinner at the upper-right, which gives it a hand-inked look; at 1x the effect is subtle but the figure looks less like clip-art. The antenna balls show a small orange pencil hatch on their lower-left. The left arm now has similar width to the guide's. Still flat: the ground shadow (a flat translucent ellipse, the only part not hand-drawn) and the hands, whose shading strokes are too small to see.

## Cycle 6

**Intent:** Final polish. Ground shadow becomes a faint flat curve plus diagonal pencil hatching clipped to it, so it matches the drawn style. Hand and foot shading strokes widened to 12px and moved to the lower edge so they show.

**Seen:** Mixed. The hands and feet now have a visible darker lower edge, which rounds them. The ground shadow is now drawn, but the hatching is evenly spaced, same angle, same length, so it reads as a mechanical ruled fill (closer to a halftone screen than to a hand) at both 1x and zoom; the flat ellipse it replaced was quieter. Given no cycles left I keep it, but a scribble with jittered spacing and angle would have been better. Overall the final frame is a faithful, clean picture-book version of the guide: ink outlines with weight variation, bristle shading that gives the head and body volume, pink cheeks, pencil touches in eyes and antenna balls.
