# Checkpoint 5: summary for the boxholder

Stage 5 of `beebox/docs/plans/canvas-loop-scene.md`, 2026-11-15. Three
subplans, each reviewed twice by Codex (gpt-6-astra for (a) and (b),
gpt-6-sol for (c)) with every finding checked against the source.

| Subplan | What | Size (changed lines) |
|---|---|---|
| (a) `canvas-loop-scene-core.subplan.md` | The spike becomes canvas-loop's one API and renderer; the Canvas2D painter and `v.ctx` retire; headless on Dawn; gallery migrated; dev-loop tools; `receivesShadow`; recording speed | about 19,800: about 9,500 written, about 10,300 deleted. **BIG CHANGE** |
| (b) `canvas-loop-gpu-brushes.subplan.md` | Brush expansion on the GPU | about 1,930 to its stop point after chunk 6; about 3,410 in all. **BIG CHANGE** |
| (c) `canvas-loop-box-figures.subplan.md` | beebox's figure card and `bbx figure run`, the server's Vulkan driver, box-agent guidance, notices for old sketches and no-WebGPU browsers | about 835 |

## Order

1. (a) chunks 1–4: module layout, one headless runner, dev-loop checks,
   `receivesShadow`.
2. (b) chunks 1–6. Chunk 1 is an ink look gate: capsule ink beside today's
   ink on walker details; the boxholder judges it before the capsule pipeline
   is built. Chunk 6 measures and is a stop point.
3. (a) chunk 4b: recording and lowering speed, closed on whole-frame browser
   measurements (walker 60 fps, six figures 30 fps each).
4. (a) chunks 5–8: gallery migrated and judged once with the new ink, the
   switch, docs, new baselines. (b) chunks 7–9 after (a)'s switch, if chosen.
5. (c): deploy pieces, `bbx figure run`, card notices, guidance.
6. (a), (b) and (c) land on `main` in one merge (`canvas-loop/` deploys).

## Decisions now

- Approve the order and the two BIG CHANGEs, to start implementation on the
  workstream branch. Nothing merges or deploys without a further yes.

## Decisions at later gates

- (b) chunk 1: the ink look.
- (b) chunk 6: whether bristle and smudge move to the GPU (chunks 7–9).
- (a) chunk 4b: any speed target still missed.
- (c), before the cutover: how far courseware regeneration goes (lean:
  review every figure), the learner wording of the notices, and the
  production steps (Mesa on the server, the merge, the regeneration prompt).
