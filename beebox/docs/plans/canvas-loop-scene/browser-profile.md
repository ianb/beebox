# Stage 0: where browser time goes, and the targets

Part of `beebox/docs/implemented-plans/canvas-loop-scene.md`, Stage 0. Measured
2026-11-14 at commit `570e8ef21` (after `2e0720f1a`: one soft-dab image,
hatching batched).

## How it was measured

- **Machine and browser:** Apple M2 Pro; the repo's headless Chromium through
  `bin/browse` (agent-browser), WebGL2 on ANGLE Metal. A desktop Chrome may be
  faster; the ratios matter more than the absolute numbers.
- **Pages:** `scratch/profile/build.ts` bundles one gallery sketch with
  canvas-loop's browser runtime (`mountSketch`, no panel). `?dpr=` forces the
  pixel ratio; `?p=` sets params. It wraps `draw` to record each call's time.
- **Frame rate:** a 5-second `requestAnimationFrame` count after a 2.5-second
  warm-up. The runtime draws only when the model changes, so a still figure
  shows 60 fps with few draws.
- **Profile:** `bin/browse profiler start|stop` on the walker sheet at ratio 2
  for 4 seconds; summarised by `scratch/profile/summarize.py`.

## Frame times

| Sketch | Ratio | fps | `draw` mean | `draw` p95 |
|---|---|---|---|---|
| Walker sheet (`intra-walk-styles`, 16 inked figures, 1280 × 1000) | 1 | 8.6 | 118 ms | 130 ms |
| Walker sheet | 2 | 5.6 | 178 ms | 192 ms |
| Walker sheet, fast drawing (flat fills, plain outlines) | 2 | 60 | 1.8 ms | 2.2 ms |
| Intra room (`intra-rooms`, default room: cached strip plus live parts) | 1 | 60 | 3.8 ms | 4.5 ms |
| Intra room | 2 | 60 | 3.4 ms | 3.7 ms |
| Intra Hallway (panning) | 2 | 60 | 3.2 ms | 3.4 ms |
| Chemistry figure (`balance-reaction-2`) | 1 | 60 | 1.1 ms | 2.2 ms |
| Chemistry figure | 2 | 60 | 0.9 ms | 2.1 ms |

What this says:
- Static and cached work is already fast. The rooms and the chemistry figure
  are well inside a frame.
- Brushed marks drawn every frame are the problem: about 11 ms per inked
  figure at ratio 2. Going from ratio 1 to 2 costs about 1.5×.
- The same figures drawn without brushes take about 0.1 ms each.

## Where the walker sheet's time goes (ratio 2, CPU profile)

Self time, as a share of the sampled main-thread time:

| Share | What |
|---|---|
| 53% | one `drawImage`: compositing each finished brush mark from its scratch layer onto the target (`canvas-loop/src/core/brush/render/mark.ts`, the final `t.drawImage(layer.image, …)` in `renderMark`) |
| 4% | the soft-dab `drawImage` calls inside `paintStamp` |
| 6% | `fill` (ink outlines from perfect-freehand, plain fills) |
| ~15% | sampling and geometry: `shapeSamples`, `resample`, transform `apply`, perfect-freehand |
| ~6% | `setTransform`, `arc`, path building |

Inclusive: `renderMark` 94%, `paintStamp` 16%, `paintInk` 10%.

## A hypothesis for Stage 3

A synthetic test in the same browser (500 marks on a 2560 × 2000 canvas)
showed about 0.4 ms per canvas operation whether a mark fills the target
directly or is copied from a scratch canvas, and 16× more when the scratch
canvas is CPU-backed (`willReadFrequently`). So the cost looks like the
**number of separate canvas operations per frame**, each one a GPU command
with its own setup, more than the pixels they cover. A walker sheet frame
issues several hundred marks, each with several operations.

If this holds, the GPU renderer wins by batching: all dabs of all marks in a
few instanced draws, marks composited in one pass. The Stage 3 dab probe tests
this directly. Unverified: the 0.4 ms figure may be specific to headless
Chromium on ANGLE Metal; the probe repeats it in a desktop Chrome.

## Targets (proposed; the boxholder confirms at Checkpoint 0)

The boxholder named browser animation speed as the goal and headless speed as
unimportant ("trivial compared to agent speed"). Proposed targets, on this
machine in Chromium:

1. **The walker sheet in full ink, ratio 2: 60 fps** (draw and render under
   about 12 ms, leaving room for the page). Today 5.6 fps.
2. **A lit, panning Intra room with two inked walkers, ratio 2: 60 fps.** The
   lit rooms today are hand-built per-pixel code and are not live.
3. **A box page with six animated figures, ratio 2: no dropped input, and each
   visible figure at 30 fps or better.** Offscreen figures cost nothing.
4. **Waking a figure that scrolls back into view: under 100 ms to its first
   frame.**
5. **Headless:** no target beyond today's (the agent's render loop already
   waits on the agent).

Targets 1 and 2 are the ones Checkpoint 3 and 4 judge the backend against.
