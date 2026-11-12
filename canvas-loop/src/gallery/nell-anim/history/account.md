# Account: "Nell Rows Out", animated

## What moves, what the reader can do, and why

The page is the meeting from *Nell Rows Out*: "The water went quiet, and something very old came up to see." The animation stays quiet. One light, one old fish, and the small things a lantern on a lake at dusk would stir.

**What moves (a seamless 180-frame loop, 3 s at 60 fps; frame 0 and frame 180 are byte-identical):**
- The lantern flame flickers. Its glow, its reflection pool, and the glow on the bow all follow the flicker.
- The lantern sways on its bail. Wind sets how far.
- The reflection under the lantern shimmers: each broken glint drifts sideways and changes length. Wind sets how far they drift.
- Rings spread from where the carp broke the surface, three at a time, passing behind and in front of its head.
- A drop gathers on the carp's chin, falls, and rings the water, twice a loop.
- The carp's "o" mouth breathes, and it blinks once a loop. Nell blinks too, at another time.
- Two moths circle the lantern with beating wings. The far half of each orbit passes behind the lantern.
- Stars twinkle and come out as dusk deepens. The home window on the far shore flickers like a lamp indoors.
- Fireflies drift and glow on and off over the reeds. More of them come out as it gets darker.
- Two mist bands drift on the far water. The reeds and cattails lean with the wind.

**What the reader can do:**
- **Drag the lantern.** Nell's arm follows within her reach. The lantern lags behind the hand and swings on after you let go, as a damped pendulum. The carp's eye follows the light. The reflection and the bow's glow follow it too.
- **Bring the light to the carp.** Lower the lantern beside its mouth and the old fish half-closes its eye and opens its mouth wider, content. In the story Nell is giving the lantern back, so this is the gesture the page is about.
- **Point at the carp.** When the pointer comes near, the carp's eye turns from the lantern to the reader. It "came up to see", and what it sees is you.
- **Click the carp** to greet it: a slow blink, a wide "o", and quick rings from its chin.
- **Click the water** for a ripple of three rings at that point. Rings are rounder nearer the viewer.
- **Params:** `dusk` (0..1) darkens the sky, water and edges, and shrinks the lantern's pool of light, while stars, fireflies and the home window come out. `wind` sets the lantern sway, the glint drift and the reed lean. `moths` is a toggle. `reset` is a trigger.

Every interaction event in `events.json` carries a name in the transcript: touch-water, greet-carp, carp-watches, carp-looks-away, take-lantern, move-lantern, let-go.

## Per-frame cost

- **Brief's measurement** (61 frames against 1 frame, three pairs, on a busy machine): 9–16 ms per frame headless, including the runtime's update fold and model freezing. The first frame costs about 1.2 s more, because it builds the cached layers.
- **Draw alone** (a timing copy of the sketch in the scratch directory, using `process.hrtime`; `performance.now()` is blocked in sketches): 5.4 ms per frame at a dusk on an anchor, 6.9 ms between anchors. The largest moving parts are the arm's ink outline (1.0–1.2 ms), the paper texture (0.4 ms) and each cached-layer paste (0.4–0.6 ms).

How I got there:
1. **Five cached layers**, split where moving parts must interleave with them: background (sky, shore, water, the submerged carp body); boat back + Nell without her arm; boat front + oar; the carp's head without eye or mouth; lily pads. The moving arm goes between the two boat layers. The rings' back halves go under the boat and their front halves over the head.
2. **Moving marks are not brush marks.** The first draft drew the reeds with ink: 17 ms by themselves, and 51 ms per frame overall. I wrote a `ribbon()` helper that fills a tapered polygon around a point list. It replaces every moving ink mark (reeds, glints, rings, ripples, lash lines) at a small fraction of the cost. At 1× it is hard to tell from ink. The only moving brush mark left is the arm outline, with a fixed `seed`.
3. **Dusk without repainting.** The background is cached at dusk 0, 0.35 and 1. Each frame cross-fades the two layers around the current value with a `group({ opacity })`. Every colour is a linear mix along dusk, so the fade matches a direct repaint. A diff against a direct render at dusk 0.8 changed nothing outside the lantern. The cost: the slider never repaints, and the cache holds 3 keys, not 21. The price is about 1.5 ms per frame for the group layer between anchors.
4. **Paper set once.** `paper()` throws away the paper layer each time it is called, so it is called only inside the background cache body, not every frame.
5. Lights (stars, home window, fireflies) are drawn after the multiply darkening, so the dark does not dim them.

