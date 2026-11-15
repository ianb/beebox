# Stage 4 drawing account — sol

I drew a dusk market, a panning night room, and a pendulum diagram. The final
sketches pass `pnpm exec tsc --noEmit -p .`. I made nine calls to
`scratch/stage4/draw/render.sh` across this stage: six successful 90-frame
runs, one room run stopped by a sketch error at frame 18, and two one-frame
pendulum attempts (the first used a bad events path). All rendering went
through that script and its GPU lock.

## Before rendering, and what I saw

I expected the market's washes to soften the flat geometry, the room's
lighting to separate warm lamplight from blue window light, and the pendulum
to read as a clean diagram. The first market frame did get attractive mottled
pigment, but the vendors are still simple round-headed figures. At
`market/frame-0030.png`, the first vendor's hand is visibly raised, the
middle vendor holds the glowing lantern, and the stalls show separate red,
green, and orange fruit. In the first draft the lantern followed a waving
hand down into the apples at some frames; I assigned the wave to the first
vendor and kept the lantern holder's arm raised. I also changed the middle
sign from FLOWERS to APPLES after seeing that its merchandise was fruit.
`market/frame-0000.png` confirms both the sign and lantern placement.

The room's `night-room/frame-0000.png` shows the cool window, moon, shelf,
table, and warm ceiling lamp. The watercolour wash gives the walls an uneven
painted surface and wavering outlines. It also flattens some furniture
details and makes the reader's face indistinct. The first pan was too slow:
at frame 89 the reader was cut off by the right edge. After increasing the
pan from 1.35 to 2.5 pixels per frame, `night-room/frame-0089.png` shows the
whole seated reader and the table, with the window moving partly out of view.
The lamp's halo and cool window light are visible, but shadows from the
furniture are soft enough that they read mostly as floor tone. The flicker
is not obvious from four stills; the images show a modest change in the light
pool, not proof that the motion feels like a real flicker in playback.

`pendulum/frame-0000.png` is clear and uncluttered: the bob, faint trail,
five-degree ticks, and period box all read. `pendulum/frame-0030.png` shows
the bob moved to the other side. My first length-to-pixel mapping made the
scale too low at the default length and would have cropped the maximum
length. I reduced the display range. An event-driven check at the slider's
maximum, `pendulum-max/frame-0000.png`, keeps the arc and its labels above
the period box and changes the period from 2.20 s to 2.84 s. Headless draws
the number control as a value box; the declaration uses the default number
control, documented as a slider in the browser.

## Authoring and guesses

`rect`, `curve`, `line`, `at`, and `group` felt familiar; I wrote them without
much thought. A `picture` with colour and pose dependencies was a compact
way to reuse the vendor body. I guessed this line would make just two poses
of the first vendor while keeping the other colourways distinct:

> `deps: [coats[i], scarves[i], raised] },`

The market scene outlines at frames 0 and 30 show different picture versions
for the first vendor, and the PNGs show the lowered and raised arm. That
proves the versioning guess in this run. `textBounds` sized the period box to
the measured label; both default and 2 m frames show padding around the text.
I also guessed that a wash over the entire lit room would look painterly.
It does, though it costs fine facial and furniture detail.

I wanted a handheld lantern to illuminate stalls that each have their own
wash. A light only shades the nearest lit group, so my lantern's point light
does not reach the stalls; its glow supplies the visible halo. The API could
use a documented pattern for a light in a reusable picture to affect nearby
objects while preserving separate wash scopes. I also had to keep the room's
whole drawing in one lit group to share its lamp and window light.

## Feedback and speed

The one sketch failure was precise. The first room run stopped at frame 18:
`ellipse material.emissive: must be a number in 0..1, got
1.000634471886337`, naming `night-room-tea.ts:84:7`. My formula was
`const flicker = 0.77 + v.noise(frame * 0.16, 8) * 0.33;`; it could exceed
one. I changed it to a 0.68–0.96 range and the full run completed. This was
an effective error: it gave the value, rule, shape, and location. A separate
one-frame run failed before drawing because `--events` was relative to the
worktree, while the script runs the runner from `canvas-loop/`; using an
absolute events path resolved it. The successful transcripts report no
warnings for faint marks, text overlap, stale picture dependencies, or
anything else. The initial lantern overlap and late reader crop were silent;
only looking at the frames exposed them.

At ratio 2, a final 90-frame market render took about 3.2 seconds wall time,
the room about 2.1 seconds, and the pendulum about 0.5 seconds. The market's
frame-0 scene reports 56 passes, 39 effect passes, and 121 brushed strokes;
the room reports 57 passes and 42 effect passes. The pendulum reports one
pass and no effect passes. These are batch times, not interactive frame-rate
measurements. Picture and brush reuse make the market practical to iterate,
but the many full-scene effects are the part I would watch in a live figure.

Compared with Canvas2D or p5, scoped effects, materials, and pictures express
the composition without manual offscreen buffers or transform bookkeeping.
Compared with SVG, brushes and washes make painterly surfaces much easier.
The tradeoff is less direct control over pixel details and effect ordering;
there is no quick way to know whether a light plus wash looks right without
rendering. The API's diagnostics caught the invalid material, while the
placement and visual hierarchy still needed eyes on PNGs.
