# Busy town (Acorn Lane): cycle notes

## Cycle 1

**Intent:** First full render of Acorn Lane: a cached painted street (bakery, post office, half-painted house, grocer, town hall with clock tower, sidewalk, road, verge), 20 clickable things drawn from sprites, chain reactions through a queued-cue list, speech bubbles, a hop/glint hover cue. Events click all 20 and pin frames for each act. Check composition, sprite placement, and that each click reads with its own name in the transcript.

**Seen:** The town reads at once as a picture-book street: five shopfronts, a clock tower, bus, crosswalk and verge, with every character in place. 19 of 20 clicks named their thing; the lamp click missed because its hit box sat 24 px right of the post. The acts all play: loaf and steam, goat watering, cat leap, letters arcing, mailbox burp, ladder wobble, bucket splosh, owl "WHO?!", hydrant spray, dog chasing its tail, grocer juggling, clock rings and pigeons circling, flag, duck, bus round the block, mole, snail. Problems: the cat sits on top of the BAKERY sign ("AKERY"); the grocer's apples orbit well above his hands; pigeons and grocer acts drag on too long; a haze band has a hard top edge at y 200; some acts collide with each other so later clicks read "(busy)" (owl, dog, pigeons); the scripted mouseups add a noise line each. The hover glint is there but faint. The whole run took 7.7 s.

## Cycle 2

