# Gallery parity: the scene renderer against the Stage 0 frames

Part of `beebox/docs/plans/canvas-loop-scene-core.subplan.md`, Track 5
(chunk 5). Each gallery exercise is rendered on the scene renderer (Dawn,
Metal, ratio 1) with the gallery's frames, seed, `every` and events, and each
frame is compared with `canvas-loop/out/baselines/570e8ef21/<slug>/`.

## How the numbers are made

- Scripts: `scratch/stage5/a5/render.ts` (renders), `compare.ts` (measures),
  `table.ts` (this table). Not committed.
- **Frames compared:** the baseline frames that the new run also captured.
  A frame the new run captured with no change from the last one is taken from
  that one. "8 of 12" means 4 baseline frames were not captured by the new
  run (see F below).
- **Parity pass, min flat, max edge:** parity-criteria.md section 2, the
  functions in `canvas-loop/test/gpu/compare.ts`, over the whole frame:
  flat is the share of non-edge pixels with every channel within 4/255
  (pass 99%); edge is the mean coverage difference along edges (pass under
  0.15).
- **Max lum / contrast Δ %:** the largest change over the frames of mean
  luminance and of its standard deviation (over white), in percent. For
  brush marks, paper grain, wash and hatching the criteria are these numbers
  (within 3% and 15%) and the eye on 4× crops, since a brushed frame never
  meets the flat measure after the texture change.

## Expected differences

From the accepted draft decisions:

- **brush texture (7):** brushed drawings change texture once.
- **effect lengths (1):** effect lengths follow their group's transform.
- **paper on transparent (4):** `effects.paper` leaves transparent areas alone.
- **paper scoped (10):** paper is scoped to its group, picture or scene.
- **snap (2.6):** placements snap to whole device pixels.

## Other differences seen

- **T, text:** light text on a dark ground draws a little lighter and thinner
  than the painter's. Within the parity measures; seen on the clock, the orbit
  toy and dark title text. Not changed in this chunk.
- **F, faint-mark frames:** the painter warned about faint marks at the
  canvas edge and captured those frames; the scene renderer's faint-mark
  check (chunk 3: the peak is taken before any clip) gives no warning there,
  so those frames are not captured. Nothing is drawn differently.
