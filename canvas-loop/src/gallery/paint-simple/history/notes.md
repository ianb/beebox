# paint-simple notes

## Cycle 1
**Intent:** First working version. Strokes as data (brush, colour hex, width, seed, points); params choose brush/colour/size (S/M/L mapped to a per-brush width table); `clear` and `undo` triggers. Pressure is keyframes from point spacing (one mousemove per frame = speed), smoothed, start taper always, end taper once finished. Finished strokes are drawn with the paper background into `v.cache("page-<page>-<count>")`; the stroke in progress is drawn live. Scripted drawing: ink signature, red marker sweep, blue bristle arc, three green pencil hatches, ochre wash, undo, clear, blue ink spiral, red bristle slash.

**Seen:** Painting works end to end: every mousedown reads `stroke-start`, every mouseup `stroke-end`, undo and clear engage. Ink, marker, bristle and pencil all read as their brushes; the bristle arc shows separate streaks. Speed-to-width is only faintly visible: the ink wave is a near-even 3px line with slightly heavier slow ends, and ink L in the spiral is ~5px, thinner than the size chip suggests. The ochre wash never appeared in a snapshot: my "first page" snapshot shares a frame with the undo trigger, so it shows the page after undo. Timing: draw avg 2.5 ms, p95 6.1 ms, max 72 ms (a cache rebuild on mouseup); update avg 0.02 ms.

## Cycle 2
**Intent:** Separate the "first page" snapshot from the undo so the wash shows. Stronger speed response (pressure bottoms out at 26 px/event instead of 34) and wider ink (4/8/14) and bristle (16/28/40) so size and speed both read.

**Seen:** The ochre wash now shows in "first page": a broad soft sweep with paper texture. Speed now reads in the ink: in the spiral the fast inner turns are ~6 px and the slow outer end swells to ~15 px (zoom), which looks like a blob more than a hand slowing down. Finishing a stroke changes only its last ~24 px (cli diff of frames 37/38: 139 px), so the end taper does not jump the rest of the stroke. Timing: draw avg 2.7 ms, p95 6.3 ms, max 90 ms. The max is the cache rebuild on mouseup, which redraws every finished stroke, so it grows with the drawing.

## Cycle 3
**Intent:** Make finishing a stroke cost one stroke: chain the cache, so layer N pastes layer N−1 and adds stroke N (`v.cache` called inside a `v.cache` body). Soften the speed response (minimum pressure 0.3 → 0.4) so slow ends swell less.

**Seen:** The chained cache renders the same page as the flat one ("first page" and "after undo" match cycle 2 by eye; undo reuses the kept layer 4). Slow ink ends still swell but less. Timing: draw avg 2.1 ms, p95 5.4 ms, max 76 ms (was 2.7 / 6.3 / 90). With only 5 strokes per page the chained and flat rebuilds cost about the same, so this run does not show whether chaining pays; the max is likely one expensive stroke (the 70 px wash), and `--timing` does not say which frame.

## Cycle 4
**Intent:** A drawing with more strokes, to test how per-frame and per-finish cost behave as strokes accumulate: twelve quick ink hatches at the end of the second page (shorter first ink line and spiral to fit 300 frames). No sketch change, so cycle 5 can run the same events with a flat (unchained) cache for comparison.

**Seen:** Second page now ends with twelve short ink hatches (thin leaf-shaped marks, both ends tapered); all 268 events engage as intended, no `(unhandled)`. Timing: draw avg 2.3 ms, p95 5.2 ms, max 91 ms; frame 0 27.7 ms. Per-frame cost did not grow with 14 strokes on the page.

## Cycle 5
**Intent:** Measurement only: the same events with a flat cache (each layer redraws paper + all strokes up to N) instead of the chain, to see what chaining saves on stroke finish.

**Seen:** Frames are byte-identical to cycle 4 (frames 179 and 291 `cmp` equal), so the chain changes cost only. Timing with the flat cache: draw avg 2.9 ms, p95 10.9 ms, max 91 ms (chained: 2.3 / 5.2 / 91). The p95 doubles because each of the ~19 stroke-finish frames redraws the whole page; the max is the same single expensive frame in both. Frame 0 read 115 ms here against 28 ms in cycle 4 with identical work (an empty page), so single-frame numbers carry tens of ms of noise.

## Cycle 6
**Intent:** Restore the chained cache. Pencil a little wider (3/4.5/6), since the S hatches on page one are barely visible at 1×. Final run for the account.

**Seen:** Same page as cycle 4 with slightly stronger pencil hatches; they are still the lightest marks on the page (pencil is light by design). Zoom on the bristle arc's tail: the dry-out reads as a row of separate square dabs beside the stroke, a dotted line more than dry bristles. Timing: draw avg 2.4 ms, p95 5.8 ms, max 72 ms; update avg 0.02 ms; frame 0 49.7 ms. Lint and typecheck clean.
