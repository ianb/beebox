# Stage 3 summary and the Checkpoint 3 recommendation

Part of `beebox/docs/implemented-plans/canvas-loop-scene.md`. Five probes ran on an Apple
M2 Pro in the repo's headless Chromium (2026-11-15). The Mac crashed once when
all five ran at once (shared CPU and GPU memory); after that they ran one at a
time with memory bounds. Notes, in this folder: `scene-cost.md`,
`geometry.md`, `compositing.md`, `brushes.md`, `light-and-paint.md`. Astra
(Codex gpt-6-astra) read eleven of the comparison images; its findings are
quoted below where they bear on a decision.

## What the probes found

| Question | Answer |
|---|---|
| Is building and comparing scenes cheap enough? | Yes: 1–4.6 ms per frame in the worst realistic cases; deps comparison is negligible. Capturing arguments by value is most of the cost; freeze helper results and hash while recording. |
| Which backend draws shapes well? | Our own WebGPU renderer (exact-area coverage, as Skia does) and CanvasKit both pass parity; PixiJS fails flat fills and needs `unsafe-eval`. Speed is similar for all three (8–11 ms for 2000 shapes at ratio 2), so shapes do not decide. |
| Does the compositing contract work on the GPU? | Yes: 35 of 36 fixtures match Skia; the 36th differs where the draft intends. Cost is set by the number of render passes (~60 µs each), not texture size; packing groups into shared textures took a 200-group frame from 601 passes (36 ms) to 4 (10.5 ms at ratio 2). |
| Can the GPU draw today's brushes with the same character? | Yes, in both WebGPU and CanvasKit, reusing today's stroke expansion unchanged. Astra: "same character across all three" for every brush; texture now moves with a moving shape. 500 marks at ratio 2: WebGPU 14 ms, CanvasKit 56 ms, today 94 ms. Smudge: WebGPU 8–14 ms, today 200+ ms. |
| Lighting, wash, hatching? | WebGPU does the whole chain: 10.6 ms at ratio 2 with a moving light over a cached room, 24 ms with everything changing (misses 60 fps at ratio 2 without the levers not yet tried). CanvasKit can run the shading as SkSL but cannot build the per-object distance field, and takes 107 s per lit frame headless. |
| Can headless run the browser's code? | **Dawn (WebGPU in Node) gave output byte-identical to Chromium's WebGPU, and byte-identical run to run**, on this Mac's GPU. A GPU-less Linux host was not tried. |
| Is the lit look good? | Not yet. Astra: the lit-only room "leans toward a generic clay diorama" (uniform rounded cushions, a featureless padded person, a neat light cone, placeholder screens); wash helps most; hatching "resembles a screen overlay". The probe's author said the same. |

## Recommendation: our own WebGPU renderer, one implementation

- **Browser:** our own WebGPU renderer. It draws brushes about 4× faster than
  CanvasKit with the same character, runs smudge as one GPU step, computes
  paper grain exactly, builds lighting's distance fields, and shares one set of
  textures between shapes, brushes, groups and effects.
- **Headless:** the same renderer running under Dawn in Node. On this Mac it is
  byte-identical to the browser, so one implementation serves both and the
  agent judges exactly what a person sees. This removes most of the parity
  work the plan budgeted for.
- **Fallback, only if Dawn cannot run on a server:** keep today's Skia renderer
  headless for everything it can draw, and write CPU versions of the new
  effects. (Two implementations, which the boxholder said is manageable.)
- **Not CanvasKit everywhere:** one engine is its strength, but it is 4× slower
  on brushes, cannot build lighting's distance fields, and is far too slow for
  lit scenes headless (107 s per frame against a 1-second allowance).

## What gates the recommendation

1. **Dawn on the production server.** Box agents run figures headless on the
   server (`bbx figure run`), which has no GPU as far as this plan knows. Dawn
   needs a GPU adapter or a software one (SwiftShader or Mesa's lavapipe).
   **Proposed probe:** a small Lima VM on this Mac (aarch64 Linux, 2 CPUs,
   3 GB, no GPU) running the light-and-paint scene under Dawn with a software
   adapter: does it run, how fast, is it byte-identical run to run, and how
   close to the Mac's GPU output. The production server's architecture and
   GPU are a question for the boxholder.
2. **Cross-machine output.** Even if Dawn runs everywhere, two machines' GPUs
   will not agree byte for byte. `gallery:check` (two runs on one machine)
   still works; any "before" baseline compares within one machine.

## Gate 1 result (after Checkpoint 3)

Dawn runs on a GPU-less Linux VM with Mesa's software Vulkan: byte-identical
run to run, and within 0.002 levels of the Mac GPU's output; 1.3–1.5 s per lit
frame at ratio 1 on 2 CPUs (`dawn-linux.md`). The recommendation holds without
a Skia fallback.

## Decisions for the boxholder at Checkpoint 3

1. **Backend:** our own WebGPU renderer, with Dawn headless (recommended), or
   CanvasKit everywhere.
2. **The parity bar** (`parity-criteria.md`): keep as written. The probes met
   it everywhere except the deliberate draft changes.
3. **Thin lines:** WebGPU draws 0.5–1 px diagonals in fewer, darker pixels than
   Skia. Astra: "acceptable by eye". Accept?
4. **Compositing details:** a group's shadow made before its blur (sharper;
   Astra: "neutral overall, slightly better for definition"), and shadow blur
   at its full stated value (what both runtimes do today; the docs said half).
5. **The Linux VM probe** above, and what the production server has.
6. **Lighting's look** is not settled. The renderer works; the art does not
   yet. Stage 4's lit room should aim at the hand-built rooms' qualities
   (Astra: curved architecture, broken silhouettes, layered clutter, oblique
   depth, darkness that conceals), and the API additions the probe listed
   (caster height, grouping parts into one object, bevel profile, height or
   normal-map input, tone curve and exposure, hatching relative to scene
   tone) go into the Stage 1 draft before Stage 4.
