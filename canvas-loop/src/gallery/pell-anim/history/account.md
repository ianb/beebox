# Account: *Old Pell Lights the Lamps*, animated

Sketch: `canvas-loop/src/gallery/pell-anim/sketch-tea.ts`. Events: `events.json`. Final render: `<scratch>/pell-anim/cycle-10/`.

## What moves and what the reader can do

The still shows the moment just before the story's point: Pell reaching his pole up to the last lamp. The animation lets the reader make that moment happen, and then shows what it is for.

- **Click the last lantern.** It starts dark. A click lights it: there is a short flare as the wick catches, then the glow, the deck pool and the water reflection bloom over about a second. Two moths come in to circle it. About a second later Pell draws the pole back a little and lowers it, and the taper's flame shrinks. The boat on the horizon turns for home. It rows down the right edge behind the near reeds, grows as it comes, leaves a small wake, and ties up in front of the pier inside the lamp's reflection. Then the fisher ships the oar and waves. The page text follows the story. Line two cross-fades from "Old Pell reached up to the last lamp." to "Old Pell lit the last lamp of all.", and "And the last boat came home." fades in when the boat arrives. Clicking a lit lamp does nothing.
- **Hover the dark lantern.** Its glass warms a little and shows a faint ghost flame, so the reader can tell it is the thing to click.
- **Drag the moon.** The moon moves behind the clouds (the clouds are a separate layer over it), and its broken reflection column follows it across the water.
- **Click open water.** Rings spread and fade, painted as seeded ink arcs, lit on the upper half and dark on the lower half.
- **Move the pointer through the reeds.** The reeds part away from it and the nearest ones tremble. They follow the pointer with a lag and fade back when it leaves.
- **Params.** `wind` (0–1) sets how far the scarf's loose end lifts and ripples, the reed sway, the glint drift and the moon-dab sway, and how far the taper flame leans. `dusk` (0–1) lays a cool veil over the page and brings out more stars. Windows, lanterns and the boat light are painted again over the veil, so they get relatively brighter. `fireflies` (on/off) shows fireflies over the reeds. `next-evening` (a trigger) puts the lamp out and sends the boat back out, to play the story again.
- **Idle loop, with nothing touched.** It lasts 240 frames (4 s at 60 fps). Stars twinkle, glints swell and drift on the water, moon dabs breathe, the reeds and scarf sway, window and lamp light flicker a little, fireflies blink, and Pell blinks twice per loop. Every idle motion is a function of `frame` with whole turns per loop, so the loop is seamless.

Why these: the book's story is a lamp lit so a boat can find home. So the main interaction is lighting the lamp, and the reward is the boat coming home. The moon, the rings and the reeds are small toys, each on a part of the page that already invites a hand. I kept the heron almost still (a blink, the scarf, the pole) because he is the most expensive part to paint, and because an old bird standing still at the end of the pier is the right tone for the scene.

## Per-frame cost

The final timing is about **17 ms per frame wall clock, 10–13 ms CPU**. I measured 61 frames against 1 frame, and 241 against 1, with `/usr/bin/time`. The machine's load average was 16–30 from other agents during the runs. The first frame, which paints every cache, takes about 1.2 s.

How I got there:

1. **Caches.** The static parts are in `v.cache` layers: sky gradient, clouds and hills, water ripples, village, walkway with the two lit lamps and the last lamp's post, the heron's legs and shadow, the heron's body and head, the wing grip, the scarf's knit, and the last lamp's reflection. The z-order sets the split. The moon goes between the sky and the clouds. The pole goes between the legs and the body. The scarf goes between the body and the grip.
2. **The first measurement was ~150 ms per frame, and nearly all of it was `v.paper()`.** A TEA sketch has no `setup`, so I called `paper()` at the top of `draw`. `PaperSheet.set` throws away the texture on every call, so `paperTexture()` rebuilt the paper on every frame. I moved `paper()` into the first cache body. Whenever the caches are fresh, so is the paper. That brought the cost to ~23 ms.
3. **Reeds.** I knocked out one part at a time and timed 241 frames. The reeds cost ~10 ms per frame, nearly all in `v.tube`: about 56 calls, ~0.2 ms each. I replaced it for the moving leaves with a small leaf-outline function (Catmull-Rom centreline, normals × profile, filled as a polygon). The diff showed 0.6% of pixels changed, only at the leaf tips.
4. **Text.** I first drew the three text lines as cached layers faded through `group`. That cost ~3 ms, because each `group` is a full-canvas layer. Drawing them with `fillText` and an alpha each frame costs almost nothing.
5. **Moving parts use cheap marks:** plain shapes, gradients and plain lines. The brush marks that are still drawn each frame are ~40 seeded ink dabs for the moon column, the ink ring arcs, the pole, and the scarf outline. A `seed` keeps their wobble steady while their points move. The scarf is the only per-frame `clip`. Inside the clip, its pencil knit is a cached layer pasted each frame, so the knit texture survives the motion at the cost of one paste.

