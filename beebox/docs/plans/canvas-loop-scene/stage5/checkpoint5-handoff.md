# Checkpoint 5 hand-off: the new canvas-loop renderer

2026-11-16, branch `worktree-canvas-brushes`. Subplans (a) scene core,
(b) GPU brushes and the returned-scene change are built. Nothing is merged
or deployed.

## What changed for a sketch author

- `draw` returns its drawing. Each call on `v` makes a piece of the
  picture; `draw` returns them as a list. Groups, clips and transforms take
  their contents as a list. Lists can be built with `.map` and `cond && x`.
- Reusable drawings are pictures: `v.picture(...)` draws once, `v.place(...)`
  puts it anywhere. They replace `v.cache`, `v.sprite` and `v.image`.
- `v.ctx` (raw Canvas2D) is gone. Calling it, or another removed call, gives
  an error that names the replacement and the doc section.
- New: lighting (lit groups, lights, materials, shadows), wash, hatching and
  paper as effects, `v.noise`.
- `cli run` type-checks the sketch first and reports mistakes with the line.
- The docs are `TEA.md` and `BRUSHES.md`, rewritten for this form. A fresh
  agent drew a brief from them alone in three renders.

## What renders where

- One renderer. In the browser it uses WebGPU. Headless (`cli run`,
  `bbx figure run`) it uses Dawn, the same engine Chrome uses, through the
  `webgpu` npm package. The Canvas2D painter is deleted.
- Brushes are laid out on the GPU; the CPU only prepares each stroke.
- A machine needs a GPU, or a software Vulkan driver (Mesa lavapipe) on a
  server without one.
- A browser without WebGPU shows an error through the figure's `onError`.
  What a box card shows then is subplan (c)'s work.

## Speed

Chromium on this Mac, pixel ratio 2, quiet machine (load 4.5, no game
running). fps is frames drawn per second.

| | Checkpoint 4 | Chunk 4b end | After returned scene | Now |
|---|---|---|---|---|
| Walker sheet (target 60) | 22.8 | 58 | 56.4 | 57.1 |
| Hallway, panning (target 60) | 58.8 | not run | not run | 59.9 |
| Chemistry figure | 60 | not run | not run | 59.5 |
| Six figures, each (target 30) | 11.0 | 24.2 | 24.2 | 24.7 |
| Pointer move to drawn frame, 95th percentile (target 33 ms) | not run | 99 ms | 98 ms | 66 ms |

All 120 scripted pointer moves reached the figure. The pointer number
swings between about 64 and 105 ms from run to run: one frame of the
six-figure page.

Headless, 90 frames with `cli run`, wall time including the type check:
walker 2.7 s (ratio 1) and 3.2 s (ratio 2), chemistry 2.3 and 2.5 s,
Hallway 6.3 and 8.6 s. Checkpoint 4 had 0.5–4 s. The Hallway is slower
because a headless run redraws each picture every frame to check it, and
the Hallway's room is one large picture.

## What was accepted, and why

- **Walker at 57 fps, not 60; six figures at 25 fps, not 30.** You chose to
  accept desktop numbers for now. Going further needs the drawing work moved
  off the page's main thread, which is its own plan.
- **Pointer delay above 33 ms.** No input is lost. The delay is one or two
  frames of a page that draws at 25 fps.
- **Brush texture.** Brush marks differ in detail from the old renderer.
  Astra (Codex) looked at every gallery drawing, old and new side by side,
  and found no difference a person would notice: no lost effect, no wrong
  colour, no overlapping text.
- **The returned form cost about 1 fps on the walker.** Accepted after R5:
  the walker's frame sits on the 16.7 ms edge, so 0.1 ms more drops some
  frames to the next screen refresh.
- **Still open, small:** the brush tests' reference numbers skip some cases
  to keep the repo about 1 MB smaller (every fourth walker stamp; one size
  for the jitter case). Restoring them means recording from an older
  commit. Lean: leave them.

## What remains: subplan (c), box figures

`canvas-loop-box-figures.subplan.md`, about 835 lines. It moves beebox's
figure card and `bbx figure run` to the new renderer, adds the server's
software GPU driver, rewrites the box agent's figure guidance and starter,
and shows a plain notice when a figure needs updating or the browser cannot
draw it. Then three production steps, **each needs your yes**:

- **P1.** Install Mesa on the production server and run a short Dawn probe
  as one box user. Nothing that runs today changes.
- **P2.** Merge to `main`. This deploys the new renderer to every box.
- **P3.** Send the courseware agent the regeneration prompt in (c), when you
  choose, so it rewrites its figures in the new form.

An optional **P0** (also needs a yes) runs the new `bbx figure run` on a
local copy of the courseware box first, to see which figures fail.

The exhibit "Gallery on the final renderer: before and after" holds the
frames.
