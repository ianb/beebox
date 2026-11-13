# pell-anim notes

## Cycle 1

**Intent:** First full port of the open-opus-b page to one TEA file (the tea lint allows no local imports). Static parts in `v.cache` layers (sky gradient, clouds+hills, water, village, walkway with the two lit lamps, heron, grip). Moving each frame: twinkling stars, a draggable moon with its reflection column (seeded ink dabs), water glints, click rings, the boat (rows home once the lamp is lit), the last lamp blooming, the scarf's loose end in the wind, a blink, reeds swaying and parting round the pointer, a dusk veil, window/lantern breathing, fireflies, moths. Events exercise every interaction over 540 frames.

**Seen:** The still at frame 0 matches open-opus-b. Everything engages (transcript verdicts: part-reeds, ring, grab/drag/drop-moon, light-lamp, next-evening). Problems: the boat at the end of its trip is too big (×3.4), its light floats over a shapeless blob of a fisher; the right reed clump is pushed off the canvas because the wind push is +x while the scarf says the wind blows toward −x; the click ring at frame 34 is a small 30px ellipse; the moon column is thin. Cost: the first timing showed ~150 ms/frame, nearly all from calling `v.paper()` in `draw`, which rebuilds the paper texture on every call; moving it into the first cache body brought it to ~23 ms/frame.

## Cycle 2

**Intent:** Redraw the boat in local coordinates (faces home, ends at ×2.3; mast arm with a hanging lantern; hunched fisher in a hat who rows while moving; wake and light streak). Wind pushes reeds toward −x like the scarf. Bigger, faster rings; slightly heavier moon dabs. The lamp's lit frame is the frame the click lands on.

**Seen:** Zoom crops of frames 300 and 520. The boat now reads as a boat at both ends of the trip and comes to rest inside the last lamp's reflection, which is a good accident. The fisher is two stacked circles plus a hat: a snowman. The ring (frame 34 zoom) is the right size now but its crisp vector ellipses look printed over the painting. The right reed clump is back on the canvas.

## Cycle 3

**Intent:** Story beat for Pell: after the lamp catches, he draws the pole back through his grip and lowers it a little, and the taper flame shrinks. That needs the pole out of the heron cache, so the heron splits into legs (cache) / pole (per frame, seeded ink) / body+head (cache) / scarf / grip (cache) / flame. Fisher as a hunched curve with a hat. Rings as seeded ink arcs (lit upper half, dark lower half) under a flattening scale.

**Seen:** Zoom of frame 210. The pole drawn back through the grip shoves its rear end out under the body and across the legs, a long stick poking out at lower left. The idea is right; the geometry is wrong (even the still had 16px of pole below the body). The ink rings (frame 34 zoom) look painted now, but faint. The hunched fisher reads as a person.

## Cycle 4

**Intent:** Smaller pole move: lower 0.12 rad and draw back 12%, total pole length 180, so the tip ends just under the lantern and the rear end barely moves. Rings brighter (alpha 0.9).

**Seen:** Zoom of frame 210: the pole now ends just under the lantern and the rear end stays tucked; the move reads as "done". The diff of frames 110→120 (highlight) shows exactly the moving set: reeds, scarf, pole, glints, moon dabs, stars, the boat, fireflies. Full frame 520: the boat at home is dim under the dusk veil and its hull is hard to find; the text says "lit the last lamp" even while the lamp is dark.

## Cycle 5

**Intent:** The page text follows the story: "reached up to the last lamp" cross-fades to "lit the last lamp of all", and "And the last boat came home." fades in when the boat ties up (each line its own cache, faded with a group). The boat's lantern is repainted over the dusk veil; once home the fisher ships the oar and waves. A pointer near the dark lantern makes a slow pulse round it, inviting the click. Events extended to 600 frames, with a hover on the dark lantern.

