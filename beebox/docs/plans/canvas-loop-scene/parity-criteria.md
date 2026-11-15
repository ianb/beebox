# Stage 3: parity criteria

Part of `beebox/docs/plans/canvas-loop-scene.md`. Written before any Stage 3
probe ran (2026-11-15), so results are judged against fixed criteria rather
than accepted as they come. The boxholder's standing guidance: "Deterministic
is more like it", not GPU-exact; brushes "may be reimplemented" and judged by
eye. The criteria are proposed; the boxholder confirms or changes them at
Checkpoint 3, before any probe result is used to choose a backend.

Three separate measures, never mixed.

## 1. Repeatability (same runtime)

- **Headless (Skia):** two renders of the same scene are byte-identical. As
  today (`gallery:check`).
- **Browser (GPU):** two renders of the same scene on the same machine and
  browser are pixel-identical, and a frame rendered with caches, without
  caches, and after waking is identical (draft 2.2, section 6). Measured on
  this machine; if a GPU backend cannot meet it, the probe reports where it
  fails.

## 2. Appearance across renderers (headless against browser)

On identical scenes, at the same pixel ratio:

| Content | Measure | Pass |
|---|---|---|
| Flat fills, plain strokes, gradients, text | per-channel difference, excluding a 1-pixel band along edges | 99% of pixels within 4/255 |
| Antialiased edges | coverage along edges, sampled across the edge | mean difference under 0.15 coverage; no visible step or halo at 4× zoom |
| Compositing (opacity, blends, erase, masks, clips) | per-channel difference | as flat fills |
| Brush marks, paper grain, wash, hatching | judged by eye on 4× crops, side by side; plus mean luminance and texture contrast (standard deviation) in each crop | same character to the eye (Astra and the boxholder); mean luminance within 3%; contrast within 15% |
| Lighting | per-channel difference on lit scenes | mean under 3/255; no visible banding |

Brushes are allowed to differ in detail (Checkpoint 0). What must match is
character: weight, texture, edge softness, how dabs build tone.

## 3. Stability over time

- In an animation, anything that does not change in the scene does not change
  in the pixels: zero difference frame to frame for static parts, in both
  runtimes.
- A moving shape's texture does not boil or crawl unless the sketch asks for it
  (brush seeds hash the stroke's own geometry, draft 2.2 section 4): measured
  on a translated brushed shape, the texture inside it moves with it.
- A small edit to one shape changes only the pixels that shape and its effects
  reach.

## How the probes report

Each probe states, for its content: repeatability result per runtime, the
appearance measures above with 4× crops in an exhibit, the stability check if
it animates, and timing at pixel ratio 1 and 2. Astra (`codex gpt-6-astra`)
reads the crops before the boxholder does.
