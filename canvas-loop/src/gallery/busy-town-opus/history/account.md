# Acorn Lane: account

## The town

Acorn Lane is one street, 1000×750. From left to right: a bakery with a flower-box window upstairs, a post office, a tall house that is half painted yellow, a fruit-and-veg shop, and a town hall with a clock tower and a flag. In front are a sidewalk, a road with a crosswalk, and a grass verge with the street sign. Things to find in the still picture: a mouse at its hole eyeing a crumb, a nest of blue eggs in the bakery gutter, a fishbowl, a pot plant, a WET PAINT sign, a "LOST: one red sock" poster with the sock up on the town hall ledge, a SNAIL X-ING sign, and a puddle.

Idle motion, always running: chimney smoke curls, the cat's tail flicks, the baker breathes, the mail carrier bounces, the painter dabs the wall, the owl snores "z z z", the dog wags its tail, the pig sweeps with a broom, the clock's hands creep, the flag flutters, the pigeons peck, the duck's newspaper rustles, steam drifts from the manhole, the snail crawls the curb, and the bus shakes and puffs exhaust at its stop.

The 20 clickable things and their acts:

| Thing | Act |
| --- | --- |
| Baker (bear) | slides a loaf out of the bakery on a peel and holds it up, steaming. "Fresh bread!" |
| Chimney | shakes and puffs three smoke rings. "POF!" |
| Upstairs window | the shutters fly open, a goat comes up and tilts a watering can over the flower box; the flowers grow (and stay a little taller after each watering, up to three times) |
| Cat | leaps up arched and lands. "MRRAOW!" |
| Mail carrier (rabbit) | tosses three letters in an arc into the mailbox. "Special delivery!" |
| Mailbox | the lid flaps open and letters flutter out and back. "*burp*" |
| Painter (fox) | the ladder wobbles and he hangs on with both arms; paint drips fall. "Whoa whoa whoa!" |
| Paint bucket | jumps, tips, splashes yellow over the sidewalk, rights itself. "SPLOSH" |
| Owl | eyes snap open. "WHO?!" |
| Hydrant | sprays an arc of water toward the dog. "fssshhh" |
| Dog | chases its tail, flipping back and forth. "Woof! Woof!" |
| Street lamp | flickers on, glows, and two moths circle it. "ding!" |
| Grocer (pig) | juggles three apples. "Ta-da!" |
| Clock | the hands spin, sound rings spread from the tower. "DONG! DONG!" |
| Pigeons | all four fly a loop round the tower and land |
| Flag | whips hard and stretches. "flap flap" |
| Duck | throws down the paper and jumps. "QUACK! QUACK!" |
| Bus | "beep beep!", drives off right, goes round the block, and comes back from the left to its stop; a passenger waves |
| Manhole | the cover tips aside, a mole in a hard hat comes up, looks around, "Oh, hi!", and goes back down |
| Snail | pulls into its shell and wobbles. "eek" |