- **H, hints:** testing mode now gives hints the painter did not, for
  example a picture placed turning a little each frame ("drawn again every
  frame; draw it as a group instead"). Hints add captured frames; they change
  no pixels.
- **A1, trails (accepted):** a sketch that draws a translucent rectangle
  instead of a background, to leave motion trails over the last frame, now
  draws over an empty canvas. Each scene frame starts clear; the painter's
  canvas kept the last frame. The ground shows light grey where it was dark.
  Accepted: a scene describes the whole frame (draft section 8), and caches,
  sleep and cache equivalence depend on it. A sketch that wants trails keeps
  its recent positions in its model and draws them. TEA.md should say each
  frame starts clear (chunk 7).

## Table

Verdicts: **pass** (the measures pass, or for brushed and papered frames the
eye and the luminance numbers), **accepted** (a difference outside the
expected list, with its reason), **fixed** (a renderer bug fixed in this
chunk, with a test).

<!-- table:start -->
| Exercise | Source | Frames compared | Parity pass | Min flat % | Max edge | Max lum / contrast Δ % | Expected differences seen | Verdict |
|---|---|---|---|---|---|---|---|---|
| `alien-bezier` | unchanged | 1 | 0/1 | 96.03 | 0.104 | 0.06 / 0.28 | brush texture (7) | pass: same character by eye |
| `alien-curve` | unchanged | 1 | 0/1 | 96.56 | 0.135 | 0.03 / 0.17 | brush texture (7) | pass: same character by eye |
| `alien-polyline` | unchanged | 1 | 0/1 | 96.44 | 0.129 | 0.01 / 0.09 | brush texture (7) | pass: same character by eye |
| `alien-scene-opus-a` | unchanged | 1 | 0/1 | 94.42 | 0.124 | 0.14 / 0.24 | brush texture (7) | pass: same character by eye |
| `alien-scene-opus-b` | unchanged | 1 | 0/1 | 92.85 | 0.107 | 0.22 / 0.03 | brush texture (7) | pass: same character by eye |
| `alien-scene-sol` | unchanged | 1 | 0/1 | 81.86 | 0.188 | 0.18 / 0.45 | brush texture (7) | pass: same character by eye |
| `balance-reaction` | ported: cache, paper | 27 | 27/27 | 99.87 | 0.045 | 0.28 / 1.87 | paper scoped (10) | pass |
| `balance-reaction-2` | ported: paper | 35 | 35/35 | 99.11 | 0.046 | 0.12 / 2.82 | paper scoped (10) | pass |
| `busy-town-opus` | ported: sprite, cache, paper | 50 | 0/50 | 86.37 | 0.175 | 0.09 / 0.32 | brush texture (7), paper scoped (10) | pass: same character by eye; text (T); new hints for pictures placed turning (H) |
| `busy-town-sol` | ported: sprite, cache, paper | 44 | 0/44 | 94.66 | 0.133 | 0.09 / 0.12 | brush texture (7), paper scoped (10) | pass: same character by eye; new hints for pictures placed turning (H) |
| `clock` | unchanged | 12 | 12/12 | 99.99 | 0.047 | 2.33 / 5.64 | none | pass: light text on dark draws lighter (T) |
| `fjord-tides` | ported: ctx | 18 | 18/18 | 99.97 | 0.05 | 0.23 / 1.7 | none | pass |
| `game-world-tiles` | ported: ctx pixels, sprite, cache | 2 | 0/2 | 83.96 | 0.085 | 0.7 / 1.84 | brush texture (7) | pass: same character by eye; the field is a v.pixels image at the map zoom |
| `guitar-strings` | ported: cache, paper | 18 | 0/18 | 96.75 | 0.051 | 0.78 / 2.59 | brush texture (7), paper scoped (10) | pass: same character by eye |
| `gull-market` | ported: paper | 1 | 0/1 | 88.57 | 0.053 | 0 / 0.1 | brush texture (7), paper scoped (10) | pass: same character by eye |
| `intra-atrium` | ported: ctx pixels, sprite, cache | 2 | 2/2 | 99.36 | 0.034 | 0.02 / 0.05 | none | pass: the hand-lit room is a v.pixels image |
| `intra-lounge` | ported: ctx pixels and transform | 2 | 2/2 | 99.99 | 0.007 | 0.07 / 0.05 | none | pass: the hand-lit room and the walker mask are v.pixels images |
| `intra-lounge-drawn` | ported: ctx transform, cache, paper | 2 | 2/2 | 99.87 | 0.028 | 0.32 / 0.2 | paper scoped (10) | pass |
| `intra-lounge-side` | ported: cache, paper | 2 | 2/2 | 99.66 | 0.037 | 0.24 / 0.06 | brush texture (7), paper scoped (10) | pass |
| `intra-map` | ported: cache | 5 | 5/5 | 99.95 | 0.034 | 0.32 / 0.45 | none | pass |
| `intra-rooms` | ported: sprite, cache, paper | 2 | 0/2 | 95.17 | 0.046 | 0.11 / 0.13 | brush texture (7), paper scoped (10) | pass: the strip of sprites is one picture, as in the Hallway port |
| `intra-scale-reference` | ported: paper | 1 | 0/1 | 92.87 | 0.026 | 0.08 / 0.08 | brush texture (7), paper scoped (10) | pass: same character by eye |
| `intra-walk-study` | unchanged | 4 of 12 | 4/4 | 100 | 0.029 | 0.08 / 0.12 | brush texture (7) | pass: 8 frames the painter captured for edge faint-mark warnings are not captured (F) |
| `intra-walk-styles` | unchanged | 2 | 2/2 | 99.99 | 0.024 | 0.06 / 0.84 | brush texture (7) | pass |
| `lens-rays` | unchanged | 15 | 15/15 | 99.86 | 0.039 | 0.09 / 3.16 | none | pass |
| `library-anim` | ported: cache, paper | 22 | 0/22 | 93.5 | 0.164 | 0.42 / 0.37 | brush texture (7), paper scoped (10) | pass: same character by eye |
| `nell-anim` | ported: cache, paper | 29 | 0/29 | 78.92 | 0.108 | 1.74 / 0.52 | brush texture (7), paper scoped (10) | pass: the sky grain is finer: the paper set inside the cached background no longer reaches the frame-wide paper effect |
| `open-opus-a` | ported: paper | 1 | 0/1 | 92.77 | 0.131 | 0.9 / 0.13 | brush texture (7), paper scoped (10) | pass: same character by eye |
| `open-opus-b` | ported: paper | 1 | 0/1 | 83.02 | 0.154 | 0.28 / 0.69 | brush texture (7), paper scoped (10) | pass: same character by eye; text (T) |
| `open-sol` | ported: paper | 1 | 0/1 | 93.43 | 0.169 | 0.4 / 0.32 | brush texture (7), paper scoped (10) | pass: same character by eye |
| `orbit-toy` | unchanged | 13 | 13/13 | 99.54 | 0.118 | 2.11 / 10.58 | none | pass: light text on dark draws lighter (T) |
| `paint-simple` | ported: cache | 249 | 238/249 | 98.66 | 0.059 | 0.01 / 7.03 | brush texture (7) | pass: nested pictures replay the page stroke by stroke |
| `particles-opus` | unchanged | 22 | 4/22 | 4.64 | 1.201 | 1092.57 / 94.5 | none | accepted: trails (A1): frames from 84 on lose the dark background |
| `particles-sonnet` | unchanged | 20 | 3/20 | 0 | 1.353 | 894.88 / 90.33 | none | accepted: trails (A1): frames from 60 on lose the dark background |
| `pelican-bicycle` | deferred to chunk 6 | — | — | — | — | — | — | deferred: v.ctx; the playground imports it (Track 5) |
| `pell-anim` | ported: ctx text, cache, paper | 21 of 27 | 0/21 | 84.02 | 0.137 | 0.25 / 0.8 | brush texture (7), paper scoped (10) | pass: same character by eye; 6 frames captured by the painter for faint-mark warnings are not captured (F); text (T) |
| `pendulum-lab` | ported: cache | 55 | 55/55 | 99.68 | 0.052 | 0.09 / 1.33 | none | pass |
| `periodic-trends` | unchanged | 16 | 16/16 | 99.99 | 0.034 | 0.15 / 1.28 | none | pass |
| `periodic-trends-2` | unchanged | 12 | 12/12 | 99.87 | 0.055 | 0.08 / 0.7 | none | pass |
| `scene-market-opus-a` | authored (Stage 4 drawer) | — | — | — | — | — | no Stage 0 frames | new: renders on the scene renderer, deterministic; checked by eye |
| `scene-market-opus-b` | authored (Stage 4 drawer) | — | — | — | — | — | no Stage 0 frames | new: renders on the scene renderer, deterministic; checked by eye |
| `scene-market-sol` | authored (Stage 4 drawer) | — | — | — | — | — | no Stage 0 frames | new: renders on the scene renderer, deterministic; checked by eye |
| `scene-night-room-opus-a` | authored (Stage 4 drawer) | — | — | — | — | — | no Stage 0 frames | new: renders on the scene renderer, deterministic; checked by eye |
| `scene-night-room-opus-b` | authored (Stage 4 drawer) | — | — | — | — | — | no Stage 0 frames | new: renders on the scene renderer, deterministic; checked by eye |
| `scene-night-room-sol` | authored (Stage 4 drawer) | — | — | — | — | — | no Stage 0 frames | new: renders on the scene renderer, deterministic; checked by eye |
| `scene-pendulum-opus-a` | authored (Stage 4 drawer) | — | — | — | — | — | no Stage 0 frames | new: renders on the scene renderer, deterministic; checked by eye |
| `scene-pendulum-opus-b` | authored (Stage 4 drawer) | — | — | — | — | — | no Stage 0 frames | new: renders on the scene renderer, deterministic; checked by eye |
| `scene-pendulum-sol` | authored (Stage 4 drawer) | — | — | — | — | — | no Stage 0 frames | new: renders on the scene renderer, deterministic; checked by eye |
<!-- table:end -->

## Examples

The top-level examples have no Stage 0 frames. Each was rendered on the
painter before its marker and on the scene renderer after (90 frames, every
30, its events file), and the two compared the same way. None calls a removed
member; each changed only by the transition marker.

| Example | Frames | Parity pass | Min flat % | Max edge | Max lum / contrast Δ % | Verdict |
|---|---|---|---|---|---|---|
| `alien-reference-tea.ts` | 1 | 1/1 | 99.95 | 0.02 | 0.02 / 0.1 | pass |
| `answer-box-tea.ts` | 5 | 5/5 | 99.62 | 0.031 | 0.06 / 0.69 | pass |
| `bounce-tea.ts` | 12 | 12/12 | 100 | 0.096 | 0.42 / 3.41 | pass |
| `brushes-sampler-tea.ts` | 1 | 0/1 | 95.28 | 0.274 | 0.12 / 0.98 | pass: brush texture (7), same character by eye |
| `effects-tea.ts` | 4 | 4/4 | 99.82 | 0.014 | 0.32 / 0.08 | pass |
| `paint-mixing-tea.ts` | 1 | 0/1 | 76.97 | 0.191 | 0.41 / 1.76 | pass: brush texture (7); the bristle hairs along the hill tops are darker and more distinct |
| `sound-tea.ts` | 9 | 9/9 | 100 | 0.028 | 0.06 / 0.17 | pass |

- `night-room-tea.ts`, `still-life-tea.ts`, `washed-shapes-tea.ts` moved from
  `examples/scene-looks/`; they were written for the scene API, so they have
  no painter frames. They gain the `renderer` export.
- **Deferred to chunk 6:** `brushes-tea.ts` (calls `v.paperTexture`; the
  playground imports it), and `orbit-tea.ts` and `fjord-tea.ts`. These two
  call no removed member, but the dev demo mounts them on Canvas2D and
  `test/headless.tea-determinism.test.ts` runs `orbit-tea.ts` through
  `teaRun` in the test phase that opens no GPU. With the marker that test
  would open a GPU device in parallel with other tests. Chunk 6 switches all
  three with the dev demo and the playground.
