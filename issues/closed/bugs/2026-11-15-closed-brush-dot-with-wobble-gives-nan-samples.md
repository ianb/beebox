---
title: "A closed brushed shape shorter than one step, with wobble, gives NaN samples on the CPU"
workstream: canvas-brushes
area: canvas-loop
labels: [brushes]
filed-by: agent
discovered-by: agent
discovered-in: worktree-canvas-brushes — GPU brushes chunk 2 (sample pass)
resolution: implemented
---

**Closed (implemented, 2026-11-15):** 4537ae4b6

`shapeSamples` (`canvas-loop/src/core/brush/render/mark/render.ts`) divides
arc length by the wobble cell. For a closed contour with one sample (shorter
than one step, for example `v.rect(10, 10, 0.1, 0.1, { stroke: "#000",
weight: 4, brush: "ink", gesture: { wobble: 1 } })`), `wobbleLattice` gets a
total of 0, so the cell is `0 / 1 = 0` and the sample's position is
`0 / 0 = NaN`. An open dot does not have this problem: its cell is 28.

What a person sees: such a dot is not drawn, or is drawn wrong, depending
on what the kind painter does with NaN.

The GPU sample pass (`canvas-loop/src/gpu/shader-brush.ts`) reads the noise at
0 when the cell is 0, so it places the dot at its start plus the wobble
there. The readback tests leave this case out. Fix the CPU path to match
(noise at 0 when the cell is 0), then add the case to
`canvas-loop/test/scene/brush-focused.ts`.