## What fought me

- **A TEA sketch cannot import its own helpers.** The brief says helper files are allowed, but the `*-tea.ts` lint (`no-restricted-imports`, pattern `^(?!@ianbicking/canvas-loop$).+`) rejects any import except the framework, including `./scene.js`. I did not want to rename helpers to dodge the rule or add a disable, so the sketch is one ~1500-line file. The 700 lines of painting code from open-opus-b are copied into it.
- **`View` has no `random`.** The still's stars, ripples, village reflections and reeds all used `s.random`. In TEA, `draw` gets no randomness, and module-level `let` is banned. I wrote a seeded mulberry32 whose state lives in a closure. The fixed scatter is computed once into module `const` arrays (stars, glints, moon dabs, reeds, fireflies), and the cache bodies seed their own generators. The lint allows this, and it is still deterministic. Nothing in the docs says how to do it.
- **`paper()` in `draw`** (above). Nothing warns that it is expensive, and a TEA sketch has nowhere else to put it. A `paper()` call with unchanged settings should keep the texture, or TEA needs a one-time setup hook.
- **`DeepReadonly` turns tuples into arrays.** `DeepReadonly<Vec2>` becomes `readonly number[]`, so `model.moon[0]` is `number | undefined`. Headless rendering ran fine. The error showed only in `pnpm typecheck` after the last cycle, and I changed the model's points to `{ x, y }` objects. `Vec2` is the library's own point type, so storing it in a model is the obvious thing to do and should work.
- **Clip cost.** `clip` builds a layer, a mask and `getImageData`, so each clip in a moving part is expensive. That ruled out the still's wash-inside-clip shading for the swaying reeds; the lit side is now a narrower filled leaf.
- **Engagement verdicts are good, with one gap.** Every click, drag and hover reads as a named verdict (`light-lamp`, `grab-moon`, `drag-moon`, `part-reeds`, `lamp-waits`, `ring`, `next-evening`). The gap is mouseups: a mouseup after a click reads as `(unhandled)`. That is correct, but it is noise in the transcript.
- **Event frames vs. model frame.** A click on frame 60 is folded before frame 60's tick, so `model.frame` is still 59. My first "lit at" stamp was one frame early.
- **Faint-mark warnings.** The still's fading village reflections raise a dozen warnings on frame 0 of every run. I filtered them out of my transcript reads.
- **Seeing effects.** The hover halo around the dark lantern was there (the diff highlight showed it), but it was invisible on the pink sky in the frame and the zoom. Only the diff told me the code worked and the design did not.

## What I wanted and did not have

- **Moving or offset cache pastes.** A cache always pastes the full canvas with the transform from its first call. I could not drift the clouds, rock the cached boat, or sway a painted reed clump. Any cached thing is fixed in place. `cache(key, body)` plus `drawCached(key, { dx, dy, rotate, opacity })` would cover clouds, bobbing boats and swaying painted foliage cheaply.
- **Cache opacity without a group.** Fading a cached layer costs a second full-canvas layer.
- **Bounded caches.** Every paste composites 800×800 pixels, even for a small layer like the grip. About ten pastes per frame is now a large share of the budget.
- **A cheap `tube`**, or a note on its cost.
- **Time-based state on ticks.** The reeds' lag needed a hand-written `stir` follower in `update`. A small "spring/ease toward" helper for `Util` would cover this and any animation like it.
- **A cursor hint.** A browser figure cannot show a pointer cursor over the lantern, so the "click me" cue has to be painted.
- **A seeded RNG in draw-side utilities** (or documentation of the closure pattern).
- **A font on `text()`.** I still use `v.ctx` for the italic Georgia line, as the still did.

## How I feel about it

I am pleased with the story beat. Hovering, clicking and watching the boat come home and the third line of text appear turns the page into the book's ending, and it costs about 17 ms per frame. The painted look holds: every static part is the same paint as the still, and the moving parts are either seeded brush marks or small plain shapes that sit inside the painting.

Weaker points:
- The hover cue is small.
- The reeds' parting is gentle enough to miss at 1×.
- The moths are white specks.
- "Next evening" is a cut with no fade.
- The clouds cannot move.
- The heron is nearly a statue. That is partly the right choice and partly the cost of painting him. A head turn toward the arriving boat is the one more motion I would want.

I did not check the sketch in a live browser figure; all checks were headless.