## What fought me

- **A cached layer cannot move.** `cache()` pastes with `resetTransform()`, so a cached head cannot bob and a cached boat cannot rock. The clip still applies, but the transform does not. The boat, Nell and the carp's head are fixed. I would have liked the boat to rock a pixel and the carp to rise and settle.
- **`paper()` invalidates the paper layer on every call.** The still page calls it once in `draw`, which costs nothing there. In an animation, a per-frame `paper()` call rebuilds the texture every frame. I found this in the source (`PaperSheet.set`), not in the docs.
- **Moving brush marks are slow, and the docs say so only in general terms.** BRUSHES.md says marks are slow. It took a measurement to learn that 25 ink reeds cost 17 ms, while a filled polygon of the same shape costs well under 1 ms.
- **`performance.now()` throws** inside a sketch (for determinism). That is correct, but profiling a sketch needs a clock. I used `process.hrtime` in a scratch copy. A built-in per-section timing in the transcript would help.
- **TEA model types.** `update` receives `DeepReadonly<Model>` and must return `Model`, so the obvious `return model` for "no change" needs a cast, and the lint bans casts. I made every Model field readonly and stored points as `{x, y}` objects. `DeepReadonly` turns a readonly tuple into a `ReadonlyArray`, which is not assignable back to `[number, number]`. Then `DeepReadonly<Model>` is a `Model`, and "unchanged" returns the same reference, which keeps the Δmodel verdict honest. It works, but every TEA author with a tuple in the model will hit this.
- **Only one file.** The TEA import restriction bans relative imports, so helper files in the directory cannot be imported. The sketch is one 1,260-line file.
- **The brief's render command** passes `--events canvas-loop/src/gallery/...` together with `--dir canvas-loop`, so the events path resolves to `canvas-loop/canvas-loop/...`. I used `src/gallery/nell-anim/events.json`.
- **Faint-mark warning noise.** "faint mark near (582, 799)" repeats every time a background layer is built. It comes from a scale arc clipped at the canvas edge, carried over from the still page.
- **Glows baked at rest.** Lantern light painted inside clips (Nell's coat and face, the inside of the boat, the carp's face) stays where the lantern rested. I moved only the bow glow out of the cache. The others are under brush marks and outlines, and redrawing them on top would wash those out. Within Nell's reach, the mismatch is small.

## What I wanted and did not have

- `cache` with a transform at paste time, or a cached sprite that can be drawn at an offset, rotation and opacity. With that, the boat could rock and the carp could breathe in and out of the water.
- A paste opacity on `cache`, so a cross-fade would not need a group layer.
- A cheap stroke that looks like ink: a "fast ink" that only fills the tapered outline, with no grain or dab work, for marks that move. My `ribbon()` is a hand-rolled version.
- A per-frame timing line in the transcript (draw time, update time, and cache hits and builds).
- An eased "interpolate toward" helper for `update`, for lag and springs. I hand-wrote the pendulum.
- A way to tell the browser figure that a param change is expensive. Without the cross-fade, each dusk value used to stall for 0.5 s.

## Check after the last render

The final render (cycle 10, frame 114) showed a bug: the "light brought close" measure was too generous, and the carp's eye was a third closed with the lantern at rest. I fixed it after the 10-cycle budget was spent. The contented look now runs from 36 px (none) to 20 px (full), and Nell's reach grows from 82 to 92 px so the lantern can actually get there. I checked the fix by arithmetic, not by rendering. The resting lantern stays 37–49 px from the mouth at any wind, so it has no effect. The scripted drag brings the lantern to 14–27 px, so the effect is full to half. Lint and typecheck pass. `history/cycle-10.txt` is the rendered version, without this fix.

## How I feel about it

I like it. The page keeps its painted look, because almost every pixel is still the painted page. The motion is small and has a reason: the light flickers, the water answers the fish, and the fish watches the light. The interactions carry the story. Dragging the lantern down to the carp and seeing it close its eye is what the book is about. Having it turn to look at the reader's pointer is the best moment. The dusk slider works better than I expected: at 0.8 it turns the page into a night scene lit from one lantern.

What it lacks: the boat and the carp's body are rigid, because a cached layer cannot move. At full reach Nell's arm stretches past her natural length. The baked lantern light on her coat does not follow when you lift the lantern. I have not run it in a real browser figure. The cost suggests it fits the 30 ms budget, since draw is 5–7 ms headless, but browser compositing of the paper texture and the group layer is not measured.
