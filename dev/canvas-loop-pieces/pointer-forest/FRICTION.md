# Pointer forest: friction log

What got in the way while building `pointer-forest` (a meadow of fractal trees
that die back where the pointer is and regrow where it leaves). Each entry:
what I tried, what happened, the workaround, a suggested library change.

## Ranked by how much a fix would help other figures

1. **F4: headless runs re-record every picture every frame.** About 1.5–4.5 s
   per frame for this scene: 331 frames took 8–9 minutes, and the first
   257-frame run took about 20 minutes. Nothing shows progress. This slows the
   core loop for any picture-heavy figure. Fix: sample the audit, capture call
   sites lazily, print progress, add an opt-out flag.
2. **F2: no `mouseleave` msg.** Every hover figure keeps stale hover state
   when the pointer exits. Small change in `wireInput` and `Msg`.
3. **F6: new picture versions cost frames, and nothing shows which ones.** Add
   browser timing per picture key, a prewarm path, and a stated cost in the
   docs. Any figure with growth, poses or morphs hits this.
4. **F1: no perceptual colour (`oklch()`, `mix`).** Every palette-minded
   figure rewrites the same converter.
5. **F7: no tint or colour adjustment on `place`.** Atmospheric depth and
   colour variants need layers or extra versions.
6. **F9: misleading "scale" hint** when the real cause is new versions.
7. **F3: sound has no soft or swelling primitive** (wind, ambience).
8. **F5: a tiny negative size ends a long run.**
9. **F8, F10: smaller items** (`RootDrawing` vs `Drawing`, picture auto-size,
   faint-mark warnings that do not name the picture, pointer-path shorthand in
   events files, notes on measuring fps).

What worked well: the picture `deps` audit caught a real bug on frame 0 with
the right line, the negative-size message said exactly what to clamp, and
pictures plus `place(…, { opacity })` made a 55-tree animated scene run at
53–60 frames/s in Chrome.

## F1. No modern CSS colour syntax (`oklch()`, `color-mix()`)

- Tried: `{ fill: "oklch(0.7 0.12 140)" }` and `color-mix(in oklch, …)`.
- Happened: `SketchUsageError: rect fill "oklch(0.7 0.12 140)" is not a CSS colour`.
  The parser (`canvas-loop/src/scene/colors.ts`) sets `fillStyle` on a 2D context and reads
  back only `#rrggbb` / `rgba(…)`; a browser that understands oklch serialises it
  as `oklch(…)` and would be refused there too. TEA.md says "Colors are CSS
  strings only" and gives `"rgb(…)"`, which reads as "any CSS colour".
- Workaround: an OKLab/OKLCH → sRGB converter in a sibling `color-tea.ts`
  (≈40 lines, gamut clipping by chroma reduction), returning `rgb(…)` strings.
- Suggest: parse `oklch()`/`oklab()`/`hsl()`/`color-mix()` in the library's own
  parser (not via the 2D context), or export colour helpers
  (`oklch(l, c, h, a?)`, `mix(a, b, t, "oklab")`, `lighten`, `toward(c, haze, t)`).
  A painterly library whose docs talk about lush colour should own perceptual
  colour; every figure that wants a palette rewrites this. Say plainly in
  TEA.md "Styles" which syntaxes parse.

## F2. No "pointer left the canvas" message

- Tried: the piece's core idea is "the forest regrows when the pointer leaves".
  `Msg` has `mousemove` but nothing for leave/enter; `wireInput`
  (`canvas-loop/src/browser/canvas-dom.ts`) listens to `pointermove/down/up/cancel` only,
  never `pointerleave`/`pointerout`.
- Happened: a sketch cannot tell "resting" from "gone". The last `mousemove`
  before leaving is wherever the browser last sampled, often 10–40 px inside.
- Workaround: treat a move within 3 px of the edge, or one whose extrapolated
  next position is outside the canvas while moving faster than 6 px/event, as
  "gone"; in events files, a move to an off-canvas coordinate (`x: -20`) means
  gone. Fragile: a slow exit leaves the pointer "present" near the edge forever.
- Suggest: add `{ type: "mouseleave" }` (and maybe `mouseenter`) to `Msg`,
  sent on `pointerleave` of the primary pointer when not pressed, and allowed
  in events files. Hover-driven figures (tooltips, highlights) all need it to
  clear hover state; today they keep a stale highlight when the pointer exits.

## F3. Sound: no way to make a soft, swelling sound (wind)

- Tried: soft wind under the scene, a rustle when leaves drop.
- Happened: `noise` is white noise that starts at full gain and decays
  exponentially (`synth.ts`); there is no filter, no attack, no envelope. It
  makes a hiss/click, not wind. `tone` has fixed fades. The sample library has
  no ambient/wind/leaves sounds (`page` is the nearest rustle).
