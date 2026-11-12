# Gull market: account

## What I drew

A sunny harbour morning, 900×700. On the right is a fish stall with a red and white striped awning and a "FRESH FISH" board. Behind the counter the fishmonger flings one arm out to point after the thief and spreads the other hand in shock. His cap jumps off his bald head and an "OI!" burst goes off beside him. On the ice in front of him is a wet, fish-shaped hollow, with a "MACKEREL £2" card stuck in the ice next to it. On the left the herring gull flaps away with a striped mackerel hanging from its beak. It glances back with a half-lidded, cocky eye, water drips from the fish, and a loose feather drifts behind it. Other figures watch: a child in a yellow raincoat laughs and points up, a ginger cat looks up at the fish, and a second gull on a bollard looks on in envy. Behind them are crates of fish, a bucket, bunting, a lamppost, three small shoppers on the harbour edge, a green headland with coloured houses and a lighthouse, two sailboats, and far-off gulls. The sun is at the upper right, and shadows fall down and to the left.

The sky, sea, quay, hill, awning, stall wall and coats carry loose bristle strokes. A shared `form()` helper gives each shape a shade crescent on the side away from the sun, an optional lit rim, and an ink outline that swells and thins twice around the shape.

## What fought me

- **Shading with group + erase under a rotate.** My first `form()` built the shade crescent as a group: fill the shape, then `erase()` the shape shifted toward the light. That worked on unrotated shapes. On the gull, which is drawn under `rotate(-0.12)`, the erase cleared only a rectangle, so the body kept a hard white box for two renders. At first I thought the cause was my lighting maths or the mantle stroke. I switched to nested clips (shade, then base shifted toward the sun, inside the shape) and the box went away. This could be a library bug: erase inside a group, under a rotation, inside a clip. I did not isolate it.
- **The first lit-rim attempt was backwards.** Filling the light colour over the shape shifted toward the light covers almost the whole shape. It does not leave a rim. A crescent needs "shape minus shifted shape", which is why I tried erase in the first place.
- **Brush texture is not visible by default.** In render 1 the sky had `wash` strokes at 0.25 opacity, and a zoom showed a flat gradient with paper grain. The texture only showed after I used bristle strokes at higher opacity, with tones clearly lighter and darker than the base. The same was true for the large flat forms, so I added a `strokes` option to `form()`.
- **Gull wings.** The first wings were two rounded paddles. A wrist bend, black tips with white spots, bristle feather strokes from the shoulder to the tip, and a few feather-edge ink marks made them read as wings. They are still stiff.
- **Story aids that did not help.** A dashed flight path from the empty spot to the gull was invisible as dark dashes on the dark stall wall. As white dashes it looked like rain specks, so I removed it. The pointing arm, the "OI!", the hollow in the ice and the fish already tell the story.
- **A prop that misled.** A brass hanging scale sat just above the fishmonger's raised hand and looked like he was holding a wedge of cheese. I removed it.

I used 8 of the 10 renders.

## How I feel about it

I am pleased with how clearly the story reads. In one look you see the thief, the fish, the empty place, and the man who sees it a moment too late. The gull's face is the best part: the drooping lid and the slanted brow make it look cheeky. The bright palette and the painted sky give the morning feel I wanted.

Weaker parts: the human figures are simple and stiff. The child and the shoppers are close to peg dolls, and the fishmonger's torso is symmetrical. The wings are clean shapes more than feathered ones. The bottom band of the quay is plain. I left it as space for a line of text, but it is also a place I stopped working. The brushwork is visible up close, but at full size the page still reads more as clean vector art with texture than as a painting.