**Seen:** Frame 575 whole: the three lines of text tell the story end to end, and the third line arrives with the boat. The boat at home is still a small dark shape under the lamp's reflection. Zoom of frame 58: the hover pulse round the dark lantern does not show at all; at that frame the pulse is near its low point (alpha ≈ 0.2) and the pink sky behind swallows it.

## Cycle 6

**Intent:** Stronger, larger hover pulse (alpha up to 0.75, radius 70) and a `lamp-waits` verdict on the hover so the transcript shows it engaged. Boat ends bigger (×2.8) and a little lower-left, with a brighter gunwale line, so it reads at home.

**Seen:** Zoom of frame 58 again showed no pulse; the diff highlight of frames 52→58 shows it is there (a green blob round the lantern) but too close in value to the pink sky to read. Zoom of frame 575: the boat now reads (hull, gunwale, mast, lantern, hunched fisher), but the last lamp's reflection is painted over the fisher, because the reflection was drawn after the boat.

## Cycle 7

**Intent:** Draw the last lamp's reflection before the boat, so the boat sits on it. Under the pointer the dark lantern's glass warms a little (a faint ghost flame), a cue on the object itself, since a halo on a pink sky does not show.

**Seen:** Frame 58 zoom: the warmed glass is a small but real cue. Frame 575 zoom: the boat sits on the lamp's reflection now; the fisher's wave is hidden because the raised arm lay along the mast. Zooms of frames 0 and 12 of the reeds: parting works, but it snaps in a single frame (the reeds read the raw pointer) and the cattails jump.

## Cycle 8

**Intent:** The reeds feel a lagged pointer: `stir` in the model follows the pointer on each tick (25% per tick) with a `presence` that fades in when the pointer enters the reeds and out when it leaves; the reeds nearest it tremble. The fisher's waving arm goes toward the stern, clear of the mast. Events: a second mousemove through the reeds.

**Seen:** Zooms of frames 10, 13, 16: the reeds now lean away over several frames and settle; the parting is gentle, maybe too gentle at 1x, but it no longer snaps. Timing at this point: ~31 ms/frame wall (machine load average 16–30 from other agents), ~19 ms CPU. Knocking out one part at a time (241 frames, user time): the reeds cost ~10 ms/frame, nearly all in `v.tube` (two per leaf, ~56 calls); the story text's three groups ~3 ms.

## Cycle 9

**Intent:** Performance pass. Replace `v.tube` for the moving reeds with a cheap hand-rolled leaf outline (Catmull-Rom centreline, 5 samples per span, normals × profile, filled as a polygon). Draw the story text directly with `ctx.globalAlpha`-style fills each frame instead of cached layers faded through groups. The picture should not change.

**Seen:** Diff 8→9 at frame 0: 0.6% of pixels changed, all in the reeds; the change crop shows the hand-rolled leaves match the tube leaves (tips a little sharper). Per-frame cost fell to ~17 ms wall, ~10–13 ms CPU (61 vs 1 frames, and 241 vs 1). Frame 150 whole, wind 0.9: the scarf streams and the glints drift, but the reeds are shoved so far left that the left clump thins out at the canvas edge, and the taper flame ignores the wind.

## Cycle 10

**Intent:** Last polish: a smaller steady wind push on the reeds (8 px, sway 2–12 px), and the taper's flame leans with the wind.

**Seen:** Zoom of frame 150 (wind 0.9): the left reed clump stays on the canvas and leans with the scarf. Whole frame 590 ("next evening"): the lamp is dark again, the pole is back up at the lantern, the text has gone back to "reached up", and the boat is back on the horizon in one cut (no fade). After this render, `pnpm typecheck` failed on my file: `DeepReadonly<Vec2>` turns the `[number, number]` tuple into `readonly number[]`, so every model point read as `number | undefined`. I changed the model's points (moon, pointer) to `{ x, y }` objects and re-rendered cycle 10 into the same folder. Frames 0, 150, 575 and 590 diff to 0 px changed against the first cycle-10 render. Lint and typecheck are clean for this directory.