Chain reactions (a cue queue in the model starts the neighbour's act some frames later):

- Window → cat: water overflows the flower box and drips onto the cat, which leaps with "MRRAOW! Wet!".
- Baker → dog: the dog sits up and begs, "Sniff sniff... bread?".
- Hydrant → dog: the dog gets soaked (a wet pose with drops) and says "Brrr! Wet dog!".
- Mail carrier → mailbox: the box burps the letters back up.
- Painter → bucket: his drips land and the bucket splashes.
- Clock → pigeons and owl: the bell scatters the pigeons and wakes the owl.
- Flag → pigeons.
- Manhole → snail: the mole frightens the snail into its shell.
- Bus → duck: when the bus comes back round the corner, the duck scolds it, "QUACK! You're late!" (that line appears only while the bus is away).

Params: `time` (morning, dusk, night), `rain`, and a `reset` trigger that settles everyone. At night the owl keeps owl hours: it is awake and blinking, and a click gets "Hoo! It's MY bedtime!". The lamp is lit at dusk and night.

The hover cue: a hovered thing that is idle hops, and a soft four-point glint pulses at the top-right of its hit box. The chimney, ladder and lamp wiggle instead of hopping, and the bucket does both. The clock gets only the glint.

The events file clicks all 20 things by name, plus the reset trigger, three hovers, and the dusk and night-rain params. Every click's verdict in the final transcript is the thing's own name.

## Per-frame cost

Measured with the brief's command, three runs each: `--frames 1` takes 1.18 to 1.30 s, `--frames 121` takes 1.48 to 1.54 s. That is about 2.2 ms per frame for the idle street. With all 20 acts started together at frame 1, 31 frames against 151 frames gives about 3.1 ms per frame. Both are far under the 16 ms target.

How:

- The whole still town (sky, hills, five buildings with their textures, signs, street, verge, the jokes, paper texture) is one `v.cache("town", …)`. Nothing in it depends on a param: time of day is a full-canvas multiply rect plus a second cache, `lights-${time}`, of window and lamp glows, pasted with `blendMode("screen")`. So the night street costs two extra full-canvas composites, not a repaint.
- Every character, pose and prop is a sprite: 12 standing poses, the cat (sit, arch), the dog (stand, wet), the owl window (asleep, awake), the window (shut, open), the ladder with the fox (painting, hanging), pigeons (sitting, flapping), the snail (out, tucked), and the bus, wheel, loaf, letter, apple, can, bucket, hydrant, lamp (off, on), mailbox (shut, open), manhole, mole, glint and glow. Each is painted once with brushes and then placed under `push`/`translate`/`rotate`/`scale`/`pop`.
- Per frame I draw only plain marks: smoke and steam circles, water and paint drops, the cat's and dog's tails, the flag polygon, the clock hands, the broom, speech bubbles, rain lines. No brush is used after a sprite or the cache is painted, and no `group` is used per frame (a group composites a full-canvas layer).
- A clip is used per frame only for the goat in the window and the mole in the manhole, both small.

Most of the wall-clock time in a render is PNG writing: about 117 ms per captured frame, measured by running 121 idle frames with `--every 1`.

## What fought me

- **Faint-mark warnings give positions in sprite coordinates.** A warning "near (52, 132)" came from pencil hatching inside the ladder sprite (80×240), not from the canvas point (52, 132), which is sky. Nothing in the line says which sprite or cache the mark was in. A sprite key in the message would have saved the search.
- **Faint-mark thresholds catch deliberate subtlety.** A white chalk texture at 12% through a 50% brush, and wash shading at 22% through a 60% brush, each produced eight warnings. The warning is right that they barely show. But there is no way to say "this one is meant to be faint", so I raised the alphas to quiet it. One cloud edge at 8% remains and is fine.
- **No way to see which sprite poses exist or how big they are.** The goat in the window took three cycles. The horns were drawn with the ears, behind the head; then they were drawn, but the goat rose so high that the window clip cut them off. A debug mode that outlines each sprite's box and each clip region in the frame would have shown both at once.
- **Text only in sans-serif.** `text()` hard-codes `px sans-serif`. For a picture book I wanted a rounded or hand-lettered face for signs and speech; there is no font option.
- **`as` casts are banned and `Object.fromEntries` returns `Record<string, …>`**, so building `Record<Id, number>` from the id list needs a hand-written literal (`NOT_STARTED`, 20 lines). A typed `fromKeys` helper in the library's types would help TEA sketches with id-keyed state.
- **Events dispatch "before the tick".** A click's `model.frame` is the previous frame, so an act clicked at frame N starts at N+1. This is documented and correct, but I had to think about it to make the "busy" check agree with what is on screen.
- **Mouseups get their own "(unhandled)" verdict line.** That is correct, but with 20 clicks it doubled the transcript noise, so the events file sends mousedowns only.
- **Brush texture at the page scale is quiet.** Pencil clapboards, bristle roof and grass, and hatching on clothes all show at 3× zoom, but at 1× the page still reads as flat fills with ink outlines plus paper grain. The texture needs more contrast than I expected to survive at full-page scale.

What I wanted and did not have:

- A sprite or cache "tint" or a per-image `blendMode` that survives a later full-canvas multiply, so that window glows could be drawn per thing instead of as a second cache with hand-copied coordinates (`paintLights` repeats the window positions from the town painter).
- A per-frame cost readout in the transcript (ms per `draw`). I measured by subtracting wall-clock times of runs of different lengths, and PNG encoding dominated them.
- Hit-test help. Each thing's hit box is a hand-kept rectangle beside its drawing code. The lamp's box was 24 px off in cycle 1, and I only found it because its click came back "(unhandled)". That verdict line is the best tool here: a miss shows on the transcript line.

## How I feel about it

I am pleased with it. It looks like a busy picture-book spread: bright shopfronts, a street crowded with small animals at work, signs, and a few jokes to find. Clicking around is the fun part. The chains are what make it feel alive: the goat waters the petunias and the drips set off the cat, the bell scatters the pigeons and wakes the owl, the dog begs at the bread. Dusk is the most beautiful of the three times. The night rain version is atmospheric, though the characters go quite dark under the blue shade.

Weaker points: the duck stands in front of the bench instead of sitting on it, some acts (painter, grocer) last a little long, the brush texture is subtle at full size, and when many acts overlap the bubbles stack into a tall column. Performance needed no fighting at all. Sprites plus one cache put the frame cost at about 2 to 3 ms, so I spent the cycles on the picture.

## Revision

Five more render cycles (13 to 17) with the new library tools.

What I changed:

- **The duck sits on the bench.** It is clipped above the seat line, a seat-plank sprite is drawn over it, and two orange feet dangle below and kick.
- **Lights after the night shade.** The old second cache of glows is gone. The shade is a multiply rect, then each lit window gets the glow sprite through `image()` with `blendMode("screen")`. Because the lights are now per thing, the goat's window glows only while its shutters are open, and the lamp's glow follows its state. Moon and stars sit in a small `night-sky` cache. The window list (`LIT_WINDOWS`) lives in the town file. The night shade is lighter, so characters stay readable.
- **Every sprite is painted at frame 0** (`warm`). Before this, the first click on each thing painted its poses mid-act, which caused a 70 ms hitch.
- **Speech bubbles draw all tails first, then all boxes.** A long tail from a stacked bubble now passes behind the others instead of across their words.
- **Shorter acts.** The painter goes from 150 to 120 frames and the grocer from 160 to 130.
- **Stronger wall texture.** The post-office clapboards, the grocer's boards and the town-hall stones now show at 1×.
- **The owl's night line appears in the final snapshot.** The night switch and the owl click move to frame 234, and the owl's bubble starts sooner.

The new tools, and whether each helped:

- **`--outline` plus `debugBox`: helped most.** One frame showed all 20 yellow hit boxes against their magenta sprite boxes. In the original round I found a 24 px lamp miss only through an "(unhandled)" verdict; here I could confirm every box at a glance, including the bus's moving box riding along with it at frame 154. Its labels do cover small art: at night they sat over the left end of the owl's bubble, so I needed a clean render to check it.
- **`--timing`: helped at once.** The first run showed avg 3.12 ms but max 70.84 ms and p95 9.49 ms. That led straight to the lazy-sprite hitch, which wall-clock subtraction had hidden. After `warm` the numbers were avg 2.11, p95 4.73, max 9.41.
- **Faint-mark warnings that name the sprite: helped.** The one warning I had blamed on a cloud said `in sprite "bus"`. It was the tiny bus driver's pencil hatching, now skipped with a `plain` flag. `gesture({ faint: true })` now marks the cloud wash as deliberate, and the transcript has no warnings.
- **`textFont` / `textStyle`: helped.** Signs are bold Trebuchet MS and speech is bold Comic Sans MS, which reads much more like a picture book. Bubble widths are still my estimate of 7.6 px per character, because the View has no text measuring.
- **`u.record(IDS, () => -100_000)`: helped.** It replaced the 20-line `NOT_STARTED` literal. `init` and the reset now take `u` for it.
- **`cursor("pointer")`: used.** It is set from `model.hover` every frame. It does nothing headless, so it is unchecked here.
- **The screen-blend `image()` recipe: helped.** It is the new lighting described above.

What still fights me:

- **Bubble width is a guess** without a `textWidth`, so long lines in other fonts could overflow their box.
- **The outline labels are opaque black tags** that cover the art they label in crowded areas.
- **Wall-clock and `--timing` maxima are noisy** while other renders run. The same all-acts run gave max 5.3 ms once and 31.9 ms the next.
- **Frame 0 now costs about 1.2 s**, because it paints every pose. That is fine headless, but a browser figure would show a one-second blank start.

New per-frame timing, from `--timing`:

- Final events run: draw avg 2.22 ms, p95 5.73 ms.
- All 20 acts started together (151 frames): avg 1.36 to 2.19 ms, p95 2.18 to 5.29 ms.
- Update: about 0.01 ms.
- Frame 0, which paints everything: about 1.0 to 1.2 s.

All of these are well under 16 ms except for noise spikes in the maximum. With the brief's wall-clock command, `--frames 1` now takes 2.2 to 2.8 s, because the up-front sprite painting moved into frame 0, and `--frames 121` takes 2.3 to 3.4 s; the machine was busy, so `--timing` is the better figure.
