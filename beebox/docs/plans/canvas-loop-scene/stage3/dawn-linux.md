# Stage 3: Dawn on a GPU-less Linux host

Part of `beebox/docs/implemented-plans/canvas-loop-scene.md`; the probe Checkpoint 3 asked
for (2026-11-15). Question: can the WebGPU renderer run headless on a server
with no GPU, so one implementation serves the browser and headless?

## Setup

- A Lima VM on the Mac (`cl-dawn`): Ubuntu, aarch64, 2 CPUs, 3 GB, no GPU.
- Mesa's software Vulkan driver (`mesa-vulkan-drivers`; device "llvmpipe
  (LLVM 21.1.8, 128 bits)", type CPU). Node 24.18.0. The `webgpu` npm package
  0.6.2 (Dawn), which ships a prebuilt `linux-arm64` binary (also
  `linux-x64`).
- The light-and-paint probe's Node script (`scratch/stage3/light-and-paint/node.ts`),
  bundled with esbuild and run unchanged: the lit room with five variants
  (flat, lit, wash, hatching, both) at pixel ratio 1 and 2.

## Results

**It runs.** Dawn found the software device; no validation errors. The only
noise is a loader message about an unrelated PowerVR driver, and a warning
that a storage-buffer limit was reduced.

**Repeatable.** All 10 outputs were byte-identical run to run.

**Matches the Mac's GPU almost exactly.** Against the same renders from Dawn on
the Mac (Metal):

| Variant (ratio 1) | Pixels within 4/255 | Mean difference (levels) | Largest |
|---|---|---|---|
| flat | 100% | 0.000 | 1 |
| lit | 99.99% | 0.001 | 10 |
| wash | 100% | 0.002 | 5 |
| hatching | 100% | 0.001 | 4 |
| both | 100% | 0.001 | 4 |

So headless output on a server would look the same as on the Mac and in the
browser, not just repeat itself.

**Speed** (mean per frame, 10 frames, 2 CPUs):

| Ratio | Full lit | Light only | Lit + wash + hatching |
|---|---|---|---|
| 1 | 1.29 s | 1.06 s | 1.50 s |
| 2 | 5.06 s | 4.31 s | 6.48 s |

The lit room is the heaviest scene the probes built: per-object distance fields
and shadows for four lights. Headless renders run at ratio 1. Software Vulkan
spreads work over cores, so a server with more CPUs is faster. Scenes without
lighting were not timed here.

## What this means

- The recommendation holds: one WebGPU implementation, Dawn headless, with no
  Skia fallback needed for correctness.
- Headless speed is near the boxholder's 1-second allowance only for lit
  scenes. Two levers: render only the frames a run captures (the transcript
  needs a few frames, not every frame), and time an unlit brush scene in
  Stage 4 to confirm ordinary scenes are well under a second.
- Open: the production server's CPU type and core count. Dawn ships x64 and
  arm64 Linux binaries, so either works.
