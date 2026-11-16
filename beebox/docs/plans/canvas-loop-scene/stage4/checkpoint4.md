# Checkpoint 4: summary for the boxholder

Stage 4 of `beebox/docs/implemented-plans/canvas-loop-scene.md`, 2026-11-15. The spike
renderer (`canvas-loop/src/scene-spike/`) draws a recorded scene with WebGPU,
in the browser and headless through Dawn. The exhibit "Canvas-loop scene
renderer: Checkpoint 4" holds the images.

## What was built

- **Chunks 1–5:** the scene recorder and renderer, and the three ports.
  - Shapes, compositing, brushes, pictures and text.
  - Wash, hatching, paper and lighting.
  - The three ports: the walker sheet, the Hallway and chemistry.
- **Chunk 6a:** the browser mount on one shared GPU device. An offscreen
  figure stops at once and releases its GPU memory after 2 seconds
  offscreen. Lost-device recovery and the DOM controls work.
- **Chunk 6b:** one figure card runs through beebox's real browser card and
  through `bbx figure run`, opted in with `export const renderer = "scene"`.
- **Chunk 7:** the dev-loop checklist, `dev-loop.md`. It has 46 deliberately
  bad sketches with their expected output: 18 passed as built, 23 gaps fixed,
  5 gaps left with proposals.
- **Drawing round:** three agents drew the same three scenes and wrote
  accounts; see `drawing-findings.md`. Fixes followed: dashes, a wash
  continuous at the canvas edge, an off-canvas warning, the placement-scale
  hint, param transcript lines, labelled control stand-ins, and light
  brightness in the outline.
- **Visual review fixes:** an Astra read found two renderer defects, speckled
  soft-shadow edges and bright fringes on shadowed edges of casters. Both
  are fixed.

Every chunk had a Codex review; each finding was checked against the source
and fixed or recorded.

## The principles

1. **Agent DX.**
   - Errors name the call, the rule, the value and the sketch line. Each
     drawer fixed its errors in one step.
   - Warnings appear once per run with the line.
   - Renders take 1–4 s for 90 frames.
   - Gaps: 5 checklist rows (`dev-loop.md`). Under a slowly panning camera,
     the off-canvas warning is noisy: 7 warnings on one drawer's room that
     the camera had not reached in 90 frames.
2. **Art that doesn't look like lazy digital art.**
   - Astra: the three ports keep today's character.
   - Astra: the second Opus drawer's scenes are the most crafted. The first
     Opus drawer's are authored, but weakened by repeated mottling.
   - Astra: the Codex drawer's market is flat and assembled, which is a
     drawing choice.
   - Astra's weaknesses: one even texture over every material; plastic
     bevels on the lit night room; straight, even hatch marks.
   - Your eye decides this principle.
3. **Composability.** Pictures with `deps` gave two vendors from one drawing,
   first try, for every drawer. `v.toCanvas` hung a lantern from a hand two
   rotations deep.
4. **Speed.** See the next section.
5. **Familiar APIs.** No drawer looked up a shape, style, `at`, `group` or
   `clip` call.

## Speed against the Stage 0 targets

Chromium on this machine, ratio 2.

| Target | Result | Status |
|---|---|---|
| 1. Walker sheet in full ink, 60 fps | 22.8 fps (today 5.6) | missed |
| 2. Lit panning room with walkers, 60 fps | Hallway panning 58.8 fps, unlit; lit room 9–22 ms per frame headless, not measured live | close; not measured as specified |
| 3. Six animated figures, 30 fps each | 11 fps each with walkers | missed |
| 4. Wake under 100 ms | 0.1–0.4 ms when back within 2 s; 26–77 ms after a release | met |
| 5. Headless | 0.5–4 s for a 90-frame run | met |

Targets 1 and 3 miss for one reason: brush expansion runs on the CPU, about
15 ms for the walker's 527 moving strokes. It takes more than the whole frame
budget before anything is drawn. No stroke repeats between frames, so no cache
helps. The "Walker speed" section of `stage4-plan.md` has the profile.

Chromebook-class check: not done; no such device is on hand.

## Decisions for you

1. **Backend.** Confirm our own WebGPU renderer, with Dawn for headless
   (chosen provisionally at Checkpoint 3). The spike supports it: Dawn output
   is byte-identical to Chromium WebGPU, and the same renderer serves
   beebox's card and `bbx figure run`.
2. **Brush speed.** For targets 1 and 3, either:
   - (a) expand brushes in a GPU compute pass. This is the fastest option.
     Ink outlines change slightly, held to the parity criteria instead of
     identical pixels.
   - (b) expand brushes on Web Workers. Same pixels, less gain.
   - (c) accept about 23 fps for a scene with 500 moving brushed strokes.

   Lean: (a), as its own subplan in Stage 5.
3. **Placement snapping** (draft 2.6, provisional). A placed picture snaps to
   whole device pixels so that panning reuses its kept image. Lean: keep it.
   The Hallway's 58.8 fps panning depends on it.
4. **Side-view shadows.** Lighting is top-down, so in a side view casters
   throw shadows up into the sky. Add `material.receivesShadow: false` for
   backdrops? Lean: yes, a small draft addition.
5. **A light across washed groups.** A light lights only its nearest lit
   group, so a lantern cannot light neighbouring stalls that have their own
   washes. Lean: document the pattern (one lit group around the washed
   groups) and revisit if box agents hit it.
6. **Hatching coverage.** Hatching covers a group's whole layer (wall and
   shadows included) and overshoots light silhouettes by a few pixels. Should
   lines be gated by each pixel's own tone? Lean: yes; the overshoot reads
   as a mistake.
7. **Chromebook check.** Borrow or buy a low-end Chromebook, or accept
   desktop numbers for now? This costs money if bought.

## The boxholder's answers (2026-11-15)

1. Backend: our own WebGPU renderer, with Dawn headless. Confirmed.
2. Brush speed: (a), brush expansion in a GPU compute pass. The boxholder:
   "isn't that the whole point of what we've done?"
3. Placement snapping: keep.
4. Side-view shadows: add `material.receivesShadow` (draft 2.9).
5. A light across washed groups: document the pattern (draft 2.9).
6. Hatching coverage: leave it as it is.
7. Chromebook check: accept desktop numbers for now.

## Production needs (not done; nothing deployed)

- beebox declares `webgpu` as a dependency, for `bbx figure run` on the
  server.
- The production server, which has no GPU, needs a software Vulkan driver
  (Mesa lavapipe). In the Lima VM test, a lit frame took about 1.3–1.5 s at
  ratio 1 on 2 CPUs.
- The browser GPU chunk is about 155 KB minified and loads lazily.
- Box-agent docs and starters (Stage 5 subplan c). The courseware box agent
  regenerates its figures.

## Next

Stage 5 writes the subplans, each through bbx-plan with cross-model review:
(a) scene core, (b) brushes on the GPU, (c) box figures. The list is in the
Stage 5 section of `../../../implemented-plans/canvas-loop-scene.md`.

Correction found while writing (b): targets 1 and 3 miss for two reasons.
Recording the walker's scene also takes about 11.4 ms per frame in
Chromium; subplan (a) owns that cost.