- Workaround: a very soft `noise` burst (gain ≤ 0.1, 0.45 s) as the rustle; a
  slow `pad` note every 5 s as the bed instead of wind.
- Suggest: `noise` options `color: "white" | "pink" | "brown"`, `attack`
  seconds, and a `lowpass` Hz; or `wind`/`rustle`/`leaves`/`birds` samples in
  the library. A "breath/swell" envelope (`attack`, `release`) on every voice
  kind would cover most ambient needs.

## F4. Headless runs are very slow for a picture-heavy scene (no way to opt out of the per-frame picture audit)

- Tried: a 700-frame run (11.7 s of scene time) with ~55 trees, each placed as
  2–4 kept pictures (about 100 distinct picture versions in use, each a few
  hundred nodes).
- Happened: about 4–5 s of wall time per frame; the run hit an error at frame
  256 after roughly 20 minutes. `--timing` shows rendering is cheap (frame 1+:
  55 passes, cpu lower 3–15 ms, gpu 10–60 ms). A `sample` of the process shows
  the time in `draw`: headless runs are always testing mode
  (`canvas-loop/src/headless/scene/surface.ts`: "pictures are re-recorded and compared
  every frame"), and each recorded node builds an `Error` to capture its call
  site (`ErrorUtils::Construct` / `CaptureAndSetErrorStack` dominate the stack).
  So every frame re-runs every placed picture body: the cost the picture was
  meant to avoid comes back headless, multiplied by the stack captures.
- Workaround: a `pace` param that speeds every rate so the story fits in ~250
  frames; fewer captured frames does not help (the cost is per simulated frame).
- Suggest: (a) audit each picture version on its first few uses and then on a
  sample (every Nth frame, or when its deps change), not every frame; (b) capture
  call sites lazily (store a cheap counter/callsite token and only build the
  stack when a warning fires); (c) a `--fast`/`--no-audit` flag for long story
  runs; (d) print progress (`frame 120/700`) on stderr for runs longer than a
  few seconds — this run printed nothing for 20 minutes, and `--out` was not
  even created until the end, so I could not tell slow from hung.
- Note: the audit itself is good. It caught a real bug on frame 0 (a grass
  tuft picture whose brush `seed` used the tree id, not the variant in `deps`):
  `picture "tuft" [1] was asked for twice this frame with the same key and deps
  [1] and drew differently`. Clear message, right line.

## F5. Negative-radius error ends the run (good message, harsh outcome)

- Happened: a landed leaf shrinking to nothing reached `rx = -0.011` on frame
  256: `ellipse: rx must be ≥ 0 … clamp it with Math.max(0, …)`. The message
  is exact and helpful. But it is a hard error that ends a 20-minute run, after
  the frames were already computed.
- Suggest: in a long run, record the error, skip the node, and continue (fail
  at the end with exit 1), or make tiny negative sizes (> −1 px) a warning
  and draw nothing.

## F6. New picture versions mid-animation cause frame drops; no way to see or spread that cost

- Tried: trees grow and wither through 12 growth levels, wood and foliage as
  separate kept pictures per level (`deps: [level]`), placed under one of four
  depth scales. Withering and regrowth create new versions while the scene runs.
- Measured (Chrome, Mac, 960×540, ~55 trees, synthetic pointer sweep for 8 s
  then off-canvas for 6 s, rAF deltas):
  - idle full forest: 59.7 frames/s.
  - crown blobs filled and edged with a `chalk` stroke: 33–55 frames/s while the
    pointer moves; rAF p95 41.7 ms, p99 65.7 ms, 80 of 712 frames over 20 ms.
  - same crowns as flat fills (chalk only on the small sunlit blobs): 50–60
    frames/s; p95 25.0 ms, p99 33.5 ms, 46 of 794 over 20 ms.
  - Headless frame 0 `--timing`: `brushed strokes 437122 (expanded 113027)`,
    `cpu lower 2065 ms (brush 1713 ms)`: the brushed edges are the cost.
- Docs say brushed marks are costly per frame and to keep still parts in
  pictures (BRUSHES.md "Animation and pictures"). They do not say the cost
  returns whenever a picture gets a new version, which is the normal case
  for anything that grows, wilts, or has many poses that first appear mid-run.
  - flat crowns, foliage snapped to a level (wood crossfaded), 12 levels:
    presents 48–60 frames/s during the sweep (≈50 while trees are dying),
    rAF p95 18.6 ms, p99 48.5 ms.
  - falling leaves hidden (≈200 rotated ellipses): about 3–5 frames/s better,
    so the leaves are not the main cost.
  - 8 growth levels instead of 12 (fewer new versions per second): 53–60
    frames/s, rAF p95 18.1 ms, p99 25.6 ms, 24 of 815 frames over 20 ms. Kept.
- Workaround: drop brushed edges from the big passes; quantise growth to 8
  levels and crossfade the next wood level in with `place(…, { opacity })`
  (cheap); snap foliage to the nearest level (a crossfaded crown reads as glass).
- Suggest: (a) a browser-side timing readout like `--timing` (per frame: new
  versions recorded and rasterised, by picture key, with ms) — I had to guess
  which pictures cost; (b) `v.prewarm(picture)` or a figure option that
  records/rasterises listed versions in idle time, a few per frame; (c) say in
  BRUSHES.md that a version change costs a full re-record and re-raster, and
  give a number (e.g. "a 200×200 picture of 100 chalk-edged blobs ≈ N ms").

## F7. No cheap colour adjustment on a placement (atmospheric depth, variants)

- Tried: far trees bluer and paler than near trees (atmospheric perspective),
  and a few colour variants of one tree shape.
- Happened: `place` takes `opacity`, `blend`, `erase`, `material` only. Wrapping
  each tree in `v.group({ effects: { saturation, brightness } })` gives each
  tree its own layer and effect pass, ~55 per frame.
- Workaround: depth by a translucent haze rect drawn between depth bands
  (one rect per band, with a vertical gradient); colour variants baked into
  separate picture versions (`deps` include the variant).
- Suggest: `place(pic, x, y, { tint: color, tintAmount, brightness, saturation })`
  applied when the kept raster is composited (a per-draw uniform, no new layer).

## F8. Smaller items

- `Drawing` vs `RootDrawing`: returning a component's `Drawing` from `draw`
  fails (`Type 'undefined' is not assignable to type 'RootDrawing'`); wrap it in
  `[…]`. The fix is easy but the error does not say so. Suggest the contract
  check message add "wrap it in a list: return [component(v)]", or let
  `RootDrawing` include `undefined`.
- Picture size is declared up front. For a tree whose bounds depend on growth I
  compute the box myself from the geometry. Suggest `v.bounds` usable inside a
  picture body, or a `width: "auto"` that sizes to the recorded drawing.
- Faint-mark warnings fire for thin ink twigs on small growth levels; the
  message names the line in the shared drawing helper, not which picture
  version (key and deps) made it, so I cannot tell which tree/level is faint.
  Suggest adding the enclosing picture key and deps to the warning.
- Scripting pointer paths: a hover story needs many `mousemove` lines. Suggest
  an events-file shorthand `{ "frame": 100, "type": "mousepath", "to": [x, y],
  "frames": 30 }` that expands to one move per frame.

## F9. The "drawn again every frame" hint blames scale when the cause is new versions

- Happened (story run, frame 144): `hint: picture "wood-oak-2" was placed at a
  scale or rotation it has no kept image for in each of the last 3 frames (now
  [0.5, 0, 0, 0.5]) … draw it as a group instead, or keep its scale and rotation
  fixed`. The scale is fixed per depth band (0.5 for every placement of that
  tree). What changed was the version: two trees sharing the key were each
  stepping through growth levels (`deps: [level]`), so the key got a new
  version in three frames running.
- Cost: I spent time looking for a non-uniform scale that did not exist.
- Suggest: track the hint per version (key + deps + transform), and when the
  version is what is new, say so: "picture `wood-oak-2` got a new version in
  each of the last 3 frames (deps [7] → [8] → [7]); each new version is
  recorded and rasterised again".

## F2 addendum: the exit heuristic misfires

- In the story events, two jumps of ~160 px/event toward the right edge read as
  `→ pointer gone` while still inside (my extrapolation guess). A real
  `mouseleave` would remove the guess.

## F10. Measuring fps in the agent browser

- The walks-now readout counts `surface.presents`; rAF can run at 60 while
  presents run at 50 (GPU behind), so the two numbers disagree. Fine once
  known; the readout could show both, or "presented / rAF".
- A 14 s `bin/browse eval` that awaited the sweep worked once, then CDP closed
  the channel; afterwards the page sat at `about:blank` or reported
  `0.0 frames/s` with rAF not firing at all until `bin/browse close` and a
  fresh `open`. Workaround: start the sweep, store the result on `window`, and
  read it in a later `eval`. (Browse tooling, not canvas-loop; noted for whoever
  writes the next perf probe.)
- There is no canvas-loop API to drive a figure's pointer from a test page;
  I dispatched synthetic `PointerEvent`s with `isPrimary: true` on the canvas,
  which works because `wireInput` only checks `isPrimary`/`pointerId`.

## 2026-11-16: fixes made, and what the second pass hit

Fixed in canvas-loop on `worktree-canvas-brushes` (one commit each):

- F4: the headless audit compares a kept version in its first three frames,
  then every 30th; re-records keep no call sites; runs over 3 s print
  progress to stderr. Forest, 60 frames: 90 s → 8.4 s, same pixels. The
  331-frame story: 8 min → 42 s (with the v2 pictures).
- F2: `mouseleave` msg (browser `pointerleave`, events-file entry). The
  edge/extrapolation heuristic is gone from the sketch.
- F6/F9: `--timing` and `figure.surface.pictureCosts()` list new versions
  and lowered tiles by key with ms (walks-now shows it under the fps); the
  "drawn again" hint names new versions when they are the cause; BRUSHES.md
  states the cost.
- F1: `oklch()`, `oklab()`, `color-mix()` parse in both runtimes. The sketch's
  converter is gone; `color-tea.ts` now only writes `oklch()` strings.
- F7: `place(…, { tint })`. Far bands now tint toward the evening air.
- F3: `noise` takes `color` and `attack`: brown gusts every 4 s, pink
  rustles when leaves drop.
- F8: type-check hint for a `Drawing` returned from `draw`; faint-mark
  warnings name the picture version.
- Left as is: F5 (strict negative-size error, by choice), picture auto-size,
  events-file `mousepath`, a prewarm API.

### N1. A thousand small polygons cost a thousand draws (fixed in the sketch; documented)

- Tried: fractal sprigs, each leaf its own `v.polygon` (≈1,000 per tree).
- Happened: frame 0 `draws 102983`, `cpu lower 3696 ms`; each new leaf
  version ≈100 ms to record and ≈30 ms a tile to lower. A browser frame that
  meets two new versions would drop several frames.
- Workaround: bin leaves into 7 tones and draw each bin as one `v.path`
  with a closed subpath per leaf; twigs one stroked path per level; fern
  fronds one path per depth. Draws 103k → 6k → 406; leaf versions ≈8 ms.
- Library: BRUSHES.md now says so. A batching recorder (merge sibling
  same-style shapes) could do it automatically; not done.

### N2. `performance.now` inside the library under the headless guard

- The first cut of per-picture timing called `performance.now()` from the
  recorder, which runs inside `draw`'s determinism guard, so every sketch
  failed on frame 0. The library now keeps the clock at module load. Worth
  remembering for any runtime-side timing added to code that runs in `draw`.

### N3. Measuring in the agent browser

- `pointerleave` dispatched as a synthetic `PointerEvent` reaches
  `wireInput`, so the sweep (`scratch/forest-fixes/sweep-leave.js`) now ends
  with a real leave instead of a move to x = -30.
- Chrome, 960×540, 8 s sweep then leave, 6 s regrowth: 55–60 frames/s,
  rAF median 16.7 ms, p95 18.4 ms, p99 25.0 ms, 27 of 817 frames over 20 ms
  (v1 with flat crowns: p95 18.6, p99 48.5). New-picture cost peaks at
  ≈140 ms per second of regrowth.

## 2026-11-17: the simpler forest

One idea now: a meadow wood that will not grow where the pointer is. Trees
near it dry to gold (a `tint`), drop leaves and shrink into the grass; they
grow back once it has gone. Hover only. The trees are no longer fractal
(the fractal ideas moved to `fractal-paint`): each is a trunk and a crown of
painted clumps, three self-sizing pictures drawn around its base.

Library changes this pass, from this log: pictures size themselves (F8's
picture auto-size), `mousepath` in events files (F8's pointer-path
shorthand).

### N4. What the self-sizing pictures removed

- `originOf`/`boxOf` and the `PAD` margin are gone: a tree, a tuft and a
  flower patch are drawn around their foot and placed at it. Nothing about
  growth level enters a picture's size any more.

### N5. Growth by scale, sway by moving layers

- Growth is the scale of the tree's three pictures, in 12 steps
  (`drawnSize`); each step is one more kept image per part. Sway moves the
  two crown layers by a pixel or two, which reuses their kept images. The
  dry look is `tint`, so no new version.
- Chrome, 960×540, 8 s sweep then leave, 6 s regrowth: 59–60 frames/s
  presented, rAF median 16.7 ms, p95 17.8 ms, p99 18.2 ms, 2 of 835 frames
  over 20 ms (the fractal version: p95 18.4, p99 25.0, 27 of 817).
- The first sweep of this version presented 55–60 while rAF ran at 60; the
  paint piece showed the same gap worse (45–54). Cause: the browser
  runtime's fixed-step clock against Chrome's wandering frame timestamps
  (fixed in the library, "Steady 60 Hz frames"; see fractal-paint P3).

### N6. Small things

- `cli run` has no `--params`; a `param` event at frame 0 sets one (the
  `marker` ring for recordings). Fine once known.
- A `mousepath` hover captures a PNG per frame (see fractal-paint P2).
- `place` takes one `tint`; haze and dryness are mixed into one colour in
  the sketch (`tintOf`). Fine.