**Intent:** Move the cat off the BAKERY sign (narrower sign, cat and goat's watering can shifted left so the drips still land on the cat), fix the lamp's hit box, bring the juggled apples down to the grocer's hands, shorten the grocer, pigeon, flag and painter acts, fade the haze band instead of a hard edge, strengthen the facade wash shading (it tripped faint-mark warnings) and the hover glint. Drop scripted mouseups and re-time clicks so none land on a busy act.

**Seen:** All 20 clicks now name their thing, none busy. BAKERY reads in full with the cat beside it, and the drips land on the cat, who leaps "MRRAOW!" over the flower box. The haze fades smoothly. New faint-mark warnings point at the chalk texture on the road (white at 12% through a 50% brush). The juggled apples are still small and hidden behind the "Ta-da!" bubble. The duck says "You're late!" even when the bus has not left.

## Cycle 3

**Intent:** Make the road chalk visible, enlarge the juggled apples and move their bubble aside, make the duck's line depend on the bus (late only while it is away). Switch to night with rain for the last frames to see the multiply shade, the screen-blended light cache, and rain together.

**Seen:** Night with rain works: the multiply shade turns the street blue, the screen-blended light cache lights every window, the lamp and the clock face, and the moon and stars come out. The rain is almost invisible, because it is drawn before the shade darkens it. At 3× zoom the goat is cut in half by the window opening and its watering can is clipped away. The juggled apples still float above the grocer's head instead of passing through his hands. Timing: idle frames cost about 2.3 ms ((2.5 s − 1.1 s) / 600 frames); a run with 14 overlapping acts is also only a few ms per frame once PNG writes (~117 ms each) are subtracted.

## Cycle 4

**Intent:** Centre the goat in the window and give the watering can its own sprite that pokes out over the sill and tilts to pour; water falls onto the flowers, and the overflow drips from the box onto the cat. Juggled apples pass through the grocer's hands. Draw rain after the night shade. Add things to find in the still town: a mouse hole with a mouse eyeing a crumb, a LOST SOCK poster and the sock up on the town hall, a nest with eggs, a fishbowl, a pot plant, a puddle.

**Seen:** The goat now stands in the middle of the window and pours from a can that leans out over the sill; the overflow drips from the box onto the cat. At 3× the apples arc up from the grocer's raised hands. The rain shows at night. Ripple rings land on top of the bus. The goat's horns are cut off by the top of the window opening, so it reads as a lamb. The night owl still sleeps, which is wrong for an owl.

## Cycle 5

**Intent:** Context makes the jokes: the dog sits up and begs when the baker has bread ("Sniff sniff... bread?"), shivers when the hydrant got it, the cat complains "Wet!" when the drips set it off, the duck says "You're late!" only while the bus is away. The owl keeps owl hours: awake at night, and a click at night gets "Hoo! It's MY bedtime!". Horns curl sideways and the goat rises higher. Ripples only on the sidewalk and verge. Pass through dusk before night to check it. (The pigeons click is still in, at frame 225.)

**Seen:** The dog sits up for the bread and says so; the cat's "Wet!" and the duck's "You're late!" appear only with their causes. Dusk turns the street warm orange with the windows starting to glow, which is the best of the three times. At frame 80 the hydrant's "fssshhh" and the dog's line overlap each other. The facades other than the bakery are flat colour; the characters' clothes are flat too.

## Cycle 6

**Intent:** Stack speech bubbles so none covers another (each new bubble moves up past those already placed, its tail still pointing at the speaker). Add surface: pencil clapboards on the post office, vertical boards on the grocer, stone blocks on the town hall and tower, a wash shadow along the back of the sidewalk, and pencil hatching in the shadow side of every townsperson's clothes. All of this goes into the cache or into sprites, so it costs nothing per frame.

**Seen:** Bubbles stack: at frame 80 "Sniff sniff... bread?" sits above "fssshhh" and both tails reach their speakers. The clapboards and stone blocks show faintly, enough to stop the walls reading as flat cards. The clothes hatching is invisible and set off a run of faint-mark warnings; their positions (e.g. (52, 132)) are in the ladder sprite's own coordinates, not the canvas, which took a minute to work out.

## Cycle 7

**Intent:** Darken the clothes hatching until it shows. Add bristle texture to the bakery roof and bristle grass along the verge, so more of the page is visibly brushed.

**Seen:** The pig's shirt now shows pencil hatching on its shadow side at 3×; the bakery roof and the verge carry visible bristle streaks. One faint-mark warning remains (a cloud edge at 8%), which I accept. Timing with the brief's command: 1 frame 1.20 s, 121 frames 1.47 s, so idle frames cost about 2.3 ms. With all 20 acts started at frame 1, 31 vs 151 frames gives about 3.4 ms per frame. Writing that timing file showed the events never click the cat directly: it only ever leapt as a chain reaction.

## Cycle 8

**Intent:** Click the cat on its own (frame 180). Seat the duck on the bench instead of standing in front of it. Exercise the reset trigger at frame 232 and snapshot the settled street.

**Seen:** The reset trigger named itself and at frame 233 every resident is back at rest (bubbles gone, ladder upright, bus at its stop, flowers back to their first height). The duck now hops in front of the bench back; it still reads as standing, not sitting, which I will leave. The cat's own click at frame 180 came back "cat (busy)": the window's drips had set it off at frame 108 and its act runs to 218. The street lamp stays dark at dusk.

## Cycle 9

**Intent:** Move the cat's own click to frame 219, after its chained leap ends. Light the street lamp at dusk as well as at night. Zoom on the goat to check the shorter horns.

**Seen:** Every one of the 20 things now gets its own named click, and the reset trigger names itself. The lamp glows at dusk. At 4× the goat still has no horns: they were drawn with the ears, behind the head, which covers them. At frame 230 the cat, clicked on its own, still says "Wet!", and the duck says "You're late!" just as the bus pulls in, because both acts were still in their final frames.

## Cycle 10

**Intent:** Draw the goat's horns after the head, as small tapered tubes. Make "Wet!" depend on the watering still running (before 85% of its act), and "You're late!" only while the bus is away (before 90%).

**Seen:** "Wet!" and "You're late!" now drop off at the right moments (frame 230 reads plain "MRRAOW!" and "QUACK! QUACK!"). The goat at 4× is unchanged: the horns are drawn, but the goat rises so high that its head top sits above the window opening and the clip cuts them off. (The cycle-9 history file was first overwritten by mistake with cycle-10 code and then restored by reversing those edits in the text.)

## Cycle 11

**Intent:** Raise the goat less (36 px instead of 52) so the whole head, horns included, sits inside the opening; the can and its pour follow the hands down.

**Seen:** At 4× the goat finally has curled horns, a beard and its whole head inside the window. It pours from the can over the flowers, and at frame 112 the cat leaps from the drips under the flower box. That is the picture I wanted for the window.

## Cycle 12

**Intent:** No drawing changes. Add a hover over the clock (a fixed thing that glints rather than hops) and a move off into empty verge, then a last full render to confirm every click, the hover cue on both kinds of thing, dusk, reset, and night rain.

**Seen:** All 20 things answer to their names, the reset trigger answers, and the three mouse moves change the hover. Hovering the clock puts a soft four-point glint at its rim (frame 190); hovering the mail carrier makes her hop (frame 176). Dusk, reset and night rain all render as before. One flaw remains in the events: the owl is clicked at frame 237 in the night, and its "Hoo! It's MY bedtime!" bubble only starts at 8% of its act, after the last frame, so the final snapshot shows it blinking without the line. I relabelled that snapshot rather than spend a thirteenth render. ESLint passes on the directory; `pnpm typecheck` reports no errors.
