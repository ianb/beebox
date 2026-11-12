# Pendulum lab (canvas-loop): account

## What a learner sees and does

The page is titled "Pendulum Lab: How does the length of the string change the time for one swing?". On the left is a stage: a wooden lab stand with a metre rule hung from its arm (zero at the pivot), and a brass bob on a string. The backdrop changes with gravity: Earth (sky, clouds, grass), Moon (stars, Earth in the sky, grey ground), Mars (butterscotch sky, red ground, rocks), Jupiter (dark sky over banded cloud tops with a red spot). A pill in the corner names the place and its g. A red arrow on the rule marks the current length ("1.00 m").

Under the stage are a stopwatch (a dial plus a large reading, ten pips for the ten swings, "swing 5 of 10") and the settings: String length (typed, m), Gravity (select), Release angle (typed, 1–30°) and Speed (1×, 4×, 16×, so a 70-second Moon trial does not take 70 seconds).

Before a trial, the bob is held out at the release angle. An arc and label show the angle, and a hint says "held: click the ball to let go". The learner presses "Time 10 swings" or clicks the ball. The bob swings with a faint trail of ghost bobs and a faint arc along its path. The stopwatch runs and fills one pip per full swing. After ten swings it stops in green, and a box says "10 swings in 20.10 s, T = 2.010 s". The trial goes into the Results table (place, length, angle, time for 10 swings, period) and onto the graph as a dot in the planet's colour. The newest dot pulses and the newest row is highlighted. The bob keeps swinging until a setting changes; then it is held again. Results are kept across setting changes, and "Clear results" removes them.

On the graph, "Theory curve" draws T = 2π√(L/g) for every planet with trials plus the current one, and adds a Theory column to the table. "Plot against √L" turns the curves into straight lines through the origin. Hovering a dot shows its trial, and hovering a table row rings its dot.

The swing integrates the full pendulum equation, so the angle results are true to a real pendulum. At L = 1 m on Earth, 5° gives 2.007 s, 10° gives 2.010 s and 25° gives 2.030 s, against 2.006 s from the small-angle formula. A learner sees that the period hardly depends on the angle and that it grows a little at larger angles.

The scripted session (`events.json`, 1940 frames) runs one real-time trial, switches to 16×, and runs five Earth lengths, including one release by clicking the ball. It then runs two angle checks, turns on the theory curves, runs two Moon trials and one Jupiter trial, turns on √L, hovers a dot and a row, and clears.

## What was easy

- TEA suited a timed trial. The trial is a mode union (held / timing / free). The stopwatch and the physics live in `update`, and `draw` only reads. Because a param change arrives as a msg, "changing a setting puts the bob back in the hand" took one line.
- Determinism made the numbers checkable. The transcript logs each trial (`trial 3: Earth L=1.00 10° → 10 swings 20.10 s, T=2.010 s`), and I checked those against the closed form and the large-angle correction without reading pixels.
- Click targets could be calculated. The release click at (280, 244) came from `bobAt`, and the transcript confirmed it (`mousedown (280,244) → let-go`). Hover hit-tests share the chart's geometry functions, so the hovered dot and the tooltip agree.
- `v.control` put the inputs where they belong: the settings beside the stopwatch, the checkboxes on the graph and the clear button on the table. Headless stand-ins showed the layout well enough to fix collisions.
- `v.cache` keyed by planet made the backdrop free after the first frame. 1940 frames rendered in about 17 s.

## What fought me

- Most of the work was layout collisions, found only by looking: the banner overflowing its pill, the clear button over a column header, the legend inside the plot, theory labels on the end dots, the place label over the bob at L = 2 m, and dark marks on dark skies. Each needed a render, a look at 3–5 frames and a fix. With no layout primitives, every position is hand arithmetic.
- `v.textWidth` measures with the default font unless I pass the same options as the draw. My first banner measured regular sans-serif and drew bold Avenir, so it overflowed. I wrapped both in my own `say`/`sayWidth` helpers.
- There is no dashed stroke in `Style`. I wrote a dashed-line helper, and drew the theory curves solid at reduced opacity instead of dashed.
- The boolean control stand-in draws no label. That matches the browser, but it means the sketch places every checkbox label by hand.
- Headless stand-ins show `2` for a length typed as 2.00. This is harmless, but it does not show what the browser input would show.
- A few lint rules sent me back for small rewrites (`forEach` to `for…of`, a ban on `as Model`). `eslint --fix` handled the first. Declaring `trials: readonly Trial[]` in the Model removed the need for casts.
- The render-and-read loop worked well once I took snapshots at chosen moments: about 20 labelled snapshots per run, with 3–5 read per cycle and one `cli zoom` crop to check the motion trail. The transcript's logs and engagement verdicts caught behaviour, and the frames caught layout. I never needed `--outline`.

## Cycles and why I stopped

I used 5 of 16 cycles. I stopped because I was satisfied: the last cycle's frames had no collisions or unreadable marks that I could find, and the physics and session behaved as scripted. The judgement of look is my own, and an independent viewer may see things I did not.

## What I would want from the library

- A `dash` key on `Style` (dash pattern for strokes).
- `textWidth` that takes the same `TextOptions` object as `text` (it does, but a `measure` that returns the box `text` would draw, without drawing, would remove the mismatch I hit). Or a `v.text(..., { dryRun })` returning bounds.
- A small layout aid for rows of label + control + unit, or at least `v.control` returning its box so labels can be placed relative to it.
- An optional label on the boolean stand-in / browser checkbox (`v.control("theory", { …, label: true })` using the param's `label`).
- A headless overlap check: warn when two text boxes, or text and a control box, intersect in a frame. Most of my cycles were spent finding exactly that by eye.
- Number field stand-ins formatted by `step` (show `2.00` when `step` is 0.01).
